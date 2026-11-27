"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CartItem, MenuItem } from "../../lib/types";
import { saveTrackingCapability } from "./order-tracking";
import {
  cartFromDineInPayload,
  canCreateNewDineInSubmission,
  canSubmitWithPendingState,
  acknowledgeDineInSubmission,
  createDineInIdempotencyKey,
  createDineInOrderPayload,
  createPendingDineInSubmission,
  getDineInStorage,
  isRegisteredTableToken,
  markPendingDineInTerminal,
  postDineInSubmission,
  pendingDineInStorageKey,
  reconcilePendingDineInSubmission,
  removePendingDineInSubmission,
  savePendingDineInSubmission,
  withDineInTableLock,
  type PendingDineInStorageState,
  type PendingDineInSubmission,
} from "./dine-in-order";

export interface DineInReceipt {
  orderId: string;
  trackingToken: string;
  status: string;
  createdAt: number;
}

export type DineInPendingStatus = "loading" | "none" | "retryable" | "terminal-conflict" | "completed" | "unknown";

export type DineInSubmitState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "error"; reason: "unavailable" | "idempotency-conflict" | "catalog-not-ready" | "invalid" | "rate-limit" | "table-unavailable" | "network" | "server" | "storage" | "terminal-storage" | "coordination" | "operation-changed" };

interface CheckoutState {
  ownerToken: string;
  ready: boolean;
  pendingStatus: DineInPendingStatus;
  pending: PendingDineInSubmission | null;
  completedOrderId: string | null;
  customerName: string;
  notes: string;
  receipt: DineInReceipt | null;
  receiptOperation: PendingDineInSubmission | null;
  receiptAcknowledged: boolean;
  receiptAckError: boolean;
  submitState: DineInSubmitState;
}

function emptyState(ownerToken: string): CheckoutState {
  return {
    ownerToken,
    ready: false,
    pendingStatus: "loading",
    pending: null,
    completedOrderId: null,
    customerName: "",
    notes: "",
    receipt: null,
    receiptOperation: null,
    receiptAcknowledged: false,
    receiptAckError: false,
    submitState: { kind: "idle" },
  };
}

function persistTrackingCapability(orderId: string, token: string): boolean {
  try {
    return typeof window !== "undefined" && saveTrackingCapability(window.localStorage, orderId, token);
  } catch {
    return false;
  }
}

function stateForStorage(ownerToken: string, stored: PendingDineInStorageState): CheckoutState {
  const state = { ...emptyState(ownerToken), ready: true };
  switch (stored.kind) {
    case "none":
      return { ...state, pendingStatus: "none" };
    case "retryable":
      return {
        ...state,
        pendingStatus: "retryable",
        pending: stored.operation,
        customerName: stored.operation.payload.customerName ?? "",
        notes: stored.operation.payload.notes ?? "",
      };
    case "terminal-conflict":
      return {
        ...state,
        pendingStatus: "terminal-conflict",
        pending: stored.operation,
        customerName: stored.operation.payload.customerName ?? "",
        notes: stored.operation.payload.notes ?? "",
        submitState: { kind: "error", reason: "idempotency-conflict" },
      };
    case "completed":
      return { ...state, pendingStatus: "completed", completedOrderId: stored.orderId };
    case "unknown":
      return {
        ...state,
        pendingStatus: "unknown",
        submitState: { kind: "idle" },
      };
  }
}

export function useDineInCheckout({
  tableToken,
  menuItems,
  cart,
  setCart,
  storefrontReady,
  submitOperation = postDineInSubmission,
}: {
  tableToken: string;
  menuItems: MenuItem[];
  cart: CartItem[];
  setCart: (cart: CartItem[]) => void;
  storefrontReady: boolean;
  submitOperation?: typeof postDineInSubmission;
}) {
  const [state, setState] = useState<CheckoutState>(() => emptyState(tableToken));
  const storageReadGeneration = useRef(0);
  const activeState = state.ownerToken === tableToken ? state : emptyState(tableToken);
  const ready = activeState.ready && storefrontReady;

  const updateOwnedState = useCallback((ownerToken: string, update: (current: CheckoutState) => CheckoutState) => {
    setState((current) => current.ownerToken === ownerToken ? update(current) : current);
  }, []);

  const applyStorageState = useCallback((ownerToken: string, stored: PendingDineInStorageState, preserveUnknownEmpty: boolean) => {
    updateOwnedState(ownerToken, (current) => {
      if (stored.kind === "completed" && current.receipt?.orderId === stored.orderId)
        return {
          ...current,
          pendingStatus: "completed",
          pending: null,
          receiptOperation: null,
          completedOrderId: stored.orderId,
          receiptAcknowledged: true,
          receiptAckError: false,
        };
      if (stored.kind === "none" && preserveUnknownEmpty && current.pendingStatus !== "none")
        return { ...current, pendingStatus: "unknown", submitState: { kind: "error", reason: "server" } };
      return stateForStorage(ownerToken, stored);
    });
    if (stored.kind === "retryable" || stored.kind === "terminal-conflict")
      setCart(cartFromDineInPayload(stored.operation.payload));
    else if (stored.kind === "completed") setCart([]);
  }, [setCart, updateOwnedState]);

  useEffect(() => {
    if (!storefrontReady || !isRegisteredTableToken(tableToken)) return;
    let live = true;
    const generation = ++storageReadGeneration.current;
    const storage = getDineInStorage();
    void withDineInTableLock(tableToken, async () => {
      const stored = await reconcilePendingDineInSubmission(storage, tableToken);
      if (live && generation === storageReadGeneration.current) applyStorageState(tableToken, stored, false);
    }).catch(() => {
      if (live && generation === storageReadGeneration.current)
        updateOwnedState(tableToken, (current) => ({ ...current, pendingStatus: "unknown", submitState: { kind: "error", reason: "coordination" } }));
    });
    return () => { live = false; storageReadGeneration.current += 1; };
  }, [applyStorageState, storefrontReady, tableToken, updateOwnedState]);

  // A storage event reveals only that the hashed table record changed. The new
  // tab re-reads that record and never broadcasts personal data or a receipt.
  useEffect(() => {
    if (!storefrontReady || !isRegisteredTableToken(tableToken)) return;
    let live = true;
    let expectedKey = "";
    void pendingDineInStorageKey(tableToken).then((key) => {
      if (!live) return;
      expectedKey = key;
    }).catch(() => {});
    const onStorage = (event: StorageEvent) => {
      if (!expectedKey || event.key !== expectedKey) return;
      const ownerToken = tableToken;
      const generation = ++storageReadGeneration.current;
      void withDineInTableLock(ownerToken, async () => {
        const stored = await reconcilePendingDineInSubmission(getDineInStorage(), ownerToken);
        if (live && generation === storageReadGeneration.current) applyStorageState(ownerToken, stored, true);
      }).catch(() => {
        if (live && generation === storageReadGeneration.current)
          updateOwnedState(ownerToken, (current) => ({ ...current, pendingStatus: "unknown", submitState: { kind: "error", reason: "coordination" } }));
      });
    };
    window.addEventListener("storage", onStorage);
    return () => {
      live = false;
      window.removeEventListener("storage", onStorage);
    };
  }, [applyStorageState, storefrontReady, tableToken, updateOwnedState]);

  const send = useCallback(async (ownerToken: string, operation: PendingDineInSubmission) => {
    updateOwnedState(ownerToken, (current) => ({ ...current, submitState: { kind: "submitting" } }));
    const result = await submitOperation(operation);
    if (!result.receipt) {
      if (result.error === "idempotency-conflict") {
        const storage = getDineInStorage();
        const persisted = await markPendingDineInTerminal(storage, ownerToken, operation);
        updateOwnedState(ownerToken, (current) => persisted
          ? {
              ...current,
              pendingStatus: "terminal-conflict",
              pending: { ...operation, disposition: "terminal-conflict" },
              submitState: { kind: "error", reason: "idempotency-conflict" },
            }
          : { ...current, pendingStatus: "unknown", submitState: { kind: "error", reason: "terminal-storage" } });
        return;
      }
      updateOwnedState(ownerToken, (current) => ({ ...current, submitState: { kind: "error", reason: result.error } }));
      return;
    }

    persistTrackingCapability(result.receipt.orderId, result.receipt.trackingToken);

    updateOwnedState(ownerToken, (current) => ({
      ...current,
      pendingStatus: "retryable",
      pending: operation,
      completedOrderId: result.receipt.orderId,
      receipt: result.receipt,
      receiptOperation: operation,
      receiptAcknowledged: false,
      receiptAckError: false,
      submitState: { kind: "idle" },
    }));
  }, [submitOperation, updateOwnedState]);

  const acknowledgeReceipt = useCallback(async () => {
    const receipt = activeState.receipt;
    const operation = activeState.receiptOperation;
    if (!receipt || !operation || activeState.ownerToken !== tableToken || activeState.receiptAcknowledged) return;
    try {
      persistTrackingCapability(receipt.orderId, receipt.trackingToken);
      await withDineInTableLock(tableToken, async () => {
        const acknowledged = await acknowledgeDineInSubmission(
          getDineInStorage(), tableToken, operation, receipt.orderId,
        );
        if (!acknowledged) {
          updateOwnedState(tableToken, (current) => ({ ...current, receiptAckError: true }));
          return;
        }
        updateOwnedState(tableToken, (current) => {
          if (current.receipt?.orderId !== receipt.orderId ||
            current.receiptOperation?.idempotencyKey !== operation.idempotencyKey ||
            current.receiptOperation?.payloadJson !== operation.payloadJson) return current;
          return {
            ...current,
            pendingStatus: "completed",
            pending: null,
            receiptOperation: null,
            receiptAcknowledged: true,
            receiptAckError: false,
            submitState: { kind: "idle" },
          };
        });
        setCart([]);
      });
    } catch {
      updateOwnedState(tableToken, (current) => ({ ...current, receiptAckError: true }));
    }
  }, [activeState, setCart, tableToken, updateOwnedState]);

  const submit = useCallback(async () => {
    if (!ready || !canSubmitWithPendingState(activeState.pendingStatus) ||
      activeState.submitState.kind === "submitting" || activeState.receipt) return;
    if (activeState.submitState.kind === "error" &&
      (activeState.submitState.reason === "idempotency-conflict" || activeState.submitState.reason === "table-unavailable")) return;

    updateOwnedState(tableToken, (current) => ({ ...current, submitState: { kind: "submitting" } }));
    try {
      await withDineInTableLock(tableToken, async () => {
        // Always re-read after acquiring the cross-tab lock; state observed before
        // waiting may have been replaced by another tab's submission.
        const storage = getDineInStorage();
        const stored = await reconcilePendingDineInSubmission(storage, tableToken);
        if (stored.kind === "unknown") {
          applyStorageState(tableToken, stored, false);
          return;
        }
        if (stored.kind === "completed" || stored.kind === "terminal-conflict" || stored.kind === "retryable") {
          applyStorageState(tableToken, stored, false);
          if (stored.kind === "retryable") await send(tableToken, stored.operation);
          return;
        }
        if (!canCreateNewDineInSubmission(activeState.pendingStatus)) {
          applyStorageState(tableToken, { kind: "unknown", reason: "read-failed" }, false);
          return;
        }

        const payload = createDineInOrderPayload(tableToken, activeState.customerName, activeState.notes, cart, menuItems);
        if (!payload.payload) {
          updateOwnedState(tableToken, (current) => ({ ...current, submitState: { kind: "error", reason: "invalid" } }));
          return;
        }
        if (!storage) {
          applyStorageState(tableToken, { kind: "unknown", reason: "unavailable" }, false);
          return;
        }
        let operation: PendingDineInSubmission;
        try {
          operation = createPendingDineInSubmission(createDineInIdempotencyKey(), payload.payload);
        } catch {
          updateOwnedState(tableToken, (current) => ({ ...current, submitState: { kind: "error", reason: "storage" } }));
          return;
        }
        if (!await savePendingDineInSubmission(storage, tableToken, operation)) {
          applyStorageState(tableToken, { kind: "unknown", reason: "unavailable" }, false);
          return;
        }
        applyStorageState(tableToken, { kind: "retryable", operation }, false);
        await send(tableToken, operation);
      });
    } catch {
      updateOwnedState(tableToken, (current) => ({ ...current, submitState: { kind: "error", reason: "coordination" } }));
    }
  }, [activeState, applyStorageState, cart, menuItems, ready, send, tableToken, updateOwnedState]);

  const reloadPending = useCallback(async () => {
    try {
      await withDineInTableLock(tableToken, async () => {
        const stored = await reconcilePendingDineInSubmission(getDineInStorage(), tableToken);
        applyStorageState(tableToken, stored, true);
      });
    } catch {
      updateOwnedState(tableToken, (current) => ({ ...current, submitState: { kind: "error", reason: "coordination" } }));
    }
  }, [applyStorageState, tableToken, updateOwnedState]);

  const abandonPending = useCallback(async () => {
    const expected = activeState.pending ? { kind: "pending" as const, operation: activeState.pending } : null;
    try {
      await withDineInTableLock(tableToken, async () => {
        const storage = getDineInStorage();
        const result = await removePendingDineInSubmission(storage, tableToken, expected, "abandon");
        if (result === "changed") {
          const actual = await reconcilePendingDineInSubmission(storage, tableToken);
          applyStorageState(tableToken, actual, false);
          updateOwnedState(tableToken, (current) => ({ ...current, submitState: { kind: "error", reason: "operation-changed" } }));
          return;
        }
        if (result !== "removed") {
          applyStorageState(tableToken, { kind: "unknown", reason: "unavailable" }, false);
          return;
        }
        updateOwnedState(tableToken, (current) => ({
          ...current,
          pendingStatus: "none",
          pending: null,
          completedOrderId: null,
          receipt: null,
          submitState: { kind: "idle" },
        }));
      });
    } catch {
      updateOwnedState(tableToken, (current) => ({ ...current, submitState: { kind: "error", reason: "coordination" } }));
    }
  }, [activeState.pending, applyStorageState, tableToken, updateOwnedState]);

  const editRejectedOrder = useCallback(() => {
    if (activeState.submitState.kind === "error" && activeState.submitState.reason === "invalid")
      void abandonPending();
  }, [abandonPending, activeState.submitState]);

  const startNewOrder = useCallback(async () => {
    if (activeState.receipt && !activeState.receiptAcknowledged) return;
    const expectedOrderId = activeState.completedOrderId ??
      (activeState.receiptAcknowledged ? activeState.receipt?.orderId : null);
    if (!expectedOrderId) return;
    try {
      await withDineInTableLock(tableToken, async () => {
        const storage = getDineInStorage();
        const result = await removePendingDineInSubmission(
          storage, tableToken, { kind: "completed", orderId: expectedOrderId }, "new-order",
        );
        if (result === "changed") {
          const actual = await reconcilePendingDineInSubmission(storage, tableToken);
          applyStorageState(tableToken, actual, false);
          updateOwnedState(tableToken, (current) => ({ ...current, submitState: { kind: "error", reason: "operation-changed" } }));
          return;
        }
        if (result !== "removed") {
          updateOwnedState(tableToken, (current) => ({ ...current, submitState: { kind: "error", reason: "storage" } }));
          return;
        }
        setCart([]);
        updateOwnedState(tableToken, () => ({ ...emptyState(tableToken), ready: true, pendingStatus: "none" }));
      });
    } catch {
      updateOwnedState(tableToken, (current) => ({ ...current, submitState: { kind: "error", reason: "coordination" } }));
    }
  }, [activeState.completedOrderId, activeState.receipt, activeState.receiptAcknowledged, applyStorageState, setCart, tableToken, updateOwnedState]);

  const setCustomerName = useCallback((customerName: string) => updateOwnedState(tableToken, (current) => ({ ...current, customerName })), [tableToken, updateOwnedState]);
  const setNotes = useCallback((notes: string) => updateOwnedState(tableToken, (current) => ({ ...current, notes })), [tableToken, updateOwnedState]);

  return {
    ready,
    pendingStatus: activeState.pendingStatus,
    pending: activeState.pending,
    completedOrderId: activeState.completedOrderId,
    customerName: activeState.customerName,
    setCustomerName,
    notes: activeState.notes,
    setNotes,
    receipt: activeState.receipt,
    receiptAcknowledged: activeState.receiptAcknowledged,
    receiptAckError: activeState.receiptAckError,
    acknowledgeReceipt,
    submitState: activeState.submitState,
    submit,
    reloadPending,
    startNewOrder,
    abandonPending,
    editRejectedOrder,
  };
}

import { parseDineInCreatedAt } from "./dine-in-orders-list";
import { DINE_IN_ORDER_STATUSES } from "./dine-in-orders-list";
import type { DineInOrderStatus } from "./dine-in-orders-list";

export interface DineInOrderDetailItem {
  lineNumber: number;
  productName: string;
  quantity: number;
  unitPriceMillimes: number;
  lineTotalMillimes: number;
  options: {
    id: string;
    name: string;
    priceAdjustmentMillimes: number;
  }[];
}

export interface DineInOrderDetail {
  orderId: string;
  createdAt: string;
  status: DineInOrderStatus;
  customerName: string | null;
  customerNotes: string | null;
  tableLabel: string;
  subtotalMillimes: number;
  totalMillimes: number;
  items: DineInOrderDetailItem[];
}

export interface DineInOrderDetailState {
  orderId: string | null;
  detail: DineInOrderDetail | null;
  loading: boolean;
  error: boolean;
  statusUpdating: boolean;
  statusTarget: DineInOrderTargetStatus | null;
  statusError: DineInOrderStatusUpdateError | null;
  statusUpdated: boolean;
}

export type DineInOrderStatusUpdateError =
  | "unauthorized" | "forbidden" | "notFound" | "conflict"
  | "unavailable" | "network" | "unexpected";

export type DineInOrderTargetStatus = Exclude<DineInOrderStatus, "pending">;

const ALLOWED_STATUS_ACTIONS: Record<DineInOrderStatus, readonly DineInOrderTargetStatus[]> = {
  pending: ["confirmed", "rejected", "cancelled"],
  confirmed: ["preparing", "cancelled"],
  // Mirrors the server: an order already being prepared can only be completed.
  preparing: ["completed"],
  completed: [],
  rejected: [],
  cancelled: [],
};

export function getDineInOrderStatusActions(status: DineInOrderStatus): readonly DineInOrderTargetStatus[] {
  return ALLOWED_STATUS_ACTIONS[status];
}

const UUID_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function safeNonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function nonemptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function parseDineInOrderDetail(value: unknown): DineInOrderDetail {
  if (!isRecord(value) ||
    Object.keys(value).sort().join(",") !==
      "createdAt,customerName,customerNotes,items,orderId,status,subtotalMillimes,tableLabel,totalMillimes" ||
    typeof value.orderId !== "string" || !UUID_PATTERN.test(value.orderId) ||
    typeof value.createdAt !== "string" || !parseDineInCreatedAt(value.createdAt) ||
    typeof value.status !== "string" || !(DINE_IN_ORDER_STATUSES as readonly string[]).includes(value.status) ||
    !(value.customerName === null || typeof value.customerName === "string") ||
    !(value.customerNotes === null || typeof value.customerNotes === "string") ||
    !nonemptyString(value.tableLabel) ||
    !safeNonnegativeInteger(value.subtotalMillimes) ||
    !safeNonnegativeInteger(value.totalMillimes) || value.subtotalMillimes !== value.totalMillimes ||
    !Array.isArray(value.items) || value.items.length === 0
  ) throw new Error("Invalid dine-in order detail response.");

  let lineSum = BigInt(0);
  const items = value.items.map((candidate, index): DineInOrderDetailItem => {
    if (!isRecord(candidate) ||
      Object.keys(candidate).sort().join(",") !==
        "lineNumber,lineTotalMillimes,options,productName,quantity,unitPriceMillimes" ||
      candidate.lineNumber !== index + 1 ||
      !Number.isSafeInteger(candidate.quantity) || typeof candidate.quantity !== "number" || candidate.quantity < 1 ||
      !nonemptyString(candidate.productName) ||
      !safeNonnegativeInteger(candidate.unitPriceMillimes) ||
      !safeNonnegativeInteger(candidate.lineTotalMillimes) ||
      !Array.isArray(candidate.options)
    ) throw new Error("Invalid dine-in order detail response.");

    const seenOptionIds = new Set<string>();
    const options = candidate.options.map((optionValue) => {
      if (!isRecord(optionValue) ||
        Object.keys(optionValue).sort().join(",") !== "id,name,priceAdjustmentMillimes" ||
        typeof optionValue.id !== "string" || !/^[A-Za-z0-9_-]{1,64}$/u.test(optionValue.id) ||
        seenOptionIds.has(optionValue.id) || !nonemptyString(optionValue.name) ||
        !safeNonnegativeInteger(optionValue.priceAdjustmentMillimes)
      ) throw new Error("Invalid dine-in order detail response.");
      seenOptionIds.add(optionValue.id);
      return {
        id: optionValue.id,
        name: optionValue.name,
        priceAdjustmentMillimes: optionValue.priceAdjustmentMillimes,
      };
    });

    const optionTotal = options.reduce((sum, option) => sum + BigInt(option.priceAdjustmentMillimes), BigInt(0));
    if (optionTotal > BigInt(candidate.unitPriceMillimes) ||
      BigInt(candidate.unitPriceMillimes) * BigInt(candidate.quantity) !== BigInt(candidate.lineTotalMillimes)
    ) throw new Error("Invalid dine-in order detail response.");

    lineSum += BigInt(candidate.lineTotalMillimes);
    return {
      lineNumber: candidate.lineNumber as number,
      productName: candidate.productName,
      quantity: candidate.quantity,
      unitPriceMillimes: candidate.unitPriceMillimes,
      lineTotalMillimes: candidate.lineTotalMillimes,
      options,
    };
  });

  if (lineSum !== BigInt(value.subtotalMillimes))
    throw new Error("Invalid dine-in order detail response.");

  return {
    orderId: value.orderId,
    createdAt: value.createdAt,
    status: value.status as DineInOrderStatus,
    customerName: value.customerName,
    customerNotes: value.customerNotes,
    tableLabel: value.tableLabel,
    subtotalMillimes: value.subtotalMillimes,
    totalMillimes: value.totalMillimes,
    items,
  };
}

export function createDineInOrderDetailController(fetcher: typeof fetch = fetch) {
  let state: DineInOrderDetailState = {
    orderId: null,
    detail: null,
    loading: false,
    error: false,
    statusUpdating: false,
    statusTarget: null,
    statusError: null,
    statusUpdated: false,
  };
  let generation = 0;
  let currentRequest: { orderId: string; promise: Promise<void> } | null = null;
  const listeners = new Set<(next: DineInOrderDetailState) => void>();

  function update(next: DineInOrderDetailState) {
    state = next;
    for (const listener of listeners) listener(state);
  }

  async function open(orderId: string): Promise<void> {
    if (state.orderId === orderId && state.loading && currentRequest?.orderId === orderId)
      return currentRequest.promise;

    generation += 1;
    const requestGeneration = generation;
    update({
      orderId, detail: null, loading: true, error: false,
      statusUpdating: false, statusTarget: null, statusError: null, statusUpdated: false,
    });
    const promise = Promise.resolve().then(async () => {
      try {
        const response = await fetcher(`/api/admin/dine-in/orders/${encodeURIComponent(orderId)}`, {
          cache: "no-store",
        });
        if (!response.ok) throw new Error("Dine-in order details could not be loaded.");
        const detail = parseDineInOrderDetail(await response.json());
        if (requestGeneration === generation)
          update({ ...state, orderId, detail, loading: false, error: false });
      } catch {
        if (requestGeneration === generation)
          update({ ...state, orderId, detail: null, loading: false, error: true });
      } finally {
        if (currentRequest?.promise === promise) currentRequest = null;
      }
    });
    currentRequest = { orderId, promise };
    return promise;
  }

  return {
    getSnapshot: () => state,
    subscribe(listener: (next: DineInOrderDetailState) => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    open,
    async updateStatus(targetStatus: DineInOrderTargetStatus): Promise<DineInOrderStatusUpdateError | "stale" | null> {
      const current = state.detail;
      const orderId = state.orderId;
      if (!current || !orderId || state.statusUpdating ||
        !getDineInOrderStatusActions(current.status).includes(targetStatus)) return "unexpected";

      const requestGeneration = generation;
      update({ ...state, statusUpdating: true, statusTarget: targetStatus, statusError: null, statusUpdated: false });
      try {
        const response = await fetcher(`/api/admin/dine-in/orders/${encodeURIComponent(orderId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: targetStatus }),
        });
        if (requestGeneration !== generation || state.orderId !== orderId) return "stale";
        if (response.status !== 200) {
          const errorByStatus: Record<number, DineInOrderStatusUpdateError> = {
            401: "unauthorized", 403: "forbidden", 404: "notFound",
            409: "conflict", 503: "unavailable",
          };
          const error = errorByStatus[response.status] ?? "unexpected";
          if (error === "conflict") {
            await open(orderId);
            if (state.orderId === orderId)
              update({ ...state, statusUpdating: false, statusTarget: null, statusError: error, statusUpdated: false });
          } else {
            update({ ...state, statusUpdating: false, statusTarget: null, statusError: error, statusUpdated: false });
          }
          return error;
        }

        let result: unknown;
        try {
          result = await response.json();
        } catch {
          if (requestGeneration !== generation || state.orderId !== orderId) return "stale";
          update({ ...state, statusUpdating: false, statusTarget: null, statusError: "unexpected", statusUpdated: false });
          return "unexpected";
        }
        if (requestGeneration !== generation || state.orderId !== orderId) return "stale";
        if (!isRecord(result) || Object.keys(result).sort().join(",") !== "orderId,status" ||
          result.orderId !== orderId || result.status !== targetStatus) {
          update({ ...state, statusUpdating: false, statusTarget: null, statusError: "unexpected", statusUpdated: false });
          return "unexpected";
        }
        update({
          ...state,
          detail: { ...current, status: targetStatus },
          statusUpdating: false,
          statusTarget: null,
          statusError: null,
          statusUpdated: true,
        });
        return null;
      } catch {
        if (requestGeneration === generation && state.orderId === orderId)
          update({ ...state, statusUpdating: false, statusTarget: null, statusError: "network", statusUpdated: false });
        return requestGeneration === generation && state.orderId === orderId ? "network" : "stale";
      }
    },
    retry() {
      return state.orderId ? open(state.orderId) : Promise.resolve();
    },
    close() {
      generation += 1;
      currentRequest = null;
      update({
        orderId: null, detail: null, loading: false, error: false,
        statusUpdating: false, statusTarget: null, statusError: null, statusUpdated: false,
      });
    },
  };
}

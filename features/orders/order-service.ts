import "server-only";

import { randomUUID } from "node:crypto";
import { upgradeStoredCatalog } from "../../lib/catalog-validation";
import {
  DINE_IN_ORDER_STATUSES,
  type DineInOrderStatus,
} from "../../db/schema";
import {
  DineInOrderDomainError,
  identifyDineInOrderRequest,
  prepareDineInOrder,
  createTrustedCatalogReadiness,
} from "./order-domain";
import {
  generateTrackingToken,
  hashTrackingToken,
} from "./crypto";
import {
  type DineInOrderPersistence,
  type ExistingDineInOrder,
  type NewDineInOrderItem,
  postgresDineInOrderPersistence,
} from "./order-persistence";
import {
  createTrackingTokenRecoveryFromEnvironment,
  type TrackingTokenRecovery,
} from "./tracking-token-recovery";

export type DineInOrderServiceErrorCode =
  | "idempotency_conflict"
  | "table_unavailable";

export class DineInOrderServiceError extends Error {
  constructor(readonly code: DineInOrderServiceErrorCode, message: string) {
    super(message);
    this.name = "DineInOrderServiceError";
  }
}

export interface DineInOrderReceipt {
  orderId: string;
  trackingToken: string;
  status: DineInOrderStatus;
  createdAt: number;
  replayed: boolean;
}

export interface DineInOrderServiceOptions {
  recovery?: () => TrackingTokenRecovery;
  createOrderId?: () => string;
  createItemId?: () => string;
  createTrackingToken?: () => string;
  now?: () => number;
}

function usableMoney(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function assertSafeOrderTotals(subtotal: number, total: number): void {
  if (!usableMoney(subtotal) || !usableMoney(total) || subtotal !== total)
    throw new Error("The persisted order totals failed verification.");
}

function verifiedStatus(value: string): DineInOrderStatus {
  if ((DINE_IN_ORDER_STATUSES as readonly string[]).includes(value))
    return value as DineInOrderStatus;
  throw new Error("The persisted order status is invalid.");
}

export function createDineInOrderService<Transaction>(
  persistence: DineInOrderPersistence<Transaction>,
  options: DineInOrderServiceOptions = {},
) {
  const recovery = options.recovery ?? createTrackingTokenRecoveryFromEnvironment;
  const createOrderId = options.createOrderId ?? randomUUID;
  const createItemId = options.createItemId ?? randomUUID;
  const createToken = options.createTrackingToken ?? generateTrackingToken;
  const now = options.now ?? Date.now;

  function recoverExisting(
    existing: ExistingDineInOrder,
    requestHash: string,
    idempotencyKeyHash: string,
  ): DineInOrderReceipt {
    if (existing.requestHash !== requestHash)
      throw new DineInOrderServiceError(
        "idempotency_conflict",
        "This idempotency key was already used for a different order request.",
      );

    if (
      existing.trackingRecoveryVersion !== 1 ||
      !existing.trackingRecoveryNonce ||
      !existing.trackingRecoveryCiphertext ||
      !existing.trackingRecoveryAuthTag
    )
      throw new Error("The order tracking token cannot be recovered.");

    const token = recovery().decrypt({
      version: existing.trackingRecoveryVersion,
      nonce: existing.trackingRecoveryNonce,
      ciphertext: existing.trackingRecoveryCiphertext,
      authTag: existing.trackingRecoveryAuthTag,
    }, existing.id, idempotencyKeyHash);
    if (hashTrackingToken(token) !== existing.trackingTokenHash)
      throw new Error("The recovered order tracking token failed verification.");
    if (!Number.isSafeInteger(existing.createdAt) || existing.createdAt < 0)
      throw new Error("The persisted order timestamp is invalid.");

    return {
      orderId: existing.id,
      trackingToken: token,
      status: verifiedStatus(existing.status),
      createdAt: existing.createdAt,
      replayed: true,
    };
  }

  return {
    async submit(requestValue: unknown, idempotencyKey: unknown): Promise<DineInOrderReceipt> {
      // Canonicalize before opening the transaction. The request hash contains
      // business inputs only; it deliberately excludes QR token and catalog state.
      const identified = identifyDineInOrderRequest(requestValue, idempotencyKey);

      return persistence.withTransaction(async (transaction) => {
        await persistence.lockIdempotencyKey(transaction, identified.idempotencyKeyHash);

        // A completed retry is resolved before checking mutable table/catalog state.
        const existing = await persistence.findByIdempotencyKeyHash(
          transaction,
          identified.idempotencyKeyHash,
        );
        if (existing)
          return recoverExisting(existing, identified.requestHash, identified.idempotencyKeyHash);

        // Lock order is catalog first, then active table. Catalog CAS saves and
        // review updates cannot race price validation; QR edits cannot race the
        // active-token check. Competing updates serialize before this snapshot.
        const storedCatalog = await persistence.lockCatalog(transaction);
        if (!storedCatalog)
          throw new DineInOrderDomainError("catalog_not_ready", "The saved catalog is not ready for ordering.");

        let catalogPayload: unknown;
        try {
          catalogPayload = upgradeStoredCatalog(JSON.parse(storedCatalog.payload));
        } catch {
          throw new DineInOrderDomainError("catalog_not_ready", "The saved catalog is not ready for ordering.");
        }
        if (!catalogPayload || typeof catalogPayload !== "object" || Array.isArray(catalogPayload))
          throw new DineInOrderDomainError("catalog_not_ready", "The saved catalog is not ready for ordering.");
        const catalog = {
          ...catalogPayload,
          // The relational row is authoritative for the revision reviewed.
          revision: storedCatalog.revision,
        };

        const table = await persistence.lockActiveTable(
          transaction,
          identified.canonicalRequest.tableTokenHash,
        );
        if (!table)
          throw new DineInOrderServiceError(
            "table_unavailable",
            "This table QR is invalid or inactive.",
          );

        const readiness =
          storedCatalog.priceReviewedRevision === storedCatalog.revision &&
          Number.isSafeInteger(storedCatalog.priceReviewedAt) &&
          (storedCatalog.priceReviewedAt ?? 0) > 0
            ? createTrustedCatalogReadiness(storedCatalog.priceReviewedRevision)
            : null;
        const prepared = prepareDineInOrder(
          requestValue,
          idempotencyKey,
          catalog,
          readiness,
          { ...table, isActive: true },
        );
        if (
          prepared.requestHash !== identified.requestHash ||
          prepared.idempotencyKeyHash !== identified.idempotencyKeyHash
        )
          throw new Error("Order request identity changed during validation.");

        const createdAt = now();
        if (!Number.isSafeInteger(createdAt) || createdAt < 0)
          throw new Error("The order timestamp is invalid.");
        const id = createOrderId();
        const trackingToken = createToken();
        const trackingTokenHash = hashTrackingToken(trackingToken);
        if (!trackingTokenHash) throw new Error("Generated tracking token is invalid.");
        const envelope = recovery().encrypt(
          trackingToken,
          id,
          identified.idempotencyKeyHash,
        );

        const header = {
          id,
          trackingTokenHash,
          idempotencyKeyHash: identified.idempotencyKeyHash,
          requestHash: identified.requestHash,
          tableId: table.id,
          tableLabelSnapshot: table.label,
          status: prepared.snapshot.status,
          subtotalMillimes: prepared.snapshot.subtotalMillimes,
          totalMillimes: prepared.snapshot.totalMillimes,
          customerName: prepared.snapshot.customerName,
          customerNotes: prepared.snapshot.customerNotes,
          trackingRecoveryVersion: envelope.version,
          trackingRecoveryNonce: envelope.nonce,
          trackingRecoveryCiphertext: envelope.ciphertext,
          trackingRecoveryAuthTag: envelope.authTag,
          createdAt,
          updatedAt: createdAt,
        } as const;

        assertSafeOrderTotals(header.subtotalMillimes, header.totalMillimes);
        const insertedHeader = await persistence.insertOrder(transaction, header);
        if (!insertedHeader) {
          // Handles a writer that reached the unique index without taking our
          // advisory lock. ON CONFLICT DO NOTHING keeps this transaction usable.
          const winner = await persistence.findByIdempotencyKeyHash(
            transaction,
            identified.idempotencyKeyHash,
          );
          if (!winner) throw new Error("The order idempotency conflict could not be resolved.");
          return recoverExisting(winner, identified.requestHash, identified.idempotencyKeyHash);
        }
        if (
          insertedHeader.id !== id ||
          insertedHeader.status !== "pending" ||
          insertedHeader.tableLabelSnapshot !== table.label ||
          insertedHeader.createdAt !== createdAt ||
          insertedHeader.updatedAt !== createdAt
        )
          throw new Error("The persisted order header failed verification.");
        assertSafeOrderTotals(insertedHeader.subtotalMillimes, insertedHeader.totalMillimes);

        if (prepared.snapshot.items.length < 1)
          throw new Error("An order must contain at least one item.");
        const items: NewDineInOrderItem[] = prepared.snapshot.items.map((item, index) => ({
          id: createItemId(),
          orderId: id,
          lineNumber: index + 1,
          productIdSnapshot: item.productIdSnapshot,
          productNameSnapshot: item.productNameSnapshot,
          quantity: item.quantity,
          unitPriceMillimes: item.unitPriceMillimes,
          lineSubtotalMillimes: item.lineSubtotalMillimes,
          optionSnapshots: item.optionSnapshots.map((option) => ({ ...option })),
        }));
        const insertedItems = await persistence.insertItems(transaction, items);
        if (insertedItems.length !== items.length)
          throw new Error("The persisted order item count failed verification.");

        const byLineNumber = new Map(insertedItems.map((item) => [item.lineNumber, item]));
        if (byLineNumber.size !== items.length)
          throw new Error("The persisted order item lines failed verification.");
        let persistedSubtotal = BigInt(0);
        for (const expected of items) {
          const actual = byLineNumber.get(expected.lineNumber);
          if (
            !actual ||
            actual.quantity !== expected.quantity ||
            actual.unitPriceMillimes !== expected.unitPriceMillimes ||
            actual.lineSubtotalMillimes !== expected.lineSubtotalMillimes ||
            !usableMoney(actual.unitPriceMillimes) ||
            !usableMoney(actual.lineSubtotalMillimes) ||
            !Number.isSafeInteger(actual.quantity) ||
            BigInt(actual.lineSubtotalMillimes) !== BigInt(actual.unitPriceMillimes) * BigInt(actual.quantity)
          )
            throw new Error("A persisted order item failed verification.");
          persistedSubtotal += BigInt(actual.lineSubtotalMillimes);
        }
        if (
          persistedSubtotal !== BigInt(insertedHeader.subtotalMillimes) ||
          insertedHeader.totalMillimes !== prepared.snapshot.totalMillimes
        )
          throw new Error("The persisted order totals failed verification.");

        return {
          orderId: id,
          trackingToken,
          status: "pending",
          createdAt,
          replayed: false,
        };
      });
    },
  };
}

// Importing this module does not open a connection; the transaction adapter
// creates its pool lazily when a submission actually runs.
export const submitDineInOrder = createDineInOrderService(postgresDineInOrderPersistence);

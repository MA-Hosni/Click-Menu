import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { dineInOrderItems, dineInOrders, restaurantCatalogs, restaurantTables } from "../../db/schema";
import { withDatabaseTransaction } from "../../db/transaction";
import type { DatabaseTransaction } from "../../db/transaction";

export interface ExistingDineInOrder {
  id: string;
  trackingTokenHash: string;
  idempotencyKeyHash: string;
  requestHash: string;
  status: string;
  createdAt: number;
  trackingRecoveryVersion: number | null;
  trackingRecoveryNonce: string | null;
  trackingRecoveryCiphertext: string | null;
  trackingRecoveryAuthTag: string | null;
}

export interface LockedCatalogRecord {
  payload: string;
  revision: number;
  tndReviewedRevision: number | null;
  tndReviewedAt: number | null;
}

export interface LockedRestaurantTable {
  id: string;
  label: string;
  qrTokenHash: string;
}

export interface NewDineInOrder {
  id: string;
  trackingTokenHash: string;
  idempotencyKeyHash: string;
  requestHash: string;
  tableId: string;
  tableLabelSnapshot: string;
  status: "pending";
  currency: "TND";
  subtotalMillimes: number;
  totalMillimes: number;
  customerName: string | null;
  customerNotes: string | null;
  trackingRecoveryVersion: 1;
  trackingRecoveryNonce: string;
  trackingRecoveryCiphertext: string;
  trackingRecoveryAuthTag: string;
  createdAt: number;
  updatedAt: number;
}

export interface NewDineInOrderItem {
  id: string;
  orderId: string;
  lineNumber: number;
  productIdSnapshot: string;
  productNameSnapshot: string;
  quantity: number;
  unitPriceMillimes: number;
  lineSubtotalMillimes: number;
  optionSnapshots: {
    id: string;
    name: string;
    priceAdjustmentMillimes: number;
  }[];
}

export interface InsertedDineInOrder {
  id: string;
  tableLabelSnapshot: string;
  status: string;
  currency: string;
  subtotalMillimes: number;
  totalMillimes: number;
  createdAt: number;
  updatedAt: number;
}

export interface InsertedDineInOrderItem {
  lineNumber: number;
  quantity: number;
  unitPriceMillimes: number;
  lineSubtotalMillimes: number;
}

export interface DineInOrderPersistence<Transaction> {
  withTransaction<Result>(callback: (transaction: Transaction) => Promise<Result>): Promise<Result>;
  lockIdempotencyKey(transaction: Transaction, idempotencyKeyHash: string): Promise<void>;
  findByIdempotencyKeyHash(transaction: Transaction, hash: string): Promise<ExistingDineInOrder | null>;
  lockCatalog(transaction: Transaction): Promise<LockedCatalogRecord | null>;
  lockActiveTable(transaction: Transaction, tokenHash: string): Promise<LockedRestaurantTable | null>;
  insertOrder(transaction: Transaction, order: NewDineInOrder): Promise<InsertedDineInOrder | null>;
  insertItems(transaction: Transaction, items: NewDineInOrderItem[]): Promise<InsertedDineInOrderItem[]>;
}

export type DineInOrderTransaction = Pick<DatabaseTransaction, "execute" | "select" | "insert">;

export type DineInOrderTransactionRunner = <Result>(
  callback: (transaction: DineInOrderTransaction) => Promise<Result>,
) => Promise<Result>;

/**
 * Builds the shared PostgreSQL persistence statements around a transaction
 * runner. Production supplies the Neon WebSocket runner; local integration
 * tests supply a node-postgres runner over disposable PostgreSQL. New-order
 * lock order is idempotency advisory lock, catalog row, then table row.
 */
export function createPostgresDineInOrderPersistence(
  withTransaction: DineInOrderTransactionRunner = withDatabaseTransaction,
): DineInOrderPersistence<DineInOrderTransaction> {
  return {
    withTransaction,

    async lockIdempotencyKey(transaction, idempotencyKeyHash) {
      // hashtextextended maps the digest to PostgreSQL's signed 64-bit advisory
      // key without converting it through a JavaScript number. A 64-bit collision
      // only serializes unrelated requests; the unique digest index is authoritative.
      await transaction.execute(sql`
      SELECT pg_advisory_xact_lock(hashtextextended(${idempotencyKeyHash}, 0::bigint))
    `);
    },

    async findByIdempotencyKeyHash(transaction, hash) {
      const [row] = await transaction
        .select({
          id: dineInOrders.id,
          trackingTokenHash: dineInOrders.trackingTokenHash,
          idempotencyKeyHash: dineInOrders.idempotencyKeyHash,
          requestHash: dineInOrders.requestHash,
          status: dineInOrders.status,
          createdAt: dineInOrders.createdAt,
          trackingRecoveryVersion: dineInOrders.trackingRecoveryVersion,
          trackingRecoveryNonce: dineInOrders.trackingRecoveryNonce,
          trackingRecoveryCiphertext: dineInOrders.trackingRecoveryCiphertext,
          trackingRecoveryAuthTag: dineInOrders.trackingRecoveryAuthTag,
        })
        .from(dineInOrders)
        .where(eq(dineInOrders.idempotencyKeyHash, hash))
        .limit(1);
      return row ?? null;
    },

    async lockCatalog(transaction) {
      const [row] = await transaction
        .select({
          payload: restaurantCatalogs.payload,
          revision: restaurantCatalogs.revision,
          tndReviewedRevision: restaurantCatalogs.tndReviewedRevision,
          tndReviewedAt: restaurantCatalogs.tndReviewedAt,
        })
        .from(restaurantCatalogs)
        .where(eq(restaurantCatalogs.id, 1))
        .limit(1)
        .for("share");
      return row ?? null;
    },

    async lockActiveTable(transaction, tokenHash) {
      const [row] = await transaction
        .select({
          id: restaurantTables.id,
          label: restaurantTables.label,
          qrTokenHash: restaurantTables.qrTokenHash,
        })
        .from(restaurantTables)
        .where(and(
          eq(restaurantTables.qrTokenHash, tokenHash),
          eq(restaurantTables.isActive, true),
        ))
        .limit(1)
        .for("share");
      return row ?? null;
    },

    async insertOrder(transaction, order) {
      const [row] = await transaction
        .insert(dineInOrders)
        .values(order)
        .onConflictDoNothing({ target: dineInOrders.idempotencyKeyHash })
        .returning({
          id: dineInOrders.id,
          tableLabelSnapshot: dineInOrders.tableLabelSnapshot,
          status: dineInOrders.status,
          currency: dineInOrders.currency,
          subtotalMillimes: dineInOrders.subtotalMillimes,
          totalMillimes: dineInOrders.totalMillimes,
          createdAt: dineInOrders.createdAt,
          updatedAt: dineInOrders.updatedAt,
        });
      return row ?? null;
    },

    async insertItems(transaction, items) {
      return transaction
        .insert(dineInOrderItems)
        .values(items)
        .returning({
          lineNumber: dineInOrderItems.lineNumber,
          quantity: dineInOrderItems.quantity,
          unitPriceMillimes: dineInOrderItems.unitPriceMillimes,
          lineSubtotalMillimes: dineInOrderItems.lineSubtotalMillimes,
        });
    },
  };
}

export const postgresDineInOrderPersistence = createPostgresDineInOrderPersistence();

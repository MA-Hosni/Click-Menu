import "server-only";

import { eq } from "drizzle-orm";
import { dineInOrders } from "../../db/schema";
import { withDatabaseTransaction } from "../../db/transaction";
import type { DatabaseTransaction } from "../../db/transaction";
import {
  DineInOrderTransitionConflict,
  isAllowedDineInOrderTransition,
} from "./order-status";
import type { ConfirmedAndPreparingDineInOrder, DineInOrderTargetStatus, UpdatedDineInOrderStatus } from "./order-status";

type StatusTransaction = Pick<DatabaseTransaction, "select" | "update">;
type StatusTransactionRunner = <Result>(
  callback: (transaction: StatusTransaction) => Promise<Result>,
) => Promise<Result>;

interface LockedOrder {
  id: string;
  status: string;
  updatedAt: number;
}

async function lockOrder(transaction: StatusTransaction, orderId: string): Promise<LockedOrder | null> {
  const [current] = await transaction
    .select({ id: dineInOrders.id, status: dineInOrders.status, updatedAt: dineInOrders.updatedAt })
    .from(dineInOrders)
    .where(eq(dineInOrders.id, orderId))
    .limit(1)
    .for("update");
  return current ?? null;
}

function nextRevision(current: LockedOrder): number {
  if (!Number.isSafeInteger(current.updatedAt) || current.updatedAt < 0 || current.updatedAt >= Number.MAX_SAFE_INTEGER)
    throw new Error("Persisted order revision is outside the supported range.");
  return Math.max(Date.now(), current.updatedAt + 1);
}

async function writeTransition(
  transaction: StatusTransaction,
  current: LockedOrder,
  targetStatus: DineInOrderTargetStatus,
): Promise<{ orderId: string; status: string; revision: number }> {
  const revision = nextRevision(current);
  const [updated] = await transaction
    .update(dineInOrders)
    .set({ status: targetStatus, updatedAt: revision })
    .where(eq(dineInOrders.id, current.id))
    .returning({ orderId: dineInOrders.id, status: dineInOrders.status });
  if (!updated) throw new Error("The locked order could not be updated.");
  return { orderId: updated.orderId, status: updated.status, revision };
}

export function createPostgresDineInOrderStatusUpdater(
  withTransaction: StatusTransactionRunner = withDatabaseTransaction,
): (orderId: string, targetStatus: DineInOrderTargetStatus) => Promise<UpdatedDineInOrderStatus | null> {
  return (orderId, targetStatus) => withTransaction(async (transaction) => {
    const current = await lockOrder(transaction, orderId);
    if (!current) return null;
    if (!isAllowedDineInOrderTransition(current.status, targetStatus))
      throw new DineInOrderTransitionConflict();

    const updated = await writeTransition(transaction, current, targetStatus);
    return { orderId: updated.orderId, status: updated.status as DineInOrderTargetStatus };
  });
}

export const updateDineInOrderStatus = createPostgresDineInOrderStatusUpdater();

export function createPostgresConfirmAndPrepareUpdater(
  withTransaction: StatusTransactionRunner = withDatabaseTransaction,
): (orderId: string, revision: number) => Promise<ConfirmedAndPreparingDineInOrder | null> {
  return (orderId, revision) => withTransaction(async (transaction) => {
    const current = await lockOrder(transaction, orderId);
    if (!current) return null;
    if (current.updatedAt !== revision || current.status !== "pending")
      throw new DineInOrderTransitionConflict();

    if (!isAllowedDineInOrderTransition(current.status, "confirmed"))
      throw new DineInOrderTransitionConflict();
    const intermediateStatus: DineInOrderTargetStatus = "confirmed";
    if (!isAllowedDineInOrderTransition(intermediateStatus, "preparing"))
      throw new DineInOrderTransitionConflict();

    // Both legal steps are checked above; one explicit action persists the final state and bumps once.
    const updated = await writeTransition(transaction, current, "preparing");
    return { orderId: updated.orderId, status: "preparing", revision: updated.revision };
  });
}

export const confirmAndPrepareDineInOrder = createPostgresConfirmAndPrepareUpdater();

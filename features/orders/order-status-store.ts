import "server-only";

import { eq } from "drizzle-orm";
import { dineInOrders } from "../../db/schema";
import { withDatabaseTransaction } from "../../db/transaction";
import type { DatabaseTransaction } from "../../db/transaction";
import {
  DineInOrderTransitionConflict,
  isAllowedDineInOrderTransition,
} from "./order-status";
import type { DineInOrderTargetStatus, UpdatedDineInOrderStatus } from "./order-status";

type StatusTransaction = Pick<DatabaseTransaction, "select" | "update">;
type StatusTransactionRunner = <Result>(
  callback: (transaction: StatusTransaction) => Promise<Result>,
) => Promise<Result>;

export function createPostgresDineInOrderStatusUpdater(
  withTransaction: StatusTransactionRunner = withDatabaseTransaction,
): (orderId: string, targetStatus: DineInOrderTargetStatus) => Promise<UpdatedDineInOrderStatus | null> {
  return (orderId, targetStatus) => withTransaction(async (transaction) => {
    const [current] = await transaction
      .select({ id: dineInOrders.id, status: dineInOrders.status, updatedAt: dineInOrders.updatedAt })
      .from(dineInOrders)
      .where(eq(dineInOrders.id, orderId))
      .limit(1)
      .for("update");

    if (!current) return null;
    if (!isAllowedDineInOrderTransition(current.status, targetStatus))
      throw new DineInOrderTransitionConflict();

    const [updated] = await transaction
      .update(dineInOrders)
      .set({ status: targetStatus, updatedAt: Math.max(Date.now(), current.updatedAt + 1) })
      .where(eq(dineInOrders.id, orderId))
      .returning({ orderId: dineInOrders.id, status: dineInOrders.status });
    if (!updated) throw new Error("The locked order could not be updated.");
    return { orderId: updated.orderId, status: updated.status as DineInOrderTargetStatus };
  });
}

export const updateDineInOrderStatus = createPostgresDineInOrderStatusUpdater();

import { desc, eq } from "drizzle-orm";
import { getDb } from "../db";
import { orders } from "../db/schema";
import {
  withStatus,
  type OrderRecord,
} from "./orders";

/** Reads legacy order rows for authenticated, read-only historical access. */
export async function listOrders(
  /** Historical partition key retained for old rows. */
  ownerId: string,
  limit = 100,
): Promise<OrderRecord[]> {
  const rows = await getDb()
    .select({ payload: orders.payload })
    .from(orders)
    .where(eq(orders.ownerId, ownerId))
    .orderBy(desc(orders.createdAt))
    .limit(limit);
  return rows.map((row) => withStatus(JSON.parse(row.payload) as OrderRecord));
}

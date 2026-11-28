import "server-only";

import { desc, eq, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "../../db/schema";
import { dineInOrders } from "../../db/schema";
import { jsonResponse, requireAdmin, routeError } from "../../lib/api-security";
import type { RequestIdentity } from "../../lib/api-security";

const MAX_SAFE_INTEGER = BigInt(Number.MAX_SAFE_INTEGER);

export interface DineInOrderDashboardSummary {
  pendingCount: number;
  preparingCount: number;
  todayDoneOrderCount: number;
  todayInKitchenTotalMillimes: number;
  todayTotalMillimes: number;
  latestPendingOrder: { orderId: string; createdAt: string } | null;
}

function safeInteger(value: unknown): number {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(value))
    throw new Error("Persisted order dashboard summary failed integrity validation.");
  const integer = BigInt(value);
  if (integer > MAX_SAFE_INTEGER)
    throw new Error("Persisted order dashboard summary failed integrity validation.");
  return Number(integer);
}

export async function queryDineInOrderDashboardSummary<Database extends PgDatabase<PgQueryResultHKT, typeof schema>>(
  database: Database,
): Promise<DineInOrderDashboardSummary> {
  const [row] = await database.select({
    pendingCount: sql<string>`count(*) FILTER (WHERE ${dineInOrders.status} = 'pending')::text`,
    preparingCount: sql<string>`count(*) FILTER (WHERE ${dineInOrders.status} IN ('confirmed', 'preparing'))::text`,
    todayDoneOrderCount: sql<string>`count(*) FILTER (
      WHERE ${dineInOrders.status} = 'completed'
        AND timezone('Africa/Tunis', to_timestamp(${dineInOrders.createdAt} / 1000.0))::date =
        timezone('Africa/Tunis', now())::date
    )::text`,
    todayInKitchenTotalMillimes: sql<string>`coalesce(sum(${dineInOrders.totalMillimes}) FILTER (
      WHERE ${dineInOrders.status} IN ('confirmed', 'preparing')
        AND timezone('Africa/Tunis', to_timestamp(${dineInOrders.createdAt} / 1000.0))::date =
        timezone('Africa/Tunis', now())::date
    ), 0)::text`,
    todayTotalMillimes: sql<string>`coalesce(sum(${dineInOrders.totalMillimes}) FILTER (
      WHERE ${dineInOrders.status} = 'completed'
        AND timezone('Africa/Tunis', to_timestamp(${dineInOrders.createdAt} / 1000.0))::date =
        timezone('Africa/Tunis', now())::date
    ), 0)::text`,
  }).from(dineInOrders);

  const [latestPending] = await database.select({
    orderId: dineInOrders.id,
    createdAt: sql<string>`${dineInOrders.createdAt}::text`,
  }).from(dineInOrders)
    .where(eq(dineInOrders.status, "pending"))
    .orderBy(desc(dineInOrders.createdAt), desc(dineInOrders.id))
    .limit(1);

  if (!row) throw new Error("Order dashboard summary query returned no aggregate row.");
  return {
    pendingCount: safeInteger(row.pendingCount),
    preparingCount: safeInteger(row.preparingCount),
    todayDoneOrderCount: safeInteger(row.todayDoneOrderCount),
    todayInKitchenTotalMillimes: safeInteger(row.todayInKitchenTotalMillimes),
    todayTotalMillimes: safeInteger(row.todayTotalMillimes),
    latestPendingOrder: latestPending ? { orderId: latestPending.orderId, createdAt: latestPending.createdAt } : null,
  };
}

export function createDineInOrderDashboardSummaryGetHandler(dependencies: {
  getCurrentUser(): Promise<RequestIdentity | null>;
  getSummary(): Promise<DineInOrderDashboardSummary>;
}) {
  return async function GET(): Promise<Response> {
    try {
      requireAdmin(await dependencies.getCurrentUser());
      return jsonResponse(await dependencies.getSummary());
    } catch (error) {
      return routeError(error);
    }
  };
}

import "server-only";

import { and, eq, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "../../db/schema";
import { dineInOrders, DINE_IN_ORDER_STATUSES } from "../../db/schema";
import { hashTrackingToken } from "./crypto";

const ORDER_ID_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/u;

export interface CustomerDineInTrackingStatus {
  orderReference: string;
  status: (typeof DINE_IN_ORDER_STATUSES)[number];
  updatedAt: number;
}

export async function queryCustomerDineInTrackingStatus<Database extends PgDatabase<PgQueryResultHKT, typeof schema>>(
  database: Database,
  orderId: string,
  trackingToken: unknown,
): Promise<CustomerDineInTrackingStatus | null> {
  const tokenHash = hashTrackingToken(trackingToken);
  if (!ORDER_ID_PATTERN.test(orderId) || !tokenHash) return null;

  const [row] = await database
    .select({
      orderId: dineInOrders.id,
      status: dineInOrders.status,
      updatedAt: sql<string>`${dineInOrders.updatedAt}::text`,
    })
    .from(dineInOrders)
    .where(and(
      eq(dineInOrders.id, orderId),
      eq(dineInOrders.trackingTokenHash, tokenHash),
    ))
    .limit(1);

  if (!row) return null;
  if (
    !DINE_IN_ORDER_STATUSES.includes(row.status as (typeof DINE_IN_ORDER_STATUSES)[number]) ||
    !/^(?:0|[1-9][0-9]*)$/u.test(row.updatedAt) ||
    BigInt(row.updatedAt) > BigInt(Number.MAX_SAFE_INTEGER)
  )
    throw new Error("Persisted customer tracking status failed integrity validation.");

  return {
    // The first eight characters are the short reference the customer receipt
    // and the administrator board both show, so all three agree.
    orderReference: row.orderId.slice(0, 8).toUpperCase(),
    status: row.status as CustomerDineInTrackingStatus["status"],
    updatedAt: Number(row.updatedAt),
  };
}

export const getCustomerDineInTrackingStatus = (
  orderId: string,
  trackingToken: unknown,
) => import("../../db").then(({ getDb }) =>
  queryCustomerDineInTrackingStatus(getDb(), orderId, trackingToken),
);

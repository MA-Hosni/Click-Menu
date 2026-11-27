import "server-only";

import { and, desc, eq, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "../../db/schema";
import { dineInOrders, DINE_IN_ORDER_STATUSES } from "../../db/schema";
import { ApiError, jsonResponse, requireAdmin, routeError } from "../../lib/api-security";
import type { RequestIdentity } from "../../lib/api-security";

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;
const MAX_CURSOR_LENGTH = 1_024;
const UUID_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/u;
const BIGINT_MIN = -(BigInt(2) ** BigInt(63));
const BIGINT_MAX = BigInt(2) ** BigInt(63) - BigInt(1);

export type DineInOrderListStatus = (typeof DINE_IN_ORDER_STATUSES)[number];

export interface DineInOrderListOptions {
  limit: number;
  status: DineInOrderListStatus | null;
  cursor: string | null;
}

export interface DineInOrderSummary {
  orderId: string;
  /** Exact PostgreSQL BIGINT epoch-millisecond value, serialized as decimal text. */
  createdAt: string;
  status: DineInOrderListStatus;
  customerName: string | null;
  tableLabel: string;
  totalMillimes: number;
}

interface OrderCursor {
  v: 1;
  status: DineInOrderListStatus | null;
  createdAt: string;
  orderId: string;
}

function isStatus(value: unknown): value is DineInOrderListStatus {
  return typeof value === "string" && (DINE_IN_ORDER_STATUSES as readonly string[]).includes(value);
}

function singleParameter(url: URL, name: string): string | null {
  const values = url.searchParams.getAll(name);
  if (values.length > 1) throw new ApiError(`The ${name} parameter is invalid.`, 400);
  return values[0] ?? null;
}

export function parseDineInOrderListOptions(url: URL): DineInOrderListOptions {
  for (const name of url.searchParams.keys()) {
    if (name !== "limit" && name !== "status" && name !== "cursor")
      throw new ApiError("The query parameters are invalid.", 400);
  }

  const rawLimit = singleParameter(url, "limit");
  let limit = DEFAULT_PAGE_SIZE;
  if (rawLimit !== null) {
    if (!/^[1-9][0-9]*$/u.test(rawLimit)) throw new ApiError("The limit is invalid.", 400);
    limit = Number(rawLimit);
    if (!Number.isSafeInteger(limit) || limit > MAX_PAGE_SIZE)
      throw new ApiError(`The limit must be between 1 and ${MAX_PAGE_SIZE}.`, 400);
  }

  const rawStatus = singleParameter(url, "status");
  if (rawStatus !== null && !isStatus(rawStatus))
    throw new ApiError("The status is invalid.", 400);

  const cursor = singleParameter(url, "cursor");
  if (cursor !== null) decodeOrderCursor(cursor, rawStatus as DineInOrderListStatus | null);

  return { limit, status: rawStatus as DineInOrderListStatus | null, cursor };
}

function decodeOrderCursor(value: string, requestedStatus: DineInOrderListStatus | null): OrderCursor {
  try {
    if (!value || value.length > MAX_CURSOR_LENGTH || !/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error();
    const json = Buffer.from(value, "base64url").toString("utf8");
    if (Buffer.from(json, "utf8").toString("base64url") !== value) throw new Error();
    const parsed: unknown = JSON.parse(json);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    const record = parsed as Record<string, unknown>;
    if (Object.keys(record).sort().join(",") !== "createdAt,orderId,status,v") throw new Error();
    if (JSON.stringify(record) !== json) throw new Error();
    if (record.v !== 1 || record.status !== requestedStatus) throw new Error();
    if (typeof record.createdAt !== "string" || !/^(?:0|-?[1-9][0-9]*)$/u.test(record.createdAt)) throw new Error();
    const createdAt = BigInt(record.createdAt);
    if (createdAt < BIGINT_MIN || createdAt > BIGINT_MAX) throw new Error();
    if (typeof record.orderId !== "string" || !UUID_PATTERN.test(record.orderId)) throw new Error();
    return record as unknown as OrderCursor;
  } catch {
    throw new ApiError("The cursor is invalid or does not match the requested status filter.", 400);
  }
}

function encodeOrderCursor(row: DineInOrderSummary, status: DineInOrderListStatus | null): string {
  const value: OrderCursor = { v: 1, status, createdAt: row.createdAt, orderId: row.orderId };
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

/** Execute the same Drizzle query with either production Neon HTTP or an isolated PostgreSQL test database. */
export async function queryDineInOrderSummaries<Database extends PgDatabase<PgQueryResultHKT, typeof schema>>(
  database: Database,
  options: DineInOrderListOptions,
): Promise<{ orders: DineInOrderSummary[]; nextCursor: string | null }> {
  const cursor = options.cursor ? decodeOrderCursor(options.cursor, options.status) : null;
  const predicates = [];
  if (options.status) predicates.push(eq(dineInOrders.status, options.status));
  if (cursor) {
    predicates.push(sql`(${dineInOrders.createdAt}, ${dineInOrders.id}) < (${cursor.createdAt}::bigint, ${cursor.orderId}::text)`);
  }

  const rows = await database
    .select({
      orderId: dineInOrders.id,
      createdAt: sql<string>`${dineInOrders.createdAt}::text`,
      status: dineInOrders.status,
      customerName: dineInOrders.customerName,
      tableLabel: dineInOrders.tableLabelSnapshot,
      totalMillimes: dineInOrders.totalMillimes,
    })
    .from(dineInOrders)
    .where(predicates.length ? and(...predicates) : undefined)
    .orderBy(desc(dineInOrders.createdAt), desc(dineInOrders.id))
    .limit(options.limit + 1);

  const hasMore = rows.length > options.limit;
  const pageRows = hasMore ? rows.slice(0, options.limit) : rows;
  const orders = pageRows.map((row) => {
    if (!Number.isSafeInteger(row.totalMillimes) || !/^(?:0|-?[1-9][0-9]*)$/u.test(row.createdAt))
      throw new Error("A persisted order summary contains an invalid numeric value.");
    return { ...row, status: row.status as DineInOrderListStatus };
  });
  const last = orders.at(-1);
  return {
    orders,
    nextCursor: hasMore && last ? encodeOrderCursor(last, options.status) : null,
  };
}

export function createDineInOrderListGetHandler(dependencies: {
  getCurrentUser(): Promise<RequestIdentity | null>;
  list(options: DineInOrderListOptions): Promise<{ orders: DineInOrderSummary[]; nextCursor: string | null }>;
}) {
  return async function GET(request: Request): Promise<Response> {
    try {
      requireAdmin(await dependencies.getCurrentUser());
      const options = parseDineInOrderListOptions(new URL(request.url));
      const result = await dependencies.list(options);
      return jsonResponse({
        orders: result.orders,
        pagination: { limit: options.limit, nextCursor: result.nextCursor },
      });
    } catch (error) {
      return routeError(error);
    }
  };
}


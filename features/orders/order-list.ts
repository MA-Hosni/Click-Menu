import "server-only";

import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "../../db/schema";
import { dineInOrderItems, dineInOrders, DINE_IN_ORDER_STATUSES } from "../../db/schema";
import { ApiError, jsonResponse, requireAdmin, routeError } from "../../lib/api-security";
import type { RequestIdentity } from "../../lib/api-security";

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;
const MAX_CURSOR_LENGTH = 1_024;
const UUID_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/u;
const BIGINT_MIN = -(BigInt(2) ** BigInt(63));
const BIGINT_MAX = BigInt(2) ** BigInt(63) - BigInt(1);

export type DineInOrderListStatus = (typeof DINE_IN_ORDER_STATUSES)[number];
export type DineInOrderListFilter = DineInOrderListStatus | "in_progress" | "finished" | null;
/** Which calendar days the board covers. "today" uses the restaurant's timezone. */
export type DineInOrderListScope = "all" | "today";

const FILTER_STATUSES: Record<"in_progress" | "finished", readonly DineInOrderListStatus[]> = {
  in_progress: ["pending", "confirmed", "preparing"],
  finished: ["completed", "rejected", "cancelled"],
};

const MAX_QUERY_LENGTH = 100;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

export interface DineInOrderListOptions {
  limit: number;
  status: DineInOrderListFilter;
  scope: DineInOrderListScope;
  /** Free text matched against the customer name, the table label, and the order reference. */
  query: string | null;
  /** Inclusive first day of the range, as `YYYY-MM-DD`. */
  fromDate: string | null;
  /** Inclusive last day of the range, as `YYYY-MM-DD`. */
  toDate: string | null;
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
  revision: number;
  customerNotes: string | null;
  items: { productName: string; quantity: number; lineTotalMillimes: number; options: string[] }[];
}

interface OrderCursor {
  v: 3;
  /** The normalized filter this cursor belongs to. */
  filter: string;
  createdAt: string;
  orderId: string;
}

function isStatus(value: unknown): value is DineInOrderListStatus {
  return typeof value === "string" && (DINE_IN_ORDER_STATUSES as readonly string[]).includes(value);
}

function isFilter(value: unknown): value is Exclude<DineInOrderListFilter, null> {
  return isStatus(value) || value === "in_progress" || value === "finished";
}

function isScope(value: unknown): value is DineInOrderListScope {
  return value === "all" || value === "today";
}

function singleParameter(url: URL, name: string): string | null {
  const values = url.searchParams.getAll(name);
  if (values.length > 1) throw new ApiError(`The ${name} parameter is invalid.`, 400);
  return values[0] ?? null;
}

/** Escapes the LIKE wildcards so a search term is matched literally. */
function escapeLikeTerm(value: string): string {
  return value.replace(/[\\%_]/gu, (character) => `\\${character}`);
}

function normalizeQuery(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > MAX_QUERY_LENGTH)
    throw new ApiError(`The q parameter must be at most ${MAX_QUERY_LENGTH} characters.`, 400);
  return trimmed;
}

function normalizeDate(value: string | null, name: string): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!DATE_PATTERN.test(trimmed) || Number.isNaN(Date.parse(`${trimmed}T00:00:00`)))
    throw new ApiError(`The ${name} parameter is invalid.`, 400);
  return trimmed;
}

/** The filter a cursor belongs to, compared as one stable string. */
function filterSignature(options: {
  status: DineInOrderListFilter;
  scope: DineInOrderListScope;
  query: string | null;
  fromDate: string | null;
  toDate: string | null;
}): string {
  return JSON.stringify([options.status, options.scope, options.query, options.fromDate, options.toDate]);
}

export function parseDineInOrderListOptions(url: URL): DineInOrderListOptions {
  for (const name of url.searchParams.keys()) {
    if (name !== "limit" && name !== "status" && name !== "scope" &&
      name !== "q" && name !== "from" && name !== "to" && name !== "cursor")
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
  if (rawStatus !== null && !isFilter(rawStatus))
    throw new ApiError("The status is invalid.", 400);

  const rawScope = singleParameter(url, "scope");
  if (rawScope !== null && !isScope(rawScope))
    throw new ApiError("The scope is invalid.", 400);
  const scope: DineInOrderListScope = rawScope ?? "all";

  const query = normalizeQuery(singleParameter(url, "q"));
  const fromDate = normalizeDate(singleParameter(url, "from"), "from");
  const toDate = normalizeDate(singleParameter(url, "to"), "to");
  if (fromDate && toDate && fromDate > toDate)
    throw new ApiError("The from parameter must not be after the to parameter.", 400);

  const cursor = singleParameter(url, "cursor");
  if (cursor !== null) {
    decodeOrderCursor(cursor, filterSignature({ status: rawStatus as DineInOrderListFilter, scope, query, fromDate, toDate }));
  }

  return { limit, status: rawStatus as DineInOrderListFilter, scope, query, fromDate, toDate, cursor };
}

function decodeOrderCursor(value: string, requestedFilter: string): OrderCursor {
  try {
    if (!value || value.length > MAX_CURSOR_LENGTH || !/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error();
    const json = Buffer.from(value, "base64url").toString("utf8");
    if (Buffer.from(json, "utf8").toString("base64url") !== value) throw new Error();
    const parsed: unknown = JSON.parse(json);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    const record = parsed as Record<string, unknown>;
    if (Object.keys(record).sort().join(",") !== "createdAt,filter,orderId,v") throw new Error();
    if (JSON.stringify(record) !== json) throw new Error();
    if (record.v !== 3 || record.filter !== requestedFilter) throw new Error();
    if (typeof record.createdAt !== "string" || !/^(?:0|-?[1-9][0-9]*)$/u.test(record.createdAt)) throw new Error();
    const createdAt = BigInt(record.createdAt);
    if (createdAt < BIGINT_MIN || createdAt > BIGINT_MAX) throw new Error();
    if (typeof record.orderId !== "string" || !UUID_PATTERN.test(record.orderId)) throw new Error();
    return record as unknown as OrderCursor;
  } catch {
    throw new ApiError("The cursor is invalid or does not match the requested filter.", 400);
  }
}

function encodeOrderCursor(row: DineInOrderSummary, filter: string): string {
  const value: OrderCursor = { v: 3, filter, createdAt: row.createdAt, orderId: row.orderId };
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

/** Start of the current calendar day in the restaurant's timezone, in epoch milliseconds. */
const START_OF_TODAY = sql`(EXTRACT(EPOCH FROM date_trunc('day', now() AT TIME ZONE 'Africa/Tunis')) * 1000)::bigint`;

/** Start of a given calendar day in the restaurant's timezone, in epoch milliseconds. */
function startOfDay(value: string) {
  return sql`(EXTRACT(EPOCH FROM ((CAST(${value} AS date)::timestamp) AT TIME ZONE 'Africa/Tunis')) * 1000)::bigint`;
}

/** Last millisecond of a given calendar day in the restaurant's timezone. */
function endOfDay(value: string) {
  return sql`(EXTRACT(EPOCH FROM (((CAST(${value} AS date)::timestamp) AT TIME ZONE 'Africa/Tunis') + interval '1 day') - interval '1 millisecond')) * 1000)::bigint`;
}

/** Execute the same Drizzle query with either production Neon HTTP or an isolated PostgreSQL test database. */
export async function queryDineInOrderSummaries<Database extends PgDatabase<PgQueryResultHKT, typeof schema>>(
  database: Database,
  options: DineInOrderListOptions,
): Promise<{ orders: DineInOrderSummary[]; nextCursor: string | null }> {
  const filter = filterSignature(options);
  const cursor = options.cursor ? decodeOrderCursor(options.cursor, filter) : null;
  const predicates = [];
  if (options.status && options.status in FILTER_STATUSES) {
    predicates.push(inArray(dineInOrders.status, FILTER_STATUSES[options.status as "in_progress" | "finished"]));
  } else if (options.status) {
    predicates.push(eq(dineInOrders.status, options.status));
  }
  if (options.scope === "today") {
    predicates.push(sql`${dineInOrders.createdAt} >= ${START_OF_TODAY}`);
  }
  if (options.query) {
    const term = `%${escapeLikeTerm(options.query)}%`;
    const reference = `${escapeLikeTerm(options.query)}%`;
    predicates.push(sql`(
      ${dineInOrders.customerName} ILIKE ${term} ESCAPE '\'
      OR ${dineInOrders.tableLabelSnapshot} ILIKE ${term} ESCAPE '\'
      OR CAST(${dineInOrders.id} AS text) ILIKE ${reference} ESCAPE '\'
    )`);
  }
  if (options.fromDate) {
    predicates.push(sql`${dineInOrders.createdAt} >= ${startOfDay(options.fromDate)}`);
  }
  if (options.toDate) {
    predicates.push(sql`${dineInOrders.createdAt} <= ${endOfDay(options.toDate)}`);
  }
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
      revision: sql<string>`${dineInOrders.updatedAt}::text`,
      customerNotes: dineInOrders.customerNotes,
    })
    .from(dineInOrders)
    .where(predicates.length ? and(...predicates) : undefined)
    .orderBy(desc(dineInOrders.createdAt), desc(dineInOrders.id))
    .limit(options.limit + 1);

  const hasMore = rows.length > options.limit;
  const pageRows = hasMore ? rows.slice(0, options.limit) : rows;
  const orderIds = pageRows.map((row) => row.orderId);
  const itemRows = orderIds.length ? await database
    .select({
      orderId: dineInOrderItems.orderId,
      lineNumber: dineInOrderItems.lineNumber,
      productName: dineInOrderItems.productNameSnapshot,
      quantity: dineInOrderItems.quantity,
      lineTotalMillimes: dineInOrderItems.lineSubtotalMillimes,
      options: dineInOrderItems.optionSnapshots,
    })
    .from(dineInOrderItems)
    .where(inArray(dineInOrderItems.orderId, orderIds))
    .orderBy(asc(dineInOrderItems.orderId), asc(dineInOrderItems.lineNumber)) : [];
  const itemsByOrder = new Map<string, DineInOrderSummary["items"]>();
  for (const row of itemRows) {
    if (!Number.isSafeInteger(row.lineNumber) || !Number.isSafeInteger(row.quantity) || row.quantity < 1 ||
      !Number.isSafeInteger(row.lineTotalMillimes) || row.lineTotalMillimes < 0 ||
      typeof row.productName !== "string" || !row.productName.trim() || !Array.isArray(row.options))
      throw new Error("A persisted order item summary contains an invalid value.");
    const options = row.options.map((option) => {
      if (!option || typeof option !== "object" || Array.isArray(option) ||
        typeof (option as { name?: unknown }).name !== "string" || !(option as { name: string }).name.trim())
        throw new Error("A persisted order option summary contains an invalid value.");
      return (option as { name: string }).name;
    });
    const items = itemsByOrder.get(row.orderId) ?? [];
    items.push({ productName: row.productName, quantity: row.quantity, lineTotalMillimes: row.lineTotalMillimes, options });
    itemsByOrder.set(row.orderId, items);
  }
  const orders = pageRows.map((row) => {
    if (!Number.isSafeInteger(row.totalMillimes) || !/^(?:0|-?[1-9][0-9]*)$/u.test(row.createdAt) ||
      !/^(?:0|[1-9][0-9]*)$/u.test(row.revision) || BigInt(row.revision) > BigInt(Number.MAX_SAFE_INTEGER) ||
      (row.customerNotes !== null && typeof row.customerNotes !== "string"))
      throw new Error("A persisted order summary contains an invalid numeric value.");
    return {
      ...row,
      status: row.status as DineInOrderListStatus,
      revision: Number(row.revision),
      items: itemsByOrder.get(row.orderId) ?? [],
    };
  });
  const last = orders.at(-1);
  return {
    orders,
    nextCursor: hasMore && last ? encodeOrderCursor(last, filter) : null,
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


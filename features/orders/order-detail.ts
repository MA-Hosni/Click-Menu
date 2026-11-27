import "server-only";

import { asc, eq, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "../../db/schema";
import { dineInOrderItems, dineInOrders, DINE_IN_ORDER_STATUSES } from "../../db/schema";
import { ApiError, jsonResponse, requireAdmin, routeError } from "../../lib/api-security";
import type { RequestIdentity } from "../../lib/api-security";

const UUID_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/u;
const SAFE_INTEGER_MAX = BigInt(Number.MAX_SAFE_INTEGER);

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
  status: (typeof DINE_IN_ORDER_STATUSES)[number];
  customerName: string | null;
  customerNotes: string | null;
  tableLabel: string;
  subtotalMillimes: number;
  totalMillimes: number;
  items: DineInOrderDetailItem[];
}

interface OrderHeaderRow {
  orderId: string;
  createdAt: string;
  status: string;
  customerName: string | null;
  customerNotes: string | null;
  tableLabel: string;
  subtotalMillimes: string;
  totalMillimes: string;
}

interface OrderItemRow {
  lineNumber: number;
  productName: string;
  quantity: number;
  unitPriceMillimes: string;
  lineTotalMillimes: string;
  options: unknown;
}

function invalidStoredDetail(): Error {
  return new Error("Persisted dine-in order detail failed integrity validation.");
}

function safeNonnegativeInteger(value: unknown): number {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(value))
    throw invalidStoredDetail();
  const integer = BigInt(value);
  if (integer > SAFE_INTEGER_MAX) throw invalidStoredDetail();
  return Number(integer);
}

function nonemptyText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validateOptions(value: unknown): DineInOrderDetailItem["options"] {
  if (!Array.isArray(value)) throw invalidStoredDetail();
  const seen = new Set<string>();
  return value.map((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate))
      throw invalidStoredDetail();
    const option = candidate as Record<string, unknown>;
    if (
      Object.keys(option).sort().join(",") !== "id,name,priceAdjustmentMillimes" ||
      typeof option.id !== "string" || !/^[A-Za-z0-9_-]{1,64}$/u.test(option.id) ||
      seen.has(option.id) ||
      !nonemptyText(option.name) ||
      typeof option.priceAdjustmentMillimes !== "number" ||
      !Number.isSafeInteger(option.priceAdjustmentMillimes) ||
      option.priceAdjustmentMillimes < 0
    )
      throw invalidStoredDetail();
    seen.add(option.id);
    return {
      id: option.id,
      name: option.name,
      priceAdjustmentMillimes: option.priceAdjustmentMillimes,
    };
  });
}

export function buildDineInOrderDetail(
  header: OrderHeaderRow,
  rows: OrderItemRow[],
): DineInOrderDetail {
  if (
    !UUID_PATTERN.test(header.orderId) ||
    !/^(?:0|[1-9][0-9]*)$/u.test(header.createdAt) ||
    BigInt(header.createdAt) > SAFE_INTEGER_MAX ||
    !DINE_IN_ORDER_STATUSES.includes(header.status as (typeof DINE_IN_ORDER_STATUSES)[number]) ||
    (header.customerName !== null && typeof header.customerName !== "string") ||
    (header.customerNotes !== null && typeof header.customerNotes !== "string") ||
    !nonemptyText(header.tableLabel)
  )
    throw invalidStoredDetail();

  const subtotalMillimes = safeNonnegativeInteger(header.subtotalMillimes);
  const totalMillimes = safeNonnegativeInteger(header.totalMillimes);
  if (subtotalMillimes !== totalMillimes || rows.length === 0)
    throw invalidStoredDetail();

  let sumOfLines = BigInt(0);
  const items = rows.map((row, index) => {
    if (
      !Number.isSafeInteger(row.lineNumber) || row.lineNumber !== index + 1 ||
      !Number.isSafeInteger(row.quantity) || row.quantity < 1 ||
      !nonemptyText(row.productName)
    )
      throw invalidStoredDetail();
    const unitPriceMillimes = safeNonnegativeInteger(row.unitPriceMillimes);
    const lineTotalMillimes = safeNonnegativeInteger(row.lineTotalMillimes);
    const options = validateOptions(row.options);
    const optionAdjustments = options.reduce(
      (sum, option) => sum + BigInt(option.priceAdjustmentMillimes),
      BigInt(0),
    );
    if (
      optionAdjustments > BigInt(unitPriceMillimes) ||
      BigInt(unitPriceMillimes) * BigInt(row.quantity) !== BigInt(lineTotalMillimes)
    )
      throw invalidStoredDetail();
    sumOfLines += BigInt(lineTotalMillimes);
    return {
      lineNumber: row.lineNumber,
      productName: row.productName,
      quantity: row.quantity,
      unitPriceMillimes,
      lineTotalMillimes,
      options,
    };
  });
  if (sumOfLines !== BigInt(subtotalMillimes)) throw invalidStoredDetail();

  return {
    orderId: header.orderId,
    createdAt: header.createdAt,
    status: header.status as DineInOrderDetail["status"],
    customerName: header.customerName,
    customerNotes: header.customerNotes,
    tableLabel: header.tableLabel,
    subtotalMillimes,
    totalMillimes,
    items,
  };
}

export async function queryDineInOrderDetail<Database extends PgDatabase<PgQueryResultHKT, typeof schema>>(
  database: Database,
  orderId: string,
): Promise<DineInOrderDetail | null> {
  const [header] = await database
    .select({
      orderId: dineInOrders.id,
      createdAt: sql<string>`${dineInOrders.createdAt}::text`,
      status: dineInOrders.status,
      customerName: dineInOrders.customerName,
      customerNotes: dineInOrders.customerNotes,
      tableLabel: dineInOrders.tableLabelSnapshot,
      subtotalMillimes: sql<string>`${dineInOrders.subtotalMillimes}::text`,
      totalMillimes: sql<string>`${dineInOrders.totalMillimes}::text`,
    })
    .from(dineInOrders)
    .where(eq(dineInOrders.id, orderId))
    .limit(1);
  if (!header) return null;

  const rows = await database
    .select({
      lineNumber: dineInOrderItems.lineNumber,
      productName: dineInOrderItems.productNameSnapshot,
      quantity: dineInOrderItems.quantity,
      unitPriceMillimes: sql<string>`${dineInOrderItems.unitPriceMillimes}::text`,
      lineTotalMillimes: sql<string>`${dineInOrderItems.lineSubtotalMillimes}::text`,
      options: dineInOrderItems.optionSnapshots,
    })
    .from(dineInOrderItems)
    .where(eq(dineInOrderItems.orderId, orderId))
    .orderBy(asc(dineInOrderItems.lineNumber));

  return buildDineInOrderDetail(header, rows as OrderItemRow[]);
}

export function createDineInOrderDetailGetHandler(dependencies: {
  getCurrentUser(): Promise<RequestIdentity | null>;
  getOrder(orderId: string): Promise<DineInOrderDetail | null>;
}) {
  return async function GET(
    _request: Request,
    context: { params: Promise<{ id: string }> },
  ): Promise<Response> {
    try {
      requireAdmin(await dependencies.getCurrentUser());
      const { id } = await context.params;
      if (!UUID_PATTERN.test(id)) throw new ApiError("The order ID is invalid.", 400);
      const order = await dependencies.getOrder(id);
      if (!order) throw new ApiError("Order not found.", 404);
      return jsonResponse(order);
    } catch (error) {
      return routeError(error);
    }
  };
}

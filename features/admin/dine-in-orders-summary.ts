/**
 * Client-side reading of the admin order summary endpoint.
 * The board needs the counts to decide what to show; the server owns the numbers.
 */

export interface DineInOrdersDashboardSummary {
  pendingCount: number;
  preparingCount: number;
  todayDoneOrderCount: number;
  todayInKitchenTotalMillimes: number;
  todayTotalMillimes: number;
  latestPendingOrder: { orderId: string; createdAt: string } | null;
}

const SUMMARY_KEYS =
  "latestPendingOrder,pendingCount,preparingCount,todayDoneOrderCount,todayInKitchenTotalMillimes,todayTotalMillimes";
const UUID_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/u;
const EPOCH_MILLIS_PATTERN = /^(?:0|[1-9][0-9]*)$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** Returns null unless the payload is exactly the summary shape the API promises. */
export function parseDineInOrdersDashboardSummary(
  value: unknown,
): DineInOrdersDashboardSummary | null {
  if (!isRecord(value) || Object.keys(value).sort().join(",") !== SUMMARY_KEYS) return null;
  if (!isCount(value.pendingCount) || !isCount(value.preparingCount) ||
    !isCount(value.todayDoneOrderCount) || !isCount(value.todayInKitchenTotalMillimes) ||
    !isCount(value.todayTotalMillimes)) return null;

  let latestPendingOrder: DineInOrdersDashboardSummary["latestPendingOrder"] = null;
  if (value.latestPendingOrder !== null) {
    const latest = value.latestPendingOrder;
    if (!isRecord(latest) || Object.keys(latest).sort().join(",") !== "createdAt,orderId" ||
      typeof latest.orderId !== "string" || !UUID_PATTERN.test(latest.orderId) ||
      typeof latest.createdAt !== "string" || !EPOCH_MILLIS_PATTERN.test(latest.createdAt) ||
      BigInt(latest.createdAt) > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    latestPendingOrder = { orderId: latest.orderId, createdAt: latest.createdAt };
  }

  return {
    pendingCount: value.pendingCount,
    preparingCount: value.preparingCount,
    todayDoneOrderCount: value.todayDoneOrderCount,
    todayInKitchenTotalMillimes: value.todayInKitchenTotalMillimes,
    todayTotalMillimes: value.todayTotalMillimes,
    latestPendingOrder,
  };
}

/**
 * True when `next` is a newer pending order than `previous`.
 * `previous` is undefined before the first successful summary read.
 */
export function isNewerPendingOrder(
  next: { orderId: string; createdAt: string } | null,
  previous: { orderId: string; createdAt: string } | null | undefined,
): boolean {
  if (!next) return false;
  if (!previous) return true;
  if (next.createdAt !== previous.createdAt)
    return BigInt(next.createdAt) > BigInt(previous.createdAt);
  return next.orderId > previous.orderId;
}

export const CUSTOMER_ORDER_STATUSES = [
  "pending",
  "confirmed",
  "preparing",
  "completed",
  "rejected",
  "cancelled",
] as const;

export type CustomerOrderStatus = (typeof CUSTOMER_ORDER_STATUSES)[number];

export interface CustomerOrderTrackingStatus {
  orderReference: string;
  status: CustomerOrderStatus;
  updatedAt: number;
}

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const ORDER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const STORAGE_PREFIX = "tabletap:order-tracking:v1:";

export interface TrackingCapabilityStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function trackingStorageKey(orderId: string): string | null {
  return ORDER_ID_PATTERN.test(orderId) ? `${STORAGE_PREFIX}${orderId}` : null;
}

export function saveTrackingCapability(
  storage: TrackingCapabilityStorage | null,
  orderId: string,
  token: unknown,
): boolean {
  const key = trackingStorageKey(orderId);
  if (!storage || !key || typeof token !== "string" || !TOKEN_PATTERN.test(token)) return false;
  try {
    storage.setItem(key, JSON.stringify({ orderId, token }));
    return true;
  } catch {
    return false;
  }
}

export function loadTrackingCapability(
  storage: TrackingCapabilityStorage | null,
  orderId: string,
): string | null {
  const key = trackingStorageKey(orderId);
  if (!storage || !key) return null;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const row = value as Record<string, unknown>;
    return Object.keys(row).length === 2 && row.orderId === orderId &&
      typeof row.token === "string" && TOKEN_PATTERN.test(row.token) ? row.token : null;
  } catch {
    return null;
  }
}

export function resolveTrackingCapability(
  hash: string,
  storage: TrackingCapabilityStorage | null,
  orderId: string,
): string | null {
  if (hash && hash !== "#") return trackingTokenFromHash(hash);
  return loadTrackingCapability(storage, orderId);
}

export function forgetTrackingCapability(
  storage: TrackingCapabilityStorage | null,
  orderId: string,
): boolean {
  const key = trackingStorageKey(orderId);
  if (!storage || !key) return false;
  try {
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export function trackingLink(origin: string, pathname: string, token: string): string {
  return `${origin}${pathname}#${token}`;
}

export function trackingTokenFromHash(hash: string): string | null {
  const token = hash.startsWith("#") ? hash.slice(1) : hash;
  return TOKEN_PATTERN.test(token) ? token : null;
}

export function isTerminalCustomerOrderStatus(
  status: CustomerOrderStatus,
): boolean {
  return status === "completed" || status === "rejected" || status === "cancelled";
}

export function parseCustomerOrderTrackingStatus(value: unknown): CustomerOrderTrackingStatus | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    Object.keys(row).sort().join(",") !== "orderReference,status,updatedAt" ||
    typeof row.orderReference !== "string" || !/^[A-F0-9]{8}$/u.test(row.orderReference) ||
    typeof row.status !== "string" || !(CUSTOMER_ORDER_STATUSES as readonly string[]).includes(row.status) ||
    typeof row.updatedAt !== "number" || !Number.isSafeInteger(row.updatedAt) || row.updatedAt < 0
  ) return null;
  return {
    orderReference: row.orderReference,
    status: row.status as CustomerOrderStatus,
    updatedAt: row.updatedAt,
  };
}

export async function fetchCustomerOrderTrackingStatus(
  orderId: string,
  trackingToken: string,
  fetcher: typeof fetch = fetch,
): Promise<CustomerOrderTrackingStatus | null> {
  try {
    const response = await fetcher(
      `/api/dine-in/orders/${encodeURIComponent(orderId)}/tracking`,
      {
        cache: "no-store",
        credentials: "omit",
        headers: { Authorization: `Bearer ${trackingToken}` },
      },
    );
    if (!response.ok) return null;
    return parseCustomerOrderTrackingStatus(await response.json());
  } catch {
    return null;
  }
}

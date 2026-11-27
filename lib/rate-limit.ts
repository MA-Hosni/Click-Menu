import { ApiError } from "./api-security";
import { sha256 } from "./auth";

/** Counts requests per key in fixed windows; returns the count including this one. */
export interface RateLimitStore {
  hit(key: string, windowStart: number): Promise<number> | number;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export const LIMITS = {
  /** Orders one visitor can send to any restaurant. */
  orderPerIp: {
    limit: 20,
    windowMs: 10 * MINUTE,
    message: "Too many orders from this connection. Please wait a few minutes.",
  },
  orderTrackingPerIp: {
    limit: 60,
    windowMs: 10 * MINUTE,
    message: "Too many order status checks. Please wait a few minutes.",
  },
  adminLoginPerIp: {
    limit: 10,
    windowMs: 15 * MINUTE,
    message: "Too many sign-in attempts. Please wait a few minutes.",
  },
  adminLoginPerAccount: {
    limit: 30,
    windowMs: 15 * MINUTE,
    message: "Too many sign-in attempts. Please wait a few minutes.",
  },
} as const;

/**
 * Throws 429 once `subject` (an IP address or email) passes the limit. Only a
 * hash of the subject is stored, and rows only matter for one window.
 */
export async function enforceLimit(
  store: RateLimitStore,
  name: keyof typeof LIMITS,
  subject: string,
  now = Date.now(),
): Promise<void> {
  const { limit, windowMs, message } = LIMITS[name];
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const count = await store.hit(
    `${name}:${await sha256(subject)}`,
    windowStart,
  );
  if (count > limit) throw new ApiError(message, 429);
}

export const RATE_LIMIT_MAX_WINDOW_MS = 24 * HOUR;

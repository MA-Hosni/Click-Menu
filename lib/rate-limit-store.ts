
import { lt, sql } from "drizzle-orm";

import { getDb } from "../db";
import { rateLimits } from "../db/schema";

import {
  RATE_LIMIT_MAX_WINDOW_MS,
  type RateLimitStore,
} from "./rate-limit";

/**
 * PostgreSQL-backed rate-limit counters.
 */
export function postgresRateLimitStore(): RateLimitStore {
  const db = getDb();

  return {
    async hit(key, windowStart) {
      // Occasionally remove expired counters.
      if (Math.random() < 0.01) {
        await db
          .delete(rateLimits)
          .where(
            lt(
              rateLimits.windowStart,
              Date.now() - RATE_LIMIT_MAX_WINDOW_MS,
            ),
          );
      }

      // Atomically insert or increment the counter.
      const [row] = await db
        .insert(rateLimits)
        .values({
          key,
          windowStart,
          count: 1,
        })
        .onConflictDoUpdate({
          target: rateLimits.key,
          set: {
            count: sql`
              CASE
                WHEN ${rateLimits.windowStart} = ${windowStart}
                THEN ${rateLimits.count} + 1
                ELSE 1
              END
            `,
            windowStart,
          },
        })
        .returning({
          count: rateLimits.count,
        });

      return row?.count ?? 1;
    },
  };
}

/**
 * Extract a client IP from proxy-provided headers.
 *
 * Before production deployment, configure this against
 * the trusted proxy headers of your hosting provider.
 */
export function clientIp(request: Request): string {
  const realIp = request.headers.get("x-real-ip");

  if (realIp?.trim()) {
    return realIp.trim();
  }

  const forwardedFor = request.headers.get("x-forwarded-for");

  return forwardedFor?.split(",")[0]?.trim() || "unknown";
}

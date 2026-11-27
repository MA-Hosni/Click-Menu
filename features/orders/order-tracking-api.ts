import "server-only";

import { clientIp } from "../../lib/client-ip";
import { jsonResponse } from "../../lib/api-security";
import { enforceLimit, type RateLimitStore } from "../../lib/rate-limit";
import type { CustomerDineInTrackingStatus } from "./order-tracking";

const ORDER_ID_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/u;
const TRACKING_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

export function createCustomerDineInTrackingGetHandler(dependencies: {
  getStatus(orderId: string, trackingToken: string): Promise<CustomerDineInTrackingStatus | null>;
  getRateLimitStore(): RateLimitStore;
  getClientIp?(request: Request): string;
}) {
  return async function GET(
    request: Request,
    context: { params: Promise<{ id: string }> },
  ): Promise<Response> {
    const { id } = await context.params;
    const authorization = request.headers.get("authorization") ?? "";
    const token = authorization.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length)
      : "";

    if (!ORDER_ID_PATTERN.test(id) || !TRACKING_TOKEN_PATTERN.test(token))
      return jsonResponse({ error: "Order tracking is unavailable." }, 404, {
        "Referrer-Policy": "no-referrer",
      });

    try {
      await enforceLimit(
        dependencies.getRateLimitStore(),
        "orderTrackingPerIp",
        (dependencies.getClientIp ?? clientIp)(request),
      );
      const status = await dependencies.getStatus(id, token);
      if (!status)
        return jsonResponse({ error: "Order tracking is unavailable." }, 404, {
          "Referrer-Policy": "no-referrer",
        });
      return jsonResponse(status, 200, { "Referrer-Policy": "no-referrer" });
    } catch (error) {
      if (error && typeof error === "object" && "status" in error && error.status === 429)
        return jsonResponse({ error: "Please wait before checking this order again." }, 429, {
          "Referrer-Policy": "no-referrer",
        });
      console.error("Customer order tracking lookup failed.");
      return jsonResponse({ error: "Order tracking is temporarily unavailable." }, 503, {
        "Referrer-Policy": "no-referrer",
      });
    }
  };
}

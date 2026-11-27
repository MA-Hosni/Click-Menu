import "server-only";

import { ApiError, assertSameOrigin, jsonResponse, readBoundedJson, requireSecureTransport } from "../../lib/api-security";
import { enforceLimit, type RateLimitStore } from "../../lib/rate-limit";
import { clientIp } from "../../lib/client-ip";
import { DineInOrderDomainError } from "./order-domain";
import { DineInOrderServiceError, type DineInOrderReceipt } from "./order-service";

export interface DineInOrderApiDependencies {
  isIntakeEnabled(): boolean;
  submit(request: unknown, idempotencyKey: unknown): Promise<DineInOrderReceipt>;
  getRateLimitStore(): RateLimitStore;
  getClientIp?(request: Request): string;
}

function handledError(error: unknown): Response | null {
  if (error instanceof ApiError)
    return jsonResponse({ code: error.status === 429 ? "rate_limited" : "request_rejected", error: error.message }, error.status);
  if (error instanceof DineInOrderServiceError) {
    const status = error.code === "idempotency_conflict" ? 409 : 404;
    return jsonResponse({ code: error.code, error: error.message }, status);
  }
  if (error instanceof DineInOrderDomainError) {
    switch (error.code) {
      case "catalog_not_ready":
      case "catalog_not_reviewed":
        return jsonResponse({ code: error.code, error: "Ordering is temporarily unavailable for this menu." }, 409);
      case "invalid_table_context":
        return jsonResponse({ code: error.code, error: "This table QR is invalid or inactive." }, 404);
      case "invalid_request":
      case "invalid_idempotency_key":
      case "invalid_selection":
        return jsonResponse({ code: error.code, error: error.message }, 400);
    }
  }
  return null;
}

export function createDineInOrderPostHandler(dependencies: DineInOrderApiDependencies) {
  return async function POST(request: Request): Promise<Response> {
    if (!dependencies.isIntakeEnabled())
      return jsonResponse(
        { error: "Ordering is temporarily unavailable." },
        503,
      );

    try {
      assertSameOrigin(request);
      requireSecureTransport(request);
      const ip = (dependencies.getClientIp ?? clientIp)(request);
      await enforceLimit(
        dependencies.getRateLimitStore(),
        "orderPerIp",
        ip,
      );

      const body = await readBoundedJson(request, 20_000);
      const key = request.headers.get("idempotency-key");
      const receipt = await dependencies.submit(body, key);
      return jsonResponse({
        orderId: receipt.orderId,
        trackingToken: receipt.trackingToken,
        status: receipt.status,
        createdAt: receipt.createdAt,
      }, receipt.replayed ? 200 : 201);
    } catch (error) {
      const response = handledError(error);
      if (response) return response;
      // Driver errors may contain SQL and parameters; keep them out of the
      // public response and logs. The transaction adapter discards uncertain clients.
      console.error("Dine-in order persistence failed.");
      return jsonResponse(
        { error: "We could not submit your order. Please retry with the same idempotency key." },
        500,
      );
    }
  };
}

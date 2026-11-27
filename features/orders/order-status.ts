import "server-only";

import { ApiError, assertSameOrigin, jsonResponse, readBoundedJson, requireAdmin, routeError } from "../../lib/api-security";
import type { RequestIdentity } from "../../lib/api-security";
import { DINE_IN_ORDER_STATUSES } from "../../db/schema";

export type NormalizedDineInOrderStatus = (typeof DINE_IN_ORDER_STATUSES)[number];
export type DineInOrderTargetStatus = Exclude<NormalizedDineInOrderStatus, "pending">;

const UUID_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/u;

const ALLOWED_TRANSITIONS: Record<NormalizedDineInOrderStatus, readonly DineInOrderTargetStatus[]> = {
  pending: ["confirmed", "rejected", "cancelled"],
  confirmed: ["preparing", "cancelled"],
  preparing: ["completed", "cancelled"],
  completed: [],
  rejected: [],
  cancelled: [],
};

export function isAllowedDineInOrderTransition(
  currentStatus: string,
  targetStatus: string,
): boolean {
  if (!(DINE_IN_ORDER_STATUSES as readonly string[]).includes(currentStatus)) return false;
  if (!(DINE_IN_ORDER_STATUSES as readonly string[]).includes(targetStatus)) return false;
  return ALLOWED_TRANSITIONS[currentStatus as NormalizedDineInOrderStatus]
    .includes(targetStatus as DineInOrderTargetStatus);
}

export class DineInOrderTransitionConflict extends Error {
  constructor() {
    super("The order cannot be changed to the requested status from its current status.");
    this.name = "DineInOrderTransitionConflict";
  }
}

export interface UpdatedDineInOrderStatus {
  orderId: string;
  status: DineInOrderTargetStatus;
}

export function createDineInOrderStatusPatchHandler(dependencies: {
  getCurrentUser(): Promise<RequestIdentity | null>;
  updateStatus(orderId: string, targetStatus: DineInOrderTargetStatus): Promise<UpdatedDineInOrderStatus | null>;
}) {
  return async function PATCH(
    request: Request,
    context: { params: Promise<{ id: string }> },
  ): Promise<Response> {
    try {
      requireAdmin(await dependencies.getCurrentUser());
      const { id } = await context.params;
      if (!UUID_PATTERN.test(id)) throw new ApiError("The order ID is invalid.", 400);
      assertSameOrigin(request);
      const body: unknown = await readBoundedJson(request, 1_000);
      if (
        !body || typeof body !== "object" || Array.isArray(body) ||
        Object.keys(body).length !== 1 || !Object.hasOwn(body, "status")
      )
        throw new ApiError("The status request is invalid.", 400);
      const targetStatus = (body as { status: unknown }).status;
      if (
        typeof targetStatus !== "string" ||
        !(["confirmed", "rejected", "preparing", "completed", "cancelled"] as const).includes(
          targetStatus as DineInOrderTargetStatus,
        )
      )
        throw new ApiError("The requested status is invalid.", 400);

      const updated = await dependencies.updateStatus(id, targetStatus as DineInOrderTargetStatus);
      if (!updated) throw new ApiError("Order not found.", 404);
      return jsonResponse(updated);
    } catch (error) {
      if (error instanceof DineInOrderTransitionConflict)
        return routeError(new ApiError(error.message, 409));
      return routeError(error);
    }
  };
}

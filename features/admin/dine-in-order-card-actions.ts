import type { DineInOrderStatus } from "./dine-in-orders-list";
import { getDineInOrderStatusActions } from "./dine-in-order-detail";

export type DineInOrderCardAction = "confirm_and_prepare" | "preparing" | "completed" | "rejected";

/** What the board asks the server to do with one order. */
export type DineInOrderCardActionRequest =
  | { status: Exclude<DineInOrderStatus, "pending"> }
  | { confirmAndPrepareRevision: number };

export function requiresDineInDestructiveConfirmation(status: DineInOrderStatus): boolean {
  return status === "rejected" || status === "cancelled";
}

export function getDineInOrderCardActions(status: DineInOrderStatus): readonly DineInOrderCardAction[] {
  if (status === "pending") return ["confirm_and_prepare", "rejected"];
  return getDineInOrderStatusActions(status).filter((target): target is "preparing" | "completed" =>
    target === "preparing" || target === "completed");
}

export type DineInOrderCardActionError =
  | "unauthorized" | "forbidden" | "notFound" | "conflict"
  | "unavailable" | "network" | "unexpected";

export type DineInOrderCardActionResult =
  | { error: null; status: DineInOrderStatus; revision: number | null }
  | { error: DineInOrderCardActionError; status: null; revision: null };

export async function requestDineInOrderCardAction(
  orderId: string,
  action: DineInOrderCardActionRequest,
  fetcher: typeof fetch = fetch,
): Promise<DineInOrderCardActionResult> {
  const body = "confirmAndPrepareRevision" in action
    ? { action: "confirm_and_prepare", revision: action.confirmAndPrepareRevision }
    : { status: action.status };
  const targetStatus: DineInOrderStatus = "confirmAndPrepareRevision" in action ? "preparing" : action.status;

  try {
    const response = await fetcher(`/api/admin/dine-in/orders/${encodeURIComponent(orderId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (response.status !== 200) {
      const errors: Record<number, DineInOrderCardActionError> = {
        401: "unauthorized", 403: "forbidden", 404: "notFound",
        409: "conflict", 503: "unavailable",
      };
      return { error: errors[response.status] ?? "unexpected", status: null, revision: null };
    }

    const result: unknown = await response.json();
    if (!result || typeof result !== "object" || Array.isArray(result))
      return { error: "unexpected", status: null, revision: null };
    const value = result as Record<string, unknown>;
    if ("confirmAndPrepareRevision" in action) {
      if (Object.keys(value).sort().join(",") !== "orderId,revision,status" || value.orderId !== orderId ||
        value.status !== "preparing" || typeof value.revision !== "number" ||
        !Number.isSafeInteger(value.revision) || value.revision < 0)
        return { error: "unexpected", status: null, revision: null };
      return { error: null, status: "preparing", revision: value.revision };
    }
    if (Object.keys(value).sort().join(",") !== "orderId,status" || value.orderId !== orderId ||
      value.status !== targetStatus)
      return { error: "unexpected", status: null, revision: null };
    return { error: null, status: targetStatus, revision: null };
  } catch {
    return { error: "network", status: null, revision: null };
  }
}

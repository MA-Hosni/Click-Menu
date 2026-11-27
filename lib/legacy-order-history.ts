import {
  jsonResponse,
  requireAdmin,
  routeError,
} from "./api-security";
import type { OrderRecord } from "./orders";

/** Authenticated read-only view of retained legacy order payloads. */
export function createAdminLegacyHistoryGetHandler(dependencies: {
  getCurrentUser: () => Promise<{ name: string } | null>;
  listOrders: () => Promise<OrderRecord[]>;
}) {
  return async function GET() {
    try {
      requireAdmin(await dependencies.getCurrentUser());
      const orders = await dependencies.listOrders();
      return jsonResponse({
        orders: orders.map(({ id, createdAt, name, notes, lines }) => ({
          id,
          createdAt,
          name,
          notes,
          lines: lines.map(({ name: itemName, options, quantity }) => ({
            name: itemName,
            options,
            quantity,
          })),
        })),
      });
    } catch (error) {
      return routeError(error);
    }
  };
}

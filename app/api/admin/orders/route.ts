import { getCurrentUser } from "../../../auth";
import { createAdminLegacyHistoryGetHandler } from "../../../../lib/legacy-order-history";
import { listOrders } from "../../../../lib/order-store";
import { LEGACY_RESTAURANT_STORAGE_KEY } from "../../../../lib/legacy-restaurant-key";

export const GET = createAdminLegacyHistoryGetHandler({
  getCurrentUser,
  listOrders: () => listOrders(LEGACY_RESTAURANT_STORAGE_KEY),
});

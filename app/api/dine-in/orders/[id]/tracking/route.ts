import { createCustomerDineInTrackingGetHandler } from "../../../../../../features/orders/order-tracking-api";
import { getCustomerDineInTrackingStatus } from "../../../../../../features/orders/order-tracking";
import { postgresRateLimitStore } from "../../../../../../lib/rate-limit-store";

export const GET = createCustomerDineInTrackingGetHandler({
  getStatus: getCustomerDineInTrackingStatus,
  getRateLimitStore: postgresRateLimitStore,
});

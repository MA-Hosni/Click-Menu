import { getCurrentUser } from "../../../../../auth";
import { createDineInOrderDashboardSummaryGetHandler } from "../../../../../../features/orders/order-dashboard-summary";
import { getDineInOrderDashboardSummary } from "../../../../../../features/orders/order-dashboard-summary-store";

export const GET = createDineInOrderDashboardSummaryGetHandler({
  getCurrentUser,
  getSummary: getDineInOrderDashboardSummary,
});

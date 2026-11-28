import "server-only";

import { getDb } from "../../db";
import { queryDineInOrderDashboardSummary } from "./order-dashboard-summary";

export const getDineInOrderDashboardSummary = () =>
  queryDineInOrderDashboardSummary(getDb());

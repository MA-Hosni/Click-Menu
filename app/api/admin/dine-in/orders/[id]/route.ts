import { getCurrentUser } from "../../../../../auth";
import { createDineInOrderDetailGetHandler } from "../../../../../../features/orders/order-detail";
import { getDineInOrderDetail } from "../../../../../../features/orders/order-detail-store";
import { createDineInOrderStatusPatchHandler } from "../../../../../../features/orders/order-status";
import { confirmAndPrepareDineInOrder, updateDineInOrderStatus } from "../../../../../../features/orders/order-status-store";

export const GET = createDineInOrderDetailGetHandler({
  getCurrentUser,
  getOrder: getDineInOrderDetail,
});

export const PATCH = createDineInOrderStatusPatchHandler({
  getCurrentUser,
  updateStatus: updateDineInOrderStatus,
  confirmAndPrepare: confirmAndPrepareDineInOrder,
});

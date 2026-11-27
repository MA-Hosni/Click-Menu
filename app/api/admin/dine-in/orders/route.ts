import { getCurrentUser } from "../../../../auth";
import {
  createDineInOrderListGetHandler,
} from "../../../../../features/orders/order-list";
import { listDineInOrderSummaries } from "../../../../../features/orders/order-list-store";

export const GET = createDineInOrderListGetHandler({
  getCurrentUser,
  list: listDineInOrderSummaries,
});

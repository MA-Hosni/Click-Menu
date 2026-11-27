import "server-only";

import { getDb } from "../../db";
import { queryDineInOrderDetail } from "./order-detail";

export const getDineInOrderDetail = (orderId: string) =>
  queryDineInOrderDetail(getDb(), orderId);

import "server-only";

import { getDb } from "../../db";
import { queryDineInOrderSummaries } from "./order-list";
import type { DineInOrderListOptions } from "./order-list";

export const listDineInOrderSummaries = (options: DineInOrderListOptions) =>
  queryDineInOrderSummaries(getDb(), options);

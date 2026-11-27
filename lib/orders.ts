/** Legacy orders are read-only historical records. New orders use normalized dine-in storage. */
export const ORDER_STATUSES = ["new", "preparing", "done", "cancelled"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export interface OrderLine {
  name: string;
  options: string[];
  quantity: number;
}

/** Historical JSON shape; old fulfillment fields are retained only in storage. */
export interface OrderRecord {
  id: string;
  createdAt: number;
  status: OrderStatus;
  updatedAt?: number;
  language: "en" | "fr" | "ar";
  name: string;
  notes?: string;
  lines: OrderLine[];
}

/** Order rows predating explicit statuses remain readable in admin history. */
export function withStatus(order: OrderRecord): OrderRecord {
  return ORDER_STATUSES.includes(order.status) ? order : { ...order, status: "new" };
}

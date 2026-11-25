"use client";

import { Check, ChefHat, RotateCcw, X } from "lucide-react";
import type { OrderRecord, OrderStatus } from "../../../lib/orders";
import { useAdminCopy } from "../../../features/admin/i18n/admin-copy";

export default function OrderCard({
  order,
  fresh,
  pending,
  money,
  time,
  onChangeStatus,
}: {
  order: OrderRecord;
  fresh: boolean;
  pending: boolean;
  money: (amount: number) => string;
  time: Intl.DateTimeFormat;
  onChangeStatus: (order: OrderRecord, status: OrderStatus) => void;
}) {
  const { t } = useAdminCopy();

  return (
          <li
            className={`admin-order admin-order-${order.status}${fresh ? " admin-order-fresh" : ""}`}
          >
            <div className="admin-order-head">
              <div>
                <strong>
                  {order.name}
                  <span className={`admin-order-status ${order.status}`}>
                    {t.status[order.status]}
                  </span>
                </strong>
                <span>
                  {t.orderType[order.type]}
                  {order.table && ` · ${t.table(order.table)}`}
                </span>
              </div>
              <div className="admin-order-total">
                <strong>{money(order.total)}</strong>
                <time dateTime={new Date(order.createdAt).toISOString()}>
                  {time.format(order.createdAt)}
                </time>
              </div>
            </div>
            <ul>
              {order.lines.map((line, i) => (
                <li key={i}>
                  <span>
                    {line.quantity} × {line.name}
                    {line.options.length > 0 && (
                      <small> ({line.options.join(", ")})</small>
                    )}
                  </span>
                  <span>{money(line.total)}</span>
                </li>
              ))}
              {order.deliveryFee > 0 && (
                <li>
                  <span>{t.delivery}</span>
                  <span>{money(order.deliveryFee)}</span>
                </li>
              )}
            </ul>
            {order.address && <p>{t.addressLine(order.address)}</p>}
            {order.notes && <p>{t.notesLine(order.notes)}</p>}
            <div className="admin-order-actions">
              {order.status === "new" && (
                <>
                  <button
                    type="button"
                    className="admin-primary"
                    disabled={pending}
                    onClick={() => onChangeStatus(order, "preparing")}
                  >
                    <ChefHat size={15} />
                    {t.confirmPrepare}
                  </button>
                  <button
                    type="button"
                    className="admin-text-button"
                    disabled={pending}
                    onClick={() => onChangeStatus(order, "cancelled")}
                  >
                    <X size={15} />
                    {t.notReceived}
                  </button>
                </>
              )}
              {order.status === "preparing" && (
                <>
                  <button
                    type="button"
                    className="admin-primary"
                    disabled={pending}
                    onClick={() => onChangeStatus(order, "done")}
                  >
                    <Check size={15} />
                    {t.markDone}
                  </button>
                  <button
                    type="button"
                    className="admin-text-button"
                    disabled={pending}
                    onClick={() => onChangeStatus(order, "cancelled")}
                  >
                    <X size={15} />
                    {t.cancelOrder}
                  </button>
                </>
              )}
              {(order.status === "done" || order.status === "cancelled") && (
                <button
                  type="button"
                  className="admin-text-button"
                  disabled={pending}
                  onClick={() => onChangeStatus(order, "preparing")}
                >
                  <RotateCcw size={15} />
                  {t.reopen}
                </button>
              )}
            </div>
          </li>
  );
}

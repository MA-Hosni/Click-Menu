"use client";

import { useState } from "react";
import { Check, ChefHat, ChevronRight, X } from "lucide-react";
import { useAdminCopy } from "../../../features/admin/i18n/admin-copy";
import { getDineInOrderCardActions } from "../../../features/admin/dine-in-order-card-actions";
import type {
  DineInOrderCardActionError,
  DineInOrderCardActionRequest,
} from "../../../features/admin/dine-in-order-card-actions";
import { formatDineInTotal, parseDineInCreatedAt } from "../../../features/admin/dine-in-orders-list";
import type { DineInOrderSummary } from "../../../features/admin/dine-in-orders-list";
import type { Language } from "../../../lib/types";

/**
 * One order on the board. The heading opens the full order; the actions below
 * move the order forward without leaving the list.
 */
export default function DineInOrderTicket({
  order,
  language,
  isNew,
  busyOrderId,
  actionError,
  onOpen,
  onAction,
}: {
  order: DineInOrderSummary;
  language: Language;
  isNew: boolean;
  busyOrderId: string | null;
  actionError: DineInOrderCardActionError | null;
  onOpen(orderId: string): void;
  onAction(orderId: string, action: DineInOrderCardActionRequest): void;
}) {
  const { t } = useAdminCopy();
  const [confirmingReject, setConfirmingReject] = useState(false);
  const createdAt = parseDineInCreatedAt(order.createdAt);
  const busy = busyOrderId !== null;
  const updating = busyOrderId === order.orderId;
  const availableActions = getDineInOrderCardActions(order.status);
  const statusActions = availableActions.filter((target): target is "preparing" | "completed" =>
    target === "preparing" || target === "completed");
  const locale = language === "ar" ? "ar-TN" : language === "fr" ? "fr-TN" : "en-TN";
  const customer = order.customerName?.trim() || t.dineInGuest;

  return (
    <li
      className={`admin-order admin-dine-order admin-dine-order-${order.status}`}
      onClick={() => onOpen(order.orderId)}
    >
      <button
        type="button"
        className="admin-dine-order-open"
        aria-label={t.dineInOrderOpen(t.dineInTable(order.tableLabel), customer)}
        onClick={() => onOpen(order.orderId)}
      >
        <span className="admin-dine-order-open-main">
          <span className="admin-dine-order-table">{t.dineInTable(order.tableLabel)}</span>
          <span className="admin-dine-order-customer">{customer}</span>
        </span>
        <span className="admin-dine-order-tags">
          <span className={`admin-dine-order-status ${order.status}`}>{t.dineInStatus[order.status]}</span>
          {isNew && <span className="admin-dine-order-new">{t.dineInOrderNew}</span>}
        </span>
        <span className="admin-dine-order-amount">
          <strong>{formatDineInTotal(order.totalMillimes, language)}</strong>
          {createdAt && (
            <time dateTime={createdAt.toISOString()}>
              {new Intl.DateTimeFormat(locale, {
                weekday: "short", day: "numeric", month: "short",
                hour: "2-digit", minute: "2-digit",
              }).format(createdAt)}
            </time>
          )}
        </span>
        <ChevronRight className="admin-dine-order-chevron" size={18} aria-hidden="true" />
      </button>

      <ul className="admin-dine-order-items">
        {order.items.map((item, index) => (
          <li key={`${order.orderId}-${index}`}>
            <span>
              {t.dineInOrderQuantity(item.quantity)} {item.productName}
              {item.options.length > 0 && <small> ({item.options.join(", ")})</small>}
            </span>
            <strong>{formatDineInTotal(item.lineTotalMillimes, language)}</strong>
          </li>
        ))}
      </ul>

      {order.customerNotes?.trim() && (
        <p className="admin-dine-order-notes">{t.dineInOrderNotesLabel}: {order.customerNotes}</p>
      )}

      <div
        className="admin-dine-order-card-actions"
        aria-busy={updating}
        onClick={(event) => { event.stopPropagation(); }}
      >
        {availableActions.includes("confirm_and_prepare") && (
          <button
            type="button"
            className="admin-primary"
            disabled={busy}
            onClick={() => onAction(order.orderId, { confirmAndPrepareRevision: order.revision })}
          >
            <ChefHat size={16} aria-hidden="true" />
            {updating ? t.dineInOrderUpdating : t.dineInOrderConfirmPrepare}
          </button>
        )}
        {statusActions.map((target) => (
          <button
            type="button"
            className="admin-primary"
            key={target}
            disabled={busy}
            onClick={() => onAction(order.orderId, { status: target })}
          >
            {target === "completed" ? <Check size={16} aria-hidden="true" /> : <ChefHat size={16} aria-hidden="true" />}
            {updating ? t.dineInOrderUpdating : t.dineInOrderActions[target]}
          </button>
        ))}
        {availableActions.includes("rejected") && (confirmingReject ? (
          <div className="admin-dine-order-reject-confirm" role="group" aria-label={t.dineInRejectConfirmPrompt}>
            <span>{t.dineInRejectConfirmPrompt}</span>
            <button
              type="button"
              className="admin-destructive"
              disabled={busy}
              onClick={() => onAction(order.orderId, { status: "rejected" })}
            >
              <X size={16} aria-hidden="true" />{t.dineInRejectConfirmed}
            </button>
            <button type="button" className="admin-secondary" disabled={busy} onClick={() => setConfirmingReject(false)}>
              {t.dineInKeepOrder}
            </button>
          </div>
        ) : (
          <button type="button" className="admin-secondary" disabled={busy} onClick={() => setConfirmingReject(true)}>
            <X size={16} aria-hidden="true" />{t.dineInOrderActions.rejected}
          </button>
        ))}
      </div>

      {actionError && !updating && (
        <p className="admin-message admin-message-error" role="alert">{t.dineInOrderUpdateErrors[actionError]}</p>
      )}
    </li>
  );
}

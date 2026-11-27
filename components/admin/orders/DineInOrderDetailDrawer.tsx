"use client";

import { useEffect, useState } from "react";
import { RefreshCw, X } from "lucide-react";
import {
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "../../ui/sheet";
import { useAdminCopy } from "../../../features/admin/i18n/admin-copy";
import {
  createDineInOrderDetailController,
  getDineInOrderStatusActions,
} from "../../../features/admin/dine-in-order-detail";
import type { DineInOrderTargetStatus } from "../../../features/admin/dine-in-order-detail";
import type { DineInOrderStatus } from "../../../features/admin/dine-in-orders-list";
import type { DineInOrderDetailState } from "../../../features/admin/dine-in-order-detail";
import { formatDineInTotal, parseDineInCreatedAt } from "../../../features/admin/dine-in-orders-list";

export default function DineInOrderDetailDrawer({
  orderId,
  latestListStatus,
  onStatusUpdated,
  onReconcile,
}: {
  orderId: string;
  latestListStatus: DineInOrderStatus | null;
  onStatusUpdated(orderId: string, status: DineInOrderTargetStatus): void;
  onReconcile(): void;
}) {
  const { t, language } = useAdminCopy();
  const [controller] = useState(() => createDineInOrderDetailController());
  const [state, setState] = useState<DineInOrderDetailState>(controller.getSnapshot());
  const locale = language === "ar" ? "ar-TN" : language === "fr" ? "fr" : "en-GB";

  useEffect(() => {
    const unsubscribe = controller.subscribe(setState);
    void controller.open(orderId);
    return unsubscribe;
  }, [controller, orderId]);

  const detail = state.detail;
  const createdAt = detail ? parseDineInCreatedAt(detail.createdAt) : null;
  const listStatusChanged = !!detail && !!latestListStatus &&
    latestListStatus !== detail.status && !state.statusUpdating;

  async function updateStatus(status: DineInOrderTargetStatus) {
    const error = await controller.updateStatus(status);
    if (error === null) onStatusUpdated(orderId, status);
    else if (error === "notFound" || error === "conflict") onReconcile();
  }

  async function refreshStatus() {
    await controller.retry();
    onReconcile();
  }

  return (
    <SheetContent
      className="admin-dine-order-detail-drawer"
      side="right"
      showCloseButton={false}
      dir={language === "ar" ? "rtl" : "ltr"}
      lang={language}
    >
      <SheetHeader className="admin-dine-order-detail-header">
        <div>
          <SheetTitle className="admin-dine-order-detail-title">
            {detail
              ? t.dineInOrderDetailTitle(detail.orderId.slice(0, 8).toUpperCase())
              : t.dineInOrderDetailHeading}
          </SheetTitle>
          <SheetDescription className="admin-dine-order-detail-description">
            {t.dineInOrderDetailDescription}
          </SheetDescription>
        </div>
        <SheetClose asChild>
          <button type="button" className="admin-dine-order-detail-close" aria-label={t.dineInOrderClose}>
            <X size={20} aria-hidden="true" />
          </button>
        </SheetClose>
      </SheetHeader>

      {state.loading && (
        <p className="admin-dine-order-detail-message" role="status">{t.dineInOrderDetailLoading}</p>
      )}

      {state.error && (
        <div className="admin-message admin-message-error admin-dine-order-detail-error" role="alert">
          <p>{t.dineInOrderDetailError}</p>
          <button type="button" onClick={() => void controller.retry()}>
            <RefreshCw size={14} aria-hidden="true" />
            {t.dineInOrderDetailRetry}
          </button>
        </div>
      )}

      {state.statusError && (
        <div className="admin-message admin-message-error admin-dine-order-status-message" role="alert">
          <p>{t.dineInOrderUpdateErrors[state.statusError]}</p>
          {state.statusError === "unauthorized" && <a href="/admin/login">{t.dineInOrderSignInAgain}</a>}
          {(state.statusError === "unavailable" || state.statusError === "network" || state.statusError === "unexpected") && (
            <button type="button" onClick={() => void refreshStatus()} disabled={state.loading}>
              {t.dineInOrderRefreshStatus}
            </button>
          )}
        </div>
      )}

      {state.statusUpdated && detail && (
        <p className="admin-dine-order-status-notice" role="status">
          {t.dineInOrderUpdated(t.dineInStatus[detail.status])}
        </p>
      )}

      {detail && createdAt && (
        <div className="admin-dine-order-detail-body">
          <dl className="admin-dine-order-detail-summary">
            <div>
              <dt>{t.dineInOrderTableLabel}</dt>
              <dd>{detail.tableLabel}</dd>
            </div>
            <div>
              <dt>{t.dineInOrderCustomerLabel}</dt>
              <dd>{detail.customerName?.trim() || t.dineInOrderNotProvided}</dd>
            </div>
            <div>
              <dt>{t.dineInOrderDateLabel}</dt>
              <dd>
                <time dateTime={createdAt.toISOString()}>
                  {new Intl.DateTimeFormat(locale, {
                    weekday: "long", year: "numeric", month: "short", day: "numeric",
                    hour: "2-digit", minute: "2-digit",
                  }).format(createdAt)}
                </time>
              </dd>
            </div>
            <div>
              <dt>{t.dineInOrderStatusLabel}</dt>
              <dd><span className={`admin-dine-order-status ${detail.status}`}>{t.dineInStatus[detail.status]}</span></dd>
            </div>
            <div>
              <dt>{t.dineInOrderNotesLabel}</dt>
              <dd className="admin-dine-order-notes">{detail.customerNotes?.trim() || t.dineInOrderNotProvided}</dd>
            </div>
          </dl>

          {listStatusChanged && (
            <p className="admin-dine-order-detail-status-changed" role="status">
              {t.dineInOrderStatusChanged}
              <button type="button" className="admin-secondary" onClick={() => void controller.retry()} disabled={state.loading}>
                {t.dineInOrderRefreshDetails}
              </button>
            </p>
          )}

          {getDineInOrderStatusActions(detail.status).length > 0 && (
            <section className="admin-dine-order-actions" aria-labelledby="dine-in-order-actions-heading" aria-busy={state.statusUpdating}>
              <h3 id="dine-in-order-actions-heading">{t.dineInOrderActionsHeading}</h3>
              <div>
                {getDineInOrderStatusActions(detail.status).map((targetStatus) => (
                  <button
                    type="button"
                    key={targetStatus}
                    className="admin-secondary"
                    onClick={() => void updateStatus(targetStatus)}
                    disabled={state.statusUpdating || state.loading ||
                      (!!state.statusError && state.statusError !== "conflict")}
                    aria-busy={state.statusTarget === targetStatus}
                  >
                    {state.statusTarget === targetStatus
                      ? t.dineInOrderUpdating
                      : t.dineInOrderActions[targetStatus]}
                  </button>
                ))}
              </div>
            </section>
          )}

          <h3 className="admin-dine-order-detail-items-heading">{t.dineInOrderItemsHeading}</h3>
          <ol className="admin-dine-order-detail-items">
            {detail.items.map((item) => (
              <li key={item.lineNumber}>
                <div className="admin-dine-order-detail-item-heading">
                  <strong>{item.productName}</strong>
                  <span>{t.dineInOrderQuantity(item.quantity)}</span>
                </div>
                <dl className="admin-dine-order-detail-prices">
                  <div>
                    <dt>{t.dineInOrderUnitPrice}</dt>
                    <dd>{formatDineInTotal(item.unitPriceMillimes, language)}</dd>
                  </div>
                  <div>
                    <dt>{t.dineInOrderLineTotal}</dt>
                    <dd>{formatDineInTotal(item.lineTotalMillimes, language)}</dd>
                  </div>
                </dl>
                {item.options.length > 0 && (
                  <ul className="admin-dine-order-detail-options">
                    {item.options.map((option) => (
                      <li key={option.id}>
                        <span>{option.name}</span>
                        <span>{t.dineInOrderOptionAdjustment(formatDineInTotal(option.priceAdjustmentMillimes, language))}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>

          <dl className="admin-dine-order-detail-totals">
            <div>
              <dt>{t.dineInOrderSubtotal}</dt>
              <dd>{formatDineInTotal(detail.subtotalMillimes, language)}</dd>
            </div>
            <div>
              <dt>{t.dineInOrderTotal}</dt>
              <dd>{formatDineInTotal(detail.totalMillimes, language)}</dd>
            </div>
          </dl>
        </div>
      )}
    </SheetContent>
  );
}

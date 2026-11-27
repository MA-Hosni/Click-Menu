"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import {
  Sheet,
  SheetTrigger,
} from "../../ui/sheet";
import DineInOrderDetailDrawer from "./DineInOrderDetailDrawer";
import { useAdminCopy } from "../../../features/admin/i18n/admin-copy";
import {
  createDineInOrdersController,
  DINE_IN_ORDER_STATUSES,
  formatDineInTotal,
  parseDineInCreatedAt,
  startDineInOrdersAutoRefresh,
} from "../../../features/admin/dine-in-orders-list";
import type {
  DineInOrderStatus,
  DineInOrdersState,
} from "../../../features/admin/dine-in-orders-list";

export default function DineInOrdersPanel({ signedIn }: { signedIn: boolean }) {
  const { t, language } = useAdminCopy();
  const [controller] = useState(() => createDineInOrdersController());
  const [state, setState] = useState<DineInOrdersState>(() => controller.getSnapshot());
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const locale = language === "ar" ? "ar-TN" : language === "fr" ? "fr" : "en-GB";

  useEffect(() => {
    if (!signedIn) return;
    const unsubscribe = controller.subscribe(setState);
    controller.start();
    const stopAutoRefresh = startDineInOrdersAutoRefresh(
      () => controller.refresh({ background: true }),
      {
        startInterval(callback, milliseconds) {
          const interval = window.setInterval(callback, milliseconds);
          return () => window.clearInterval(interval);
        },
        subscribeVisibility(callback) {
          document.addEventListener("visibilitychange", callback);
          return () => document.removeEventListener("visibilitychange", callback);
        },
        isVisible: () => document.visibilityState === "visible",
      },
    );
    return () => {
      stopAutoRefresh();
      unsubscribe();
    };
  }, [controller, signedIn]);

  const busy = state.loading || state.refreshing || state.backgroundRefreshing;

  return (
    <Sheet
      open={selectedOrderId !== null}
      onOpenChange={(open) => { if (!open) setSelectedOrderId(null); }}
    >
    <section className="admin-dine-orders" aria-labelledby="dine-in-orders-heading">
      <div className="admin-dine-orders-toolbar">
        <div>
          <h2 id="dine-in-orders-heading">{t.dineInOrdersHeading}</h2>
          <label className="admin-dine-orders-filter">
            <span>{t.dineInOrdersFilterLabel}</span>
            <select
              value={state.status ?? "all"}
              onChange={(event) => {
                const value = event.target.value;
                controller.setStatus(value === "all" ? null : value as DineInOrderStatus);
              }}
            >
              <option value="all">{t.dineInStatusFilter.all}</option>
              {DINE_IN_ORDER_STATUSES.map((status) => (
                <option key={status} value={status}>{t.dineInStatus[status]}</option>
              ))}
            </select>
          </label>
        </div>
        <button
          type="button"
          className="admin-secondary admin-dine-orders-refresh"
          onClick={() => controller.refresh()}
          disabled={busy}
        >
          <RefreshCw size={16} aria-hidden="true" />
          {state.refreshing || state.backgroundRefreshing ? t.dineInOrdersRefreshing : t.dineInOrdersRefresh}
        </button>
      </div>

      {state.loading && !state.orders.length && (
        <p className="admin-dine-orders-message" role="status">{t.dineInOrdersLoading}</p>
      )}

      {state.error && (
        <div className="admin-message admin-message-error" role="alert">
          <p>{t.dineInOrdersError}</p>
          <button type="button" onClick={() => controller.refresh()} disabled={busy}>
            {t.dineInOrdersRetry}
          </button>
        </div>
      )}

      {!busy && !state.error && state.orders.length === 0 && (
        <div className="admin-empty" role="status"><p>{t.dineInOrdersEmpty}</p></div>
      )}

      <ol className="admin-order-list admin-dine-orders-list">
      {state.orders.map((order) => {
          const createdAt = parseDineInCreatedAt(order.createdAt)!;
        const isNew = state.newOrderIds.includes(order.orderId);
          return (
            <li
              className={`admin-order admin-dine-order${order.status === "pending" ? " admin-dine-order-pending" : ""}`}
              key={order.orderId}
            >
              <div className="admin-dine-order-heading">
                <div>
                  <SheetTrigger asChild>
                    <button
                      type="button"
                      className="admin-dine-order-open"
                      aria-label={t.dineInOrderOpen(t.dineInTable(order.tableLabel), order.customerName?.trim() || t.dineInGuest)}
                      onClick={() => setSelectedOrderId(order.orderId)}
                    >
                      {t.dineInTable(order.tableLabel)}
                    </button>
                  </SheetTrigger>
                  <span>{order.customerName?.trim() || t.dineInGuest}</span>
                </div>
                <div className="admin-order-total">
                  <div className="admin-dine-order-badges">
                    <span className={`admin-dine-order-status ${order.status}`}>
                      {order.status === "pending" && <span aria-hidden="true">● </span>}
                      {t.dineInStatus[order.status]}
                    </span>
                    {isNew && <span className="admin-dine-order-new" role="status">{t.dineInOrderNew}</span>}
                  </div>
                  <strong>{formatDineInTotal(order.totalMillimes, language)}</strong>
                  <time dateTime={createdAt.toISOString()}>
                    {new Intl.DateTimeFormat(locale, {
                      weekday: "short", day: "numeric", month: "short",
                      hour: "2-digit", minute: "2-digit",
                    }).format(createdAt)}
                  </time>
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      {state.loadMoreError && (
        <div className="admin-message admin-message-error" role="alert">
          <p>{t.dineInOrdersMoreError}</p>
          <button type="button" onClick={() => void controller.loadMore()} disabled={state.loadingMore}>
            {t.dineInOrdersRetry}
          </button>
        </div>
      )}

      {state.nextCursor && !state.loadMoreError && (
        <button
          type="button"
          className="admin-secondary admin-dine-orders-more"
          onClick={() => void controller.loadMore()}
          disabled={state.loadingMore || state.refreshing || state.backgroundRefreshing}
        >
          {state.loadingMore ? t.dineInOrdersLoadingMore : t.dineInOrdersLoadMore}
        </button>
      )}
      {selectedOrderId && (
        <DineInOrderDetailDrawer
          orderId={selectedOrderId}
          latestListStatus={state.orders.find((order) => order.orderId === selectedOrderId)?.status ?? null}
          onStatusUpdated={(orderId, status) => controller.updateOrderStatus(orderId, status)}
          onReconcile={() => void controller.refresh()}
        />
      )}
    </section>
    </Sheet>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { useAdmin } from "../../../features/admin/AdminProvider";
import { useAdminCopy } from "../../../features/admin/i18n/admin-copy";
import {
  createHistoricalOrdersArchiveController,
  isHistoricalArchiveFilterEmpty,
} from "../../../features/admin/historical-orders-archive";
import type { HistoricalOrderRecord } from "../../../features/admin/historical-orders-archive";
import { formatDineInTotal } from "../../../features/admin/dine-in-orders-list";

/**
 * The archive of past orders. It reads the same normalized order history the
 * board reads and answers to a name, table, reference, or date range.
 */
export default function HistoricalOrders() {
  const { user } = useAdmin();
  const { t, language } = useAdminCopy();
  const [controller] = useState(() => createHistoricalOrdersArchiveController());
  const [state, setState] = useState(() => controller.getSnapshot());
  const [query, setQuery] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [preserved, setPreserved] = useState<HistoricalOrderRecord[] | null>(null);
  const firstFilterRun = useRef(true);

  useEffect(() => {
    const unsubscribe = controller.subscribe(setState);
    void controller.start();
    return unsubscribe;
  }, [controller]);

  useEffect(() => {
    if (firstFilterRun.current) {
      firstFilterRun.current = false;
      return;
    }
    const timer = window.setTimeout(() => {
      void controller.setFilter({ query, fromDate, toDate });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [controller, query, fromDate, toDate]);

  useEffect(() => {
    if (!user) return;
    let active = true;
    fetch("/api/admin/orders", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        return (await response.json()) as { orders?: HistoricalOrderRecord[] };
      })
      .then((data) => { if (active) setPreserved(data.orders ?? []); })
      .catch(() => { if (active) setPreserved([]); });
    return () => { active = false; };
  }, [user]);

  const locale = language === "ar" ? "ar-TN" : language === "fr" ? "fr-TN" : "en-TN";
  const time = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });
  const filtering = !isHistoricalArchiveFilterEmpty({ query, fromDate, toDate });

  if (!user) return <p className="admin-note">{t.ordersSignIn}</p>;

  return (
    <section className="admin-historical" aria-label={t.historicalOrdersHeading}>
      <div className="admin-historical-filter">
        <label className="admin-historical-search">
          <span className="sr-only">{t.historicalOrdersSearch}</span>
          <input
            type="search"
            value={query}
            placeholder={t.historicalOrdersSearch}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <label className="admin-historical-date">
          <span>{t.historicalOrdersFrom}</span>
          <input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} />
        </label>
        <label className="admin-historical-date">
          <span>{t.historicalOrdersTo}</span>
          <input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} />
        </label>
        {filtering && (
          <button
            type="button"
            className="admin-secondary"
            onClick={() => { setQuery(""); setFromDate(""); setToDate(""); }}
          >
            {t.historicalOrdersClearFilters}
          </button>
        )}
        <span className="admin-historical-count" role="status">
          {t.historicalOrdersCount(state.orders.length)}
        </span>
      </div>

      {state.loading && <p className="admin-dine-orders-message" role="status">{t.historicalOrdersLoading}</p>}
      {state.error && (
        <div className="admin-message admin-message-error" role="alert">
          <p>{t.historicalOrdersError}</p>
          <button type="button" onClick={() => { void controller.setFilter({ query, fromDate, toDate }); }}>
            {t.dineInOrdersRetry}
          </button>
        </div>
      )}

      {!state.loading && !state.error && !state.orders.length && (
        <p className="admin-empty">{t.historicalOrdersEmpty}</p>
      )}

      {!!state.orders.length && (
        <ol className="admin-order-list admin-historical-orders">
          {state.orders.map((order) => {
            const placed = new Date(Number(order.createdAt));
            const validDate = !Number.isNaN(placed.getTime());
            return (
              <li className="admin-order" key={order.orderId}>
                <div className="admin-order-head">
                  <strong>
                    {t.dineInTable(order.tableLabel)}
                    {order.customerName?.trim() ? ` · ${order.customerName.trim()}` : ""}
                  </strong>
                  <div className="admin-order-total">
                    <span className={`admin-dine-order-status ${order.status}`}>
                      {t.dineInStatus[order.status]}
                    </span>
                    {validDate && (
                      <time dateTime={placed.toISOString()}>{time.format(placed)}</time>
                    )}
                  </div>
                </div>
                <ul>
                  {order.items.map((item, index) => (
                    <li key={index}>
                      <span>
                        {t.dineInOrderQuantity(item.quantity)} {item.productName}
                        {item.options.length ? ` (${item.options.join(", ")})` : ""}
                      </span>
                      <strong>{formatDineInTotal(item.lineTotalMillimes, language)}</strong>
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ol>
      )}

      {state.loadMoreError && (
        <div className="admin-message admin-message-error" role="alert">
          <p>{t.dineInOrdersMoreError}</p>
          <button type="button" onClick={() => { void controller.loadMore(); }} disabled={state.loadingMore}>
            {t.dineInOrdersRetry}
          </button>
        </div>
      )}

      {state.nextCursor && !state.loadMoreError && (
        <button
          type="button"
          className="admin-secondary admin-dine-orders-more"
          onClick={() => { void controller.loadMore(); }}
          disabled={state.loadingMore}
        >
          {state.loadingMore ? t.dineInOrdersLoadingMore : t.dineInOrdersLoadMore}
        </button>
      )}

      {!!preserved?.length && (
        <section className="admin-historical-preserved" aria-label={t.historicalOrdersPreservedHeading}>
          <h3>{t.historicalOrdersPreservedHeading}</h3>
          <p className="admin-note">{t.historicalOrderReadOnly}</p>
          <ol className="admin-order-list">
            {preserved.map((order) => {
              const placed = new Date(order.createdAt);
              const validDate = !Number.isNaN(placed.getTime());
              return (
                <li className="admin-order" key={order.id}>
                  <div className="admin-order-head">
                    <strong>{order.name || t.historicalOrder}</strong>
                    <div className="admin-order-total">
                      {validDate && <time dateTime={placed.toISOString()}>{time.format(placed)}</time>}
                    </div>
                  </div>
                  <ul>
                    {order.lines.map((line, index) => (
                      <li key={index}>
                        <span>
                          {line.quantity} × {line.name}
                          {line.options.length ? ` (${line.options.join(", ")})` : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {order.notes && <p>{order.notes}</p>}
                </li>
              );
            })}
          </ol>
        </section>
      )}
    </section>
  );
}

"use client";

import { useAdmin } from "../../../features/admin/AdminProvider";
import { useAdminCopy } from "../../../features/admin/i18n/admin-copy";
import { useEffect, useState } from "react";
import DineInOrdersPanel from "./DineInOrdersPanel";

interface HistoricalOrder {
  id: string;
  createdAt: number;
  name: string;
  notes?: string;
  lines: { name: string; options: string[]; quantity: number }[];
}

function LegacyHistory({ signedIn }: { signedIn: boolean }) {
  const { t, language } = useAdminCopy();
  const [orders, setOrders] = useState<HistoricalOrder[]>([]);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!signedIn) return;
    let active = true;
    fetch("/api/admin/orders", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        return (await response.json()) as { orders?: HistoricalOrder[] };
      })
      .then((data) => { if (active) setOrders(data.orders ?? []); })
      .catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [signedIn]);

  if (!signedIn) return <p className="admin-note">{t.ordersSignIn}</p>;
  if (error) return <p className="admin-message admin-message-error">{t.historicalOrdersError}</p>;
  if (!orders.length) return <p className="admin-empty">{t.noHistoricalOrders}</p>;

  const locale = language === "ar" ? "ar-TN" : language === "fr" ? "fr-TN" : "en-TN";
  const time = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium", timeStyle: "short",
  });

  return <ol className="admin-order-list">
    {orders.map((order) => <li className="admin-order" key={order.id}>
      <div className="admin-order-head">
        <strong>{order.name || t.historicalOrder}</strong>
        <div className="admin-order-total">
          <time dateTime={new Date(order.createdAt).toISOString()}>{time.format(order.createdAt)}</time>
        </div>
      </div>
      <ul>{order.lines.map((line, index) => <li key={index}>
        <span>{line.quantity} × {line.name}{line.options.length ? ` (${line.options.join(", ")})` : ""}</span>
      </li>)}</ul>
      {order.notes && <p>{order.notes}</p>}
      <p>{t.historicalOrderReadOnly}</p>
    </li>)}
  </ol>;
}

export default function OrdersPage() {
  const { user } = useAdmin();
  const { t } = useAdminCopy();
  const [view, setView] = useState<"dine-in" | "history">("dine-in");
  return <>
    <div className="admin-order-system-switch" role="group" aria-label={t.orderSystemsLabel}>
      <button type="button" aria-pressed={view === "dine-in"} className={view === "dine-in" ? "active" : ""} onClick={() => setView("dine-in")}>{t.dineInOrdersTab}</button>
      <button type="button" aria-pressed={view === "history"} className={view === "history" ? "active" : ""} onClick={() => setView("history")}>{t.historicalOrdersTab}</button>
    </div>
    {view === "dine-in" ? <DineInOrdersPanel signedIn={!!user} /> : <LegacyHistory signedIn={!!user} />}
  </>;
}

"use client";

import { useState } from "react";
import { useAdminCopy } from "../../../features/admin/i18n/admin-copy";
import DineInOrdersPanel from "./DineInOrdersPanel";
import HistoricalOrders from "./HistoricalOrders";

type OrderSystem = "dine_in" | "historical";

/**
 * Two different order systems live in the same database: the live
 * registered-table orders and the preserved records of the previous one.
 * They are read separately so the two never mix on screen.
 */
export default function OrdersPage() {
  const { t } = useAdminCopy();
  const [system, setSystem] = useState<OrderSystem>("dine_in");

  return (
    <div className="admin-orders">
      <div className="admin-order-system-switch" role="group" aria-label={t.orderSystemsLabel}>
        <button
          type="button"
          aria-pressed={system === "dine_in"}
          className={system === "dine_in" ? "active" : ""}
          onClick={() => setSystem("dine_in")}
        >
          {t.dineInOrdersTab}
        </button>
        <button
          type="button"
          aria-pressed={system === "historical"}
          className={system === "historical" ? "active" : ""}
          onClick={() => setSystem("historical")}
        >
          {t.historicalOrdersTab}
        </button>
      </div>
      {system === "dine_in" ? <DineInOrdersPanel /> : <HistoricalOrders />}
    </div>
  );
}

"use client";

import { useAdminCopy } from "../../../features/admin/i18n/admin-copy";
import { formatDineInTotal } from "../../../features/admin/dine-in-orders-list";
import type { DineInOrdersDashboardSummary } from "../../../features/admin/dine-in-orders-summary";

/**
 * The board's header figures. They are set in a ledger strip rather than in
 * cards: a kitchen reads numbers in a row, not in three separate boxes.
 */
export default function DineInOrdersSummary({
  summary,
}: {
  summary: DineInOrdersDashboardSummary | null;
}) {
  const { t, language } = useAdminCopy();
  const pending = summary ? summary.pendingCount : null;

  return (
    <div className="admin-order-summary-strip" aria-label={t.dineInSummaryHeading}>
      <div className={`admin-order-summary-figure${pending ? " needs-action" : ""}`}>
        <span>{t.dineInSummaryToConfirm}</span>
        <strong>{summary ? summary.pendingCount : "—"}</strong>
      </div>
      <div className="admin-order-summary-figure">
        <span>{t.dineInSummaryPreparing}</span>
        <strong>{summary ? summary.preparingCount : "—"}</strong>
      </div>
      <div className="admin-order-summary-figure today">
        <span>{t.dineInSummaryToday}</span>
        <strong>{summary ? formatDineInTotal(summary.todayTotalMillimes, language) : "—"}</strong>
        {summary && (
          <small>
            {t.dineInTodaySubline(
              summary.todayDoneOrderCount,
              formatDineInTotal(summary.todayInKitchenTotalMillimes, language),
            )}
          </small>
        )}
      </div>
    </div>
  );
}

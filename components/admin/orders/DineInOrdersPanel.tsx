"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { RefreshCw, Volume2, VolumeX } from "lucide-react";
import { Sheet } from "../../ui/sheet";
import DineInOrderDetailDrawer from "./DineInOrderDetailDrawer";
import DineInOrderTicket from "./DineInOrderTicket";
import DineInOrdersSummary from "./DineInOrdersSummary";
import { useAdmin } from "../../../features/admin/AdminProvider";
import { useAdminCopy } from "../../../features/admin/i18n/admin-copy";
import { requestDineInOrderCardAction } from "../../../features/admin/dine-in-order-card-actions";
import type {
  DineInOrderCardActionError,
  DineInOrderCardActionRequest,
} from "../../../features/admin/dine-in-order-card-actions";
import {
  createDineInOrdersController,
  startDineInOrdersAutoRefresh,
} from "../../../features/admin/dine-in-orders-list";
import type { DineInOrdersState } from "../../../features/admin/dine-in-orders-list";
import {
  isNewerPendingOrder,
  parseDineInOrdersDashboardSummary,
} from "../../../features/admin/dine-in-orders-summary";
import type { DineInOrdersDashboardSummary } from "../../../features/admin/dine-in-orders-summary";

const SOUND_STORAGE_KEY = "clickmenu:admin-order-sound";
const SOUND_CHANGE_EVENT = "clickmenu:admin-order-sound-change";

function subscribeToSoundPreference(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(SOUND_CHANGE_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(SOUND_CHANGE_EVENT, callback);
  };
}

function getSoundPreference() {
  try {
    return window.localStorage.getItem(SOUND_STORAGE_KEY) === "on";
  } catch {
    return false;
  }
}

function playNotificationSound(context: AudioContext | null) {
  if (!context) return;
  try {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.12, context.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.2);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.21);
  } catch {
    // Audio is optional and may be blocked by the browser.
  }
}

/**
 * The live board: one list of registered-table orders that keeps itself
 * current, plus the summary figures the kitchen reads first.
 */
export default function DineInOrdersPanel() {
  const { user } = useAdmin();
  const { t, language } = useAdminCopy();
  const [controller] = useState(() => createDineInOrdersController());
  const [state, setState] = useState<DineInOrdersState>(() => controller.getSnapshot());
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [summary, setSummary] = useState<DineInOrdersDashboardSummary | null>(null);
  const [summaryError, setSummaryError] = useState(false);
  const [soundFallback, setSoundFallback] = useState<boolean | null>(null);
  const storedSoundEnabled = useSyncExternalStore(subscribeToSoundPreference, getSoundPreference, () => false);
  const soundEnabled = soundFallback ?? storedSoundEnabled;
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<DineInOrderCardActionError | null>(null);
  const [actionErrorOrderId, setActionErrorOrderId] = useState<string | null>(null);
  const audioContext = useRef<AudioContext | null>(null);
  const soundEnabledRef = useRef(false);
  const latestPendingOrderRef = useRef<{ orderId: string; createdAt: string } | null | undefined>(undefined);
  const summaryRequest = useRef(0);
  const locale = language === "ar" ? "ar-TN" : language === "fr" ? "fr-TN" : "en-TN";

  const loadSummary = useCallback(async () => {
    const requestId = ++summaryRequest.current;
    try {
      const response = await fetch("/api/admin/dine-in/orders/summary", { cache: "no-store" });
      if (!response.ok) throw new Error();
      const next = parseDineInOrdersDashboardSummary(await response.json());
      if (!next) throw new Error();
      if (requestId !== summaryRequest.current) return;

      const previous = latestPendingOrderRef.current;
      const isNew = isNewerPendingOrder(next.latestPendingOrder, previous);
      if (previous !== undefined && isNew && soundEnabledRef.current) {
        try {
          audioContext.current ??= new window.AudioContext();
          const context = audioContext.current;
          void context.resume().then(() => playNotificationSound(context)).catch(() => undefined);
        } catch {
          // Audio is optional and may be blocked by the browser.
        }
      }
      if (previous === undefined || isNew) latestPendingOrderRef.current = next.latestPendingOrder;

      setSummary(next);
      setSummaryError(false);
    } catch {
      if (requestId === summaryRequest.current) setSummaryError(true);
    }
  }, []);

  const refreshAll = useCallback(async (background = false) => {
    await Promise.all([
      controller.refresh({ background }),
      loadSummary(),
    ]);
  }, [controller, loadSummary]);

  useEffect(() => { soundEnabledRef.current = soundEnabled; }, [soundEnabled]);

  useEffect(() => {
    if (!user) return;
    const unsubscribe = controller.subscribe(setState);
    void controller.start();
    const summaryTimer = window.setTimeout(() => { void loadSummary(); }, 0);
    const stopAutoRefresh = startDineInOrdersAutoRefresh(
      () => refreshAll(true),
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
      window.clearTimeout(summaryTimer);
      unsubscribe();
    };
  }, [controller, loadSummary, refreshAll, user]);

  function toggleSound() {
    const next = !soundEnabled;
    soundEnabledRef.current = next;
    try {
      window.localStorage.setItem(SOUND_STORAGE_KEY, next ? "on" : "off");
      setSoundFallback(null);
      window.dispatchEvent(new Event(SOUND_CHANGE_EVENT));
    } catch {
      setSoundFallback(next);
    }
    if (next) {
      try {
        audioContext.current ??= new window.AudioContext();
        void audioContext.current.resume().catch(() => undefined);
      } catch {
        // Browsers without Web Audio keep the toggle but remain silent.
      }
    } else if (audioContext.current) {
      void audioContext.current.close().catch(() => undefined);
      audioContext.current = null;
    }
  }

  async function runCardAction(orderId: string, action: DineInOrderCardActionRequest) {
    setBusyOrderId(orderId);
    setActionError(null);
    setActionErrorOrderId(null);
    const result = await requestDineInOrderCardAction(orderId, action);
    if (result.error) {
      setActionError(result.error);
      setActionErrorOrderId(orderId);
      if (result.error === "conflict" || result.error === "notFound") await refreshAll();
    } else {
      controller.updateOrderStatus(orderId, result.status, result.revision ?? undefined);
      await refreshAll();
    }
    setBusyOrderId(null);
  }

  const busy = state.loading || state.refreshing || state.backgroundRefreshing;
  const checkedAt = state.lastCheckedAt === null ? null : new Intl.DateTimeFormat(locale, {
    hour: "2-digit", minute: "2-digit",
  }).format(state.lastCheckedAt);

  return (
    <Sheet open={selectedOrderId !== null} onOpenChange={(open) => { if (!open) setSelectedOrderId(null); }}>
      <section className="admin-dine-orders" aria-label={t.dineInOrdersHeading}>
        <DineInOrdersSummary summary={summary} />
        {summaryError && (
          <p className="admin-dine-orders-summary-error" role="status">{t.dineInSummaryUnavailable}</p>
        )}

        <div className="admin-dine-orders-toolbar">
          <div className="admin-order-view-tabs" role="group" aria-label={t.dineInOrdersViews}>
            {(["in_progress", "finished", "all"] as const).map((tab) => (
              <button
                type="button"
                aria-pressed={state.view === tab}
                className={state.view === tab ? "active" : ""}
                key={tab}
                onClick={() => { void controller.setView(tab); }}
              >
                {t.dineInOrdersView[tab]}
              </button>
            ))}
          </div>
          <div className="admin-dine-orders-toolbar-actions">
            <div className="admin-dine-orders-scope" role="group" aria-label={t.dineInScopeLabel}>
              {(["all", "today"] as const).map((scope) => (
                <button
                  type="button"
                  key={scope}
                  aria-pressed={state.scope === scope}
                  className={state.scope === scope ? "active" : ""}
                  onClick={() => { void controller.setScope(scope); }}
                >
                  {scope === "today" ? t.dineInScopeToday : t.dineInScopeAllTime}
                </button>
              ))}
            </div>
            <span className="admin-dine-orders-checked">
              {checkedAt ? t.dineInChecked(checkedAt) : t.dineInCheckedNever}
            </span>
            <button type="button" className="admin-secondary" aria-pressed={soundEnabled} onClick={toggleSound}>
              {soundEnabled ? <Volume2 size={16} aria-hidden="true" /> : <VolumeX size={16} aria-hidden="true" />}
              {soundEnabled ? t.dineInSoundOn : t.dineInSoundOff}
            </button>
            <button type="button" className="admin-secondary admin-dine-orders-refresh" onClick={() => void refreshAll()} disabled={busy}>
              <RefreshCw size={16} aria-hidden="true" />
              {state.refreshing || state.backgroundRefreshing ? t.dineInOrdersRefreshing : t.dineInOrdersRefresh}
            </button>
          </div>
        </div>

        {state.backgroundRefreshFailed && !state.error && (
          <p className="admin-dine-orders-stale" role="status">{t.dineInRefreshFailed}</p>
        )}

        {state.loading && !state.orders.length && (
          <p className="admin-dine-orders-message" role="status">{t.dineInOrdersLoading}</p>
        )}

        {state.error && (
          <div className="admin-message admin-message-error" role="alert">
            <p>{t.dineInOrdersError}</p>
            <button type="button" onClick={() => void refreshAll()} disabled={busy}>{t.dineInOrdersRetry}</button>
          </div>
        )}

        {!busy && !state.error && state.orders.length === 0 && (
          <div className="admin-empty" role="status"><p>{t.dineInOrdersEmpty}</p></div>
        )}

        <ol className="admin-order-list admin-dine-orders-list">
          {state.orders.map((order) => (
            <DineInOrderTicket
              key={order.orderId}
              order={order}
              language={language}
              isNew={state.newOrderIds.includes(order.orderId)}
              busyOrderId={busyOrderId}
              actionError={actionErrorOrderId === order.orderId ? actionError : null}
              onOpen={setSelectedOrderId}
              onAction={(orderId, action) => { void runCardAction(orderId, action); }}
            />
          ))}
        </ol>

        {state.loadMoreError && (
          <div className="admin-message admin-message-error" role="alert">
            <p>{t.dineInOrdersMoreError}</p>
            <button type="button" onClick={() => void controller.loadMore()} disabled={state.loadingMore}>{t.dineInOrdersRetry}</button>
          </div>
        )}

        {state.nextCursor && !state.loadMoreError && (
          <button type="button" className="admin-secondary admin-dine-orders-more" onClick={() => void controller.loadMore()} disabled={state.loadingMore || state.refreshing || state.backgroundRefreshing}>
            {state.loadingMore ? t.dineInOrdersLoadingMore : t.dineInOrdersLoadMore}
          </button>
        )}

        {selectedOrderId && (
          <DineInOrderDetailDrawer
            orderId={selectedOrderId}
            latestListStatus={state.orders.find((order) => order.orderId === selectedOrderId)?.status ?? null}
            onStatusUpdated={(orderId, status) => {
              controller.updateOrderStatus(orderId, status);
              void refreshAll();
            }}
            onReconcile={() => void refreshAll()}
          />
        )}
      </section>
    </Sheet>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  fetchCustomerOrderTrackingStatus,
  forgetTrackingCapability,
  isTerminalCustomerOrderStatus,
  resolveTrackingCapability,
  saveTrackingCapability,
  trackingLink,
  trackingTokenFromHash,
  type CustomerOrderStatus,
  type CustomerOrderTrackingStatus,
} from "../../../features/storefront/order-tracking";
import type { Language } from "../../../lib/types";
import { copy } from "../../../features/storefront/i18n/copy";

const LANGUAGE_KEY = "tabletap:language";
const STATUS_LABEL: Record<Language, Record<CustomerOrderStatus, keyof typeof copy.en>> = {
  en: {
    pending: "trackingStatusPending",
    confirmed: "trackingStatusConfirmed",
    preparing: "trackingStatusPreparing",
    completed: "trackingStatusCompleted",
    rejected: "trackingStatusRejected",
    cancelled: "trackingStatusCancelled",
  },
  fr: {
    pending: "trackingStatusPending",
    confirmed: "trackingStatusConfirmed",
    preparing: "trackingStatusPreparing",
    completed: "trackingStatusCompleted",
    rejected: "trackingStatusRejected",
    cancelled: "trackingStatusCancelled",
  },
  ar: {
    pending: "trackingStatusPending",
    confirmed: "trackingStatusConfirmed",
    preparing: "trackingStatusPreparing",
    completed: "trackingStatusCompleted",
    rejected: "trackingStatusRejected",
    cancelled: "trackingStatusCancelled",
  },
};

export default function CustomerOrderTracking({ orderId }: { orderId: string }) {
  const [language, setLanguage] = useState<Language>("en");
  const [token, setToken] = useState<string | null>(null);
  const [tokenResolved, setTokenResolved] = useState(false);
  const [status, setStatus] = useState<CustomerOrderTrackingStatus | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [linkActionMessage, setLinkActionMessage] = useState("");
  const t = copy[language];

  useEffect(() => {
    let savedLanguage: Language | null = null;
    try {
      const saved = localStorage.getItem(LANGUAGE_KEY);
      if (saved === "en" || saved === "fr" || saved === "ar") savedLanguage = saved;
    } catch {
      // English remains the safe default when browser storage is unavailable.
    }
    const timer = window.setTimeout(() => {
      if (savedLanguage) setLanguage(savedLanguage);
      const hash = window.location.hash;
      let capability = hash && hash !== "#" ? trackingTokenFromHash(hash) : null;
      if (!hash || hash === "#") {
        try {
          capability = resolveTrackingCapability(hash, window.localStorage, orderId);
        } catch {
          // The recovery copy is optional; storage can be disabled or cleared.
        }
      }
      setToken(capability);
      setTokenResolved(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [orderId]);

  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = language === "ar" ? "rtl" : "ltr";
  }, [language]);

  const refresh = useCallback(async () => {
    if (!token) {
      setUnavailable(true);
      setRefreshing(false);
      return;
    }
    setRefreshing(true);
    const result = await fetchCustomerOrderTrackingStatus(orderId, token);
    setRefreshing(false);
    if (!result) {
      setUnavailable(true);
      return;
    }
    setUnavailable(false);
    setStatus(result);
    try {
      saveTrackingCapability(window.localStorage, orderId, token);
    } catch {
      // The URL fragment remains a usable capability if local storage is unavailable.
    }
  }, [orderId, token]);

  useEffect(() => {
    if (!tokenResolved) return;
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh, tokenResolved]);

  useEffect(() => {
    if (!status || isTerminalCustomerOrderStatus(status.status)) return;
    const interval = window.setInterval(() => void refresh(), 30_000);
    return () => window.clearInterval(interval);
  }, [refresh, status]);

  const steps = [
    { status: "pending", label: t.trackingStepReceived },
    { status: "confirmed", label: t.trackingStepConfirmed },
    { status: "preparing", label: t.trackingStepPreparing },
    { status: "completed", label: t.trackingStepCompleted },
  ] as const;
  const activeStep = status
    ? steps.findIndex((step) => step.status === status.status)
    : -1;
  const statusLabel = status ? t[STATUS_LABEL[language][status.status]] : "";
  const updatedAt = status ? new Date(status.updatedAt) : null;
  const formattedUpdatedAt = updatedAt && Number.isFinite(updatedAt.getTime())
    ? new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" }).format(updatedAt)
    : null;

  async function saveOrShareTrackingLink(share: boolean) {
    if (!token) return;
    const url = trackingLink(window.location.origin, `/track/${encodeURIComponent(orderId)}`, token);
    try {
      if (share && navigator.share) await navigator.share({ title: t.trackingTitle, url });
      else await navigator.clipboard.writeText(url);
      setLinkActionMessage(t.trackingLinkCopied);
    } catch {
      setLinkActionMessage(t.trackingCopyUnavailable);
    }
  }

  function forgetOrder() {
    try {
      forgetTrackingCapability(window.localStorage, orderId);
    } catch {
      // The storage implementation already reports unavailable storage safely.
    }
    setToken(null);
    setStatus(null);
    setUnavailable(true);
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    setLinkActionMessage(t.trackingForgotten);
  }

  return (
    <main className="customer-tracking-page">
      <header className="customer-tracking-header">
        <Link className="brand" href="/">The Hood</Link>
        <Link className="text-link" href="/menu">{t.menu}</Link>
      </header>
      <section className="customer-tracking-card" aria-live="polite">
        <p className="eyebrow">{t.trackingEyebrow}</p>
        <h1>{t.trackingTitle}</h1>
        {status ? (
          <>
            <p className="customer-tracking-reference">
              {t.trackingReference}: <strong>#{status.orderReference}</strong>
            </p>
            <p className="customer-tracking-current">
              <span>{t.trackingCurrentStatus}</span>
              <strong>{statusLabel}</strong>
            </p>
            {status.status === "rejected" || status.status === "cancelled" ? (
              <p className="customer-tracking-terminal">{t[STATUS_LABEL[language][status.status]]}</p>
            ) : (
              <ol className="customer-tracking-steps" aria-label={t.trackingProgress}>
                {steps.map((step, index) => (
                  <li
                    key={step.status}
                    className={index < activeStep ? "complete" : index === activeStep ? "current" : ""}
                    aria-current={index === activeStep ? "step" : undefined}
                  >
                    <span aria-hidden="true" />
                    {step.label}
                  </li>
                ))}
              </ol>
            )}
            {formattedUpdatedAt && (
              <p className="customer-tracking-updated">
                {t.trackingLastUpdated}: <time dateTime={updatedAt?.toISOString()}>{formattedUpdatedAt}</time>
              </p>
            )}
            <div className="tracking-link-actions">
              <button className="button secondary" type="button" onClick={() => void saveOrShareTrackingLink(false)}>{t.trackingCopyLink}</button>
              <button className="button secondary" type="button" onClick={() => void saveOrShareTrackingLink(true)}>{t.trackingShareLink}</button>
              <button className="text-link" type="button" onClick={forgetOrder}>{t.trackingForgetOrder}</button>
            </div>
            <p className="dine-private-note">{t.trackingRecoveryScope}</p>
          </>
        ) : unavailable ? (
          <p role="alert" className="customer-tracking-error">
            {token ? t.trackingUnavailable : t.trackingLinkMissing}
          </p>
        ) : (
          <p role="status">{t.trackingLoading}</p>
        )}
        {linkActionMessage && <p role="status">{linkActionMessage}</p>}
        <button
          className="button primary full-width"
          type="button"
          disabled={!tokenResolved || refreshing}
          onClick={() => void refresh()}
        >
          {refreshing ? t.trackingRefreshing : t.trackingRefresh}
        </button>
        {status && isTerminalCustomerOrderStatus(status.status) && (
          <p className="customer-tracking-terminal-note">{t.trackingTerminalNote}</p>
        )}
      </section>
    </main>
  );
}

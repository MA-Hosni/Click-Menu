"use client";

import { useState } from "react";
import { Minus, Plus, ShoppingBag, X } from "lucide-react";
import type { CartItem, Catalog, Language } from "../../../lib/types";
import { formatPrice } from "../../../lib/cart";
import { pickText } from "../../../lib/text";
import { isTerminalDineInSubmissionError, reconcileDineInCart } from "../../../features/storefront/dine-in-order";
import type { useDineInCheckout } from "../../../features/storefront/useDineInCheckout";
import { copy } from "../../../features/storefront/i18n/copy";
import { trackingLink } from "../../../features/storefront/order-tracking";
import Modal from "../shared/Modal";

export default function DineInCheckout({
  open,
  onClose,
  language,
  catalog,
  cart,
  onQuantityChange,
  onRefreshCatalog,
  checkout,
}: {
  open: boolean;
  onClose: () => void;
  language: Language;
  catalog: Catalog;
  cart: CartItem[];
  onQuantityChange: (key: string, quantity: number) => void;
  onRefreshCatalog: () => void;
  checkout: ReturnType<typeof useDineInCheckout>;
}) {
  const [trackingActionMessage, setTrackingActionMessage] = useState("");
  const t = copy[language];
  const totals = reconcileDineInCart(cart, catalog.items);
  const locked = Boolean(checkout.pending) || checkout.submitState.kind === "submitting";
  const errorText = checkout.submitState.kind !== "error" ? "" : {
    unavailable: t.dineErrorUnavailable,
    "idempotency-conflict": t.dineErrorIdempotencyConflict,
    "catalog-not-ready": t.dineErrorCatalogNotReady,
    "rate-limit": t.dineErrorRateLimit,
    "table-unavailable": t.dineErrorTableUnavailable,
    invalid: t.dineErrorInvalid,
    network: t.dineErrorNetwork,
    server: t.dineErrorServer,
    storage: t.dineErrorStorage,
    "terminal-storage": t.dineErrorTerminalStorage,
    coordination: t.dineErrorCoordination,
    "operation-changed": t.dineErrorOperationChanged,
  }[checkout.submitState.reason];
  const terminalError = checkout.submitState.kind === "error" && isTerminalDineInSubmissionError(checkout.submitState.reason);

  async function saveOrShareTrackingLink(orderId: string, token: string, share: boolean) {
    const url = trackingLink(window.location.origin, `/track/${encodeURIComponent(orderId)}`, token);
    try {
      if (share && navigator.share) await navigator.share({ title: t.trackingTitle, url });
      else await navigator.clipboard.writeText(url);
      setTrackingActionMessage(t.trackingLinkCopied);
    } catch {
      setTrackingActionMessage(t.trackingCopyUnavailable);
    }
  }

  return (
    <Modal open={open} onClose={onClose} label={t.cart} drawer>
      <div className="cart-heading">
        <h2>{checkout.receipt ? t.dineReceiptTitle : t.cart}<span>{totals.itemCount}</span></h2>
        <button className="close-button" onClick={onClose} aria-label={t.close}><X size={22} /></button>
      </div>
      {checkout.receipt ? (
        <section className="dine-in-receipt" role="status">
          <h3>{t.dineReceiptTitle}</h3>
          <p>{t.dineReceiptPending}</p>
          <p>{t.dineOrderIdLabel}: <code>{checkout.receipt.orderId}</code></p>
          <p>{t.dineTrackingLabel}</p>
          <a
            className="button primary full-width"
            href={`/track/${encodeURIComponent(checkout.receipt.orderId)}#${checkout.receipt.trackingToken}`}
            target="_blank"
            rel="noreferrer"
          >
            {t.dineOpenTracking}
          </a>
          <div className="tracking-link-actions">
            <button className="button secondary" type="button" onClick={() => void saveOrShareTrackingLink(checkout.receipt!.orderId, checkout.receipt!.trackingToken, false)}>{t.trackingCopyLink}</button>
            <button className="button secondary" type="button" onClick={() => void saveOrShareTrackingLink(checkout.receipt!.orderId, checkout.receipt!.trackingToken, true)}>{t.trackingShareLink}</button>
          </div>
          {trackingActionMessage && <p role="status">{trackingActionMessage}</p>}
          <p className="dine-private-note">{t.dineTrackingSave}</p>
          {checkout.receiptAckError && <p role="alert" className="dine-line-error">{t.dineReceiptAckFailed}</p>}
          {!checkout.receiptAcknowledged ? (
            <button className="button primary full-width" type="button" onClick={() => void checkout.acknowledgeReceipt()}>
              {t.dineAcknowledgeReceipt}
            </button>
          ) : (
            <>
              <p role="status">{t.dineReceiptAcknowledged}</p>
              <button className="button primary full-width" type="button" onClick={() => void checkout.startNewOrder()}>{t.newOrder}</button>
            </>
          )}
        </section>
      ) : checkout.pendingStatus === "unknown" ? (
        <section className="dine-in-checkout" role="alert">
          <h3>{t.dinePendingUnknown}</h3>
          <p>{t.dineAbandonWarning}</p>
          {errorText && <p>{errorText}</p>}
          <button className="button primary full-width" type="button" onClick={() => void checkout.reloadPending()}>{t.dineReloadPending}</button>
          <button className="text-link" type="button" onClick={() => void checkout.abandonPending()}>{t.dineAbandonUncertain}</button>
        </section>
      ) : checkout.pendingStatus === "completed" ? (
        <section className="dine-in-receipt" role="status">
          <h3>{t.dineReceiptTitle}</h3>
          <p>{t.dineReceiptAcknowledgedElsewhere}</p>
          {checkout.completedOrderId && <p>{t.dineOrderIdLabel}: <code>{checkout.completedOrderId}</code></p>}
          <button className="button primary full-width" type="button" onClick={() => void checkout.startNewOrder()}>{t.newOrder}</button>
        </section>
      ) : !cart.length ? (
        <div className="empty-cart">
          <ShoppingBag size={45} strokeWidth={1} />
          <h3>{t.empty}</h3>
          <p>{t.emptyText}</p>
          <button className="button primary" onClick={onClose}>{t.continue}</button>
        </div>
      ) : (
        <div className="dine-in-checkout">
          {checkout.pending && <>
            <p className="table-notice" role="status">{t.dineRetryNotice}</p>
            <p className="dine-private-note">{t.dinePendingPersonalData}</p>
          </>}
          {totals.lines.map((line) => (
            <article className="cart-line" key={line.key}>
              <div className="cart-line-body">
                <div className="cart-line-title">
                  <h3>{line.item ? pickText(line.item.name, language) : line.entry.itemId}</h3>
                  {line.lineTotalMillimes !== null && !checkout.pending &&
                    <strong>{formatPrice(line.lineTotalMillimes, language)} TND</strong>}
                </div>
                {line.options.length > 0 && <p>{line.options.map((option) => pickText(option.label, language)).join(", ")}</p>}
                {line.issue && <p className="dine-line-error" role="alert">{line.issue === "unavailable" ? t.dineItemUnavailable : line.issue === "invalid-options" ? t.dineOptionsInvalid : line.issue === "invalid-quantity" ? t.dineQuantityInvalid : t.dinePriceInvalid}</p>}
                {!locked && <div className="cart-line-controls">
                  <div className="quantity-control">
                    <button type="button" aria-label={t.dineDecrease} onClick={() => onQuantityChange(line.key, line.entry.quantity - 1)}><Minus size={14} /></button>
                    <output>{line.entry.quantity}</output>
                    <button type="button" aria-label={t.dineIncrease} disabled={line.entry.quantity >= 99} onClick={() => onQuantityChange(line.key, line.entry.quantity + 1)}><Plus size={14} /></button>
                  </div>
                  <button className="remove-line" type="button" onClick={() => onQuantityChange(line.key, 0)}>{t.dineRemove}</button>
                </div>}
              </div>
            </article>
          ))}
          {totals.valid && totals.subtotalMillimes !== null && !checkout.pending && (
            <div className="order-totals">
              <p><span>{t.subtotal}</span><span>{formatPrice(totals.subtotalMillimes, language)} TND</span></p>
              <p className="grand-total"><span>{t.total}</span><span>{formatPrice(totals.subtotalMillimes, language)} TND</span></p>
            </div>
          )}
          {!totals.valid && !checkout.pending && <p role="alert" className="dine-line-error">{t.dineCartInvalid}</p>}
          {errorText && <p role="alert" className="dine-line-error">{errorText}</p>}
          {checkout.pending && checkout.submitState.kind === "error" && checkout.submitState.reason === "idempotency-conflict" && (
            <>
              <p role="alert" className="dine-line-error">{t.dineAbandonWarning}</p>
              <button className="text-link" type="button" onClick={() => void checkout.abandonPending()}>{t.dineAbandonConflict}</button>
            </>
          )}
          {checkout.pending && checkout.submitState.kind === "error" && checkout.submitState.reason === "catalog-not-ready" && (
            <button className="text-link" type="button" onClick={onRefreshCatalog}>{t.dineRefreshMenu}</button>
          )}
          {checkout.pending && checkout.submitState.kind === "error" && checkout.submitState.reason === "invalid" && (
            <button className="text-link" type="button" onClick={checkout.editRejectedOrder}>{t.dineEditInvalidOrder}</button>
          )}
          {!locked && <>
            <label className="form-field">
              <span>{t.name} <small>({t.optional})</small></span>
              <input value={checkout.customerName} maxLength={100} onChange={(event) => checkout.setCustomerName(event.target.value)} autoComplete="name" />
            </label>
            <label className="form-field">
              <span>{t.notes} <small>({t.optional})</small></span>
              <textarea value={checkout.notes} maxLength={500} onChange={(event) => checkout.setNotes(event.target.value)} placeholder={t.dineNotesPlaceholder} />
            </label>
          </>}
          {!checkout.pending && <p className="dine-private-note">{t.dinePendingDisclaimer}</p>}
          <button
            className="button primary full-width"
            disabled={!checkout.ready || checkout.submitState.kind === "submitting" || terminalError || (!checkout.pending && !totals.valid)}
            onClick={() => void checkout.submit()}
          >
            {checkout.submitState.kind === "submitting" ? t.dineSubmitting : checkout.pending ? t.dineRetry : t.dinePlaceOrder}
          </button>
        </div>
      )}
    </Modal>
  );
}

"use client";

import { ArrowUpRight, Check, Copy } from "lucide-react";
import type { Language } from "../../../lib/types";
import { copy } from "../copy";

export default function OrderConfirmation({
  language,
  restaurantName,
  message,
  sent,
  whatsappUrl,
  formError,
  copied,
  onBack,
  onCopy,
  onSend,
  onNewOrder,
}: {
  language: Language;
  restaurantName: string;
  message: string;
  sent: boolean;
  whatsappUrl: string;
  formError: string;
  copied: boolean;
  onBack: () => void;
  onCopy: () => void;
  onSend: () => void;
  onNewOrder: () => void;
}) {
  const t = copy[language];

  if (sent)
    return (
      <div className="order-sent" role="status">
        <span className="order-sent-mark" aria-hidden="true">
          <Check size={26} />
        </span>
        <h3>{t.sentTitle}</h3>
        <p>{t.sentText.replace("{restaurant}", restaurantName)}</p>
        <button className="button primary full-width" onClick={onNewOrder}>
          {t.newOrder}
        </button>
        {whatsappUrl && (
          <a
            className="text-link"
            href={whatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t.openAgain}
            <ArrowUpRight size={16} />
          </a>
        )}
      </div>
    );

  return (
    <div className="order-preview">
      <button className="text-link" onClick={onBack}>
        ← {t.back}
      </button>
      <h3>{t.message}</h3>
      <pre tabIndex={0}>{message}</pre>
      <p className="confirmation-note">{t.confirm}</p>
      {!whatsappUrl && <p className="demo-warning">{t.demo}</p>}
      {formError && (
        <p role="alert" className="form-error">
          {formError}
        </p>
      )}
      <button className="button secondary full-width" onClick={onCopy}>
        {copied ? <Check size={18} /> : <Copy size={18} />}
        {copied ? t.copied : t.copy}
      </button>
      {whatsappUrl ? (
        <a
          className="button primary full-width"
          href={whatsappUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={onSend}
        >
          {t.send}
          <ArrowUpRight size={18} />
        </a>
      ) : (
        <button className="button primary full-width" disabled>
          {t.send}
        </button>
      )}
    </div>
  );
}

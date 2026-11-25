"use client";

import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  Printer,
} from "lucide-react";
import { useAdminCopy } from "../../../features/admin/i18n/admin-copy";
import QrPreview from "./QrPreview";

export interface QrPanelProps {
  shopId?: string;
  publicUrl?: string;
  restaurantName?: string;
}

export default function QrPanel({
  shopId,
  publicUrl,
  restaurantName = "Olive & Ember",
}: QrPanelProps) {
  const { t } = useAdminCopy();
  const [base, setBase] = useState(publicUrl || "");
  const [table, setTable] = useState("");
  const [generated, setGenerated] = useState<{ url: string; svg: string } | null>(null);
  const [feedback, setFeedback] = useState<{ url: string; message: string } | null>(null);
  const [tooLongFor, setTooLongFor] = useState<string | null>(null);
  useEffect(() => {
    // The site root, including any path the app is served under (e.g. /tabletap/).
    const timer = window.setTimeout(
      () => setBase(publicUrl || new URL(".", document.baseURI).href.replace(/\/$/, "")),
      0,
    );
    return () => window.clearTimeout(timer);
  }, [publicUrl]);

  const result = useMemo(() => {
    if (!base.trim())
      return {
        url: "",
        error: "qrErrAddress" as const,
        local: false,
      };
    if (
      table &&
      (!/^\d+$/.test(table) || Number(table) < 1 || Number(table) > 99)
    )
      return {
        url: "",
        error: "qrErrTable" as const,
        local: false,
      };
    try {
      const url = new URL(base.trim());
      const local = ["localhost", "127.0.0.1", "[::1]", "0.0.0.0"].includes(
        url.hostname,
      );
      if (
        (url.protocol !== "https:" && !(url.protocol === "http:" && local)) ||
        url.username ||
        url.password
      )
        throw new Error();
      url.pathname = `${url.pathname.replace(/\/$/, "").replace(/\/menu$/, "")}/menu`;
      url.search = "";
      url.hash = "";
      if (shopId) url.searchParams.set("shop", shopId);
      if (table) url.searchParams.set("table", String(Number(table)));
      return { url: url.toString(), error: null, local };
    } catch {
      return {
        url: "",
        error: "qrErrHttps" as const,
        local: false,
      };
    }
  }, [base, table, shopId]);
  const svg = generated?.url === result.url ? generated.svg : "";
  const qrTooLong = tooLongFor === result.url;

  useEffect(() => {
    let active = true;
    if (result.url) {
      QRCode.toString(result.url, {
        type: "svg",
        errorCorrectionLevel: "M",
        margin: 4,
        width: 320,
        color: { dark: "#252b20", light: "#ffffff" },
      })
        .then((value) => {
          if (active) setGenerated({ url: result.url, svg: value });
        })
        .catch(() => {
          if (active) setTooLongFor(result.url);
        });
    }
    return () => {
      active = false;
    };
  }, [result.url]);

  function download() {
    const blobUrl = URL.createObjectURL(
      new Blob([svg], { type: "image/svg+xml;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = blobUrl;
    link.download = `tabletap-menu${table ? `-table-${Number(table)}` : ""}.svg`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    setFeedback({ url: result.url, message: t.qrDownloaded });
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(result.url);
      setFeedback({ url: result.url, message: t.qrCopied });
    } catch {
      setFeedback({ url: result.url, message: t.qrSelectCopy });
    }
  }

  return (
    <div className="admin-qr-layout">
      <div className="admin-qr-settings">
        <h2>{t.qrTitle}</h2>
        <p>{t.qrIntro}</p>
        <label className="admin-field">
          {t.qrAddress}
          <input
            type="url"
            value={base}
            onChange={(e) => setBase(e.target.value)}
            placeholder="https://your-cafe.com"
            autoComplete="url"
          />
        </label>
        <label className="admin-field">
          {t.qrTable} <span className="admin-optional">{t.qrOptional}</span>
          <input
            inputMode="numeric"
            type="number"
            min="1"
            max="99"
            value={table}
            onChange={(e) => setTable(e.target.value)}
            placeholder={t.qrTablePlaceholder}
          />
          <small>{t.qrTableHint}</small>
        </label>
        {(result.error || qrTooLong) && (
          <p className="admin-error" role="alert">
            {result.error ? t[result.error] : t.qrErrLong}
          </p>
        )}
        {result.local && <p className="admin-notice">{t.qrLocal}</p>}
        {!shopId && <p className="admin-note">{t.qrDemo}</p>}
        <div className="admin-qr-actions">
          <button
            className="admin-primary"
            type="button"
            onClick={download}
            disabled={!svg}
          >
            <Download size={16} /> {t.qrDownload}
          </button>
          <button
            className="admin-secondary"
            type="button"
            onClick={() => window.print()}
            disabled={!svg}
          >
            <Printer size={16} /> {t.qrPrint}
          </button>
        </div>
        {result.url && (
          <div className="admin-copy-link">
            <a href={result.url} target="_blank" rel="noopener noreferrer">
              {result.url}
              <ExternalLink size={14} />
            </a>
            <button type="button" onClick={copy} aria-label={t.qrCopy}>
              <Copy size={17} />
            </button>
          </div>
        )}
        <p className="admin-feedback" role="status">
          {feedback?.url === result.url && (
            <>
              <Check size={15} /> {feedback.message}
            </>
          )}
        </p>
      </div>
      <QrPreview
        restaurantName={restaurantName}
        table={table}
        error={result.error}
        svg={svg}
      />
    </div>
  );
}

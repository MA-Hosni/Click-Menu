"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { useAdminCopy } from "../../../features/admin/i18n/admin-copy";

type TableRow = {
  id: string;
  label: string;
  isActive: boolean;
  qrVersion: number;
};

type SelectedQr = {
  tableId: string;
  label: string;
  url: string;
  recovered: boolean;
};
type PendingRotation = {
  tableId: string;
  expectedVersion: number;
  rotationId: string;
};

const PENDING_ROTATION_KEY = "thehood:table-qr-pending-rotation:v1";

export default function TablesPage() {
  const { t } = useAdminCopy();
  const [tables, setTables] = useState<TableRow[]>([]);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [newLabel, setNewLabel] = useState("");
  const [selectedQr, setSelectedQr] = useState<SelectedQr | null>(null);
  const [pendingRotation, setPendingRotation] = useState<PendingRotation | null>(null);
  const [qrSvg, setQrSvg] = useState<{ url: string; svg: string } | null>(null);
  const [recoveryMessage, setRecoveryMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    fetch("/api/admin/tables", { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || t.tableRequestError);
        return data.tables as TableRow[];
      })
      .then((data) => {
        if (!active) return;
        setTables(data);
        setLabels(Object.fromEntries(data.map((table) => [table.id, table.label])));
        try {
          const stored = localStorage.getItem(PENDING_ROTATION_KEY);
          const pending = stored ? JSON.parse(stored) as PendingRotation : null;
          const table = pending && data.find((entry) => entry.id === pending.tableId);
          if (
            pending &&
            table &&
            typeof pending.rotationId === "string" &&
            /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(pending.rotationId) &&
            Number.isSafeInteger(pending.expectedVersion) &&
            pending.expectedVersion >= 1 &&
            (table.qrVersion === pending.expectedVersion ||
              table.qrVersion === pending.expectedVersion + 1)
          ) {
            setPendingRotation(pending);
            setRecoveryMessage(t.qrPendingRecovery);
          } else if (pending) {
            localStorage.removeItem(PENDING_ROTATION_KEY);
            setRecoveryMessage(t.qrRotationOutdated);
          }
        } catch {
          try {
            localStorage.removeItem(PENDING_ROTATION_KEY);
          } catch {}
        }
      })
      .catch((cause: unknown) => {
        if (active)
          setError(cause instanceof Error ? cause.message : t.tableRequestError);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [t.qrPendingRecovery, t.qrRotationOutdated, t.tableRequestError]);

  useEffect(() => {
    let active = true;
    if (!selectedQr) return;
    QRCode.toString(selectedQr.url, {
      type: "svg",
      errorCorrectionLevel: "H",
      margin: 4,
      width: 320,
      color: { dark: "#252b20", light: "#ffffff" },
    })
      .then((svg) => {
        if (active) setQrSvg({ url: selectedQr.url, svg });
      })
      .catch(() => {
        if (active) setError(t.tableRequestError);
      });
    return () => {
      active = false;
    };
  }, [selectedQr, t.tableRequestError]);

  async function parseResponse(response: Response) {
    const data = await response.json();
    if (!response.ok) {
      if (response.status === 409) throw new Error(t.duplicateTableLabel);
      throw new Error(data.error || t.tableRequestError);
    }
    return data;
  }

  async function createTable(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const data = await parseResponse(
        await fetch("/api/admin/tables", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ label: newLabel }),
        }),
      );
      setTables((current) => [...current, data.table].sort((a, b) => a.label.localeCompare(b.label)));
      setLabels((current) => ({ ...current, [data.table.id]: data.table.label }));
      setSelectedQr({ tableId: data.table.id, label: data.table.label, url: data.url, recovered: false });
      setRecoveryMessage(t.qrGeneratedNotice);
      setNewLabel("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t.tableRequestError);
    } finally {
      setSaving(false);
    }
  }

  async function updateTable(table: TableRow, changes: { label?: string; isActive?: boolean }) {
    setSaving(true);
    setError("");
    try {
      await parseResponse(
        await fetch(`/api/admin/tables/${encodeURIComponent(table.id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(changes),
        }),
      );
      const updated = {
        ...table,
        ...changes,
        label: changes.label?.trim().replace(/\s+/g, " ") ?? table.label,
      };
      setTables((current) => current.map((entry) => entry.id === table.id ? updated : entry)
        .sort((a, b) => a.label.localeCompare(b.label)));
      setLabels((current) => ({ ...current, [table.id]: updated.label }));
      setSelectedQr((current) =>
        current?.tableId === table.id && changes.label
          ? { ...current, label: updated.label }
          : changes.isActive === false && current?.tableId === table.id
            ? null
            : current,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t.tableRequestError);
    } finally {
      setSaving(false);
    }
  }

  async function submitRotation(pending: PendingRotation) {
    const table = tables.find((entry) => entry.id === pending.tableId);
    if (!table) return;
    setSaving(true);
    setError("");
    setSelectedQr(null);
    try {
      const response = await fetch(`/api/admin/tables/${encodeURIComponent(table.id)}/rotate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            rotationId: pending.rotationId,
            expectedVersion: pending.expectedVersion,
          }),
        });
      if (response.status === 409) {
        const latest = await fetch("/api/admin/tables", { cache: "no-store" });
        if (latest.ok) {
          const refreshed = await latest.json();
          setTables(refreshed.tables);
          setLabels(Object.fromEntries(refreshed.tables.map((entry: TableRow) => [entry.id, entry.label])));
        }
        setPendingRotation(null);
        try { localStorage.removeItem(PENDING_ROTATION_KEY); } catch {}
        setRecoveryMessage(t.qrRotationOutdated);
        return;
      }
      const data = await parseResponse(response);
      setTables((current) => current.map((entry) => entry.id === table.id
        ? { ...entry, qrVersion: data.qrVersion }
        : entry));
      setSelectedQr({
        tableId: table.id,
        label: table.label,
        url: data.url,
        recovered: data.recovered,
      });
      setRecoveryMessage(data.recovered ? t.qrRecoveredNotice : t.qrGeneratedNotice);
      setPendingRotation(null);
      try { localStorage.removeItem(PENDING_ROTATION_KEY); } catch {}
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t.tableRequestError);
      setRecoveryMessage(t.qrRetryRecovery);
    } finally {
      setSaving(false);
    }
  }

  async function rotateQr(table: TableRow) {
    if (!window.confirm(t.rotateTableWarning)) return;
    const pending = {
      tableId: table.id,
      expectedVersion: table.qrVersion,
      rotationId: crypto.randomUUID(),
    };
    try {
      localStorage.setItem(PENDING_ROTATION_KEY, JSON.stringify(pending));
    } catch {
      setError(t.qrRecoveryStorageError);
      return;
    }
    setPendingRotation(pending);
    setRecoveryMessage(t.qrPendingRecovery);
    await submitRotation(pending);
  }

  async function recoverLatestQr(table: TableRow) {
    setSaving(true);
    setError("");
    setSelectedQr(null);
    try {
      const data = await parseResponse(
        await fetch(`/api/admin/tables/${encodeURIComponent(table.id)}/recover`, {
          cache: "no-store",
        }),
      );
      if (data.qrVersion !== table.qrVersion)
        throw new Error(t.qrRotationOutdated);
      setSelectedQr({
        tableId: table.id,
        label: table.label,
        url: data.url,
        recovered: true,
      });
      setRecoveryMessage(t.qrRecoveredNotice);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t.tableRequestError);
    } finally {
      setSaving(false);
    }
  }

  function downloadQr() {
    if (!currentQrSvg || !selectedQr) return;
    const objectUrl = URL.createObjectURL(
      new Blob([currentQrSvg], { type: "image/svg+xml;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = `${selectedQr.label.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "table"}-qr.svg`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }

  const currentQrSvg = selectedQr && qrSvg?.url === selectedQr.url ? qrSvg.svg : "";

  return (
    <section className="admin-tables-page">
      <form className="admin-tables-create" onSubmit={createTable}>
        <label className="admin-field">
          {t.tableLabelField}
          <input
            value={newLabel}
            maxLength={40}
            onChange={(event) => setNewLabel(event.target.value)}
            required
          />
        </label>
        <button className="admin-primary" type="submit" disabled={saving || !newLabel.trim()}>
          {t.createTable}
        </button>
      </form>

      <p className="admin-notice">{t.qrRecoveryHelp}</p>
      {error && <p className="admin-message admin-message-error" role="alert">{error}</p>}
      {recoveryMessage && <p className="admin-notice" role="status">{recoveryMessage}</p>}
      {pendingRotation && (
        <button
          className="admin-secondary"
          type="button"
          disabled={saving}
          onClick={() => void submitRotation(pendingRotation)}
        >
          {t.recoverTableQr}
        </button>
      )}
      {loading ? (
        <p role="status">{t.tablesLoading}</p>
      ) : tables.length === 0 ? (
        <p className="admin-tables-empty">{t.tablesEmpty}</p>
      ) : (
        <div className="admin-tables-list">
          {tables.map((table) => (
            <article className="admin-table-row" key={table.id}>
              <form
                className="admin-table-label-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void updateTable(table, { label: labels[table.id] });
                }}
              >
                <label className="admin-field">
                  {t.tableLabelField}
                  <input
                    value={labels[table.id] ?? table.label}
                    maxLength={40}
                    onChange={(event) =>
                      setLabels((current) => ({ ...current, [table.id]: event.target.value }))
                    }
                    required
                  />
                </label>
                <button className="admin-secondary" type="submit" disabled={saving || labels[table.id] === table.label}>
                  {t.saveTable}
                </button>
              </form>
              <div className="admin-table-status">
                <span className={table.isActive ? "active" : "inactive"}>
                  {table.isActive ? t.activeStatus : t.inactiveStatus}
                </span>
                <button
                  className="admin-text-button"
                  type="button"
                  disabled={saving || Boolean(pendingRotation)}
                  onClick={() => void updateTable(table, { isActive: !table.isActive })}
                >
                  {table.isActive ? t.deactivateTable : t.activateTable}
                </button>
                <button
                  className="admin-secondary"
                  type="button"
                  disabled={saving || Boolean(pendingRotation)}
                  onClick={() => void rotateQr(table)}
                >
                  {t.rotateTableQr}
                </button>
                {table.isActive && table.qrVersion > 1 && (
                  <button
                    className="admin-secondary"
                    type="button"
                    disabled={saving || Boolean(pendingRotation)}
                    onClick={() => void recoverLatestQr(table)}
                  >
                    {t.recoverLatestQr}
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}

      {selectedQr && (
        <section className="admin-table-qr-section" aria-label={t.tableQrReady}>
          <div className="admin-table-qr-actions">
            <button className="admin-secondary" type="button" disabled={!currentQrSvg} onClick={downloadQr}>
              {t.downloadTableQr}
            </button>
            <button className="admin-primary" type="button" disabled={!currentQrSvg} onClick={() => window.print()}>
              {t.printTableQr}
            </button>
          </div>
          <div className="admin-table-qr-card">
            <strong className="admin-table-qr-brand">The Hood</strong>
            <span>{t.tableQrReady}</span>
            <h2>{selectedQr.label}</h2>
            <span>{selectedQr.recovered ? t.qrRecoveredLabel : t.qrNewLabel}</span>
            <div className="admin-table-qr-code" aria-label={t.tableQrAlt}>
              {currentQrSvg ? <div dangerouslySetInnerHTML={{ __html: currentQrSvg }} /> : <span role="status">{t.tablesLoading}</span>}
            </div>
            <span className="admin-table-qr-url">{selectedQr.url}</span>
          </div>
        </section>
      )}
    </section>
  );
}

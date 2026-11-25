"use client";

import { QrCode } from "lucide-react";
import { useAdminCopy } from "../../../features/admin/i18n/admin-copy";

export default function QrPreview({
  restaurantName,
  table,
  error,
  svg,
}: {
  restaurantName: string;
  table: string;
  error: string | null;
  svg: string;
}) {
  const { t } = useAdminCopy();

  return (
    <div className="admin-qr-preview">
      <div className="admin-qr-card">
        <p className="admin-qr-name">{restaurantName}</p>
        <p className="admin-qr-headline">
          {t.qrHeadline.split("\n").map((line, index) => (
            <span key={index}>
              {index > 0 && <br />}
              {line}
            </span>
          ))}
        </p>
        <div className="admin-qr-code" aria-label={svg ? t.qrCode : t.qrPreview}>
          {svg ? (
            <div dangerouslySetInnerHTML={{ __html: svg }} />
          ) : (
            <QrCode size={120} strokeWidth={1} />
          )}
        </div>
        <p className="admin-qr-instruction">{t.qrInstruction}</p>
        <p className="admin-qr-table">
          {table && !error ? t.qrCardTable(Number(table)) : t.qrCardTagline}
        </p>
        <div className="admin-qr-brand">
          {t.qrMenuBy} <strong>TableTap</strong>
        </div>
      </div>
      <span className="admin-preview-caption">{t.qrCaption}</span>
    </div>
  );
}

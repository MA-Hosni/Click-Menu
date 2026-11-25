"use client";

import { useAdmin } from "../../../features/admin/AdminProvider";
import QrPanel from "./QrPanel";

export default function QrPage() {
  const { user, saved, t } = useAdmin();
  const shopId = user ? saved.settings.slug || user.id : undefined;

  return (
    <>
      <QrPanel
        shopId={shopId}
        publicUrl={saved.settings.publicUrl}
        restaurantName={saved.settings.name}
      />
      {user && saved.revision === 0 && (
        <p className="admin-notice">{t.saveBeforeSharing}</p>
      )}
    </>
  );
}

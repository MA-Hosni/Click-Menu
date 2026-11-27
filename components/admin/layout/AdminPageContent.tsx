"use client";

import type { ReactNode } from "react";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Check, RefreshCw, Save } from "lucide-react";
import { useAdmin } from "../../../features/admin/AdminProvider";

type AdminSection = "menu" | "categories" | "orders" | "restaurant" | "tables";

export default function AdminPageContent({
  section,
  children,
}: {
  section: AdminSection;
  children: ReactNode;
}) {
  const {
    user,
    catalog,
    loading,
    saving,
    error,
    conflict,
    notice,
    dirty,
    t,
    reload,
    saveCatalog,
  } = useAdmin();
  const router = useRouter();
  useEffect(() => {
    if (!loading && !user) router.replace("/admin/login");
  }, [loading, router, user]);
  const titles = {
    menu: [t.titleMenu, t.introMenu],
    categories: [t.titleSections, t.introSections],
    orders: [t.titleOrders, t.introOrders],
    restaurant: [t.titleRestaurant, t.introRestaurant],
    tables: [t.titleTables, t.introTables],
  } as const;
  const [title, intro] = titles[section];

  return (
    <main className="admin-sheet">
      <div className="admin-title-row">
        <div>
          <h1>{title}</h1>
          <p>{intro}</p>
        </div>
        {user && section !== "orders" && section !== "tables" && (
          <button
            type="button"
            className="admin-primary"
            onClick={() => void saveCatalog()}
            disabled={loading || saving || (!dirty && catalog.revision > 0)}
          >
            <Save size={16} />
            {saving
              ? t.saving
              : dirty
                ? t.saveChanges
                : catalog.revision === 0
                  ? t.saveYourMenu
                  : t.saved}
          </button>
        )}
      </div>
      {error && (
        <div className="admin-message admin-message-error" role="alert">
          <p>{error}</p>
          {conflict ? (
            <button
              type="button"
              onClick={() => {
                if (window.confirm(t.confirmReloadSaved)) void reload(t);
              }}
            >
              {t.reloadSaved}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                if (!dirty || window.confirm(t.confirmReload)) void reload(t);
              }}
            >
              <RefreshCw size={14} />
              {t.retryLoading}
            </button>
          )}
        </div>
      )}
      {notice && (
        <div className="admin-message" role="status">
          <Check size={16} />
          <p>{notice}</p>
        </div>
      )}
      {dirty && <p className="admin-unsaved">{t.unsaved}</p>}
      {loading || !user ? (
        <>
          <div className="admin-loading" role="status">
            <p>{t.opening}</p>
            {[1, 2, 3, 4].map((number) => (
              <div className="admin-skeleton-row" key={number}>
                <span />
                <div />
                <span />
              </div>
            ))}
          </div>
          {/* Keep the route segment rendered while the session check is pending. */}
          <div hidden aria-hidden="true">
            {children}
          </div>
        </>
      ) : (
        <>
          {user && catalog.revision === 0 && section !== "orders" && section !== "tables" && (
            <p className="admin-notice">{t.catalogSetup}</p>
          )}
          {children}
        </>
      )}
    </main>
  );
}

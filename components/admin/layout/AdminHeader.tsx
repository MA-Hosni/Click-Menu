"use client";

import Link from "next/link";
import { ArrowUpRight, LayoutList, X } from "lucide-react";
import type { Language } from "../../../lib/types";
import { useAdmin } from "../../../features/admin/AdminProvider";

const languages: { id: Language; label: string }[] = [
  { id: "en", label: "English" },
  { id: "fr", label: "Français" },
  { id: "ar", label: "العربية" },
];

export default function AdminHeader({
  navigationOpen,
  onNavigationToggle,
}: {
  navigationOpen: boolean;
  onNavigationToggle: () => void;
}) {
  const { uiLanguage, setDashboardLanguage, t } = useAdmin();

  return (
    <header className="admin-topbar">
      <button
        type="button"
        className="admin-nav-toggle"
        onClick={onNavigationToggle}
        aria-label={navigationOpen ? t.closeNavigation : t.openNavigation}
        aria-expanded={navigationOpen}
      >
        {navigationOpen ? <X size={20} /> : <LayoutList size={20} />}
      </button>
      <span>{t.workspace}</span>
      <label className="admin-ui-language">
        <span className="sr-only">{t.dashboardLanguage}</span>
        <select
          value={uiLanguage}
          onChange={(event) =>
            setDashboardLanguage(event.target.value as Language)
          }
        >
          {languages.map((language) => (
            <option key={language.id} value={language.id}>
              {language.label}
            </option>
          ))}
        </select>
      </label>
      <Link href="/">
        {t.backToCafe} <ArrowUpRight size={14} />
      </Link>
    </header>
  );
}

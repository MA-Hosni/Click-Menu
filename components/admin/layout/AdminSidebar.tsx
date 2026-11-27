"use client";

import Link from "next/link";
import {
  ArrowUpRight,
  ChevronRight,
  Coffee,
  LayoutList,
  ListOrdered,
  ReceiptText,
  Settings,
  Table2,
} from "lucide-react";
import { useAdmin } from "../../../features/admin/AdminProvider";
import AdminAccount from "../auth/AdminAccount";

const routes = [
  { href: "/admin/menu", key: "menu", icon: LayoutList },
  { href: "/admin/categories", key: "sections", icon: ListOrdered },
  { href: "/admin/orders", key: "orders", icon: ReceiptText },
  { href: "/admin/restaurant", key: "restaurant", icon: Settings },
  { href: "/admin/tables", key: "tables", icon: Table2 },
] as const;

function initials(name: string): string {
  const letters = name
    .split(/\s+/)
    .map((word) =>
      word
        .replace(/[^\p{L}\p{N}]/gu, "")
        .replace(/^ال(?=\p{L}{2})/u, "")
        .charAt(0),
    )
    .filter(Boolean);
  return (
    letters.length > 1 ? letters[0] + letters.at(-1) : letters[0] || "T"
  ).toLocaleUpperCase();
}

export default function AdminSidebar({
  pathname,
  open,
  onNavigate,
}: {
  pathname: string;
  open: boolean;
  onNavigate: () => void;
}) {
  const { user, catalog, t } = useAdmin();

  return (
    <aside className={`admin-sidebar ${open ? "admin-sidebar-open" : ""}`}>
      <Link className="admin-logo" href="/">
        <Coffee size={25} strokeWidth={1.6} />
        Click Menu<span className="admin-logo-dot">.</span>
      </Link>
      <div className="admin-workspace">
        <span className="admin-workspace-symbol" aria-hidden="true">
          {initials(catalog.settings.name)}
        </span>
        <div>
          <strong>{catalog.settings.name}</strong>
          <span>{user ? t.yourRestaurant : t.demoRestaurant}</span>
        </div>
      </div>
      <nav aria-label={t.ownerNavigation}>
        {routes.map(({ href, key, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={pathname === href ? "active" : ""}
            aria-current={pathname === href ? "page" : undefined}
            onClick={onNavigate}
          >
            <Icon size={18} />
            {key === "sections"
              ? t.navSections
              : key === "menu"
                ? t.navMenu
                : key === "orders"
                  ? t.navOrders
                  : key === "restaurant"
                    ? t.navRestaurant
                    : key === "tables"
                      ? t.navTables
                      : t.navRestaurant}
            <ChevronRight size={15} />
          </Link>
        ))}
      </nav>
      <div className="admin-sidebar-bottom">
        <a href="/menu" target="_blank" rel="noopener noreferrer">
          {t.viewCustomerMenu} <ArrowUpRight size={17} />
        </a>
        <AdminAccount />
      </div>
    </aside>
  );
}

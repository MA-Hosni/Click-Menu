"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useAdmin } from "../../../features/admin/AdminProvider";
import AdminHeader from "./AdminHeader";
import AdminPageContent from "./AdminPageContent";
import AdminSidebar from "./AdminSidebar";
import "../../../app/admin/admin.css";

const sections = ["menu", "categories", "orders", "restaurant", "qr"] as const;
type AdminSection = (typeof sections)[number];

export default function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [navigationOpen, setNavigationOpen] = useState(false);
  const { uiLanguage } = useAdmin();
  const routeSection = pathname.split("/")[2];
  const section: AdminSection = sections.includes(routeSection as AdminSection)
    ? (routeSection as AdminSection)
    : "menu";

  return (
    <div
      className="admin-app"
      lang={uiLanguage}
      dir={uiLanguage === "ar" ? "rtl" : "ltr"}
    >
      <AdminSidebar
        pathname={pathname}
        open={navigationOpen}
        onNavigate={() => setNavigationOpen(false)}
      />
      <div className="admin-body">
        <AdminHeader
          navigationOpen={navigationOpen}
          onNavigationToggle={() => setNavigationOpen((open) => !open)}
        />
        <AdminPageContent section={section}>{children}</AdminPageContent>
      </div>
    </div>
  );
}

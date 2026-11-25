import type { ReactNode } from "react";
import { AdminProvider } from "../../features/admin/AdminProvider";
import AdminShell from "../../components/admin/layout/AdminShell";
import "./admin.css";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <AdminProvider>
      <AdminShell>{children}</AdminShell>
    </AdminProvider>
  );
}

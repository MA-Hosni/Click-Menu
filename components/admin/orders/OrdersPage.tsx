"use client";

import { useAdmin } from "../../../features/admin/AdminProvider";
import OrdersPanel from "./OrdersPanel";

export default function OrdersPage() {
  const { user } = useAdmin();
  return <OrdersPanel signedIn={!!user} />;
}

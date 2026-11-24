"use client";

import CategoriesPanel from "./CategoriesPanel";
import { useAdmin } from "../../../features/admin/AdminProvider";

const newId = () => crypto.randomUUID().replaceAll("-", "");

export default function CategoriesPage() {
  const { catalog, user, updateCatalog, clearNotice } = useAdmin();

  return (
    <CategoriesPanel
      categories={catalog.categories}
      items={catalog.items}
      editable={!!user}
      newId={newId}
      onChange={(categories) => {
        updateCatalog((current) => ({ ...current, categories }));
        clearNotice();
      }}
    />
  );
}

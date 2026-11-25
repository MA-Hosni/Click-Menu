"use client";

import { useMemo, useState } from "react";
import type { Category, MenuItem } from "../../../lib/types";
import { useAdmin } from "../../../features/admin/AdminProvider";
import MenuItemEditor from "./MenuItemEditor";
import MenuItemList from "./MenuItemList";

const newId = () => crypto.randomUUID().replaceAll("-", "");

export default function AdminMenuPage() {
  const { user } = useAdmin();
  return <MenuWorkspace key={user?.id ?? "guest"} />;
}

function MenuWorkspace() {
  const { user, catalog, uiLanguage, t, updateCatalog, clearNotice } = useAdmin();
  const [filter, setFilter] = useState<Category | "all">("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = user
    ? catalog.items.find((item) => item.id === selectedId)
    : undefined;
  const items = useMemo(
    () => catalog.items.filter((item) =>
      (filter === "all" || item.category === filter) &&
      Object.values(item.name).some((name) => name.toLocaleLowerCase().includes(search.toLocaleLowerCase()))),
    [catalog.items, filter, search],
  );

  function addItem() {
    const item: MenuItem = {
      id: newId(),
      category: filter === "all" ? catalog.categories[0].id : filter,
      name: { en: "", fr: "", ar: "", [uiLanguage]: t.newDish },
      description: { en: "", fr: "", ar: "" },
      price: 0,
      image: "/images/toast.jpg",
      tags: [],
      available: true,
      options: [],
    };
    updateCatalog((current) => ({ ...current, items: [...current.items, item] }));
    setSelectedId(item.id);
    clearNotice();
  }

  if (selected) {
    return (
      <MenuItemEditor
        key={selected.id}
        item={selected}
        onBack={() => setSelectedId(null)}
      />
    );
  }

  return (
    <MenuItemList
      categories={catalog.categories}
      items={items}
      filter={filter}
      search={search}
      onFilterChange={setFilter}
      onSearchChange={setSearch}
      onShowAll={() => {
        setSearch("");
        setFilter("all");
      }}
      onAddItem={addItem}
      onSelectItem={setSelectedId}
    />
  );
}

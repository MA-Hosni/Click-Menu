"use client";

import { useEffect, useMemo, useState } from "react";
import { Clock3, Search, Utensils } from "lucide-react";
import type { Catalog, Category, Language, MenuItem } from "../../../lib/types";
import { pickText } from "../../../lib/text";
import { copy } from "../../../features/storefront/i18n/copy";
import MenuCategoryNavigation from "./MenuCategoryNavigation";
import MenuItemCard from "./MenuItemCard";
import MenuItemDetails from "./MenuItemDetails";
import MenuSearch from "./MenuSearch";

export default function MenuSection({
  catalog,
  language,
  menuOnly,
  loading,
  error,
  orderTable,
  orderingEnabled = true,
  dineInMode = false,
  onRetry,
  onAddToCart,
}: {
  catalog: Catalog;
  language: Language;
  menuOnly: boolean;
  loading: boolean;
  error: string;
  orderTable: string;
  orderingEnabled?: boolean;
  dineInMode?: boolean;
  onRetry: () => void;
  onAddToCart: (item: MenuItem, options: string[], quantity: number) => void;
}) {
  const t = copy[language];
  const [category, setCategory] = useState<Category | "all">("all");
  const [search, setSearch] = useState("");
  const [vegetarian, setVegetarian] = useState(false);
  const [selected, setSelected] = useState<MenuItem | null>(null);
  const [options, setOptions] = useState<string[]>([]);
  const [quantity, setQuantity] = useState(1);
  const menuCategories = useMemo(
    () =>
      catalog.categories.filter((entry) =>
        catalog.items.some((item) => item.category === entry.id),
      ),
    [catalog.categories, catalog.items],
  );
  const filtered = useMemo(
    () =>
      catalog.items.filter(
        (item) =>
          (category === "all" || item.category === category) &&
          (!vegetarian ||
            item.tags.includes("vegetarian") ||
            item.tags.includes("vegan")) &&
          `${pickText(item.name, language)} ${pickText(item.description, language)} ${pickText(item.name, "en")}`
            .toLocaleLowerCase()
            .includes(search.trim().toLocaleLowerCase()),
      ),
    [catalog.items, category, language, search, vegetarian],
  );

  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const root = document.documentElement;
    root.classList.add("motion-ok");
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries)
          if (entry.isIntersecting) {
            entry.target.classList.add("is-in");
            observer.unobserve(entry.target);
          }
      },
      { rootMargin: "0px 0px -8% 0px" },
    );
    document
      .querySelectorAll("[data-reveal]:not(.is-in)")
      .forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [loading, category, search, vegetarian, language]);

  function selectItem(item: MenuItem) {
    setSelected(item);
    setQuantity(1);
    setOptions([]);
  }

  function addItem(item: MenuItem, selectedOptions: string[], count: number) {
    onAddToCart(item, selectedOptions, count);
    setSelected(null);
  }

  function quickAdd(item: MenuItem) {
    if (!orderingEnabled) return;
    if (item.options.length) return selectItem(item);
    onAddToCart(item, [], 1);
  }

  return (
    <section
      id="menu"
      className={`menu-section shell ${menuOnly ? "menu-first" : ""}`}
      aria-labelledby="menu-title"
    >
      <div className="section-heading" data-reveal>
        <div>
          {menuOnly ? (
            <h1 id="menu-title">{t.menu}</h1>
          ) : (
            <h2 id="menu-title">{t.fresh}</h2>
          )}
          <p>
            {menuOnly
            ? (dineInMode ? t.dineMenuHowTo : t.menuHowTo).replace(
                  "{restaurant}",
                  catalog.settings.name || "The Hood",
                )
              : t.menuIntro}
          </p>
        </div>
        {catalog.settings.hours && (
          <span className="menu-note">
            <Clock3 size={17} />
            {catalog.settings.hours}
          </span>
        )}
      </div>
      {orderTable && (
        <p className="table-notice">
          <Utensils size={17} />
          {t.tableLabel} <strong>{orderTable}</strong>
        </p>
      )}
      <div className="menu-toolbar">
        <MenuCategoryNavigation
          categories={[
            { id: "all", label: t.all },
            ...menuCategories.map((entry) => ({
              id: entry.id,
              label: pickText(entry.name, language),
            })),
          ]}
          activeCategory={category}
          label={t.menu}
          onSelect={(id) => setCategory(id)}
        />
        <MenuSearch
          search={search}
          vegetarian={vegetarian}
          searchLabel={t.search}
          vegetarianLabel={t.veg}
          onSearchChange={setSearch}
          onVegetarianChange={() => setVegetarian((current) => !current)}
        />
      </div>
      {loading ? (
        <div className="menu-grid menu-skeleton" role="status" aria-busy="true">
          <span className="sr-only">{t.menuLoading}</span>
          {[0, 1, 2, 3].map((number) => (
            <div className="menu-item" key={number} aria-hidden="true">
              <span className="skeleton-photo" />
              <span className="skeleton-lines">
                <span />
                <span />
                <span />
              </span>
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="menu-state" role="alert">
          <h3>{t.error}</h3>
          <p>{t.errorHelp}</p>
          <button className="button primary" onClick={onRetry}>
            {t.retry}
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="menu-state">
          <Search size={30} />
          <h3>{t.noResults}</h3>
          <button
            className="text-link"
            onClick={() => {
              setSearch("");
              setVegetarian(false);
              setCategory("all");
            }}
          >
            {t.clear}
          </button>
        </div>
      ) : (
        <div className="menu-grid">
          {filtered.map((item, index) => (
            <MenuItemCard
              key={item.id}
              item={item}
              language={language}
              headingLevel={menuOnly ? "h2" : "h3"}
              index={index}
              onSelect={selectItem}
              onQuickAdd={quickAdd}
              orderingEnabled={orderingEnabled}
            />
          ))}
        </div>
      )}
      <p className="allergy-note">
        {language === "fr"
          ? "Des allergies ? Indiquez-les dans votre commande et demandez confirmation au café."
          : language === "ar"
            ? "لديك حساسية؟ اذكرها في طلبك واطلب التأكيد من المقهى."
            : "Food allergies? Include them in your order and check with the café before eating."}
      </p>
      <MenuItemDetails
        item={selected}
        language={language}
        options={options}
        quantity={quantity}
        onClose={() => setSelected(null)}
        onOptionsChange={setOptions}
        onQuantityChange={setQuantity}
        onAdd={() => {
          if (selected) addItem(selected, options, quantity);
        }}
        orderingEnabled={orderingEnabled}
      />
    </section>
  );
}

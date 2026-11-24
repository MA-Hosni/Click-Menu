"use client";

import { ChevronRight, Plus, Search } from "lucide-react";
import type { Category, Language, MenuCategory, MenuItem } from "../../../lib/types";
import { formatPrice } from "../../../lib/cart";
import { pickText } from "../../../lib/text";
import { useAdmin } from "../../../features/admin/AdminProvider";

const label = (text: { en: string; fr: string; ar: string }, language: Language) => pickText(text, language);

export default function MenuItemList({
  categories,
  items,
  filter,
  search,
  onFilterChange,
  onSearchChange,
  onShowAll,
  onAddItem,
  onSelectItem,
}: {
  categories: MenuCategory[];
  items: MenuItem[];
  filter: Category | "all";
  search: string;
  onFilterChange: (filter: Category | "all") => void;
  onSearchChange: (search: string) => void;
  onShowAll: () => void;
  onAddItem?: () => void;
  onSelectItem?: (id: string) => void;
}) {
  const { user, catalog, uiLanguage, t, updateCatalog } = useAdmin();
  function toggleAvailability(id: string) {
    updateCatalog((current) => ({
      ...current,
      items: current.items.map((item) => item.id === id ? { ...item, available: !item.available } : item),
    }));
  }

  return (
                  <>
                    <div
                      className="admin-category-tabs"
                      aria-label={t.filterCategories}
                    >
                      <button
                        type="button"
                        className={filter === "all" ? "active" : ""}
                        onClick={() => onFilterChange("all")}
                      >
                        {t.allDishes}
                      </button>
                      {categories.map((category) => (
                        <button
                          type="button"
                          key={category.id}
                          className={filter === category.id ? "active" : ""}
                          onClick={() => onFilterChange(category.id)}
                        >
                          {label(category.name, uiLanguage)}
                        </button>
                      ))}
                    </div>
                    <div className="admin-list-toolbar">
                      <label className="admin-search">
                        <Search size={17} />
                        <input
                          type="search"
                          aria-label={t.searchDishes}
                          placeholder={t.findDish}
                          value={search}
                          onChange={(e) => onSearchChange(e.target.value)}
                        />
                      </label>
                      <div>
                        <span>{t.dishCount(items.length)}</span>
                        {user && (
                          <button
                            className="admin-secondary"
                            type="button"
                            onClick={onAddItem}
                            disabled={catalog.items.length >= 100}
                          >
                            <Plus size={16} />
                            {t.addDish}
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="admin-dish-list">
                      <div className="admin-dish-head">
                        <span>{t.columnDish}</span>
                        <span>{t.columnPrice}</span>
                        <span>{t.columnAvailability}</span>
                        <span />
                      </div>
                      {items.length ? (
                        items.map((item) => (
                          <div className="admin-dish-row" key={item.id}>
                            <div className="admin-dish-identity">
                              <img
                                src={item.image}
                                alt=""
                                width={60}
                                height={60}
                                onError={(e) => {
                                  e.currentTarget.src = "/images/toast.jpg";
                                }}
                              />
                              <div>
                                <strong>{label(item.name, uiLanguage)}</strong>
                                <span>
                                  {(() => {
                                    const section = categories.find(
                                      (c) => c.id === item.category,
                                    );
                                    return section
                                      ? label(section.name, uiLanguage)
                                      : "";
                                  })()}
                                </span>
                              </div>
                            </div>
                            <span className="admin-dish-price">
                              {formatPrice(item.price, uiLanguage)}
                            </span>
                            <button
                              type="button"
                              className={`admin-availability ${item.available ? "" : "unavailable"}`}
                              aria-pressed={item.available}
                              aria-label={t.availabilityLabel(
                                label(item.name, uiLanguage),
                                item.available,
                                !!user,
                              )}
                              disabled={!user}
                              onClick={() => toggleAvailability(item.id)}
                            >
                              <span />
                              {item.available ? t.available : t.soldOut}
                            </button>
                            {user ? (
                              <button
                                className="admin-edit-button"
                                type="button"
                                onClick={() => onSelectItem?.(item.id)}
                              >
                                {t.edit} <ChevronRight size={14} />
                              </button>
                            ) : (
                              <span className="admin-readonly">
                                {t.preview}
                              </span>
                            )}
                          </div>
                        ))
                      ) : (
                        <div className="admin-empty">
                          <p>{t.noMatches}</p>
                          <button
                            type="button"
                            className="admin-text-button"
                            onClick={() => {
                              onShowAll();
                            }}
                          >
                            {t.showAll}
                          </button>
                        </div>
                      )}
                    </div>
                    {!user && <p className="admin-note">{t.sampleNote}</p>}
                  </>
  );
}

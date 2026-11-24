"use client";

import { useState } from "react";
import { ArrowLeft, Check, Plus, Trash2, X } from "lucide-react";
import type { Category, Language, MenuItem, MenuOption } from "../../../lib/types";
import { formatPrice } from "../../../lib/cart";
import { pickText } from "../../../lib/text";
import { useAdmin } from "../../../features/admin/AdminProvider";
import PhotoField from "./PhotoField";

const languages: { id: Language; label: string }[] = [
  { id: "en", label: "English" },
  { id: "fr", label: "Français" },
  { id: "ar", label: "العربية" },
];
const label = (text: { en: string; fr: string; ar: string }, language: Language) => pickText(text, language);
const newId = () => crypto.randomUUID().replaceAll("-", "");

export default function MenuItemEditor({
  item,
  onBack,
}: {
  item: MenuItem;
  onBack: () => void;
}) {
  const { catalog, uiLanguage, t, updateCatalog, clearNotice } = useAdmin();
  const [language, setLanguage] = useState<Language>(uiLanguage);
  const categories = catalog.categories;

  function editItem(patch: Partial<MenuItem>) {
    updateCatalog((current) => ({
      ...current,
      items: current.items.map((row) => row.id === item.id ? { ...row, ...patch } : row),
    }));
    clearNotice();
  }
  function editOption(index: number, patch: Partial<MenuOption>) {
    editItem({ options: item.options.map((option, i) => i === index ? { ...option, ...patch } : option) });
  }
  function deleteItem() {
    if (!window.confirm(t.confirmDelete(label(item.name, uiLanguage)))) return;
    updateCatalog((current) => ({
      ...current,
      items: current.items.filter((row) => row.id !== item.id),
    }));
    onBack();
  }

  return (
                  <div className="admin-editor">
                    <button
                      className="admin-text-button"
                      type="button"
                      onClick={onBack}
                    >
                      <ArrowLeft size={15} />
                      {t.backToDishes}
                    </button>
                    <div className="admin-editor-layout">
                      <div className="admin-edit-fields">
                        <div
                          className="admin-language-tabs"
                          aria-label={t.editTranslation}
                        >
                          {languages.map((lang) => (
                            <button
                              type="button"
                              className={language === lang.id ? "active" : ""}
                              onClick={() => setLanguage(lang.id)}
                              key={lang.id}
                            >
                              {lang.label}
                            </button>
                          ))}
                        </div>
                        <label className="admin-field">
                          {t.dishName} ·{" "}
                          {
                            languages.find((lang) => lang.id === language)
                              ?.label
                          }
                          <input
                            dir={language === "ar" ? "rtl" : "ltr"}
                            value={item.name[language]}
                            maxLength={100}
                            onChange={(e) =>
                              editItem({
                                name: {
                                  ...item.name,
                                  [language]: e.target.value,
                                },
                              })
                            }
                          />
                        </label>
                        <label className="admin-field">
                          {t.description}
                          <textarea
                            dir={language === "ar" ? "rtl" : "ltr"}
                            rows={3}
                            value={item.description[language]}
                            maxLength={500}
                            onChange={(e) =>
                              editItem({
                                description: {
                                  ...item.description,
                                  [language]: e.target.value,
                                },
                              })
                            }
                          />
                          <small>{t.translationHint}</small>
                        </label>
                        <div className="admin-field-pair">
                          <label className="admin-field">
                            {t.priceDh}
                            <input
                              type="number"
                              inputMode="decimal"
                              min="0"
                              max="10000"
                              step="0.01"
                              value={item.price / 100}
                              onChange={(e) =>
                                editItem({
                                  price: Math.round(
                                    Number(e.target.value) * 100,
                                  ),
                                })
                              }
                            />
                          </label>
                          <label className="admin-field">
                            {t.section}
                            <select
                              value={item.category}
                              onChange={(e) =>
                                editItem({
                                  category: e.target.value as Category,
                                })
                              }
                            >
                              {categories.map((category) => (
                                <option key={category.id} value={category.id}>
                                  {label(category.name, uiLanguage)}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>
                        <PhotoField
                          key={item.id}
                          value={item.image}
                          onChange={(image) => editItem({ image })}
                        />
                        <label className="admin-field">
                          {t.labels}
                          <input
                            value={item.tags.join(", ")}
                            onChange={(e) =>
                              editItem({
                                tags: e.target.value
                                  .split(",")
                                  .map((tag) => tag.trim())
                                  .filter(Boolean),
                              })
                            }
                            placeholder={t.labelsPlaceholder}
                          />
                          <small>{t.labelsHint}</small>
                        </label>
                        <label className="admin-checkbox">
                          <input
                            type="checkbox"
                            checked={item.available}
                            onChange={(e) =>
                              editItem({ available: e.target.checked })
                            }
                          />
                          <span>{t.availableToOrder}</span>
                        </label>
                        <section className="admin-options">
                          <div className="admin-section-title">
                            <h2>{t.extrasTitle}</h2>
                            <button
                              type="button"
                              className="admin-text-button"
                              disabled={item.options.length >= 12}
                              onClick={() =>
                                editItem({
                                  options: [
                                    ...item.options,
                                    {
                                      id: newId(),
                                      label: {
                                        en: "",
                                        fr: "",
                                        ar: "",
                                        [language]: t.newExtra,
                                      },
                                      price: 0,
                                    },
                                  ],
                                })
                              }
                            >
                              <Plus size={15} />
                              {t.addExtra}
                            </button>
                          </div>
                          {item.options.length ? (
                            item.options.map((option, index) => (
                              <div className="admin-option-row" key={option.id}>
                                <label className="admin-field">
                                  {t.extraName} · {language.toUpperCase()}
                                  <input
                                    dir={language === "ar" ? "rtl" : "ltr"}
                                    value={option.label[language]}
                                    maxLength={100}
                                    onChange={(e) =>
                                      editOption(index, {
                                        label: {
                                          ...option.label,
                                          [language]: e.target.value,
                                        },
                                      })
                                    }
                                  />
                                </label>
                                <label className="admin-field">
                                  {t.extraDh}
                                  <input
                                    type="number"
                                    inputMode="decimal"
                                    min="0"
                                    max="10000"
                                    step="0.01"
                                    value={option.price / 100}
                                    onChange={(e) =>
                                      editOption(index, {
                                        price: Math.round(
                                          Number(e.target.value) * 100,
                                        ),
                                      })
                                    }
                                  />
                                </label>
                                <button
                                  type="button"
                                  className="admin-icon-button"
                                  aria-label={t.removeExtra(
                                    label(option.label, uiLanguage),
                                  )}
                                  onClick={() =>
                                    editItem({
                                      options: item.options.filter(
                                        (_, i) => i !== index,
                                      ),
                                    })
                                  }
                                >
                                  <X size={17} />
                                </button>
                              </div>
                            ))
                          ) : (
                            <p className="admin-note">{t.noExtras}</p>
                          )}
                        </section>
                        <div className="admin-editor-bottom">
                          <button
                            type="button"
                            className="admin-danger-button"
                            disabled={catalog.items.length < 2}
                            onClick={deleteItem}
                          >
                            <Trash2 size={15} />
                            {t.deleteDish}
                          </button>
                          <button
                            type="button"
                            className="admin-secondary"
                            onClick={onBack}
                          >
                            {t.doneEditing} <Check size={15} />
                          </button>
                        </div>
                      </div>
                      <aside className="admin-item-preview">
                        <img
                          src={item.image}
                          alt={label(item.name, language)}
                          onError={(e) => {
                            e.currentTarget.src = "/images/toast.jpg";
                          }}
                        />
                        <div dir={language === "ar" ? "rtl" : "ltr"}>
                          <span className="admin-preview-label">
                            {t.menuPreview}
                          </span>
                          {/* Shows exactly what customers see, fallbacks included. */}
                          <h2>
                            {label(item.name, language) || t.previewName}
                          </h2>
                          <p>
                            {label(item.description, language) ||
                              t.previewDescription}
                          </p>
                          <strong>
                            {formatPrice(item.price, language)}
                          </strong>
                          <span className="admin-preview-status">
                            {item.available
                              ? t.availableToOrder
                              : t.currentlySoldOut}
                          </span>
                        </div>
                      </aside>
                    </div>
                  </div>
  );
}

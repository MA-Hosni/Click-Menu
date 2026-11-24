"use client";

import { ExternalLink } from "lucide-react";
import { slugify, SLUG_PATTERN } from "../../../lib/catalog-validation";
import type { Catalog } from "../../../lib/types";
import { useAdmin } from "../../../features/admin/AdminProvider";

export default function RestaurantPage() {
  const { user, catalog, saved, updateCatalog, clearNotice, t } = useAdmin();
  const shopId = user ? saved.settings.slug || user.id : undefined;
  const publicLink = shopId ? `/menu?shop=${encodeURIComponent(shopId)}` : "/menu";
  function setting<K extends keyof Catalog["settings"]>(key: K, value: Catalog["settings"][K]) {
    updateCatalog((current) => ({ ...current, settings: { ...current.settings, [key]: value } }));
    clearNotice();
  }
  return (
                
                  <fieldset className="admin-settings" disabled={!user}>
                    <section className="admin-setting-section">
                      <div>
                        <h2>{t.yourRestaurantTitle}</h2>
                        <p>{t.yourRestaurantIntro}</p>
                      </div>
                      <div className="admin-setting-fields">
                        <label className="admin-field">
                          {t.restaurantName}
                          <input
                            maxLength={100}
                            value={catalog.settings.name}
                            onChange={(e) => setting("name", e.target.value)}
                          />
                        </label>
                        <label className="admin-field">
                          {t.tagline}
                          <input
                            maxLength={150}
                            value={catalog.settings.tagline}
                            onChange={(e) => setting("tagline", e.target.value)}
                          />
                        </label>
                        <label className="admin-field">
                          {t.about}
                          <textarea
                            rows={4}
                            maxLength={1000}
                            value={catalog.settings.description}
                            onChange={(e) =>
                              setting("description", e.target.value)
                            }
                          />
                        </label>
                      </div>
                    </section>
                    <section className="admin-setting-section">
                      <div>
                        <h2>{t.findTableTitle}</h2>
                        <p>{t.findTableIntro}</p>
                      </div>
                      <div className="admin-setting-fields">
                        <label className="admin-field">
                          {t.address}
                          <input
                            maxLength={300}
                            value={catalog.settings.address}
                            onChange={(e) => setting("address", e.target.value)}
                          />
                        </label>
                        <label className="admin-field">
                          {t.hours}
                          <input
                            maxLength={300}
                            value={catalog.settings.hours}
                            onChange={(e) => setting("hours", e.target.value)}
                          />
                        </label>
                      </div>
                    </section>
                    <section className="admin-setting-section">
                      <div>
                        <h2>{t.whatsappTitle}</h2>
                        <p>{t.whatsappIntro}</p>
                      </div>
                      <div className="admin-setting-fields">
                        <label className="admin-field">
                          {t.whatsappNumber}
                          <input
                            type="tel"
                            placeholder="212600000000"
                            value={catalog.settings.whatsapp}
                            onChange={(e) =>
                              setting("whatsapp", e.target.value)
                            }
                          />
                          <small>{t.whatsappHint}</small>
                        </label>
                        <label className="admin-field">
                          {t.deliveryFee}
                          <input
                            type="number"
                            inputMode="decimal"
                            min="0"
                            max="1000"
                            step="0.01"
                            value={catalog.settings.deliveryFee / 100}
                            onChange={(e) =>
                              setting(
                                "deliveryFee",
                                Math.round(Number(e.target.value) * 100),
                              )
                            }
                          />
                        </label>
                        <p className="admin-note">{t.pricesInDh}</p>
                      </div>
                    </section>
                    <section className="admin-setting-section">
                      <div>
                        <h2>{t.publicMenuTitle}</h2>
                        <p>{t.publicMenuIntro}</p>
                        {user && (
                          <a
                            className="admin-text-button"
                            href={publicLink}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {t.openCustomerMenu} <ExternalLink size={14} />
                          </a>
                        )}
                      </div>
                      <div className="admin-setting-fields">
                        <label className="admin-field">
                          {t.linkName}
                          <div className="admin-slug-input">
                            <span>/menu?shop=</span>
                            <input
                              maxLength={60}
                              placeholder={slugify(catalog.settings.name)}
                              value={catalog.settings.slug}
                              onChange={(e) =>
                                setting("slug", e.target.value.toLowerCase())
                              }
                              aria-invalid={
                                !!catalog.settings.slug &&
                                !SLUG_PATTERN.test(catalog.settings.slug)
                              }
                            />
                          </div>
                          <small>{t.linkNameHint}</small>
                        </label>
                        {!catalog.settings.slug &&
                          slugify(catalog.settings.name).length >= 3 && (
                            <button
                              type="button"
                              className="admin-text-button admin-slug-suggest"
                              onClick={() =>
                                setting("slug", slugify(catalog.settings.name))
                              }
                            >
                              {t.useSuggestion(slugify(catalog.settings.name))}
                            </button>
                          )}
                        <label className="admin-field">
                          {t.websiteAddress}
                          <input
                            type="url"
                            placeholder="https://your-cafe.com"
                            value={catalog.settings.publicUrl}
                            onChange={(e) =>
                              setting("publicUrl", e.target.value)
                            }
                          />
                          <small>{t.websiteHint}</small>
                        </label>
                      </div>
                    </section>
                  </fieldset>

  );
}

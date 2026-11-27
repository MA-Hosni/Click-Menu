"use client";

import { ExternalLink } from "lucide-react";
import type { Catalog } from "../../../lib/types";
import { useAdmin } from "../../../features/admin/AdminProvider";

export default function RestaurantPage() {
  const { user, catalog, updateCatalog, clearNotice, t } = useAdmin();
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
                        <h2>{t.publicMenuTitle}</h2>
                        <p>{t.publicMenuIntro}</p>
                        {user && (
                          <a
                            className="admin-text-button"
                            href="/menu"
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {t.openCustomerMenu} <ExternalLink size={14} />
                          </a>
                        )}
                      </div>
                      <div className="admin-setting-fields">
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

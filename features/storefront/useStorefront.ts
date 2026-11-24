"use client";

import { useCallback, useEffect, useState } from "react";
import type { CartItem, Catalog, Language, MenuItem } from "../../lib/types";
import { createSeedCatalog } from "../../lib/menu-data";
import {
  addToCart as addCartItem,
  sanitizeCart,
  updateCartQuantity,
} from "../../lib/cart";
import { copy } from "../../components/client/copy";

const LANGUAGE_KEY = "tabletap:language";

export function useStorefront() {
  const [catalog, setCatalog] = useState<Catalog>(createSeedCatalog);
  const [language, setLanguage] = useState<Language>("en");
  const [shop, setShop] = useState("");
  const [tableFromLink, setTableFromLink] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [storageKey, setStorageKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadCount, setReloadCount] = useState(0);
  const [notice, setNotice] = useState("");
  const t = copy[language];

  useEffect(() => {
    const controller = new AbortController();
    let live = true;
    const params = new URLSearchParams(window.location.search);
    const shopId = params.get("shop") || "";
    const table = params.get("table") || "";
    let savedLanguage: string | null = null;
    try {
      savedLanguage = localStorage.getItem(LANGUAGE_KEY);
    } catch {}
    queueMicrotask(() => {
      if (!live) return;
      setShop(shopId);
      if (shopId)
        setCatalog((current) => ({
          ...current,
          items: [],
          categories: [],
          settings: {
            ...current.settings,
            name: "",
            tagline: "",
            description: "",
            address: "",
            hours: "",
            whatsapp: "",
          },
        }));
      if (/^\d{1,2}$/.test(table) && Number(table) > 0)
        setTableFromLink(String(Number(table)));
      if (
        savedLanguage === "en" ||
        savedLanguage === "fr" ||
        savedLanguage === "ar"
      )
        setLanguage(savedLanguage);
      setLoading(true);
      setError("");
    });

    fetch(`/api/catalog${shopId ? `?shop=${encodeURIComponent(shopId)}` : ""}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Menu unavailable");
        return (await response.json()) as Catalog;
      })
      .then((data) => {
        if (!live) return;
        setCatalog(data);
        const key = `tabletap:cart:v1:${shopId || "demo"}`;
        try {
          setCart(
            sanitizeCart(
              JSON.parse(localStorage.getItem(key) || "[]"),
              data.items,
            ),
          );
        } catch {
          setCart([]);
        }
        setStorageKey(key);
        setLoading(false);
      })
      .catch((cause: unknown) => {
        if (
          live &&
          !(cause instanceof DOMException && cause.name === "AbortError")
        ) {
          setError("menu");
          setLoading(false);
        }
      });

    return () => {
      live = false;
      controller.abort();
    };
  }, [reloadCount]);

  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = language === "ar" ? "rtl" : "ltr";
    try {
      localStorage.setItem(LANGUAGE_KEY, language);
    } catch {}
  }, [language]);

  useEffect(() => {
    if (!storageKey) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(cart));
    } catch {}
  }, [cart, storageKey]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 3000);
    return () => clearTimeout(timer);
  }, [notice]);

  const addItem = useCallback(
    (item: MenuItem, optionIds: string[] = [], quantity = 1) => {
      setCart((current) => addCartItem(current, item, optionIds, quantity));
      setNotice(t.saved);
    },
    [t.saved],
  );
  const changeQuantity = useCallback((key: string, quantity: number) => {
    setCart((current) => updateCartQuantity(current, key, quantity));
  }, []);
  const clearCart = useCallback(() => setCart([]), []);
  const changeLanguage = useCallback((next: Language) => {
    setLanguage(next);
  }, []);
  const retry = useCallback(() => setReloadCount((count) => count + 1), []);
  const clearNotice = useCallback(() => setNotice(""), []);

  return {
    catalog,
    language,
    shop,
    tableFromLink,
    cart,
    loading,
    error,
    notice,
    t,
    addItem,
    changeQuantity,
    clearCart,
    changeLanguage,
    retry,
    clearNotice,
  };
}

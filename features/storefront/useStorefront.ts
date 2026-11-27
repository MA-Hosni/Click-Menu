"use client";

import { useCallback, useEffect, useState } from "react";
import type { CartItem, Catalog, Language, MenuItem } from "../../lib/types";
import { createEmptyCatalog } from "../../lib/menu-data";
import {
  addToCart as addCartItem,
  sanitizeCart,
  updateCartQuantity,
} from "../../lib/cart";
import { copy } from "./i18n/copy";
import { getDineInStorage, loadDineInCart, saveDineInCart } from "./dine-in-order";

const LANGUAGE_KEY = "tabletap:language";
const RESTAURANT_KEY = "the-hood";

interface ScopedCartState {
  scope: string;
  items: CartItem[];
}

export function visibleCartForScope(state: ScopedCartState, scope: string): CartItem[] {
  return state.scope === scope ? state.items : [];
}

export function cartStateCanPersist(state: ScopedCartState, loadedScope: string, scope: string): boolean {
  return Boolean(scope) && state.scope === scope && loadedScope === scope;
}

export function useStorefront(
  tableContext = "",
  initialCatalog?: Catalog,
  dineInTableToken?: string,
) {
  const [catalog, setCatalog] = useState<Catalog>(
    () => initialCatalog ?? createEmptyCatalog(),
  );
  const [language, setLanguage] = useState<Language>("en");
  const [tableFromLink, setTableFromLink] = useState(tableContext);
  const cartScope = dineInTableToken
    ? `table:${dineInTableToken}`
    : `tabletap:cart:v1:${RESTAURANT_KEY}`;
  const [cartState, setCartState] = useState<ScopedCartState>({ scope: "", items: [] });
  const [loadedScope, setLoadedScope] = useState("");
  const cart = visibleCartForScope(cartState, cartScope);
  const scopeReady = loadedScope === cartScope;
  const [loading, setLoading] = useState(!initialCatalog);
  const [error, setError] = useState("");
  const [reloadCount, setReloadCount] = useState(0);
  const [notice, setNotice] = useState("");
  const t = copy[language];

  useEffect(() => {
    const controller = new AbortController();
    let live = true;
    let savedLanguage: string | null = null;
    try {
      savedLanguage = localStorage.getItem(LANGUAGE_KEY);
    } catch {}
    queueMicrotask(() => {
      if (!live) return;
      setTableFromLink(tableContext);
      if (
        savedLanguage === "en" ||
        savedLanguage === "fr" ||
        savedLanguage === "ar"
      )
        setLanguage(savedLanguage);
      if (!initialCatalog || reloadCount > 0) setLoading(true);
      setError("");
    });

    const catalogRequest = initialCatalog && reloadCount === 0
      ? Promise.resolve(initialCatalog)
      : fetch("/api/catalog", { signal: controller.signal }).then(
          async (response) => {
            if (!response.ok) throw new Error("Menu unavailable");
            return (await response.json()) as Catalog;
          },
        );

    catalogRequest
      .then(async (data) => {
        if (!live) return;
        setCatalog(data);
        const key = cartScope;
        const storage = getDineInStorage();
        if (dineInTableToken) {
          const items = storage ? await loadDineInCart(storage, dineInTableToken) : [];
          if (!live) return;
          setCartState({ scope: key, items });
        }
        else {
          try {
            setCartState({ scope: key, items: sanitizeCart(JSON.parse(storage?.getItem(key) || "[]"), data.items) });
          } catch {
            setCartState({ scope: key, items: [] });
          }
        }
        setLoadedScope(key);
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
  }, [cartScope, dineInTableToken, initialCatalog, reloadCount, tableContext]);

  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = language === "ar" ? "rtl" : "ltr";
    try {
      localStorage.setItem(LANGUAGE_KEY, language);
    } catch {}
  }, [language]);

  useEffect(() => {
    if (!cartStateCanPersist(cartState, loadedScope, cartScope)) return;
    const storage = getDineInStorage();
    if (storage) {
      if (dineInTableToken) void saveDineInCart(storage, dineInTableToken, cartState.items);
      else {
        try { storage.setItem(cartScope, JSON.stringify(cartState.items)); } catch {}
      }
    }
  }, [cartScope, cartState, dineInTableToken, loadedScope]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 3000);
    return () => clearTimeout(timer);
  }, [notice]);

  const addItem = useCallback(
    (item: MenuItem, optionIds: string[] = [], quantity = 1) => {
      setCartState((current) => current.scope === cartScope
        ? { scope: cartScope, items: addCartItem(current.items, item, optionIds, quantity) }
        : current);
      setNotice(t.saved);
    },
    [cartScope, setCartState, t.saved],
  );
  const changeQuantity = useCallback((key: string, quantity: number) => {
    setCartState((current) => current.scope === cartScope
      ? { scope: cartScope, items: updateCartQuantity(current.items, key, quantity) }
      : current);
  }, [cartScope, setCartState]);
  const clearCart = useCallback(() => {
    setCartState((current) => current.scope === cartScope
      ? { scope: cartScope, items: [] }
      : current);
  }, [cartScope, setCartState]);
  const replaceCart = useCallback((next: CartItem[]) => {
    setCartState((current) => current.scope === cartScope
      ? { scope: cartScope, items: next }
      : current);
  }, [cartScope, setCartState]);
  const changeLanguage = useCallback((next: Language) => {
    setLanguage(next);
  }, []);
  const retry = useCallback(() => setReloadCount((count) => count + 1), []);
  const clearNotice = useCallback(() => setNotice(""), []);

  return {
    catalog,
    language,
    tableFromLink,
    cart,
    loading: loading || !scopeReady,
    error: scopeReady ? error : "",
    notice,
    t,
    addItem,
    changeQuantity,
    clearCart,
    replaceCart,
    changeLanguage,
    retry,
    clearNotice,
  };
}

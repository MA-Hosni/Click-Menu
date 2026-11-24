"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CartItem, Catalog, Language, OrderDetails } from "../../lib/types";
import {
  buildWhatsAppMessage,
  calculateCart,
  createWhatsAppUrl,
  validateOrder,
} from "../../lib/cart";
import { copy } from "./i18n/copy";

const NAME_KEY = "tabletap:customer-name";
type CheckoutField = "name" | "table" | "address";

export function useCheckout({
  catalog,
  cart,
  language,
  shop,
  tableFromLink,
  clearCart,
  closeCart,
}: {
  catalog: Catalog;
  cart: CartItem[];
  language: Language;
  shop: string;
  tableFromLink: string;
  clearCart: () => void;
  closeCart: () => void;
}) {
  const t = copy[language];
  const [details, setDetails] = useState<OrderDetails>({
    name: "",
    type: "takeaway",
    table: "",
    address: "",
    notes: "",
  });
  const [message, setMessage] = useState("");
  const [formError, setFormError] = useState("");
  const [copied, setCopied] = useState(false);
  const [invalid, setInvalid] = useState<
    Partial<Record<CheckoutField, boolean>>
  >({});
  const [sent, setSent] = useState(false);
  const [orderId, setOrderId] = useState("");
  const totals = useMemo(
    () =>
      calculateCart(
        cart,
        catalog.items,
        details.type === "delivery" ? catalog.settings.deliveryFee : 0,
      ),
    [cart, catalog.items, catalog.settings.deliveryFee, details.type],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (tableFromLink)
        setDetails((current) => ({
          ...current,
          type: "dine-in",
          table: tableFromLink,
        }));
      try {
        const name = localStorage.getItem(NAME_KEY);
        if (name)
          setDetails((current) =>
            current.name ? current : { ...current, name },
          );
      } catch {}
    }, 0);
    return () => window.clearTimeout(timer);
  }, [tableFromLink]);

  function fieldInvalid(field: CheckoutField, next = details) {
    if (field === "name") return !next.name.trim();
    if (field === "table")
      return (
        next.type === "dine-in" &&
        !/^[A-Za-z0-9 -]{1,20}$/.test(next.table.trim())
      );
    return next.type === "delivery" && next.address.trim().length < 5;
  }

  function checkField(field: CheckoutField) {
    setInvalid((current) => ({ ...current, [field]: fieldInvalid(field) }));
  }

  function clearField(field: CheckoutField) {
    setInvalid((current) =>
      current[field] ? { ...current, [field]: false } : current,
    );
  }

  function preview(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields: CheckoutField[] = ["name", "table", "address"];
    const wrong = fields.filter((field) => fieldInvalid(field));
    if (wrong.length) {
      setInvalid(Object.fromEntries(wrong.map((field) => [field, true])));
      event.currentTarget
        .querySelector<HTMLElement>(`[name="${wrong[0]}"]`)
        ?.focus();
      return;
    }
    if (validateOrder(details)) {
      setFormError(t.error);
      return;
    }
    try {
      setMessage(buildWhatsAppMessage(cart, catalog, details, language));
      setOrderId(crypto.randomUUID().replaceAll("-", ""));
      try {
        localStorage.setItem(NAME_KEY, details.name.trim());
      } catch {}
      setFormError("");
      setCopied(false);
    } catch (error) {
      console.error("Could not build the order message:", error);
      setFormError(t.error);
    }
  }

  function changeLanguage(next: Language) {
    if (!message) return;
    try {
      setMessage(buildWhatsAppMessage(cart, catalog, details, next));
      setCopied(false);
    } catch {
      setMessage("");
    }
  }

  const resetForCartChange = useCallback(() => {
    setMessage("");
    setSent(false);
  }, []);

  function recordOrder() {
    setSent(true);
    if (!shop || !orderId) return;
    fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: orderId, shop, cart, details, language }),
      keepalive: true,
    }).catch(() => {});
  }

  async function copyMessage() {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
    } catch {
      setFormError(t.copyFallback);
    }
  }

  function startNewOrder() {
    clearCart();
    setMessage("");
    setSent(false);
    setOrderId("");
    setDetails((current) => ({ ...current, notes: "", address: "" }));
    closeCart();
  }

  let whatsappUrl = "";
  try {
    if (message)
      whatsappUrl = createWhatsAppUrl(catalog.settings.whatsapp, message);
  } catch {}

  return {
    details,
    setDetails,
    totals,
    message,
    setMessage,
    formError,
    setFormError,
    copied,
    invalid,
    fieldInvalid,
    checkField,
    clearField,
    preview,
    changeLanguage,
    resetForCartChange,
    recordOrder,
    copyMessage,
    startNewOrder,
    sent,
    whatsappUrl,
  };
}

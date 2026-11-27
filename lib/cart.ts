import type {
  CartItem,
  Currency,
  Language,
  MenuItem,
  MenuOption,
} from "./types";
import { formatMinorUnits } from "./money";

export interface CartLine {
  key: string;
  item: MenuItem;
  options: MenuOption[];
  quantity: number;
  unitPrice: number;
  total: number;
}

/** Formats integer millimes as Tunisian dinars. */
export function formatPrice(
  amount: number,
  language: Language = "en",
  currency: Currency = "TND",
): string {
  return formatMinorUnits(amount, currency, language);
}

export function cartKey(itemId: string, optionIds: string[] = []): string {
  return `${itemId}:${[...new Set(optionIds)].sort().join(",")}`;
}

export function addToCart(
  cart: CartItem[],
  item: MenuItem,
  optionIds: string[] = [],
  quantity = 1,
): CartItem[] {
  if (!item.available) return cart;
  const validIds = [
    ...new Set(
      optionIds.filter((id) => item.options.some((option) => option.id === id)),
    ),
  ].sort();
  const key = cartKey(item.id, validIds);
  const added = Number.isFinite(quantity)
    ? Math.max(1, Math.min(99, Math.floor(quantity)))
    : 1;
  const existing = cart.find((entry) => entry.key === key);
  if (existing)
    return cart.map((entry) =>
      entry.key === key
        ? { ...entry, quantity: Math.min(99, entry.quantity + added) }
        : entry,
    );
  return [
    ...cart,
    { key, itemId: item.id, optionIds: validIds, quantity: added },
  ];
}

export function updateCartQuantity(
  cart: CartItem[],
  key: string,
  quantity: number,
): CartItem[] {
  if (!Number.isFinite(quantity)) return cart;
  if (quantity < 1) return cart.filter((entry) => entry.key !== key);
  return cart.map((entry) =>
    entry.key === key
      ? { ...entry, quantity: Math.min(99, Math.floor(quantity)) }
      : entry,
  );
}

/** Treat saved browser state as untrusted; only current, available menu items survive. */
export function sanitizeCart(value: unknown, items: MenuItem[]): CartItem[] {
  if (!Array.isArray(value)) return [];
  let result: CartItem[] = [];
  for (const candidate of value.slice(0, 100)) {
    if (!candidate || typeof candidate !== "object") continue;
    const row = candidate as Partial<CartItem>;
    const item = items.find(
      (entry) => entry.id === row.itemId && entry.available,
    );
    if (
      !item ||
      typeof row.quantity !== "number" ||
      !Number.isInteger(row.quantity) ||
      row.quantity < 1
    )
      continue;
    if (
      !Array.isArray(row.optionIds) ||
      row.optionIds.some((id) => typeof id !== "string")
    )
      continue;
    result = addToCart(result, item, row.optionIds, row.quantity);
  }
  return result;
}

export function getCartLines(cart: CartItem[], items: MenuItem[]): CartLine[] {
  return sanitizeCart(cart, items).map((row) => {
    const item = items.find((entry) => entry.id === row.itemId)!;
    const options = item.options.filter((option) =>
      row.optionIds.includes(option.id),
    );
    const unitPrice =
      item.price + options.reduce((sum, option) => sum + option.price, 0);
    return {
      key: row.key,
      item,
      options,
      quantity: row.quantity,
      unitPrice,
      total: unitPrice * row.quantity,
    };
  });
}

export function calculateCart(
  cart: CartItem[],
  items: MenuItem[],
) {
  const lines = getCartLines(cart, items);
  const subtotal = lines.reduce((sum, line) => sum + line.total, 0);
  const itemCount = lines.reduce((sum, line) => sum + line.quantity, 0);
  return {
    lines,
    subtotal,
    total: subtotal,
    itemCount,
  };
}

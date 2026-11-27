"use client";

import { useState } from "react";
import DineInCheckout from "../../components/client/ordering/DineInCheckout";
import { cartKey } from "../../lib/cart";
import type { CartItem, Catalog, Language } from "../../lib/types";
import { useDineInCheckout } from "../../features/storefront/useDineInCheckout";
import { postBrowserTestSubmission } from "./checkout-test-transport";
import DishPhoto from "../../components/ui/DishPhoto";

const language: Language = "en";
const catalog: Catalog = {
  revision: 1,
  settings: {
    name: "Synthetic Test Restaurant",
    tagline: "",
    description: "",
    address: "",
    hours: "",
    currency: "TND",
    publicUrl: "",
  },
  categories: [{ id: "test-food", name: { en: "Test food", fr: "Test", ar: "اختبار" } }],
  items: [{
    id: "test-product",
    category: "test-food",
    name: { en: "Synthetic sandwich", fr: "Sandwich test", ar: "ساندويتش تجريبي" },
    description: { en: "", fr: "", ar: "" },
    price: 1800,
    image: null,
    tags: [],
    available: true,
    options: [],
  }],
};

// This test-only transport targets a path with no application handler. Playwright
// supplies the mock; outside the runner, it can only receive a 404, never an order.
const submitSyntheticOrder = (operation: Parameters<typeof postBrowserTestSubmission>[0]) =>
  postBrowserTestSubmission(operation);

export default function CheckoutBrowserHarness({ tableToken }: { tableToken: string }) {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [open, setOpen] = useState(false);
  const checkout = useDineInCheckout({
    tableToken,
    menuItems: catalog.items,
    cart,
    setCart,
    storefrontReady: true,
    submitOperation: submitSyntheticOrder,
  });

  return (
    <main>
      <div data-testid="dish-photo-placeholder">
        <DishPhoto src={catalog.items[0].image} alt="Synthetic sandwich" />
      </div>
      <p data-testid="pending-state">{checkout.pendingStatus}</p>
      <button type="button" data-testid="add-test-item" onClick={() => setCart([{
        itemId: "test-product",
        optionIds: [],
        quantity: 1,
        key: cartKey("test-product"),
      }])}>Add synthetic item</button>
      <button type="button" data-testid="open-checkout" onClick={() => setOpen(true)}>Open checkout</button>
      <DineInCheckout
        open={open}
        onClose={() => setOpen(false)}
        language={language}
        catalog={catalog}
        cart={cart}
        onQuantityChange={(key, quantity) => setCart((current) => quantity < 1
          ? current.filter((entry) => entry.key !== key)
          : current.map((entry) => entry.key === key ? { ...entry, quantity } : entry))}
        onRefreshCatalog={() => {}}
        checkout={checkout}
      />
    </main>
  );
}

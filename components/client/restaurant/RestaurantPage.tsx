"use client";

import { useState } from "react";
import { ArrowRight, Check } from "lucide-react";
import type { Language, MenuItem } from "../../../lib/types";
import { formatPrice } from "../../../lib/cart";
import { useCheckout } from "../../../features/storefront/useCheckout";
import { useStorefront } from "../../../features/storefront/useStorefront";
import CartPanel from "../cart/CartPanel";
import MenuSection from "../menu/MenuSection";
import RestaurantFooter from "./RestaurantFooter";
import RestaurantHeader from "./RestaurantHeader";
import RestaurantHero from "./RestaurantHero";
import RestaurantInfo from "./RestaurantInfo";

export default function RestaurantPage({
  menuOnly = false,
}: {
  menuOnly?: boolean;
}) {
  const storefront = useStorefront();
  const [cartOpen, setCartOpen] = useState(false);
  const checkout = useCheckout({
    catalog: storefront.catalog,
    cart: storefront.cart,
    language: storefront.language,
    shop: storefront.shop,
    tableFromLink: storefront.tableFromLink,
    clearCart: storefront.clearCart,
    closeCart: () => setCartOpen(false),
  });
  const restaurantName = storefront.catalog.settings.name || "TableTap";
  const orderTable =
    checkout.details.type === "dine-in" ? checkout.details.table : "";

  function addToCart(item: MenuItem, options: string[], quantity: number) {
    storefront.addItem(item, options, quantity);
    checkout.resetForCartChange();
  }

  function changeQuantity(key: string, quantity: number) {
    storefront.changeQuantity(key, quantity);
    checkout.resetForCartChange();
  }

  function changeLanguage(language: Language) {
    storefront.changeLanguage(language);
    checkout.changeLanguage(language);
  }

  return (
    <>
      <RestaurantHeader
        restaurantName={restaurantName}
        shop={storefront.shop}
        language={storefront.language}
        itemCount={checkout.totals.itemCount}
        onLanguageChange={changeLanguage}
        onOpenCart={() => setCartOpen(true)}
      />
      {!menuOnly && (
        <RestaurantHero
          language={storefront.language}
          tagline={storefront.catalog.settings.tagline}
          restaurantName={restaurantName}
        />
      )}
      <main>
        <MenuSection
          catalog={storefront.catalog}
          language={storefront.language}
          menuOnly={menuOnly}
          loading={storefront.loading}
          error={storefront.error}
          orderTable={orderTable}
          onRetry={storefront.retry}
          onAddToCart={addToCart}
        />
        <RestaurantInfo
          catalog={storefront.catalog}
          language={storefront.language}
        />
      </main>
      <RestaurantFooter
        restaurantName={restaurantName}
        shop={storefront.shop}
        language={storefront.language}
      />
      {checkout.totals.itemCount > 0 && !cartOpen && (
        <button
          className="floating-cart"
          onClick={() => {
            setCartOpen(true);
            checkout.setMessage("");
          }}
        >
          <span className="cart-count">{checkout.totals.itemCount}</span>
          <span>{storefront.t.viewOrder}</span>
          <strong>{formatPrice(checkout.totals.total, storefront.language)}</strong>
          <ArrowRight size={19} />
        </button>
      )}
      <div
        className={`toast ${storefront.notice ? "visible" : ""}`}
        role="status"
        aria-live="polite"
      >
        {storefront.notice && (
          <>
            <Check size={17} />
            {storefront.notice}
          </>
        )}
      </div>
      <CartPanel
        language={storefront.language}
        checkout={checkout}
        restaurantName={restaurantName}
        open={cartOpen}
        onClose={() => setCartOpen(false)}
        onQuantityChange={changeQuantity}
      />
    </>
  );
}

"use client";

import { useState } from "react";
import { ArrowRight, Check } from "lucide-react";
import type { Catalog, Language, MenuItem } from "../../../lib/types";
import { useStorefront } from "../../../features/storefront/useStorefront";
import { useDineInCheckout } from "../../../features/storefront/useDineInCheckout";
import DineInCheckout from "../ordering/DineInCheckout";
import MenuSection from "../menu/MenuSection";
import RestaurantFooter from "./RestaurantFooter";
import RestaurantHeader from "./RestaurantHeader";
import RestaurantHero from "./RestaurantHero";
import RestaurantInfo from "./RestaurantInfo";

export default function RestaurantPage({
  menuOnly = false,
  tableLabel = "",
  dineInTableToken,
  initialCatalog,
}: {
  menuOnly?: boolean;
  tableLabel?: string;
  dineInTableToken?: string;
  initialCatalog?: Catalog;
}) {
  const dineInMode = Boolean(dineInTableToken);
  const storefront = useStorefront(tableLabel, initialCatalog, dineInTableToken);
  const [cartOpen, setCartOpen] = useState(false);
  const restaurantName = storefront.catalog.settings.name || "The Hood";
  const dineInCheckout = useDineInCheckout({
    tableToken: dineInTableToken ?? "",
    menuItems: storefront.catalog.items,
    cart: storefront.cart,
    setCart: storefront.replaceCart,
    storefrontReady: !storefront.loading && !storefront.error,
  });
  const orderingAvailable = dineInMode && dineInCheckout.ready && !dineInCheckout.pending && !dineInCheckout.receipt;
  const orderTable = tableLabel;

  function addToCart(item: MenuItem, options: string[], quantity: number) {
    if (!dineInMode || dineInCheckout.pending || dineInCheckout.receipt) return;
    storefront.addItem(item, options, quantity);
  }

  function changeQuantity(key: string, quantity: number) {
    storefront.changeQuantity(key, quantity);
  }

  function changeLanguage(language: Language) {
    storefront.changeLanguage(language);
  }

  return (
    <>
      <RestaurantHeader
        restaurantName={restaurantName}
        language={storefront.language}
        itemCount={storefront.cart.reduce((sum, item) => sum + item.quantity, 0)}
        showCart={dineInMode && (storefront.cart.length > 0 || dineInCheckout.receipt !== null)}
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
          orderingEnabled={orderingAvailable}
          dineInMode={dineInMode}
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
        language={storefront.language}
      />
      {dineInMode && (storefront.cart.length > 0 || dineInCheckout.receipt !== null) && !cartOpen && (
        <button className="floating-cart" onClick={() => setCartOpen(true)}>
          {storefront.cart.length > 0 && <span className="cart-count">{storefront.cart.reduce((sum, item) => sum + item.quantity, 0)}</span>}
          <span>{dineInCheckout.receipt ? storefront.t.dineReceiptTitle : storefront.t.viewOrder}</span>
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
      {dineInMode && <DineInCheckout
        language={storefront.language}
        catalog={storefront.catalog}
        cart={storefront.cart}
        checkout={dineInCheckout}
        onRefreshCatalog={storefront.retry}
        open={cartOpen}
        onClose={() => setCartOpen(false)}
        onQuantityChange={changeQuantity}
      />}
    </>
  );
}

"use client";

import { useEffect, useRef } from "react";
import { ShoppingBag } from "lucide-react";
import Link from "next/link";
import type { Language } from "../../../lib/types";
import { copy } from "../../../features/storefront/i18n/copy";
import RestaurantBrand from "./RestaurantBrand";

export default function RestaurantHeader({
  restaurantName,
  language,
  itemCount,
  showCart = true,
  onLanguageChange,
  onOpenCart,
}: {
  restaurantName: string;
  language: Language;
  itemCount: number;
  showCart?: boolean;
  onLanguageChange: (language: Language) => void;
  onOpenCart: () => void;
}) {
  const t = copy[language];
  const bagRef = useRef<HTMLButtonElement>(null);
  const lastCount = useRef<number | null>(null);

  useEffect(() => {
    const previous = lastCount.current;
    lastCount.current = itemCount;
    const bag = bagRef.current;
    if (!bag || previous === null || itemCount <= previous) return;
    bag.classList.remove("bump");
    void bag.offsetWidth;
    bag.classList.add("bump");
  }, [itemCount]);

  return (
    <>
      <a className="skip-link" href="#menu">
        Skip to menu
      </a>
      <header className="site-header shell">
        <Link
          className="brand"
          href="/"
          aria-label={`${restaurantName} home`}
        >
          <RestaurantBrand />
          <span>{restaurantName}</span>
        </Link>
        <nav className="main-nav" aria-label="Main navigation">
          <a href="#menu">{t.menu}</a>
          <a href="#story">{t.story}</a>
          <a href="#visit">{t.visit}</a>
        </nav>
        <div className="header-actions">
          <label className="language-select">
            <span className="sr-only">Language</span>
            <select
              aria-label="Language"
              value={language}
              onChange={(event) =>
                onLanguageChange(event.target.value as Language)
              }
            >
              <option value="en">EN</option>
              <option value="fr">FR</option>
              <option value="ar">عربي</option>
            </select>
          </label>
          {showCart && (
            <button
              ref={bagRef}
              className="bag-button"
              aria-label={`${t.cart} (${itemCount})`}
              onClick={onOpenCart}
            >
              <ShoppingBag size={20} />
              <span>{itemCount}</span>
            </button>
          )}
        </div>
      </header>
    </>
  );
}

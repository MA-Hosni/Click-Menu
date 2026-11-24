"use client";

import { Leaf, Plus } from "lucide-react";
import type { Language, MenuItem } from "../../../lib/types";
import { formatPrice } from "../../../lib/cart";
import { pickText } from "../../../lib/text";
import { copy } from "../../../features/storefront/i18n/copy";
import Photo from "../shared/Photo";

export default function MenuItemCard({
  item,
  language,
  headingLevel,
  index,
  onSelect,
  onQuickAdd,
}: {
  item: MenuItem;
  language: Language;
  headingLevel: "h2" | "h3";
  index: number;
  onSelect: (item: MenuItem) => void;
  onQuickAdd: (item: MenuItem) => void;
}) {
  const t = copy[language];
  const Heading = headingLevel;

  return (
    <article
      className={`menu-item ${!item.available ? "unavailable" : ""}`}
      data-reveal
      style={{ "--reveal-i": index % 4 } as React.CSSProperties}
    >
      <button
        className="menu-image-button"
        disabled={!item.available}
        onClick={() => onSelect(item)}
        aria-label={`${t.customize}: ${pickText(item.name, language)}`}
      >
        <Photo src={item.image} alt={pickText(item.name, language)} />
      </button>
      <div className="menu-item-content">
        <div className="menu-item-title">
          <Heading className="menu-item-name">
            {pickText(item.name, language)}
          </Heading>
          {(item.tags.includes("vegetarian") || item.tags.includes("vegan")) && (
            <Leaf className="diet-icon" size={15} aria-label={t.veg} />
          )}
        </div>
        <p>{pickText(item.description, language)}</p>
        <div className="menu-item-bottom">
          <strong>{formatPrice(item.price, language)}</strong>
          <button
            className="add-button"
            disabled={!item.available}
            onClick={() => onQuickAdd(item)}
            aria-label={`${t.add} ${pickText(item.name, language)}`}
          >
            {item.available ? (
              <>
                {t.add}
                <Plus size={15} />
              </>
            ) : (
              t.sold
            )}
          </button>
        </div>
      </div>
    </article>
  );
}

"use client";

import { Check, Leaf, Search } from "lucide-react";

export default function MenuSearch({
  search,
  vegetarian,
  searchLabel,
  vegetarianLabel,
  onSearchChange,
  onVegetarianChange,
}: {
  search: string;
  vegetarian: boolean;
  searchLabel: string;
  vegetarianLabel: string;
  onSearchChange: (value: string) => void;
  onVegetarianChange: () => void;
}) {
  return (
    <div className="menu-filter-row">
      <label className="search-box">
        <Search size={18} />
        <span className="sr-only">{searchLabel}</span>
        <input
          type="search"
          placeholder={searchLabel}
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
        />
      </label>
      <button
        className={`veg-filter ${vegetarian ? "selected" : ""}`}
        aria-pressed={vegetarian}
        onClick={onVegetarianChange}
      >
        <Leaf size={16} />
        {vegetarianLabel}
        {vegetarian && <Check size={14} />}
      </button>
    </div>
  );
}

export type Language = "en" | "fr" | "ar";
export type Currency = "TND";
export type LocalizedText = Record<Language, string>;
/** A menu section ID chosen by the owner. */
export type Category = string;

export interface MenuCategory {
  id: Category;
  name: LocalizedText;
}

export interface MenuOption {
  id: string;
  label: LocalizedText;
  /** Additional price, in integer minor units for settings.currency. */
  price: number;
}

export interface MenuItem {
  id: string;
  category: Category;
  name: LocalizedText;
  description: LocalizedText;
  /** Price in integer minor units for settings.currency. */
  price: number;
  image: string | null;
  tags: string[];
  available: boolean;
  options: MenuOption[];
}

export interface RestaurantSettings {
  name: string;
  tagline: string;
  description: string;
  address: string;
  hours: string;
  currency: Currency;
  /** Public site origin or base URL. Blank until configured. */
  publicUrl: string;
}

export interface Catalog {
  settings: RestaurantSettings;
  /** Menu sections in display order. */
  categories: MenuCategory[];
  items: MenuItem[];
  /** 0 for an unsaved menu; increments on every successful save. */
  revision: number;
}

export interface CartItem {
  /** Stable identity derived from item ID and selected option IDs. */
  key: string;
  itemId: string;
  optionIds: string[];
  quantity: number;
}

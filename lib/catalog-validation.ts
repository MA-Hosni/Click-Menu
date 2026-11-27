import type {
  Catalog,
  LocalizedText,
  MenuCategory,
  MenuItem,
  MenuOption,
  RestaurantSettings,
} from "./types";

export class CatalogValidationError extends Error {}

/** Server-hosted photos uploaded from the owner dashboard. */
export const UPLOADED_IMAGE_PATTERN = /^\/api\/images\/[a-f0-9]{32}$/;
function object(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new CatalogValidationError(`${field} must be an object.`);
  return value as Record<string, unknown>;
}

function string(
  value: unknown,
  field: string,
  maximum: number,
  allowEmpty = false,
): string {
  if (
    typeof value !== "string" ||
    value.length > maximum ||
    (!allowEmpty && !value.trim()) ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)
  )
    throw new CatalogValidationError(
      `${field} must contain ${allowEmpty ? "0" : "1"}–${maximum} characters.`,
    );
  return value.trim();
}

function integer(value: unknown, field: string, maximum = 1_000_000): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > maximum
  )
    throw new CatalogValidationError(
      `${field} must be a whole number between 0 and ${maximum}.`,
    );
  return value;
}

/**
 * Translations are optional: "one" needs text in at least one language
 * (names), "optional" may be empty everywhere (descriptions). Missing
 * languages fall back on the customer menu (see lib/text.ts).
 */
function localized(
  value: unknown,
  field: string,
  maximum: number,
  required: "one" | "optional" = "one",
): LocalizedText {
  const row = object(value, field);
  const text = {
    en: string(row.en ?? "", `${field} (English)`, maximum, true),
    fr: string(row.fr ?? "", `${field} (French)`, maximum, true),
    ar: string(row.ar ?? "", `${field} (Arabic)`, maximum, true),
  };
  if (required === "one" && !text.en && !text.fr && !text.ar)
    throw new CatalogValidationError(
      `${field} needs text in at least one language.`,
    );
  return text;
}

function id(value: unknown, field: string): string {
  const result = string(value, field, 64);
  if (!/^[a-zA-Z0-9_-]+$/.test(result))
    throw new CatalogValidationError(
      `${field} can only contain letters, numbers, hyphens and underscores.`,
    );
  return result;
}

function imageUrl(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  const result = string(value, "image", 1200);
  if (/^\/images\/[a-zA-Z0-9_.\/-]+$/.test(result) && !result.includes(".."))
    return result;
  if (UPLOADED_IMAGE_PATTERN.test(result)) return result;
  try {
    const url = new URL(result);
    if (url.protocol === "https:" && !url.username && !url.password)
      return url.toString();
  } catch {
    /* handled below */
  }
  throw new CatalogValidationError(
    "Upload a photo, or use an /images/ path or a secure HTTPS URL.",
  );
}

function settings(value: unknown): RestaurantSettings {
  const row = object(value, "settings");
  const publicUrl = string(row.publicUrl, "Public URL", 1200, true);
  if (publicUrl) {
    try {
      const url = new URL(publicUrl);
      const isLocal = ["localhost", "127.0.0.1", "[::1]"].includes(
        url.hostname,
      );
      if (
        (url.protocol !== "https:" && !(isLocal && url.protocol === "http:")) ||
        url.username ||
        url.password
      )
        throw new Error();
    } catch {
      throw new CatalogValidationError(
        "Enter a full HTTPS public URL, or leave it blank.",
      );
    }
  }
  return {
    name: string(row.name, "Restaurant name", 100),
    tagline: string(row.tagline, "Tagline", 150, true),
    description: string(row.description, "Description", 1000, true),
    address: string(row.address, "Address", 300, true),
    hours: string(row.hours, "Opening hours", 300, true),
    publicUrl,
  };
}

function category(value: unknown): MenuCategory {
  const row = object(value, "category");
  return {
    id: id(row.id, "Category ID"),
    name: localized(row.name, "Category name", 60),
  };
}

function option(value: unknown): MenuOption {
  const row = object(value, "option");
  return {
    id: id(row.id, "Option ID"),
    label: localized(row.label, "Option label", 100),
    price: integer(row.price, "Option price"),
  };
}

function item(value: unknown, categoryIds: Set<string>): MenuItem {
  const row = object(value, "item");
  if (typeof row.category !== "string" || !categoryIds.has(row.category))
    throw new CatalogValidationError("Choose a valid menu category.");
  if (typeof row.available !== "boolean")
    throw new CatalogValidationError("Availability must be true or false.");
  if (!Array.isArray(row.tags) || row.tags.length > 8)
    throw new CatalogValidationError("An item can have up to 8 tags.");
  if (!Array.isArray(row.options) || row.options.length > 12)
    throw new CatalogValidationError("An item can have up to 12 options.");
  const options = row.options.map(option);
  if (new Set(options.map((entry) => entry.id)).size !== options.length)
    throw new CatalogValidationError(
      "Option IDs must be unique within each item.",
    );
  return {
    id: id(row.id, "Item ID"),
    category: row.category,
    name: localized(row.name, "Item name", 100),
    description: localized(row.description, "Item description", 500, "optional"),
    price: integer(row.price, "Item price"),
    image: imageUrl(row.image),
    tags: row.tags.map((tag) => string(tag, "Tag", 30)),
    available: row.available,
    options,
  };
}

/** Reconstructs a bounded, known shape; database partition keys are never accepted from a payload. */
export function validateCatalog(value: unknown): Catalog {
  const row = object(value, "Catalog");
  if (
    Object.keys(row).some(
      (key) => !["settings", "categories", "items", "revision"].includes(key),
    )
  )
    throw new CatalogValidationError("Unexpected catalog fields.");
  if (
    !Array.isArray(row.items) ||
    row.items.length > 100
  )
    throw new CatalogValidationError(
      "A menu can contain up to 100 items.",
    );
  if (
    !Array.isArray(row.categories) ||
    row.categories.length > 20
  )
    throw new CatalogValidationError(
      "A menu can contain up to 20 categories.",
    );
  const categories = row.categories.map(category);
  const categoryIds = new Set(categories.map((entry) => entry.id));
  if (categoryIds.size !== categories.length)
    throw new CatalogValidationError("Every category must have a unique ID.");
  const items = row.items.map((entry, index) => {
    try {
      return item(entry, categoryIds);
    } catch (error) {
      if (!(error instanceof CatalogValidationError)) throw error;
      // Name the dish so the owner can find it in a long menu.
      const name = (entry as { name?: { en?: unknown } } | null)?.name?.en;
      const label =
        typeof name === "string" && name.trim()
          ? `“${name.trim().slice(0, 100)}”`
          : `Dish ${index + 1}`;
      throw new CatalogValidationError(`${label}: ${error.message}`);
    }
  });
  if (new Set(items.map((entry) => entry.id)).size !== items.length)
    throw new CatalogValidationError("Every item must have a unique ID.");
  return {
    settings: settings(row.settings),
    categories,
    items,
    revision: integer(row.revision, "Revision", 2_000_000_000),
  };
}

/**
 * Fills fields added after a menu was first saved, so older stored menus keep
 * loading. Runs before validation; it never removes owner content.
 */
export function upgradeStoredCatalog(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const row = value as Record<string, unknown>;
  return {
    ...row,
    categories: Array.isArray(row.categories) ? row.categories : [],
  };
}

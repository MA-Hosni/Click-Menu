import type { Catalog } from "./types";

/** Blank The Hood catalog used for initial setup and public empty states. */
export function createEmptyCatalog(): Catalog {
  return {
    settings: {
      name: "The Hood",
      tagline: "",
      description: "",
      address: "",
      hours: "",
      currency: "TND",
      publicUrl: "",
    },
    categories: [],
    items: [],
    revision: 0,
  };
}

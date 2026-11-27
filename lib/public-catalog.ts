import { jsonResponse, routeError } from "./api-security";
import { createEmptyCatalog } from "./menu-data";
import type { Catalog } from "./types";

export function createPublicCatalogHandler(
  readCatalog: () => Promise<Catalog | null>,
) {
  return async function GET(): Promise<Response> {
    try {
      const catalog = await readCatalog();
      return jsonResponse(catalog ?? createEmptyCatalog());
    } catch (error) {
      return routeError(error);
    }
  };
}

import { readPublicCatalog } from "../../../lib/catalog-store";
import { createPublicCatalogHandler } from "../../../lib/public-catalog";

export const GET = createPublicCatalogHandler(readPublicCatalog);

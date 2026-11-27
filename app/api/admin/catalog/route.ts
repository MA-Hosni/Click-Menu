import { getCurrentUser } from "../../../auth";
import {
  ApiError,
  assertSameOrigin,
  jsonResponse,
  readBoundedJson,
  requireAdmin,
  routeError,
} from "../../../../lib/api-security";
import { readCatalog, saveCatalog } from "../../../../lib/catalog-store";
import {
  CatalogValidationError,
  validateTndCatalog,
} from "../../../../lib/catalog-validation";
import { createEmptyCatalog } from "../../../../lib/menu-data";

export async function GET() {
  try {
    requireAdmin(await getCurrentUser());
    return jsonResponse((await readCatalog()) ?? createEmptyCatalog());
  } catch (error) {
    return routeError(error);
  }
}

export async function PUT(request: Request) {
  try {
    requireAdmin(await getCurrentUser());
    assertSameOrigin(request);
    const payload = await readBoundedJson(request);
    const catalog = validateTndCatalog(payload);
    return jsonResponse(await saveCatalog(catalog));
  } catch (error) {
    if (error instanceof CatalogValidationError)
      return routeError(new ApiError(error.message, 400));
    return routeError(error);
  }
}

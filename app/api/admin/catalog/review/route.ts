import { getCurrentUser } from "../../../../auth";
import {
  ApiError,
  assertSameOrigin,
  jsonResponse,
  readBoundedJson,
  requireAdmin,
  routeError,
} from "../../../../../lib/api-security";
import {
  readCatalogReviewState,
  reviewCatalogPrices,
} from "../../../../../lib/catalog-store";

export async function GET() {
  try {
    requireAdmin(await getCurrentUser());
    return jsonResponse(await readCatalogReviewState());
  } catch (error) {
    return routeError(error);
  }
}

export async function POST(request: Request) {
  try {
    const admin = await getCurrentUser();
    requireAdmin(admin);
    assertSameOrigin(request);

    const body = await readBoundedJson(request, 2_000);
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      Object.keys(body).length !== 1 ||
      !Object.hasOwn(body, "expectedRevision")
    )
      throw new ApiError("The review request is invalid.", 400);

    const expectedRevision = (body as { expectedRevision: unknown }).expectedRevision;
    return jsonResponse(await reviewCatalogPrices(expectedRevision, admin!.name));
  } catch (error) {
    return routeError(error);
  }
}

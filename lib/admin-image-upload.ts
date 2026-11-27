import {
  assertSameOrigin,
  jsonResponse,
  readBoundedBytes,
  requireAdmin,
  routeError,
} from "./api-security";
import { MAX_IMAGE_BYTES, assertImage, type ImageType } from "./images";
import type { RequestIdentity } from "./api-security";

export function createAdminImageUploadHandler(dependencies: {
  getCurrentUser: () => Promise<RequestIdentity | null>;
  saveImage: (
    bytes: Uint8Array,
    contentType: ImageType,
  ) => Promise<{ url: string }>;
}) {
  return async function POST(request: Request): Promise<Response> {
    try {
      requireAdmin(await dependencies.getCurrentUser());
      assertSameOrigin(request);
      const bytes = await readBoundedBytes(request, MAX_IMAGE_BYTES);
      return jsonResponse(
        await dependencies.saveImage(bytes, await assertImage(bytes)),
        201,
      );
    } catch (error) {
      return routeError(error);
    }
  };
}

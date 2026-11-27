import { ApiError } from "./api-security";
import { validateImageBytes } from "./image-validation.mjs";
import type { ImageType } from "./image-constants";

export { MAX_IMAGE_BYTES, MAX_IMAGES } from "./image-constants";
export type { ImageType } from "./image-constants";

/** Photos are resized in the browser first; this bounds what the server stores. */
export const IMAGE_ID_PATTERN = /^[a-f0-9]{32}$/;

/** Trusts decoded file content, never the declared Content-Type. */
export async function assertImage(bytes: Uint8Array): Promise<ImageType> {
  if (!bytes.byteLength) throw new ApiError("Choose a photo to upload.", 400);
  try {
    return (await validateImageBytes(bytes)).contentType as ImageType;
  } catch {
    throw new ApiError("Upload a valid JPEG, PNG or WebP photo.", 415);
  }
}

export function newImageId(): string {
  return crypto.randomUUID().replaceAll("-", "");
}

export function imagePath(id: string): string {
  return `/api/images/${id}`;
}

/** Uploaded photos never change, and are served so they can't run as a page. */
export function imageResponse(
  bytes: Uint8Array<ArrayBuffer>,
  contentType: string,
): Response {
  return new Response(bytes, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}

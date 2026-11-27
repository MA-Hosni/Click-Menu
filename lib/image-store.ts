import { eq, sql } from "drizzle-orm";
import { getDb } from "../db";
import { hasDatabaseRows } from "../db/result";
import { menuImages } from "../db/schema";
import {
  deleteImageObject,
  getImageObject,
  putImageObject,
} from "./s3-storage";
import {
  createImageStorage,
  type ImageMetadata,
  type ImageMetadataStore,
} from "./image-storage";
import type { ImageType } from "./images";

function createDatabaseImageStore(): ImageMetadataStore {
  const db = getDb();
  return {
    async insertWithinLimit(metadata: ImageMetadata, maximum: number) {
      const result = await db.execute(sql`
        WITH capacity AS (
          INSERT INTO image_upload_capacity (id, image_count)
          VALUES (1, 1)
          ON CONFLICT (id) DO UPDATE
          SET image_count = image_upload_capacity.image_count + 1
          WHERE image_upload_capacity.image_count < ${maximum}
          RETURNING id
        )
        INSERT INTO menu_images (id, object_key, content_type, byte_length, created_at)
        SELECT ${metadata.id}, ${metadata.objectKey}, ${metadata.contentType},
          ${metadata.byteLength}, ${metadata.createdAt}
        FROM capacity
        RETURNING id
      `);
      return hasDatabaseRows(result);
    },
    async isObjectKeyReferenced(objectKey: string) {
      const [row] = await db
        .select({ id: menuImages.id })
        .from(menuImages)
        .where(eq(menuImages.objectKey, objectKey))
        .limit(1);
      return Boolean(row);
    },
    async get(id) {
      const [row] = await db
        .select({
          objectKey: menuImages.objectKey,
          contentType: menuImages.contentType,
        })
        .from(menuImages)
        .where(eq(menuImages.id, id))
        .limit(1);
      if (
        !row ||
        (row.contentType !== "image/jpeg" &&
          row.contentType !== "image/png" &&
          row.contentType !== "image/webp")
      )
        return null;
      return { objectKey: row.objectKey, contentType: row.contentType as ImageType };
    },
  };
}

function imageStorage() {
  return createImageStorage(createDatabaseImageStore(), {
    put: putImageObject,
    get: getImageObject,
    delete: deleteImageObject,
  });
}

export function saveImage(
  bytes: Uint8Array,
  contentType: ImageType,
): Promise<{ url: string }> {
  return imageStorage().saveImage(bytes, contentType);
}

export function readImage(id: string) {
  return imageStorage().readImage(id);
}

import { ApiError } from "./api-security";
import {
  MAX_IMAGES,
  imagePath,
  newImageId,
  type ImageType,
} from "./images";

export type ImageMetadata = {
  id: string;
  objectKey: string;
  contentType: ImageType;
  byteLength: number;
  createdAt: number;
};

export interface ImageMetadataStore {
  insertWithinLimit(metadata: ImageMetadata, maximum: number): Promise<boolean>;
  isObjectKeyReferenced(objectKey: string): Promise<boolean>;
  get(id: string): Promise<Pick<ImageMetadata, "objectKey" | "contentType"> | null>;
}

export interface ImageObjectStore {
  put(key: string, bytes: Uint8Array, contentType: ImageType): Promise<void>;
  get(key: string): Promise<Uint8Array<ArrayBuffer> | null>;
  delete(key: string): Promise<void>;
}

function isImageType(value: string): value is ImageType {
  return value === "image/jpeg" || value === "image/png" || value === "image/webp";
}

const OBJECT_KEY_PATTERN = /^menu-images\/[a-f0-9]{32}$/;

export function createImageStorage(
  metadataStore: ImageMetadataStore,
  objectStore: ImageObjectStore,
  idFactory = newImageId,
) {
  async function removeOnlyIfUnreferenced(objectKey: string) {
    try {
      if (await metadataStore.isObjectKeyReferenced(objectKey)) {
        console.warn("Preserved a menu image object referenced by database metadata.");
        return;
      }
    } catch {
      console.error("Preserved a menu image object because its database references could not be checked.");
      return;
    }
    try {
      await objectStore.delete(objectKey);
    } catch {
      console.error("Could not remove an unreferenced menu image object.");
    }
  }

  return {
    async saveImage(
      bytes: Uint8Array,
      contentType: ImageType,
    ): Promise<{ url: string }> {
      const id = idFactory();
      const objectKey = `menu-images/${newImageId()}`;
      try {
        await objectStore.put(objectKey, bytes, contentType);
      } catch (error) {
        await removeOnlyIfUnreferenced(objectKey);
        throw error;
      }
      let inserted: boolean;
      try {
        inserted = await metadataStore.insertWithinLimit({
          id,
          objectKey,
          contentType,
          byteLength: bytes.byteLength,
          createdAt: Date.now(),
        }, MAX_IMAGES);
      } catch (error) {
        await removeOnlyIfUnreferenced(objectKey);
        throw error;
      }
      if (!inserted) {
        await removeOnlyIfUnreferenced(objectKey);
        throw new ApiError(
          `You can store up to ${MAX_IMAGES} photos. Reuse an existing photo or contact support.`,
          400,
        );
      }
      return { url: imagePath(id) };
    },

    async readImage(
      id: string,
    ): Promise<{ bytes: Uint8Array<ArrayBuffer>; contentType: ImageType } | null> {
      const metadata = await metadataStore.get(id);
      if (
        !metadata ||
        !OBJECT_KEY_PATTERN.test(metadata.objectKey) ||
        !isImageType(metadata.contentType)
      )
        return null;
      const bytes = await objectStore.get(metadata.objectKey);
      return bytes ? { bytes, contentType: metadata.contentType } : null;
    },
  };
}

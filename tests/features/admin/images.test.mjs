import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import sharp from "sharp";
import {
  decodeLegacyImage,
  sanitizeTransferFailureId,
  transferLegacyImages,
} from "../../../lib/legacy-image-transfer.mjs";
import "../../support/register-types.mjs";

const requireTs = createRequire(import.meta.url);
const { createImageStorage } = requireTs("../../../lib/image-storage.ts");
const { createCatalogOperations } = requireTs("../../../lib/catalog-operations.ts");
const { MAX_IMAGE_BYTES, MAX_IMAGES, assertImage } = requireTs("../../../lib/images.ts");
const { createAdminImageUploadHandler } = requireTs("../../../lib/admin-image-upload.ts");
import { createTestCatalog } from "../../support/catalog-fixture.mjs";

async function fixtures(width = 8, height = 6) {
  const raw = {
    create: { width, height, channels: 3, background: { r: 36, g: 90, b: 150 } },
  };
  return {
    "image/jpeg": await sharp(raw).jpeg().toBuffer(),
    "image/png": await sharp(raw).png().toBuffer(),
    "image/webp": await sharp(raw).webp().toBuffer(),
  };
}

async function animatedWebpFixture() {
  const frames = ["red", "blue"].map((background) => ({
    create: { width: 8, height: 6, channels: 3, background },
  }));
  return sharp(frames, { join: { animated: true } })
    .webp({ delay: [100, 100], loop: 0 })
    .toBuffer();
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  let crc = 0xffffffff;
  for (const byte of Buffer.concat([typeBytes, data])) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc & 1) ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, typeBytes, data, checksum]);
}

function animatedPngFixture(firstFrame, secondFrame) {
  const pngSignature = firstFrame.subarray(0, 8);
  const chunks = [];
  let offset = 8;
  while (offset + 12 <= firstFrame.length) {
    const length = firstFrame.readUInt32BE(offset);
    const type = firstFrame.toString("ascii", offset + 4, offset + 8);
    const data = firstFrame.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") chunks.push(pngChunk(type, data));
    if (type === "IDAT") chunks.push(data);
    if (type === "IEND") break;
    offset += 12 + length;
  }
  const secondFrameData = [];
  offset = 8;
  while (offset + 12 <= secondFrame.length) {
    const length = secondFrame.readUInt32BE(offset);
    const type = secondFrame.toString("ascii", offset + 4, offset + 8);
    if (type === "IDAT") secondFrameData.push(secondFrame.subarray(offset + 8, offset + 8 + length));
    if (type === "IEND") break;
    offset += 12 + length;
  }
  const control = (sequence) => {
    const data = Buffer.alloc(26);
    data.writeUInt32BE(sequence, 0);
    data.writeUInt32BE(8, 4);
    data.writeUInt32BE(6, 8);
    data.writeUInt16BE(100, 20);
    data.writeUInt16BE(100, 22);
    return pngChunk("fcTL", data);
  };
  const animation = Buffer.alloc(8);
  animation.writeUInt32BE(2, 0);
  const frameData = Buffer.alloc(4);
  frameData.writeUInt32BE(2, 0);
  return Buffer.concat([
    pngSignature,
    chunks[0],
    pngChunk("acTL", animation),
    control(0),
    ...chunks.slice(1),
    control(1),
    ...secondFrameData.map((data) => pngChunk("fdAT", Buffer.concat([frameData, data]))),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function memoryStores({ count = 0, insertFailure, referenceFailure = false } = {}) {
  let used = count;
  const metadata = new Map();
  const objects = new Map();
  const deleted = [];
  const metadataStore = {
    async insertWithinLimit(row, maximum) {
      if (used >= maximum) return false;
      used += 1;
      metadata.set(row.id, row);
      if (insertFailure === "before-commit") {
        metadata.delete(row.id);
        used -= 1;
        throw new Error("metadata rejected");
      }
      if (insertFailure === "after-commit") throw new Error("response lost after commit");
      return true;
    },
    async isObjectKeyReferenced(key) {
      if (referenceFailure) throw new Error("database unavailable");
      return [...metadata.values()].some((row) => row.objectKey === key);
    },
    async get(id) { return metadata.get(id) ?? null; },
  };
  const objectStore = {
    async put(key, bytes, contentType) { objects.set(key, { bytes, contentType }); },
    async get(key) { return objects.get(key)?.bytes ?? null; },
    async delete(key) { deleted.push(key); objects.delete(key); },
  };
  return {
    metadata,
    objects,
    deleted,
    metadataStore,
    objectStore,
    get count() { return used; },
  };
}

function catalogImageStores(stores) {
  return createImageStorage(
    stores.metadataStore,
    stores.objectStore,
    (() => {
      let sequence = 0;
      return () => (++sequence).toString(16).padStart(32, "0");
    })(),
  );
}

function legacyRow(id, bytes, contentType) {
  return {
    id,
    content_type: contentType,
    byte_length: bytes.byteLength,
    data: Buffer.from(bytes).toString("base64"),
  };
}

describe("menu image validation", () => {
  it("fully decodes valid JPEG, PNG, and WebP files", async () => {
    const images = await fixtures();
    for (const [contentType, bytes] of Object.entries(images))
      assert.equal(await assertImage(new Uint8Array(bytes)), contentType);
  });

  it("rejects truncated and malformed images", async () => {
    const images = await fixtures();
    await assert.rejects(assertImage(images["image/jpeg"].subarray(0, 12)), { status: 415 });
    await assert.rejects(assertImage(new Uint8Array([0xff, 0xd8, 0xff, 0x00])), { status: 415 });
  });

  it("rejects animated WebP and APNG while accepting static fixtures", async () => {
    const images = await fixtures();
    const animatedWebp = await animatedWebpFixture();
    const animatedPng = animatedPngFixture(images["image/png"], images["image/png"]);
    await assert.rejects(assertImage(animatedWebp), { status: 415 });
    await assert.rejects(assertImage(animatedPng), { status: 415 });
    for (const bytes of Object.values(images)) await assertImage(bytes);
  });

  it("rejects dimensions and pixel counts above the configured limits", async () => {
    const tooWide = await sharp({
      create: { width: 8193, height: 1, channels: 3, background: "red" },
    }).png().toBuffer();
    const tooManyPixels = await sharp({
      create: { width: 5000, height: 4000, channels: 3, background: "red" },
    }).png().toBuffer();
    await assert.rejects(assertImage(tooWide), { status: 415 });
    await assert.rejects(assertImage(tooManyPixels), { status: 415 });
  });

  it("enforces the request-size cap independently of image decoding", () => {
    assert.equal(MAX_IMAGE_BYTES, 700_000);
  });
});

describe("legacy image transfer validation", () => {
  it("rejects malformed and noncanonical Base64", async () => {
    const images = await fixtures();
    const row = legacyRow("a".repeat(32), images["image/png"], "image/png");
    assert.throws(() => decodeLegacyImage({ ...row, data: "not-base64" }));
    assert.throws(() => decodeLegacyImage({ ...row, data: row.data.replace(/=+$/, "") + "====" }));
  });

  it("rejects source byte_length mismatches and stored MIME mismatches", async () => {
    const images = await fixtures();
    const id = "b".repeat(32);
    assert.throws(() => decodeLegacyImage({
      ...legacyRow(id, images["image/png"], "image/png"),
      byte_length: images["image/png"].byteLength + 1,
    }));
    const result = await transferLegacyImages({
      ids: [id],
      async readSource() { return legacyRow(id, images["image/png"], "image/jpeg"); },
      async getObject() { return null; },
      async putObject() { assert.fail("invalid source must not upload"); },
    });
    assert.equal(result.failures[0].reason, "content_type_mismatch");
  });

  it("rejects truncated source images before upload", async () => {
    const images = await fixtures();
    const id = "c".repeat(32);
    const truncated = images["image/jpeg"].subarray(0, 12);
    const result = await transferLegacyImages({
      ids: [id],
      async readSource() { return legacyRow(id, truncated, "image/jpeg"); },
      async getObject() { return null; },
      async putObject() { assert.fail("truncated image must not upload"); },
    });
    assert.equal(result.verifiedCount, 0);
    assert.equal(result.failures.length, 1);
  });

  it("applies the same animation policy during legacy transfer", async () => {
    const id = "f".repeat(32);
    const bytes = await animatedWebpFixture();
    const result = await transferLegacyImages({
      ids: [id],
      async readSource() { return legacyRow(id, bytes, "image/webp"); },
      async getObject() { return null; },
      async putObject() { assert.fail("animated image must not upload"); },
    });
    assert.equal(result.verifiedCount, 0);
    assert.equal(result.failures.length, 1);
  });

  it("sanitizes malformed IDs in transfer diagnostics", () => {
    assert.equal(sanitizeTransferFailureId("a".repeat(32)), "a".repeat(32));
    assert.equal(sanitizeTransferFailureId("bad\u001b[31m-id"), "[invalid id]");
    assert.equal(sanitizeTransferFailureId("database"), "database");
  });

  it("verifies an existing destination object on retry without overwriting it", async () => {
    const images = await fixtures();
    const bytes = images["image/webp"];
    const id = "d".repeat(32);
    let putCount = 0;
    const result = await transferLegacyImages({
      ids: [id],
      async readSource() { return legacyRow(id, bytes, "image/webp"); },
      async getObject() { return { bytes, contentLength: bytes.byteLength, contentType: "image/webp" }; },
      async putObject() { putCount += 1; },
    });
    assert.deepEqual(result, { sourceCount: 1, verifiedCount: 1, failures: [] });
    assert.equal(putCount, 0);
  });

  it("fails verification when an existing or newly uploaded object differs", async () => {
    const images = await fixtures();
    const bytes = images["image/png"];
    const id = "e".repeat(32);
    const result = await transferLegacyImages({
      ids: [id],
      async readSource() { return legacyRow(id, bytes, "image/png"); },
      async getObject() { return { bytes: bytes.subarray(0, -1), contentLength: bytes.byteLength - 1, contentType: "image/png" }; },
      async putObject() { assert.fail("mismatched existing object must not be overwritten"); },
    });
    assert.equal(result.failures[0].reason, "existing_object_mismatch");

    let uploaded = false;
    const mismatchAfterUpload = await transferLegacyImages({
      ids: [id],
      async readSource() { return legacyRow(id, bytes, "image/png"); },
      async getObject() {
        return uploaded
          ? { bytes: bytes.subarray(0, -1), contentLength: bytes.byteLength - 1, contentType: "image/png" }
          : null;
      },
      async putObject() { uploaded = true; },
    });
    assert.equal(mismatchAfterUpload.failures[0].reason, "destination_verification_failed");
  });
});

describe("menu image storage", () => {
  it("returns only the application URL and retrieves through its metadata key", async () => {
    const images = await fixtures();
    const bytes = images["image/jpeg"];
    const stores = memoryStores();
    const storage = catalogImageStores(stores);
    const response = await storage.saveImage(bytes, "image/jpeg");
    const metadata = [...stores.metadata.values()][0];
    assert.deepEqual(response, { url: `/api/images/${metadata.id}` });
    assert.match(metadata.objectKey, /^menu-images\/[a-f0-9]{32}$/);
    assert.deepEqual((await storage.readImage(metadata.id)).bytes, bytes);
    assert.equal(JSON.stringify(response).includes("objectKey"), false);
  });

  it("keeps uploaded objects readable when a dish image is replaced or removed", async () => {
    const images = await fixtures();
    const stores = memoryStores();
    const storage = catalogImageStores(stores);
    const oldImage = await storage.saveImage(images["image/jpeg"], "image/jpeg");
    const newImage = await storage.saveImage(images["image/png"], "image/png");
    let row = null;
    const catalogStore = createCatalogOperations({
      async read() { return row; },
      async create(payload, revision) { row = { payload, revision }; return true; },
      async update(expectedRevision, payload, revision) {
        if (!row || row.revision !== expectedRevision) return false;
        row = { payload, revision };
        return true;
      },
    });
    const draft = createTestCatalog();
    draft.revision = 0;
    draft.items[0].image = oldImage.url;
    const original = await catalogStore.save(draft);
    const replaced = await catalogStore.save({
      ...original,
      items: original.items.map((item, index) => index === 0 ? { ...item, image: newImage.url } : item),
    });
    assert.equal(replaced.items[0].image, newImage.url);
    const removed = await catalogStore.save({
      ...replaced,
      items: replaced.items.map((item, index) => index === 0 ? { ...item, image: null } : item),
    });
    assert.equal(removed.items[0].image, null);
    assert.equal(stores.deleted.length, 0);
    assert.deepEqual((await storage.readImage(oldImage.url.split("/").at(-1))).bytes, images["image/jpeg"]);
    assert.deepEqual((await storage.readImage(newImage.url.split("/").at(-1))).bytes, images["image/png"]);
  });

  it("cleans up only after confirming metadata is absent", async () => {
    const images = await fixtures();
    const bytes = images["image/png"];
    const absent = memoryStores({ insertFailure: "before-commit" });
    await assert.rejects(catalogImageStores(absent).saveImage(bytes, "image/png"));
    assert.equal(absent.deleted.length, 1);

    const committed = memoryStores({ insertFailure: "after-commit" });
    await assert.rejects(catalogImageStores(committed).saveImage(bytes, "image/png"));
    assert.equal(committed.deleted.length, 0);
    assert.equal(committed.metadata.size, 1);
    assert.equal(committed.objects.size, 1);

    const uncertain = memoryStores({ insertFailure: "before-commit", referenceFailure: true });
    await assert.rejects(catalogImageStores(uncertain).saveImage(bytes, "image/png"));
    assert.equal(uncertain.deleted.length, 0);
    assert.equal(uncertain.objects.size, 1);
  });

  it("atomically enforces the 300-image limit across concurrent uploads", async () => {
    const images = await fixtures();
    const stores = memoryStores({ count: MAX_IMAGES - 1 });
    const storage = catalogImageStores(stores);
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () => storage.saveImage(images["image/webp"], "image/webp")),
    );
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(stores.count, MAX_IMAGES);
    assert.equal(stores.metadata.size, 1);
    assert.equal(stores.objects.size, 1);
  });
});

describe("admin image upload endpoint", () => {
  it("rejects unauthenticated upload attempts before storage is called", async () => {
    let saved = false;
    const post = createAdminImageUploadHandler({
      async getCurrentUser() { return null; },
      async saveImage() { saved = true; return { url: "/api/images/id" }; },
    });
    const response = await post(new Request("https://clickmenu.test/api/admin/images", {
      method: "POST",
      headers: { origin: "https://clickmenu.test" },
      body: new Uint8Array([1, 2, 3]),
    }));
    assert.equal(response.status, 401);
    assert.equal(saved, false);
  });

  it("accepts a decodable image and rejects a malformed file", async () => {
    const bytes = (await fixtures())["image/jpeg"];
    let receivedType = "";
    const post = createAdminImageUploadHandler({
      async getCurrentUser() { return { name: "Administrator" }; },
      async saveImage(_bytes, type) { receivedType = type; return { url: "/api/images/opaque" }; },
    });
    const valid = await post(new Request("https://clickmenu.test/api/admin/images", {
      method: "POST",
      headers: { origin: "https://clickmenu.test" },
      body: bytes,
    }));
    assert.equal(valid.status, 201);
    assert.equal(receivedType, "image/jpeg");
    const invalid = await post(new Request("https://clickmenu.test/api/admin/images", {
      method: "POST",
      headers: { origin: "https://clickmenu.test" },
      body: new Uint8Array([0xff, 0xd8, 0xff, 0x00]),
    }));
    assert.equal(invalid.status, 415);
  });

  it("rejects an oversized request before storage is called", async () => {
    let saved = false;
    const post = createAdminImageUploadHandler({
      async getCurrentUser() { return { name: "Administrator" }; },
      async saveImage() { saved = true; return { url: "/api/images/id" }; },
    });
    const response = await post(new Request("https://clickmenu.test/api/admin/images", {
      method: "POST",
      headers: {
        origin: "https://clickmenu.test",
        "content-length": String(MAX_IMAGE_BYTES + 1),
      },
      body: new Uint8Array(MAX_IMAGE_BYTES + 1),
    }));
    assert.equal(response.status, 413);
    assert.equal(saved, false);
  });
});

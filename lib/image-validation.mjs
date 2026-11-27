import sharp from "sharp";

export const MAX_IMAGE_DIMENSION = 8192;
export const MAX_IMAGE_PIXELS = 16_000_000;

const SIGNATURES = [
  { type: "image/jpeg", format: "jpeg", matches: (bytes) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff },
  { type: "image/png", format: "png", matches: (bytes) => bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) },
  { type: "image/webp", format: "webp", matches: (bytes) => bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP" },
];

function hasAnimatedPngChunk(bytes) {
  let offset = 8;
  while (offset + 12 <= bytes.byteLength) {
    const chunkLength = bytes.readUInt32BE(offset);
    const chunkType = bytes.toString("ascii", offset + 4, offset + 8);
    if (chunkType === "acTL") return true;
    if (chunkType === "IEND" || chunkLength > bytes.byteLength - offset - 12)
      return false;
    offset += 12 + chunkLength;
  }
  return false;
}

function hasAnimatedWebpChunk(bytes) {
  let offset = 12;
  while (offset + 8 <= bytes.byteLength) {
    const chunkType = bytes.toString("ascii", offset, offset + 4);
    const chunkLength = bytes.readUInt32LE(offset + 4);
    if (chunkType === "ANIM" || chunkType === "ANMF") return true;
    if (
      chunkType === "VP8X" &&
      chunkLength >= 10 &&
      offset + 18 <= bytes.byteLength &&
      (bytes[offset + 8] & 0x02) !== 0
    )
      return true;
    if (chunkLength > bytes.byteLength - offset - 8) return false;
    offset += 8 + chunkLength + (chunkLength % 2);
  }
  return false;
}

/** Decode supported raster images fully and reject headers that do not match their decoded format. */
export async function validateImageBytes(bytes) {
  const imageBuffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const signature = SIGNATURES.find(({ matches }) => matches(imageBuffer));
  if (!signature) throw new Error("Unsupported image signature.");
  if (
    (signature.format === "png" && hasAnimatedPngChunk(imageBuffer)) ||
    (signature.format === "webp" && hasAnimatedWebpChunk(imageBuffer))
  )
    throw new Error("Animated images are not supported.");

  const options = {
    failOn: "warning",
    limitInputPixels: MAX_IMAGE_PIXELS,
    sequentialRead: true,
  };
  const metadata = await sharp(imageBuffer, options).metadata();
  if (
    metadata.format !== signature.format ||
    (metadata.pages ?? 1) > 1 ||
    !metadata.width ||
    !metadata.height ||
    metadata.width > MAX_IMAGE_DIMENSION ||
    metadata.height > MAX_IMAGE_DIMENSION ||
    metadata.width * metadata.height > MAX_IMAGE_PIXELS
  )
    throw new Error("Image dimensions or decoded format are invalid.");

  // stats() forces libvips to decode pixel data, catching truncated/corrupt files.
  await sharp(imageBuffer, options).stats();
  return {
    contentType: signature.type,
    width: metadata.width,
    height: metadata.height,
  };
}

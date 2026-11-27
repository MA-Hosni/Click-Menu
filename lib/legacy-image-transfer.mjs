import { validateImageBytes } from "./image-validation.mjs";

const IMAGE_ID_PATTERN = /^[a-f0-9]{32}$/;
const MAX_IMAGE_BYTES = 700_000;

export function sanitizeTransferFailureId(id) {
  if (typeof id !== "string") return "[invalid id]";
  if (
    IMAGE_ID_PATTERN.test(id) ||
    id === "configuration" ||
    id === "database" ||
    id === "transfer"
  )
    return id;
  return "[invalid id]";
}

export function decodeLegacyImage(row) {
  if (
    !row ||
    typeof row.data !== "string" ||
    !row.data.length ||
    row.data.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(row.data)
  )
    throw new Error("invalid_base64");
  const bytes = Buffer.from(row.data, "base64");
  if (bytes.toString("base64") !== row.data) throw new Error("noncanonical_base64");
  if (
    !Number.isSafeInteger(row.byte_length) ||
    row.byte_length < 1 ||
    row.byte_length > MAX_IMAGE_BYTES ||
    bytes.byteLength !== row.byte_length
  )
    throw new Error("byte_length_mismatch");
  return bytes;
}

function sameBytes(left, right) {
  return left.byteLength === right.byteLength && left.equals(right);
}

/** Transfers to deterministic keys, verifies existing objects, and never removes source rows. */
export async function transferLegacyImages({ ids, readSource, getObject, putObject }) {
  let verifiedCount = 0;
  const failures = [];

  for (const id of ids) {
    try {
      if (typeof id !== "string" || !IMAGE_ID_PATTERN.test(id))
        throw new Error("invalid_id");
      const row = await readSource(id);
      if (!row || row.id !== id) throw new Error("source_missing");
      const bytes = decodeLegacyImage(row);
      const validated = await validateImageBytes(bytes);
      if (validated.contentType !== row.content_type)
        throw new Error("content_type_mismatch");

      const key = `menu-images/${id}`;
      let destination = await getObject(key);
      if (destination && !sameBytes(destination.bytes, bytes))
        throw new Error("existing_object_mismatch");
      if (!destination) {
        await putObject(key, bytes, validated.contentType);
        destination = await getObject(key);
      }
      if (
        !destination ||
        destination.contentLength !== row.byte_length ||
        destination.contentType !== row.content_type ||
        !sameBytes(destination.bytes, bytes)
      )
        throw new Error("destination_verification_failed");
      verifiedCount += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      failures.push({
        id: typeof id === "string" ? id : "invalid-id",
        reason: /^[a-z_]+$/.test(message) ? message : "transfer_failed",
      });
    }
  }

  return { sourceCount: ids.length, verifiedCount, failures };
}

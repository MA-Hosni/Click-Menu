import { createHash, randomBytes } from "node:crypto";

const OPAQUE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function decodeOpaqueToken(value: unknown): Buffer | null {
  if (typeof value !== "string" || !OPAQUE_TOKEN_PATTERN.test(value))
    return null;
  const decoded = Buffer.from(value, "base64url");
  if (decoded.byteLength !== 32 || decoded.toString("base64url") !== value)
    return null;
  return decoded;
}

/** Hashes a canonical Base64URL idempotency key containing exactly 32 bytes. */
export function hashIdempotencyKey(value: unknown): string | null {
  const decoded = decodeOpaqueToken(value);
  return decoded ? createHash("sha256").update(decoded).digest("hex") : null;
}

/** Creates a 32-byte opaque token for use as a customer tracking capability. */
export function generateTrackingToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Returns the lookup digest for a valid tracking token, without retaining it. */
export function hashTrackingToken(value: unknown): string | null {
  const decoded = decodeOpaqueToken(value);
  return decoded ? createHash("sha256").update(decoded).digest("hex") : null;
}

// Server-only module: uses Node cryptography and a private runtime environment key.
import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { hashTrackingToken } from "./crypto";

export interface TrackingTokenRecoveryEnvelope {
  readonly version: 1;
  readonly nonce: string;
  readonly ciphertext: string;
  readonly authTag: string;
}

export class TrackingTokenRecoveryError extends Error {
  constructor(message = "Tracking-token recovery failed.") {
    super(message);
    this.name = "TrackingTokenRecoveryError";
  }
}

const ENVELOPE_VERSION = 1 as const;
const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const TRACKING_TOKEN_BYTES = 43;
const HEX_DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function encode(value: Buffer): string {
  return value.toString("base64");
}

function decodeCanonicalBase64(value: unknown): Buffer | null {
  if (typeof value !== "string" || !value || !BASE64_PATTERN.test(value))
    return null;
  const decoded = Buffer.from(value, "base64");
  return encode(decoded) === value ? decoded : null;
}

function loadOrderTrackingRecoveryKey(value: unknown): Buffer {
  const key = decodeCanonicalBase64(value);
  if (!key || key.byteLength !== KEY_BYTES)
    throw new TrackingTokenRecoveryError(
      "ORDER_TRACKING_RECOVERY_KEY is missing or invalid.",
    );
  return key;
}

function validateContext(
  orderId: unknown,
  idempotencyKeyHash: unknown,
): { orderId: string; idempotencyKeyHash: string } {
  if (
    typeof orderId !== "string" ||
    !orderId.trim() ||
    orderId.length > 128 ||
    /[\u0000-\u001f\u007f-\u009f]/u.test(orderId) ||
    typeof idempotencyKeyHash !== "string" ||
    !HEX_DIGEST_PATTERN.test(idempotencyKeyHash)
  )
    throw new TrackingTokenRecoveryError();
  return { orderId, idempotencyKeyHash };
}

function associatedData(orderId: string, idempotencyKeyHash: string): Buffer {
  return Buffer.from(
    JSON.stringify([
      "click-menu-order-tracking-recovery",
      ENVELOPE_VERSION,
      orderId,
      idempotencyKeyHash,
    ]),
    "utf8",
  );
}

function validateEnvelope(value: unknown): {
  nonce: Buffer;
  ciphertext: Buffer;
  authTag: Buffer;
} {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(",") !== "authTag,ciphertext,nonce,version"
  )
    throw new TrackingTokenRecoveryError();

  const envelope = value as Record<string, unknown>;
  const nonce = decodeCanonicalBase64(envelope.nonce);
  const ciphertext = decodeCanonicalBase64(envelope.ciphertext);
  const authTag = decodeCanonicalBase64(envelope.authTag);
  if (
    envelope.version !== ENVELOPE_VERSION ||
    !nonce || nonce.byteLength !== NONCE_BYTES ||
    !ciphertext || ciphertext.byteLength !== TRACKING_TOKEN_BYTES ||
    !authTag || authTag.byteLength !== AUTH_TAG_BYTES
  )
    throw new TrackingTokenRecoveryError();
  return { nonce, ciphertext, authTag };
}

export interface TrackingTokenRecovery {
  encrypt(
    token: unknown,
    orderId: unknown,
    idempotencyKeyHash: unknown,
  ): TrackingTokenRecoveryEnvelope;
  decrypt(
    envelope: unknown,
    orderId: unknown,
    idempotencyKeyHash: unknown,
  ): string;
}

/** Creates the recovery operations after validating a canonical Base64 key. */
export function createTrackingTokenRecovery(keyValue: unknown): TrackingTokenRecovery {
  const key = loadOrderTrackingRecoveryKey(keyValue);

  return {
    encrypt(token, orderId, idempotencyKeyHash) {
      const context = validateContext(orderId, idempotencyKeyHash);
      if (!hashTrackingToken(token)) throw new TrackingTokenRecoveryError();

      const nonce = randomBytes(NONCE_BYTES);
      try {
        const cipher = createCipheriv("aes-256-gcm", key, nonce, {
          authTagLength: AUTH_TAG_BYTES,
        });
        cipher.setAAD(associatedData(context.orderId, context.idempotencyKeyHash));
        const ciphertext = Buffer.concat([
          cipher.update(token as string, "utf8"),
          cipher.final(),
        ]);
        return {
          version: ENVELOPE_VERSION,
          nonce: encode(nonce),
          ciphertext: encode(ciphertext),
          authTag: encode(cipher.getAuthTag()),
        };
      } catch {
        throw new TrackingTokenRecoveryError();
      }
    },

    decrypt(envelopeValue, orderId, idempotencyKeyHash) {
      try {
        const context = validateContext(orderId, idempotencyKeyHash);
        const envelope = validateEnvelope(envelopeValue);
        const decipher = createDecipheriv("aes-256-gcm", key, envelope.nonce, {
          authTagLength: AUTH_TAG_BYTES,
        });
        decipher.setAAD(associatedData(context.orderId, context.idempotencyKeyHash));
        decipher.setAuthTag(envelope.authTag);
        const plaintext = Buffer.concat([
          decipher.update(envelope.ciphertext),
          decipher.final(),
        ]);
        const token = plaintext.toString("utf8");
        if (
          plaintext.byteLength !== TRACKING_TOKEN_BYTES ||
          !Buffer.from(token, "utf8").equals(plaintext) ||
          !hashTrackingToken(token)
        )
          throw new TrackingTokenRecoveryError();
        return token;
      } catch {
        throw new TrackingTokenRecoveryError();
      }
    },
  };
}

/** Reads the server-only environment key without generating a fallback. */
export function createTrackingTokenRecoveryFromEnvironment(): TrackingTokenRecovery {
  return createTrackingTokenRecovery(process.env.ORDER_TRACKING_RECOVERY_KEY);
}

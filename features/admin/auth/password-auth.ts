import * as crypto from "node:crypto";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { ApiError } from "../../../lib/api-security";
import {
  SESSION_TTL_MS,
  sha256,
  type AuthStore,
  type AdminIdentity,
} from "../../../lib/auth";

const ARGON2_MEMORY_KIB = 19 * 1024;
const ARGON2_PASSES = 2;
const ARGON2_PARALLELISM = 1;
const ARGON2_TAG_BYTES = 32;
const ARGON2_SALT_BYTES = 16;
const MAX_PASSWORD_LENGTH = 128;

type Argon2Options = {
  message: string;
  nonce: Buffer;
  parallelism: number;
  tagLength: number;
  memory: number;
  passes: number;
};
type Argon2Function = (
  algorithm: "argon2id",
  options: Argon2Options,
  callback: (error: Error | null, derivedKey?: Buffer) => void,
) => void;

// Node 26 provides Argon2id in node:crypto; retain the repository's existing hash format.
const argon2 = (crypto as unknown as { argon2: Argon2Function }).argon2;

function derivePasswordHash(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    argon2(
      "argon2id",
      {
        message: password,
        nonce: salt,
        parallelism: ARGON2_PARALLELISM,
        tagLength: ARGON2_TAG_BYTES,
        memory: ARGON2_MEMORY_KIB,
        passes: ARGON2_PASSES,
      },
      (error, derivedKey) => {
        if (error) reject(error);
        else if (!derivedKey) reject(new Error("Argon2id returned no hash."));
        else resolve(derivedKey);
      },
    );
  });
}

export function validateAdminPassword(value: unknown): string {
  if (typeof value !== "string") throw new ApiError("Choose a stronger password.", 400);
  const length = [...value].length;
  const characterClasses = [/\p{Ll}/u, /\p{Lu}/u, /\p{N}/u, /[^\p{L}\p{N}\s]/u]
    .filter((pattern) => pattern.test(value)).length;
  if (
    length < 12 ||
    length > MAX_PASSWORD_LENGTH ||
    Buffer.byteLength(value, "utf8") > MAX_PASSWORD_LENGTH * 4 ||
    characterClasses < 3
  ) {
    throw new ApiError(
      "Password must be 12–128 characters and use at least three character types.",
      400,
    );
  }
  return value;
}

export async function hashAdminPassword(value: unknown): Promise<string> {
  const password = validateAdminPassword(value);
  const salt = crypto.randomBytes(ARGON2_SALT_BYTES);
  const digest = await derivePasswordHash(password, salt);
  return `argon2id$${ARGON2_MEMORY_KIB}$${ARGON2_PASSES}$${ARGON2_PARALLELISM}$${salt.toString("base64url")}$${digest.toString("base64url")}`;
}

async function verifyPassword(password: string, storedHash: string | null) {
  const parts = storedHash?.split("$");
  const isValidFormat =
    parts?.length === 6 &&
    parts[0] === "argon2id" &&
    parts[1] === String(ARGON2_MEMORY_KIB) &&
    parts[2] === String(ARGON2_PASSES) &&
    parts[3] === String(ARGON2_PARALLELISM);
  const salt = isValidFormat ? Buffer.from(parts[4], "base64url") : Buffer.alloc(ARGON2_SALT_BYTES, 0x5a);
  const expected = isValidFormat ? Buffer.from(parts[5], "base64url") : Buffer.alloc(ARGON2_TAG_BYTES, 0);
  const actual = await derivePasswordHash(password, salt);
  return isValidFormat && salt.length === ARGON2_SALT_BYTES && expected.length === ARGON2_TAG_BYTES && timingSafeEqual(actual, expected);
}

export async function loginAdminWithPassword(
  store: AuthStore,
  body: unknown,
  now = Date.now(),
): Promise<{ user: AdminIdentity; token: string }> {
  const password =
    body && typeof body === "object" && "password" in body && typeof body.password === "string"
      ? body.password
      : "";
  const credential = await store.getAdminCredential();
  const valid = await verifyPassword(password, credential?.passwordHash ?? null);
  if (!credential || !valid) throw new ApiError("The password is incorrect.", 401);
  const token = crypto.randomBytes(32).toString("hex");
  await store.deleteExpiredSessions(now);
  await store.createSession({
    tokenHash: await sha256(token),
    credentialVersion: credential.credentialVersion,
    expiresAt: now + SESSION_TTL_MS,
    createdAt: now,
  });
  return { user: { name: "The Hood" }, token };
}

export async function initializeAdminPassword(
  store: AuthStore,
  password: unknown,
  now = Date.now(),
): Promise<void> {
  const passwordHash = await hashAdminPassword(password);
  if (!(await store.initializePassword(passwordHash, randomUUID(), now)))
    throw new ApiError("The administrator password is already initialized.", 409);
}

export async function resetAdminPassword(
  store: AuthStore,
  password: unknown,
  now = Date.now(),
): Promise<void> {
  const passwordHash = await hashAdminPassword(password);
  if (!(await store.resetPassword(passwordHash, randomUUID(), now)))
    throw new ApiError("Initialize the administrator password first.", 409);
}

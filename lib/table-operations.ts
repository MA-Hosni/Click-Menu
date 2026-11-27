import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { ApiError } from "./api-security";

const TABLE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const TABLE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ROTATION_ID_PATTERN = TABLE_ID_PATTERN;
const MAX_LABEL_LENGTH = 40;
const TOKEN_COLLISION_RETRIES = 3;

export type RestaurantTable = {
  id: string;
  label: string;
  isActive: boolean;
  qrVersion: number;
  createdAt: number;
  updatedAt: number;
};

export type TableChanges = { label?: string; isActive?: boolean };

export interface RestaurantTableStore {
  list(): Promise<RestaurantTable[]>;
  hasLabel(label: string, exceptId?: string): Promise<boolean>;
  insert(
    table: RestaurantTable & { qrTokenHash: string },
  ): Promise<boolean>;
  update(id: string, changes: TableChanges, updatedAt: number): Promise<boolean>;
  readRotation(id: string): Promise<{
    qrVersion: number;
    qrTokenHash: string;
    rotationRequestHash: string | null;
    rotationTokenCiphertext: string | null;
  } | null>;
  readCurrentRecovery(id: string): Promise<{
    qrVersion: number;
    qrTokenHash: string;
    rotationRequestHash: string | null;
    rotationTokenCiphertext: string | null;
    isActive: boolean;
  } | null>;
  rotateToken(
    id: string,
    expectedVersion: number,
    qrTokenHash: string,
    rotationRequestHash: string,
    rotationTokenCiphertext: string,
    updatedAt: number,
  ): Promise<number | null>;
  exists(id: string): Promise<boolean>;
  resolveActive(qrTokenHash: string): Promise<Pick<RestaurantTable, "label"> | null>;
}

export class TableLabelError extends Error {}
export class DuplicateTableLabelError extends Error {}
export class TableNotFoundError extends Error {}
export class TableRotationConflictError extends Error {}
export class InvalidTableRotationRequestError extends Error {}

function recoveryKey(): Buffer {
  const value = process.env.TABLE_QR_RECOVERY_KEY;
  if (!value) throw new Error("Table QR recovery is not configured.");
  const key = Buffer.from(value, "base64");
  if (key.byteLength !== 32 || key.toString("base64") !== value)
    throw new Error("Table QR recovery configuration is invalid.");
  return key;
}

function recoveryAad(tableId: string, requestHash: string): Buffer {
  return Buffer.from(`table-qr-recovery:v1:${tableId}:${requestHash}`);
}

function encryptRecoveryToken(
  token: string,
  tableId: string,
  requestHash: string,
): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", recoveryKey(), iv);
  cipher.setAAD(recoveryAad(tableId, requestHash));
  const encrypted = Buffer.concat([
    cipher.update(token, "utf8"),
    cipher.final(),
  ]);
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}

function decryptRecoveryToken(
  value: string,
  tableId: string,
  requestHash: string,
): string {
  const [version, encodedIv, encodedTag, encodedCiphertext, ...rest] = value.split(".");
  if (version !== "v1" || !encodedIv || !encodedTag || !encodedCiphertext || rest.length)
    throw new Error("Table QR recovery data is invalid.");
  const decodeCanonical = (encoded: string, expectedLength: number) => {
    if (!/^[A-Za-z0-9_-]+$/.test(encoded))
      throw new Error("Table QR recovery data is invalid.");
    const decoded = Buffer.from(encoded, "base64url");
    if (
      decoded.byteLength !== expectedLength ||
      decoded.toString("base64url") !== encoded
    )
      throw new Error("Table QR recovery data is invalid.");
    return decoded;
  };
  const iv = decodeCanonical(encodedIv, 12);
  const tag = decodeCanonical(encodedTag, 16);
  const ciphertext = decodeCanonical(encodedCiphertext, 43);
  const decipher = createDecipheriv("aes-256-gcm", recoveryKey(), iv);
  decipher.setAAD(recoveryAad(tableId, requestHash));
  decipher.setAuthTag(tag);
  const token = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8");
  if (!hashTableToken(token)) throw new Error("Table QR recovery data is invalid.");
  return token;
}

export function normalizeTableLabel(value: unknown): string {
  if (typeof value !== "string") throw new TableLabelError();
  const label = value.trim().replace(/\s+/g, " ");
  if (
    !label ||
    label.length > MAX_LABEL_LENGTH ||
    /[\u0000-\u001f\u007f-\u009f]/u.test(label)
  )
    throw new TableLabelError();
  return label;
}

export function hashTableToken(token: string): string | null {
  if (!TABLE_TOKEN_PATTERN.test(token)) return null;
  const decoded = Buffer.from(token, "base64url");
  if (decoded.byteLength !== 32 || decoded.toString("base64url") !== token)
    return null;
  return createHash("sha256").update(decoded).digest("hex");
}

export function isRestaurantTableId(value: string): boolean {
  return TABLE_ID_PATTERN.test(value);
}

function createToken(): string {
  return randomBytes(32).toString("base64url");
}

function publicTable(table: RestaurantTable) {
  return {
    id: table.id,
    label: table.label,
    isActive: table.isActive,
    qrVersion: table.qrVersion,
    createdAt: table.createdAt,
    updatedAt: table.updatedAt,
  };
}

function tableUrl(token: string, siteUrl: string): string {
  const base = new URL(siteUrl);
  const localHost = ["localhost", "127.0.0.1", "[::1]", "0.0.0.0"].includes(
    base.hostname,
  );
  if (
    (base.protocol !== "https:" && !(base.protocol === "http:" && localHost)) ||
    base.username ||
    base.password
  )
    throw new Error("SITE_URL must be an absolute HTTP or HTTPS URL.");
  return new URL(`/t/${token}`, base).toString();
}

function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth++) {
    if ("code" in current && current.code === "23505") return true;
    current = "cause" in current ? current.cause : null;
  }
  return false;
}

export function createTableOperations(
  store: RestaurantTableStore,
  options: {
    siteUrl: string | undefined;
    createId?: () => string;
    createToken?: () => string;
    now?: () => number;
  },
) {
  const idFactory = options.createId ?? randomUUID;
  const tokenFactory = options.createToken ?? createToken;
  const now = options.now ?? Date.now;

  function urlFor(token: string) {
    if (!options.siteUrl) throw new Error("SITE_URL is not configured.");
    return tableUrl(token, options.siteUrl);
  }

  return {
    async list() {
      return (await store.list()).map(publicTable);
    },

    async create(value: unknown) {
      const label = normalizeTableLabel(value);
      if (await store.hasLabel(label)) throw new DuplicateTableLabelError();
      const timestamp = now();
      for (let attempt = 0; attempt < TOKEN_COLLISION_RETRIES; attempt++) {
        const token = tokenFactory();
        const qrTokenHash = hashTableToken(token);
        if (!qrTokenHash) throw new Error("Generated table token is invalid.");
        const url = urlFor(token);
        const table: RestaurantTable & { qrTokenHash: string } = {
          id: idFactory(),
          label,
          qrTokenHash,
          isActive: true,
          qrVersion: 1,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        if (await store.insert(table)) return { table: publicTable(table), url };
        if (await store.hasLabel(label)) throw new DuplicateTableLabelError();
      }
      throw new Error("Could not create a unique table QR token.");
    },

    async update(id: string, changes: TableChanges) {
      if (!isRestaurantTableId(id)) throw new TableNotFoundError();
      const next: TableChanges = {};
      if ("label" in changes) next.label = normalizeTableLabel(changes.label);
      if ("isActive" in changes) {
        if (typeof changes.isActive !== "boolean") throw new TableLabelError();
        next.isActive = changes.isActive;
      }
      if (!Object.keys(next).length) throw new TableLabelError();
      if (next.label && await store.hasLabel(next.label, id))
        throw new DuplicateTableLabelError();
      try {
        if (await store.update(id, next, now())) return { updated: true };
      } catch (error) {
        if (isUniqueViolation(error)) throw new DuplicateTableLabelError();
        throw error;
      }
      if (!(await store.exists(id))) throw new TableNotFoundError();
      throw new DuplicateTableLabelError();
    },

    async rotate(id: string, rotationId: unknown, expectedVersion: unknown) {
      if (!isRestaurantTableId(id)) throw new TableNotFoundError();
      if (
        typeof rotationId !== "string" ||
        !ROTATION_ID_PATTERN.test(rotationId) ||
        typeof expectedVersion !== "number" ||
        !Number.isSafeInteger(expectedVersion) ||
        (expectedVersion as number) < 1
      )
        throw new InvalidTableRotationRequestError();
      const version = expectedVersion as number;
      const requestHash = createHash("sha256").update(rotationId).digest("hex");

      const existing = await store.readRotation(id);
      if (!existing) throw new TableNotFoundError();
      if (existing.rotationRequestHash === requestHash) {
        if (existing.qrVersion !== version + 1)
          throw new TableRotationConflictError("This table QR has changed.");
        const token = decryptRecoveryToken(
          existing.rotationTokenCiphertext ?? "",
          id,
          requestHash,
        );
        if (hashTableToken(token) !== existing.qrTokenHash)
          throw new Error("Table QR recovery data is stale.");
        return { url: urlFor(token), qrVersion: existing.qrVersion, recovered: true };
      }
      if (existing.qrVersion !== version)
        throw new TableRotationConflictError("This table QR has changed.");

      for (let attempt = 0; attempt < TOKEN_COLLISION_RETRIES; attempt++) {
        const token = tokenFactory();
        const qrTokenHash = hashTableToken(token);
        if (!qrTokenHash) throw new Error("Generated table token is invalid.");
        if (qrTokenHash === existing.qrTokenHash) continue;
        const ciphertext = encryptRecoveryToken(token, id, requestHash);
        const url = urlFor(token);
        try {
          const nextVersion = await store.rotateToken(
            id,
            version,
            qrTokenHash,
            requestHash,
            ciphertext,
            now(),
          );
          if (nextVersion !== null)
            return { url, qrVersion: nextVersion, recovered: false };
        } catch (error) {
          if (!isUniqueViolation(error)) throw error;
        }

        const current = await store.readRotation(id);
        if (!current) throw new TableNotFoundError();
        if (current.qrVersion === version + 1 && current.rotationRequestHash === requestHash) {
          const recoveredToken = decryptRecoveryToken(
            current.rotationTokenCiphertext ?? "",
            id,
            requestHash,
          );
          if (hashTableToken(recoveredToken) !== current.qrTokenHash)
            throw new Error("Table QR recovery data is stale.");
          return { url: urlFor(recoveredToken), qrVersion: current.qrVersion, recovered: true };
        }
        if (current.qrVersion !== version)
          throw new TableRotationConflictError("This table QR has changed.");
      }
      throw new Error("Could not create a unique table QR token.");
    },

    async recover(id: string) {
      if (!isRestaurantTableId(id)) throw new TableNotFoundError();
      const current = await store.readCurrentRecovery(id);
      if (
        !current ||
        !current.isActive ||
        current.qrVersion < 2 ||
        !current.rotationRequestHash ||
        !current.rotationTokenCiphertext
      )
        throw new TableNotFoundError();
      const token = decryptRecoveryToken(
        current.rotationTokenCiphertext,
        id,
        current.rotationRequestHash,
      );
      if (hashTableToken(token) !== current.qrTokenHash)
        throw new Error("Table QR recovery data is stale.");
      return { url: urlFor(token), qrVersion: current.qrVersion, recovered: true };
    },

    async resolve(token: string) {
      const qrTokenHash = hashTableToken(token);
      return qrTokenHash ? store.resolveActive(qrTokenHash) : null;
    },
  };
}

export function toTableApiError(error: unknown): ApiError | null {
  if (error instanceof TableLabelError)
    return new ApiError("Enter a table label up to 40 characters.", 400);
  if (error instanceof DuplicateTableLabelError)
    return new ApiError("A table with this label already exists.", 409);
  if (error instanceof TableNotFoundError)
    return new ApiError("This table was not found.", 404);
  if (error instanceof TableRotationConflictError)
    return new ApiError("This table QR has changed. Refresh the table list before rotating again.", 409);
  if (error instanceof InvalidTableRotationRequestError)
    return new ApiError("Send a valid QR rotation request.", 400);
  return null;
}

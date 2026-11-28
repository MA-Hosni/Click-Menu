import type { CartItem, MenuItem, MenuOption } from "../../lib/types";
import { cartKey } from "../../lib/cart";

const MAX_QUANTITY = 99;
const MAX_ITEMS = 100;
const MAX_SAFE_AMOUNT = BigInt(Number.MAX_SAFE_INTEGER);
const PRODUCT_ID = /^[A-Za-z0-9_-]{1,64}$/;
const OPAQUE_TOKEN = /^[A-Za-z0-9_-]{43}$/;

export function isRegisteredTableToken(value: unknown): value is string {
  return typeof value === "string" && OPAQUE_TOKEN.test(value);
}

export interface DineInOrderPayload {
  tableToken: string;
  customerName?: string;
  notes?: string;
  items: { productId: string; quantity: number; optionIds: string[] }[];
}

export interface PendingDineInSubmission {
  version: 2;
  idempotencyKey: string;
  payloadJson: string;
  payload: DineInOrderPayload;
  disposition: "retryable" | "terminal-conflict";
}

export interface DineInOrderSessionReference {
  orderId: string;
  createdAt: number;
}

export type PendingDineInStorageState =
  | { kind: "none" }
  | { kind: "retryable"; operation: PendingDineInSubmission }
  | { kind: "terminal-conflict"; operation: PendingDineInSubmission }
  | { kind: "completed"; orderId: string }
  | { kind: "unknown"; reason: "unavailable" | "read-failed" | "malformed" | "fallback-failed" | "cleanup-in-progress" };

type StoredPendingDineInSubmission =
  | { version: 2; state: "pending" | "terminal-conflict"; idempotencyKey: string; payloadJson: string }
  | { version: 2; state: "completed"; orderId: string }
  | { version: 3; state: "cleanup"; action: "abandon" | "new-order"; idempotencyKey: string | null; payloadJson: string | null; orderId: string | null };
type CleanupRecord = Extract<StoredPendingDineInSubmission, { state: "cleanup" }>;

export interface DineInLockManager {
  request<T>(
    name: string,
    options: { mode: "exclusive" },
    callback: () => Promise<T>,
  ): Promise<T>;
}

export type DineInSubmissionResult =
  | { receipt: { orderId: string; trackingToken: string; status: string; createdAt: number }; error: null }
  | { receipt: null; error: "unavailable" | "idempotency-conflict" | "catalog-not-ready" | "invalid" | "rate-limit" | "table-unavailable" | "network" | "server" | "storage" };

export function isTerminalDineInSubmissionError(
  error: DineInSubmissionResult["error"] | "coordination" | "terminal-storage" | "operation-changed",
): boolean {
  return error === "idempotency-conflict" || error === "table-unavailable";
}

export function canSubmitWithPendingState(state: PendingDineInStorageState["kind"] | "loading"): boolean {
  return state === "none" || state === "retryable";
}

export function canCreateNewDineInSubmission(state: PendingDineInStorageState["kind"] | "loading"): boolean {
  return state === "none";
}

export interface DineInCartLine {
  key: string;
  entry: CartItem;
  item: MenuItem | null;
  options: MenuOption[];
  unitPriceMillimes: number | null;
  lineTotalMillimes: number | null;
  issue: "unavailable" | "invalid-options" | "invalid-price" | "invalid-quantity" | null;
}

export interface StringStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface TerminalDineInFallbackStorage {
  get(tableStorageId: string): Promise<unknown>;
  set(tableStorageId: string, value: string): Promise<void>;
  remove(tableStorageId: string): Promise<void>;
}

function getTerminalDineInFallbackStorage(): TerminalDineInFallbackStorage | null {
  try {
    const indexedDb = globalThis.indexedDB;
    if (!indexedDb) return null;
    const open = () => new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDb.open("tabletap-dine-in-recovery", 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains("terminal"))
          request.result.createObjectStore("terminal");
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed."));
      request.onblocked = () => reject(new Error("IndexedDB open was blocked."));
    });
    const read = async (tableStorageId: string) => {
      const db = await open();
      try {
        return await new Promise<string | null>((resolve, reject) => {
          const transaction = db.transaction("terminal", "readonly");
          const request = transaction.objectStore("terminal").get(tableStorageId);
          request.onsuccess = () => resolve(request.result === undefined ? null : request.result);
          request.onerror = () => reject(request.error ?? new Error("IndexedDB read failed."));
          transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB read aborted."));
        });
      } finally { db.close(); }
    };
    const write = async (tableStorageId: string, value?: string) => {
      const db = await open();
      try {
        await new Promise<void>((resolve, reject) => {
          const transaction = db.transaction("terminal", "readwrite");
          const store = transaction.objectStore("terminal");
          if (value === undefined) store.delete(tableStorageId);
          else store.put(value, tableStorageId);
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB write failed."));
          transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB write aborted."));
        });
      } finally { db.close(); }
    };
    return {
      get: read,
      set: (tableStorageId, value) => write(tableStorageId, value),
      remove: (tableStorageId) => write(tableStorageId),
    };
  } catch {
    return null;
  }
}

/** Accessing the browser storage getter itself can throw in restricted contexts. */
export function getDineInStorage(): StringStorage | null {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

function getDineInLockManager(): DineInLockManager | null {
  try {
    return globalThis.navigator?.locks ?? null;
  } catch {
    return null;
  }
}

export async function deriveTableStorageId(
  tableToken: string,
  cryptoApi: Pick<Crypto, "subtle"> = globalThis.crypto,
): Promise<string> {
  if (!isRegisteredTableToken(tableToken)) throw new Error("Invalid table token.");
  const digest = await cryptoApi.subtle.digest("SHA-256", new TextEncoder().encode(tableToken));
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

export async function withDineInTableLock<T>(
  tableToken: string,
  callback: () => Promise<T>,
  lockManager: DineInLockManager | null = getDineInLockManager(),
): Promise<T> {
  if (!lockManager) throw new Error("Cross-tab order coordination is unavailable.");
  const storageId = await deriveTableStorageId(tableToken);
  return lockManager.request(`tabletap:dine-in-submit:${storageId}`, { mode: "exclusive" }, callback);
}

export type DineInPayloadResult =
  | { payload: DineInOrderPayload; error: null }
  | { payload: null; error: "cart" | "name" | "notes" };

export async function tableCartStorageKey(tableToken: string): Promise<string> {
  return `tabletap:dine-in-cart:v2:${await deriveTableStorageId(tableToken)}`;
}

export async function pendingDineInStorageKey(tableToken: string): Promise<string> {
  return `tabletap:dine-in-pending:v2:${await deriveTableStorageId(tableToken)}`;
}

export async function dineInOrderSessionHistoryKey(tableToken: string): Promise<string> {
  return `tabletap:dine-in-orders:v1:${await deriveTableStorageId(tableToken)}`;
}

const ORDER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export async function loadDineInOrderSessionHistory(
  storage: StringStorage | null,
  tableToken: string,
): Promise<DineInOrderSessionReference[]> {
  if (!storage) return [];
  try {
    const raw = storage.getItem(await dineInOrderSessionHistoryKey(tableToken));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((row): row is DineInOrderSessionReference =>
      !!row && typeof row === "object" && !Array.isArray(row) &&
      Object.keys(row).sort().join(",") === "createdAt,orderId" &&
      typeof (row as DineInOrderSessionReference).orderId === "string" && ORDER_ID.test((row as DineInOrderSessionReference).orderId) &&
      Number.isSafeInteger((row as DineInOrderSessionReference).createdAt) && (row as DineInOrderSessionReference).createdAt >= 0)
      .sort((left, right) => right.createdAt - left.createdAt || right.orderId.localeCompare(left.orderId))
      .slice(0, 20);
  } catch {
    return [];
  }
}

export async function rememberDineInOrderInSession(
  storage: StringStorage | null,
  tableToken: string,
  reference: DineInOrderSessionReference,
): Promise<DineInOrderSessionReference[]> {
  if (!storage || !ORDER_ID.test(reference.orderId) || !Number.isSafeInteger(reference.createdAt) || reference.createdAt < 0)
    return loadDineInOrderSessionHistory(storage, tableToken);
  const history = await loadDineInOrderSessionHistory(storage, tableToken);
  const next = [reference, ...history.filter((entry) => entry.orderId !== reference.orderId)]
    .sort((left, right) => right.createdAt - left.createdAt || right.orderId.localeCompare(left.orderId))
    .slice(0, 20);
  try {
    storage.setItem(await dineInOrderSessionHistoryKey(tableToken), JSON.stringify(next));
    return next;
  } catch {
    return history;
  }
}

export async function loadDineInCart(storage: StringStorage, tableToken: string): Promise<CartItem[]> {
  try {
    return restoreDineInCart(JSON.parse(storage.getItem(await tableCartStorageKey(tableToken)) || "[]"));
  } catch {
    return [];
  }
}

export async function saveDineInCart(storage: StringStorage, tableToken: string, cart: CartItem[]): Promise<void> {
  try {
    storage.setItem(await tableCartStorageKey(tableToken), JSON.stringify(cart));
  } catch {
    // Browser storage can be unavailable in private/restricted browsing modes.
  }
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key)) &&
    allowed.every((key) => Object.hasOwn(value, key));
}

export function createPendingDineInSubmission(
  idempotencyKey: string,
  payload: DineInOrderPayload,
): PendingDineInSubmission {
  return { version: 2, idempotencyKey, payloadJson: JSON.stringify(payload), payload, disposition: "retryable" };
}

export async function savePendingDineInSubmission(
  storage: StringStorage,
  tableToken: string,
  operation: PendingDineInSubmission,
): Promise<boolean> {
  return writePendingRecord(storage, tableToken, {
    version: 2,
    state: operation.disposition === "terminal-conflict" ? "terminal-conflict" : "pending",
    idempotencyKey: operation.idempotencyKey,
    payloadJson: operation.payloadJson,
  });
}

async function writePendingRecord(
  storage: StringStorage,
  tableToken: string,
  stored: StoredPendingDineInSubmission,
): Promise<boolean> {
  try {
    storage.setItem(await pendingDineInStorageKey(tableToken), JSON.stringify(stored));
    return true;
  } catch {
    return false;
  }
}

export async function markPendingDineInTerminal(
  storage: StringStorage | null,
  tableToken: string,
  operation: PendingDineInSubmission,
  fallback: TerminalDineInFallbackStorage | null = getTerminalDineInFallbackStorage(),
): Promise<boolean> {
  const record: StoredPendingDineInSubmission = {
    version: 2,
    state: "terminal-conflict",
    idempotencyKey: operation.idempotencyKey,
    payloadJson: operation.payloadJson,
  };
  if (storage && await writePendingRecord(storage, tableToken, record)) return true;
  if (!fallback) return false;
  try {
    await fallback.set(await deriveTableStorageId(tableToken), JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
}

async function writeCompletedMarker(
  storage: StringStorage,
  tableToken: string,
  orderId: string,
): Promise<boolean> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(orderId)) return false;
  return writePendingRecord(storage, tableToken, { version: 2, state: "completed", orderId });
}

export async function acknowledgeDineInSubmission(
  storage: StringStorage | null,
  tableToken: string,
  operation: PendingDineInSubmission,
  orderId: string,
  fallback: TerminalDineInFallbackStorage | null = getTerminalDineInFallbackStorage(),
): Promise<boolean> {
  if (!storage || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(orderId)) return false;
  const current = await loadPendingDineInSubmission(storage, tableToken, fallback);
  if (current.kind === "completed" && current.orderId === orderId) return true;
  if (current.kind !== "retryable" ||
    current.operation.idempotencyKey !== operation.idempotencyKey ||
    current.operation.payloadJson !== operation.payloadJson) return false;
  return writeCompletedMarker(storage, tableToken, orderId);
}

/** A successful receipt can release the single retry slot after its tracking data is saved. */
export async function releaseAcknowledgedDineInOrder(
  storage: StringStorage | null,
  tableToken: string,
  operation: PendingDineInSubmission,
  orderId: string,
  fallback: TerminalDineInFallbackStorage | null = getTerminalDineInFallbackStorage(),
): Promise<boolean> {
  if (!storage || !await acknowledgeDineInSubmission(storage, tableToken, operation, orderId, fallback))
    return false;
  return await removePendingDineInSubmission(
    storage, tableToken, { kind: "completed", orderId }, "new-order", fallback,
  ) === "removed";
}

export type DineInCleanupExpectation =
  | { kind: "pending"; operation: PendingDineInSubmission }
  | { kind: "completed"; orderId: string };

export type DineInCleanupResult = "removed" | "changed" | "failed";

export async function removePendingDineInSubmission(
  storage: StringStorage | null,
  tableToken: string,
  expected: DineInCleanupExpectation | null,
  action: "abandon" | "new-order",
  fallback: TerminalDineInFallbackStorage | null = getTerminalDineInFallbackStorage(),
): Promise<DineInCleanupResult> {
  if (!storage || !fallback) return "failed";
  let primaryRaw: string | null;
  let fallbackRaw: unknown;
  try {
    primaryRaw = storage.getItem(await pendingDineInStorageKey(tableToken));
    fallbackRaw = await fallback.get(await deriveTableStorageId(tableToken));
  } catch {
    return "failed";
  }
  if (fallbackRaw !== null && typeof fallbackRaw !== "string") return "failed";

  const primary = parseStoredPendingState(primaryRaw, tableToken);
  const fallbackState = parseStoredPendingState(fallbackRaw as string | null, tableToken);
  let marker: CleanupRecord;
  const primaryCleanup = parseCleanupRecord(primaryRaw, tableToken);
  const fallbackCleanup = parseCleanupRecord(fallbackRaw, tableToken);
  if (primaryCleanup) {
    marker = primaryCleanup;
    if (marker.action !== action || (expected && !cleanupMatchesExpectation(marker, expected))) return "changed";
    if (fallbackCleanup
      ? !cleanupRecordsMatch(fallbackCleanup, marker)
      : fallbackState.kind !== "none" && !storedStateMatchesCleanup(fallbackState, marker)) return "failed";
  } else if (fallbackCleanup) {
    marker = fallbackCleanup;
    if (marker.action !== action || (expected && !cleanupMatchesExpectation(marker, expected))) return "changed";
    if (primary.kind !== "none" && !storedStateMatchesCleanup(primary, marker)) return "changed";
    if (!await writePendingRecord(storage, tableToken, marker)) return "failed";
  } else {
    if (!expected || primary.kind === "unknown" || fallbackState.kind === "unknown" ||
      !cleanupStateMatchesExpected(primary, expected) && !cleanupStateMatchesExpected(fallbackState, expected) ||
      primary.kind !== "none" && !cleanupStateMatchesExpected(primary, expected) ||
      fallbackState.kind !== "none" && !cleanupStateMatchesExpected(fallbackState, expected)) return "changed";
    if (action === "abandon" && expected.kind !== "pending") return "changed";
    if (action === "new-order" && expected.kind !== "completed") return "changed";
    marker = expected.kind === "pending"
      ? { version: 3, state: "cleanup", action, idempotencyKey: expected.operation.idempotencyKey, payloadJson: expected.operation.payloadJson, orderId: null }
      : { version: 3, state: "cleanup", action, idempotencyKey: null, payloadJson: null, orderId: expected.orderId };
    if (!await writePendingRecord(storage, tableToken, marker)) {
      try {
        await fallback.set(await deriveTableStorageId(tableToken), JSON.stringify(marker));
      } catch {
        return "failed";
      }
      return "failed";
    }
  }

  // Leave this primary tombstone in place until the fallback has been removed.
  // Any interrupted cleanup therefore remains an explicit blocked state.
  try {
    await fallback.remove(await deriveTableStorageId(tableToken));
  } catch {
    return "failed";
  }
  try {
    storage.removeItem(await pendingDineInStorageKey(tableToken));
    return "removed";
  } catch {
    return "failed";
  }
}

export async function loadPendingDineInSubmission(
  storage: StringStorage | null,
  tableToken: string,
  fallback: TerminalDineInFallbackStorage | null = getTerminalDineInFallbackStorage(),
): Promise<PendingDineInStorageState> {
  if (!fallback) return { kind: "unknown", reason: "fallback-failed" };
  let tableStorageId: string;
  let fallbackRaw: unknown;
  try {
    tableStorageId = await deriveTableStorageId(tableToken);
    fallbackRaw = await fallback.get(tableStorageId);
  } catch {
    return { kind: "unknown", reason: "fallback-failed" };
  }

  let raw: string | null;
  if (!storage) {
    raw = null;
  } else {
    try {
      raw = storage.getItem(await pendingDineInStorageKey(tableToken));
    } catch {
      return { kind: "unknown", reason: "read-failed" };
    }
  }

  const primaryCleanup = parseCleanupRecord(raw, tableToken);
  const fallbackCleanup = parseCleanupRecord(fallbackRaw, tableToken);
  if (primaryCleanup) {
    const marker = primaryCleanup;
    if (fallbackRaw === null) return { kind: "unknown", reason: "cleanup-in-progress" };
    if (typeof fallbackRaw !== "string") return { kind: "unknown", reason: "malformed" };
    const fallbackMarker = parseCleanupRecord(fallbackRaw, tableToken);
    if (fallbackMarker) return cleanupRecordsMatch(fallbackMarker, marker)
      ? { kind: "unknown", reason: "cleanup-in-progress" }
      : { kind: "unknown", reason: "malformed" };
    const fallbackState = parseStoredPendingState(fallbackRaw, tableToken);
    return storedStateMatchesCleanup(fallbackState, marker)
      ? { kind: "unknown", reason: "cleanup-in-progress" }
      : { kind: "unknown", reason: "malformed" };
  }
  if (fallbackCleanup) {
    const marker = fallbackCleanup;
    const primaryMarker = parseCleanupRecord(raw, tableToken);
    if (primaryMarker) return cleanupRecordsMatch(primaryMarker, marker)
      ? { kind: "unknown", reason: "cleanup-in-progress" }
      : { kind: "unknown", reason: "malformed" };
    const primaryState = parseStoredPendingState(raw, tableToken);
    return primaryState.kind === "none" || storedStateMatchesCleanup(primaryState, marker)
      ? { kind: "unknown", reason: "cleanup-in-progress" }
      : { kind: "unknown", reason: "malformed" };
  }

  const primary = parseStoredPendingState(raw, tableToken);
  if (primary.kind === "unknown") return primary;
  if (fallbackRaw !== null && typeof fallbackRaw !== "string")
    return { kind: "unknown", reason: "malformed" };
  if (fallbackRaw === null) {
    if (primary.kind !== "none") return primary;
    return storage ? primary : { kind: "unknown", reason: "unavailable" };
  }
  const fallbackRecord = parseStoredPendingState(fallbackRaw, tableToken);
  if (fallbackRecord.kind !== "terminal-conflict")
    return { kind: "unknown", reason: "malformed" };
  if (primary.kind === "none") return fallbackRecord;
  if (primary.kind === "completed") return { kind: "unknown", reason: "malformed" };
  return primary.operation.idempotencyKey === fallbackRecord.operation.idempotencyKey &&
    primary.operation.payloadJson === fallbackRecord.operation.payloadJson
    ? fallbackRecord
    : { kind: "unknown", reason: "malformed" };
}

/** Resumes only a previously persisted cleanup intent; callers hold the table lock. */
export async function reconcilePendingDineInSubmission(
  storage: StringStorage | null,
  tableToken: string,
  fallback: TerminalDineInFallbackStorage | null = getTerminalDineInFallbackStorage(),
): Promise<PendingDineInStorageState> {
  const current = await loadPendingDineInSubmission(storage, tableToken, fallback);
  if (current.kind !== "unknown" || current.reason !== "cleanup-in-progress" || !storage || !fallback) return current;
  try {
    const primaryRaw = storage.getItem(await pendingDineInStorageKey(tableToken));
    const fallbackRaw = await fallback.get(await deriveTableStorageId(tableToken));
    const marker = parseCleanupRecord(primaryRaw, tableToken) ?? parseCleanupRecord(fallbackRaw, tableToken);
    if (!marker) return { kind: "unknown", reason: "malformed" };
    const cleaned = await removePendingDineInSubmission(storage, tableToken, null, marker.action, fallback);
    return cleaned === "removed"
      ? loadPendingDineInSubmission(storage, tableToken, fallback)
      : { kind: "unknown", reason: "cleanup-in-progress" };
  } catch {
    return { kind: "unknown", reason: "read-failed" };
  }
}

function parseCleanupRecord(raw: unknown, tableToken: string): CleanupRecord | null {
  if (typeof raw !== "string") return null;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return null; }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== 6 || row.version !== 3 || row.state !== "cleanup" ||
    (row.action !== "abandon" && row.action !== "new-order")) return null;
  if (row.action === "abandon") {
    const operation = parsePendingDineInSubmission({
      version: 2, state: "pending", idempotencyKey: row.idempotencyKey, payloadJson: row.payloadJson,
    }, tableToken);
    return operation && row.orderId === null ? row as CleanupRecord : null;
  }
  return row.idempotencyKey === null && row.payloadJson === null && typeof row.orderId === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(row.orderId)
    ? row as CleanupRecord : null;
}

function storedStateMatchesCleanup(state: PendingDineInStorageState, marker: CleanupRecord): boolean {
  if (marker.action === "abandon") return (state.kind === "retryable" || state.kind === "terminal-conflict") &&
    state.operation.idempotencyKey === marker.idempotencyKey && state.operation.payloadJson === marker.payloadJson;
  return state.kind === "completed" && state.orderId === marker.orderId;
}

function cleanupRecordsMatch(left: CleanupRecord, right: CleanupRecord): boolean {
  return left.version === right.version && left.state === right.state && left.action === right.action &&
    left.idempotencyKey === right.idempotencyKey && left.payloadJson === right.payloadJson &&
    left.orderId === right.orderId;
}

function cleanupMatchesExpectation(marker: CleanupRecord, expected: DineInCleanupExpectation): boolean {
  if (expected.kind === "pending") return marker.action === "abandon" &&
    marker.idempotencyKey === expected.operation.idempotencyKey && marker.payloadJson === expected.operation.payloadJson;
  return marker.action === "new-order" && marker.orderId === expected.orderId;
}

function cleanupStateMatchesExpected(state: PendingDineInStorageState, expected: DineInCleanupExpectation): boolean {
  if (expected.kind === "completed") return state.kind === "completed" && state.orderId === expected.orderId;
  return (state.kind === "retryable" || state.kind === "terminal-conflict") &&
    state.operation.idempotencyKey === expected.operation.idempotencyKey &&
    state.operation.payloadJson === expected.operation.payloadJson;
}

function parseStoredPendingState(raw: string | null, tableToken: string): PendingDineInStorageState {
  if (!raw) return { kind: "none" };
  let record: unknown;
  try { record = JSON.parse(raw) as unknown; }
  catch { return { kind: "unknown", reason: "malformed" }; }
  if (isCompletedRecord(record)) return { kind: "completed", orderId: record.orderId };
  const operation = parsePendingDineInSubmission(record, tableToken);
  if (!operation) return { kind: "unknown", reason: "malformed" };
  return operation.disposition === "terminal-conflict"
    ? { kind: "terminal-conflict", operation }
    : { kind: "retryable", operation };
}

function isCompletedRecord(value: unknown): value is { version: 2; state: "completed"; orderId: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return Object.keys(row).length === 3 && row.version === 2 && row.state === "completed" &&
    typeof row.orderId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(row.orderId);
}

/** Restores structurally valid cart lines without hiding items made stale by a menu edit. */
export function restoreDineInCart(value: unknown): CartItem[] {
  if (!Array.isArray(value)) return [];
  const restored: CartItem[] = [];
  for (const candidate of value.slice(0, MAX_ITEMS)) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    const row = candidate as Partial<CartItem>;
    if (
      typeof row.itemId !== "string" || !PRODUCT_ID.test(row.itemId) ||
      typeof row.quantity !== "number" || !Number.isSafeInteger(row.quantity) ||
      row.quantity < 1 || row.quantity > MAX_QUANTITY ||
      !Array.isArray(row.optionIds) || row.optionIds.length > 12 ||
      row.optionIds.some((id) => typeof id !== "string" || !PRODUCT_ID.test(id))
    ) continue;

    const optionIds = [...row.optionIds];
    const key = `${cartKey(row.itemId, optionIds)}${new Set(optionIds).size !== optionIds.length ? `:invalid:${restored.length}` : ""}`;
    restored.push({ key, itemId: row.itemId, optionIds, quantity: row.quantity });
  }
  return restored;
}

export function reconcileDineInCart(
  cart: CartItem[],
  menuItems: MenuItem[],
): { lines: DineInCartLine[]; itemCount: number; subtotalMillimes: number | null; valid: boolean } {
  let itemCount = 0;
  let subtotal = BigInt(0);
  let valid = cart.length > 0;
  const lines = cart.map((entry): DineInCartLine => {
    const item = menuItems.find((candidate) => candidate.id === entry.itemId) ?? null;
    if (!Number.isSafeInteger(entry.quantity) || entry.quantity < 1 || entry.quantity > MAX_QUANTITY) {
      valid = false;
      return { key: entry.key, entry, item, options: [], unitPriceMillimes: null, lineTotalMillimes: null, issue: "invalid-quantity" };
    }
    if (!item || !item.available) {
      valid = false;
      return { key: entry.key, entry, item, options: [], unitPriceMillimes: null, lineTotalMillimes: null, issue: "unavailable" };
    }

    if (!Array.isArray(entry.optionIds)) {
      valid = false;
      return { key: entry.key, entry, item, options: [], unitPriceMillimes: null, lineTotalMillimes: null, issue: "invalid-options" };
    }
    const duplicateOptions = new Set(entry.optionIds).size !== entry.optionIds.length;
    const options = entry.optionIds
      .map((id) => item.options.find((option) => option.id === id))
      .filter((option): option is MenuOption => Boolean(option));
    if (duplicateOptions || options.length !== entry.optionIds.length) {
      valid = false;
      return { key: entry.key, entry, item, options, unitPriceMillimes: null, lineTotalMillimes: null, issue: "invalid-options" };
    }

    if (
      !Number.isSafeInteger(item.price) || item.price < 0 ||
      options.some((option) => !Number.isSafeInteger(option.price) || option.price < 0)
    ) {
      valid = false;
      return { key: entry.key, entry, item, options, unitPriceMillimes: null, lineTotalMillimes: null, issue: "invalid-price" };
    }

    const unit = BigInt(item.price) + options.reduce((sum, option) => sum + BigInt(option.price), BigInt(0));
    const lineTotal = unit * BigInt(entry.quantity);
    if (unit < 0 || unit > MAX_SAFE_AMOUNT || lineTotal < 0 || lineTotal > MAX_SAFE_AMOUNT) {
      valid = false;
      return { key: entry.key, entry, item, options, unitPriceMillimes: null, lineTotalMillimes: null, issue: "invalid-price" };
    }

    itemCount += entry.quantity;
    subtotal += lineTotal;
    return {
      key: entry.key,
      entry,
      item,
      options,
      unitPriceMillimes: Number(unit),
      lineTotalMillimes: Number(lineTotal),
      issue: null,
    };
  });

  if (!Number.isSafeInteger(itemCount) || subtotal > MAX_SAFE_AMOUNT) valid = false;
  return {
    lines,
    itemCount,
    subtotalMillimes: valid ? Number(subtotal) : null,
    valid,
  };
}

export function createDineInOrderPayload(
  tableToken: string,
  customerName: string,
  notes: string,
  cart: CartItem[],
  menuItems: MenuItem[],
): DineInPayloadResult {
  const reconciled = reconcileDineInCart(cart, menuItems);
  if (!reconciled.valid || cart.length > MAX_ITEMS || !isRegisteredTableToken(tableToken))
    return { payload: null, error: "cart" };
  const normalizedName = customerName.normalize("NFC").trim();
  const normalizedNotes = notes.normalize("NFC").trim();
  if (normalizedName.length > 100 || /[\u0000-\u001f\u007f-\u009f]/u.test(normalizedName))
    return { payload: null, error: "name" };
  if (normalizedNotes.length > 500 || /[\u0000-\u001f\u007f-\u009f]/u.test(normalizedNotes))
    return { payload: null, error: "notes" };

  const payload: DineInOrderPayload = {
    tableToken,
    ...(normalizedName ? { customerName: normalizedName } : {}),
    ...(normalizedNotes ? { notes: normalizedNotes } : {}),
    items: cart.map((entry) => ({
      productId: entry.itemId,
      quantity: entry.quantity,
      optionIds: [...entry.optionIds].sort(),
    })),
  };
  return { payload, error: null };
}

export function createDineInIdempotencyKey(
  cryptoApi: Pick<Crypto, "getRandomValues"> = globalThis.crypto,
): string {
  const bytes = cryptoApi.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

export function isDineInIdempotencyKey(value: unknown): value is string {
  if (typeof value !== "string" || !OPAQUE_TOKEN.test(value)) return false;
  try {
    const base64 = value.replaceAll("-", "+").replaceAll("_", "/") + "=";
    const decoded = atob(base64);
    return decoded.length === 32 && btoa(decoded).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "") === value;
  } catch {
    return false;
  }
}

export function isDineInTrackingToken(value: unknown): value is string {
  return isDineInIdempotencyKey(value);
}

/** Executes one persisted logical attempt; callers reuse the same operation after uncertainty. */
export async function postDineInSubmission(
  operation: PendingDineInSubmission,
  fetcher: typeof fetch = fetch,
): Promise<DineInSubmissionResult> {
  try {
    const response = await fetcher("/api/dine-in/orders", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": operation.idempotencyKey,
      },
      body: operation.payloadJson,
    });
    if (response.status !== 200 && response.status !== 201) {
      let code: unknown;
      try { code = (await response.json() as { code?: unknown }).code; } catch {}
      if (response.status === 409 && code === "idempotency_conflict")
        return { receipt: null, error: "idempotency-conflict" };
      if (response.status === 409 && (code === "catalog_not_ready" || code === "catalog_not_reviewed"))
        return { receipt: null, error: "catalog-not-ready" };
      if (response.status === 404 && code === "table_unavailable")
        return { receipt: null, error: "table-unavailable" };
      const error = response.status === 503 ? "unavailable"
        : response.status === 429 ? "rate-limit"
          : response.status === 400 ? "invalid" : "server";
      return { receipt: null, error };
    }
    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      return { receipt: null, error: "server" };
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return { receipt: null, error: "server" };
    const data = parsed as Partial<{ orderId: string; trackingToken: string; status: string; createdAt: number }>;
    const statuses = ["pending", "confirmed", "preparing", "completed", "rejected", "cancelled"];
    if (
      typeof data.orderId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(data.orderId) ||
      !isDineInTrackingToken(data.trackingToken) ||
      typeof data.status !== "string" || !statuses.includes(data.status) ||
      typeof data.createdAt !== "number" || !Number.isSafeInteger(data.createdAt) || data.createdAt < 0 ||
      !Number.isFinite(new Date(data.createdAt).getTime()) ||
      Object.keys(data).some((field) => !["orderId", "trackingToken", "status", "createdAt"].includes(field))
    )
      return { receipt: null, error: "server" };
    return {
      receipt: { orderId: data.orderId, trackingToken: data.trackingToken, status: data.status, createdAt: data.createdAt },
      error: null,
    };
  } catch {
    return { receipt: null, error: "network" };
  }
}

export function parsePendingDineInSubmission(
  value: unknown,
  tableToken: string,
): PendingDineInSubmission | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  let payload: unknown;
  if (
    !hasOnlyKeys(row, ["version", "state", "idempotencyKey", "payloadJson"]) ||
    !isRegisteredTableToken(tableToken) ||
    row.version !== 2 || (row.state !== "pending" && row.state !== "terminal-conflict") ||
    !isDineInIdempotencyKey(row.idempotencyKey) || typeof row.payloadJson !== "string" || row.payloadJson.length > 20_000
  ) return null;
  try { payload = JSON.parse(row.payloadJson); } catch { return null; }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const request = payload as Record<string, unknown>;
  if (
    !["tableToken", "customerName", "notes", "items"].every((key) => Object.hasOwn(request, key) || key === "customerName" || key === "notes") ||
    Object.keys(request).some((key) => !["tableToken", "customerName", "notes", "items"].includes(key)) ||
    request.tableToken !== tableToken || !Array.isArray(request.items) ||
    request.items.length < 1 || request.items.length > MAX_ITEMS ||
    request.items.some((item) =>
      !item || typeof item !== "object" || Array.isArray(item) ||
      !hasOnlyKeys(item as Record<string, unknown>, ["productId", "quantity", "optionIds"]) ||
      typeof (item as DineInOrderPayload["items"][number]).productId !== "string" || !PRODUCT_ID.test((item as DineInOrderPayload["items"][number]).productId) ||
      !Number.isSafeInteger((item as DineInOrderPayload["items"][number]).quantity) || (item as DineInOrderPayload["items"][number]).quantity < 1 || (item as DineInOrderPayload["items"][number]).quantity > MAX_QUANTITY ||
      !Array.isArray((item as DineInOrderPayload["items"][number]).optionIds) || (item as DineInOrderPayload["items"][number]).optionIds.length > 12 ||
      (item as DineInOrderPayload["items"][number]).optionIds.some((id) => typeof id !== "string" || !PRODUCT_ID.test(id)) ||
      (item as DineInOrderPayload["items"][number]).optionIds.some((id, index, ids) => index > 0 && ids[index - 1] >= id)
    ) ||
    (request.customerName !== undefined && (typeof request.customerName !== "string" || request.customerName.length > 100 || request.customerName !== request.customerName.normalize("NFC").trim() || /[\u0000-\u001f\u007f-\u009f]/u.test(request.customerName))) ||
    (request.notes !== undefined && (typeof request.notes !== "string" || request.notes.length > 500 || request.notes !== request.notes.normalize("NFC").trim() || /[\u0000-\u001f\u007f-\u009f]/u.test(request.notes)))
  ) return null;
  const canonicalPayload: DineInOrderPayload = {
    tableToken,
    ...(typeof request.customerName === "string" && request.customerName ? { customerName: request.customerName } : {}),
    ...(typeof request.notes === "string" && request.notes ? { notes: request.notes } : {}),
    items: request.items as DineInOrderPayload["items"],
  };
  if (JSON.stringify(canonicalPayload) !== row.payloadJson) return null;

  return {
    version: 2,
    idempotencyKey: row.idempotencyKey as string,
    payloadJson: row.payloadJson as string,
    payload: canonicalPayload,
    disposition: row.state === "terminal-conflict" ? "terminal-conflict" : "retryable",
  };
}

export function cartFromDineInPayload(payload: DineInOrderPayload): CartItem[] {
  return payload.items.map((item) => ({
    itemId: item.productId,
    optionIds: [...item.optionIds],
    quantity: item.quantity,
    key: cartKey(item.productId, item.optionIds),
  }));
}

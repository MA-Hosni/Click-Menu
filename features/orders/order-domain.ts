import "server-only";

import { createHash } from "node:crypto";
import { hashTableToken } from "../../lib/table-operations";
import { validateCatalog, CatalogValidationError } from "../../lib/catalog-validation";
import { pickText } from "../../lib/text";
import type { Catalog } from "../../lib/types";
import { hashIdempotencyKey } from "./crypto";

export type DineInOrderErrorCode =
  | "invalid_request"
  | "invalid_idempotency_key"
  | "catalog_not_ready"
  | "catalog_not_reviewed"
  | "invalid_selection"
  | "invalid_table_context";

export class DineInOrderDomainError extends Error {
  constructor(
    readonly code: DineInOrderErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DineInOrderDomainError";
  }
}

export interface DineInOrderLineInput {
  readonly productId: string;
  readonly quantity: number;
  readonly optionIds: readonly string[];
}

/** Contains only customer-supplied business inputs; prices and identity are excluded. */
export interface DineInOrderRequest {
  readonly tableToken: string;
  readonly customerName?: string | null;
  readonly notes?: string;
  readonly items: readonly DineInOrderLineInput[];
}

export interface CanonicalDineInOrderRequest {
  readonly version: 1;
  readonly tableTokenHash: string;
  readonly customerName: string | null;
  readonly notes: string;
  readonly items: readonly DineInOrderLineInput[];
}

/** Must come from a trusted server-side review record, never the request body. */
const trustedReadinessBrand: unique symbol = Symbol("trustedCatalogReadiness");

/**
 * Marker for readiness obtained by a trusted server-side caller. This module
 * is server-only; the future persistence service must read both review fields
 * from PostgreSQL and match the reviewed revision to the catalog revision.
 */
export interface TrustedCatalogReadiness {
  readonly reviewedRevision: number;
  readonly [trustedReadinessBrand]: true;
}

/**
 * Wraps a revision read from trusted server-side review state. Do not pass a
 * revision copied from a customer request; the future persistence/service
 * layer is responsible for obtaining this value from the database.
 */
export function createTrustedCatalogReadiness(
  reviewedRevision: number,
): TrustedCatalogReadiness {
  if (!Number.isSafeInteger(reviewedRevision) || reviewedRevision < 0)
    throw new DineInOrderDomainError(
      "catalog_not_reviewed",
      "The current catalog revision has not been reviewed for ordering.",
    );
  return Object.freeze({ reviewedRevision, [trustedReadinessBrand]: true as const });
}

/** Resolved from the registered-table store, not supplied by the customer. */
export interface ResolvedDineInTable {
  readonly id: string;
  readonly label: string;
  readonly isActive: true;
  /** Hash of the QR token used by the trusted server-side resolution. */
  readonly qrTokenHash: string;
}

export interface DineInOptionSnapshot {
  readonly id: string;
  readonly name: string;
  readonly priceAdjustmentMillimes: number;
}

export interface DineInOrderItemSnapshot {
  readonly productIdSnapshot: string;
  readonly productNameSnapshot: string;
  readonly quantity: number;
  readonly unitPriceMillimes: number;
  readonly lineSubtotalMillimes: number;
  readonly optionSnapshots: readonly DineInOptionSnapshot[];
}

export interface DineInOrderSnapshot {
  readonly tableId: string;
  readonly tableLabelSnapshot: string;
  readonly status: "pending";
  readonly subtotalMillimes: number;
  readonly totalMillimes: number;
  readonly customerName: string | null;
  readonly customerNotes: string | null;
  readonly items: readonly DineInOrderItemSnapshot[];
}

export interface PreparedDineInOrder {
  readonly canonicalRequest: CanonicalDineInOrderRequest;
  readonly idempotencyKeyHash: string;
  readonly requestHash: string;
  /** Transient concurrency guard; the current database schema has no revision column on orders. */
  readonly sourceCatalogRevision: number;
  readonly snapshot: DineInOrderSnapshot;
}

export interface IdentifiedDineInOrderRequest {
  readonly canonicalRequest: CanonicalDineInOrderRequest;
  readonly idempotencyKeyHash: string;
  readonly requestHash: string;
}

const MAX_REQUEST_LINES = 100;
const MAX_QUANTITY_PER_SELECTION = 99;
const MAX_NAME_LENGTH = 100;
const MAX_NOTES_LENGTH = 500;
const MAX_SAFE_MILLIMES = BigInt(Number.MAX_SAFE_INTEGER);
const PRODUCT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function canonicalText(
  value: unknown,
  field: string,
  maximum: number,
  optional = false,
): string | null {
  if (optional && (value === undefined || value === null)) return null;
  if (typeof value !== "string")
    throw new DineInOrderDomainError("invalid_request", `${field} must be text.`);
  const normalized = value.normalize("NFC").trim();
  if (
    normalized.length > maximum ||
    /[\u0000-\u001f\u007f-\u009f]/u.test(normalized)
  )
    throw new DineInOrderDomainError("invalid_request", `${field} is invalid.`);
  return normalized || (optional ? null : "");
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function selectionKey(line: DineInOrderLineInput): string {
  return `${line.productId}\u0000${line.optionIds.join("\u0000")}`;
}

/**
 * Current catalog options have no availability, requiredness, or combination
 * fields. Therefore each listed option is optional and additive; duplicate
 * selections are rejected, while any unique subset is valid.
 */
export function canonicalizeDineInOrderRequest(
  value: unknown,
): CanonicalDineInOrderRequest {
  if (!isRecord(value) || !hasOnlyKeys(value, ["tableToken", "customerName", "notes", "items"]))
    throw new DineInOrderDomainError("invalid_request", "The order request is invalid.");

  const tableTokenHash = hashTableToken(
    typeof value.tableToken === "string" ? value.tableToken : "",
  );
  if (!tableTokenHash)
    throw new DineInOrderDomainError("invalid_request", "The table token is invalid.");
  if (!Array.isArray(value.items) || value.items.length < 1 || value.items.length > MAX_REQUEST_LINES)
    throw new DineInOrderDomainError("invalid_request", "Choose between 1 and 100 order lines.");

  const customerName = canonicalText(value.customerName, "Customer name", MAX_NAME_LENGTH, true);
  const notes = canonicalText(value.notes, "Order notes", MAX_NOTES_LENGTH, true) ?? "";
  const merged = new Map<string, DineInOrderLineInput>();

  for (const candidate of value.items) {
    if (!isRecord(candidate) || !hasOnlyKeys(candidate, ["productId", "quantity", "optionIds"]))
      throw new DineInOrderDomainError("invalid_request", "An order line is invalid.");
    if (typeof candidate.productId !== "string" || !PRODUCT_ID_PATTERN.test(candidate.productId))
      throw new DineInOrderDomainError("invalid_request", "A product reference is invalid.");
    if (
      typeof candidate.quantity !== "number" ||
      !Number.isSafeInteger(candidate.quantity) ||
      candidate.quantity < 1 ||
      candidate.quantity > MAX_QUANTITY_PER_SELECTION
    )
      throw new DineInOrderDomainError("invalid_request", "A quantity is invalid.");
    if (
      !Array.isArray(candidate.optionIds) ||
      candidate.optionIds.length > 12 ||
      candidate.optionIds.some((id) => typeof id !== "string" || !PRODUCT_ID_PATTERN.test(id))
    )
      throw new DineInOrderDomainError("invalid_request", "Option selections are invalid.");

    const optionIds = [...candidate.optionIds] as string[];
    if (new Set(optionIds).size !== optionIds.length)
      throw new DineInOrderDomainError("invalid_request", "An option cannot be selected more than once.");
    optionIds.sort(compareText);

    const line: DineInOrderLineInput = {
      productId: candidate.productId,
      quantity: candidate.quantity,
      optionIds,
    };
    const key = selectionKey(line);
    const existing = merged.get(key);
    const quantity = (existing?.quantity ?? 0) + line.quantity;
    if (quantity > MAX_QUANTITY_PER_SELECTION)
      throw new DineInOrderDomainError("invalid_request", "The combined quantity is too large.");
    merged.set(key, { ...line, quantity });
  }

  const items = [...merged.values()].sort((left, right) =>
    compareText(selectionKey(left), selectionKey(right)),
  );

  return {
    version: 1,
    tableTokenHash,
    customerName,
    notes,
    items,
  };
}

/** Hashes order content without binding an idempotency identity to a QR token. */
function hashCanonicalDineInRequest(
  request: CanonicalDineInOrderRequest,
): string {
  const orderContent = {
    version: request.version,
    customerName: request.customerName,
    notes: request.notes,
    items: request.items,
  };
  return createHash("sha256").update(JSON.stringify(orderContent)).digest("hex");
}

/** Validates and identifies customer input before any mutable database reads. */
export function identifyDineInOrderRequest(
  requestValue: unknown,
  idempotencyKey: unknown,
): IdentifiedDineInOrderRequest {
  const idempotencyKeyHash = hashIdempotencyKey(idempotencyKey);
  if (!idempotencyKeyHash)
    throw new DineInOrderDomainError("invalid_idempotency_key", "The idempotency key is invalid.");

  const canonicalRequest = canonicalizeDineInOrderRequest(requestValue);
  return {
    canonicalRequest,
    idempotencyKeyHash,
    requestHash: hashCanonicalDineInRequest(canonicalRequest),
  };
}

export function toSafeMillimes(value: bigint): number {
  if (value < BigInt(0) || value > MAX_SAFE_MILLIMES)
    throw new DineInOrderDomainError("invalid_selection", "The order amount is outside the supported range.");
  return Number(value);
}

function trustedTable(
  value: ResolvedDineInTable,
  expectedTokenHash: string,
): ResolvedDineInTable {
  if (
    !value ||
    typeof value.id !== "string" ||
    !value.id.trim() ||
    value.id.length > 64 ||
    value.isActive !== true ||
    typeof value.label !== "string" ||
    !value.label.trim() ||
    value.label.length > 40 ||
    typeof value.qrTokenHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.qrTokenHash) ||
    value.qrTokenHash !== expectedTokenHash ||
    /[\u0000-\u001f\u007f-\u009f]/u.test(value.label)
  )
    throw new DineInOrderDomainError("invalid_table_context", "The registered table context is invalid.");
  return {
    id: value.id,
    label: value.label,
    isActive: true,
    qrTokenHash: value.qrTokenHash,
  };
}

/** Validates and prices a request using the supplied server-loaded catalog. */
export function prepareDineInOrder(
  requestValue: unknown,
  idempotencyKey: unknown,
  catalogValue: unknown,
  readiness: TrustedCatalogReadiness | null | undefined,
  resolvedTable: ResolvedDineInTable,
): PreparedDineInOrder {
  const identifiedRequest = identifyDineInOrderRequest(requestValue, idempotencyKey);
  const { canonicalRequest, idempotencyKeyHash, requestHash } = identifiedRequest;
  const table = trustedTable(resolvedTable, canonicalRequest.tableTokenHash);

  let catalog: Catalog;
  try {
    catalog = validateCatalog(catalogValue);
  } catch (error) {
    if (error instanceof CatalogValidationError)
      throw new DineInOrderDomainError("catalog_not_ready", "The saved catalog is not ready for ordering.");
    throw error;
  }
  if (
    !readiness ||
    readiness[trustedReadinessBrand] !== true ||
    !Number.isSafeInteger(readiness.reviewedRevision) ||
    readiness.reviewedRevision !== catalog.revision
  )
    throw new DineInOrderDomainError(
      "catalog_not_reviewed",
      "The current catalog revision has not been reviewed for ordering.",
    );

  const itemSnapshots: DineInOrderItemSnapshot[] = [];
  let subtotal = BigInt(0);
  for (const selection of canonicalRequest.items) {
    const product = catalog.items.find((item) => item.id === selection.productId);
    if (!product || !product.available)
      throw new DineInOrderDomainError("invalid_selection", "A selected menu item is unavailable.");

    const optionsById = new Map(product.options.map((option) => [option.id, option]));
    const selectedOptions = selection.optionIds.map((id) => {
      const option = optionsById.get(id);
      if (!option)
        throw new DineInOrderDomainError("invalid_selection", "An option does not belong to the selected item.");
      return option;
    });

    const unitPrice = BigInt(product.price) + selectedOptions.reduce(
      (sum, option) => sum + BigInt(option.price),
      BigInt(0),
    );
    const lineSubtotal = unitPrice * BigInt(selection.quantity);
    subtotal += lineSubtotal;

    itemSnapshots.push({
      productIdSnapshot: product.id,
      productNameSnapshot: pickText(product.name, "en"),
      quantity: selection.quantity,
      unitPriceMillimes: toSafeMillimes(unitPrice),
      lineSubtotalMillimes: toSafeMillimes(lineSubtotal),
      optionSnapshots: selectedOptions.map((option) => ({
        id: option.id,
        name: pickText(option.label, "en"),
        priceAdjustmentMillimes: option.price,
      })),
    });
  }

  const subtotalMillimes = toSafeMillimes(subtotal);
  return {
    canonicalRequest,
    idempotencyKeyHash,
    requestHash,
    sourceCatalogRevision: catalog.revision,
    snapshot: {
      tableId: table.id,
      tableLabelSnapshot: table.label,
      status: "pending",
      subtotalMillimes,
      totalMillimes: subtotalMillimes,
      customerName: canonicalRequest.customerName,
      customerNotes: canonicalRequest.notes || null,
      items: itemSnapshots,
    },
  };
}

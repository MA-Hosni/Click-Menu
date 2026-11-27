import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import "../../support/register-types.mjs";

const requireTs = createRequire(import.meta.url);
import { createTestCatalog } from "../../support/catalog-fixture.mjs";
const {
  canonicalizeDineInOrderRequest,
  createTrustedTndCatalogReadiness,
  DineInOrderDomainError,
  identifyDineInOrderRequest,
  prepareDineInOrder,
  toSafeMillimes,
} = requireTs("../../../features/orders/order-domain.ts");
const { hashTableToken } = requireTs("../../../lib/table-operations.ts");
const {
  generateTrackingToken,
  hashIdempotencyKey,
  hashTrackingToken,
} = requireTs("../../../features/orders/crypto.ts");

const token = () => randomBytes(32).toString("base64url");
const tableToken = token();
const context = {
  id: "a4a1a6a5-c746-4cc5-9fb4-955893e72124",
  label: "Table 7",
  isActive: true,
  qrTokenHash: hashTableToken(tableToken),
};

function contextFor(requestToken) {
  return { ...context, qrTokenHash: hashTableToken(requestToken) };
}

function makeCatalog() {
  const catalog = createTestCatalog();
  catalog.settings.currency = "TND";
  catalog.revision = 17;
  catalog.items[0].price = 1250;
  catalog.items[0].options[0].price = 275;
  return catalog;
}

function validRequest(overrides = {}) {
  const catalog = makeCatalog();
  return {
    tableToken,
    customerName: "  Guest  ",
    notes: "  No onions  ",
    items: [
      {
        productId: catalog.items[0].id,
        quantity: 2,
        optionIds: [catalog.items[0].options[0].id],
      },
    ],
    ...overrides,
  };
}

function prepare(
  request = validRequest(),
  catalog = makeCatalog(),
  readiness = createTrustedTndCatalogReadiness(17),
) {
  return prepareDineInOrder(request, token(), catalog, readiness, context);
}

describe("normalized dine-in order domain", () => {
  it("prices a reviewed TND catalog and builds snapshots from saved catalog data", () => {
    const catalog = makeCatalog();
    const request = validRequest({
      items: [{
        productId: catalog.items[0].id,
        quantity: 2,
        optionIds: [catalog.items[0].options[0].id],
      }],
    });

    const prepared = prepare(request, catalog);
    const product = catalog.items[0];
    const option = product.options[0];
    const unit = product.price + option.price;

    assert.equal(prepared.snapshot.currency, "TND");
    assert.equal(prepared.snapshot.status, "pending");
    assert.equal(prepared.snapshot.tableId, context.id);
    assert.equal(prepared.snapshot.tableLabelSnapshot, context.label);
    assert.equal(prepared.snapshot.items[0].productNameSnapshot, product.name.en);
    assert.equal(prepared.snapshot.items[0].unitPriceMillimes, unit);
    assert.equal(prepared.snapshot.items[0].lineSubtotalMillimes, unit * 2);
    assert.equal(prepared.snapshot.items[0].optionSnapshots[0].name, option.label.en);
    assert.equal(prepared.snapshot.subtotalMillimes, unit * 2);
    assert.equal(prepared.snapshot.totalMillimes, unit * 2);
    assert.equal(prepared.snapshot.customerName, "Guest");
    assert.equal(prepared.snapshot.customerNotes, "No onions");
    assert.equal(prepared.sourceCatalogRevision, 17);
    assert.equal("price" in prepared.snapshot.items[0], false);
  });

  it("rejects non-TND and malformed catalogs", () => {
    const missingCurrency = makeCatalog();
    delete missingCurrency.settings.currency;
    assert.throws(() => prepare(validRequest(), missingCurrency), { code: "catalog_not_ready" });

    const malformed = makeCatalog();
    malformed.items[0].price = -1;
    assert.throws(() => prepare(validRequest(), malformed), { code: "catalog_not_ready" });
  });

  it("requires trusted reviewed readiness for the exact catalog revision", () => {
    assert.throws(() => prepare(validRequest(), makeCatalog(), null), {
      code: "catalog_not_reviewed",
    });
    assert.throws(() => prepare(validRequest(), makeCatalog(), { reviewedRevision: 17 }), {
      code: "catalog_not_reviewed",
    });
    assert.throws(() => createTrustedTndCatalogReadiness(-1), {
      code: "catalog_not_reviewed",
    });
    assert.throws(() => prepare(validRequest(), makeCatalog(), createTrustedTndCatalogReadiness(16)), {
      code: "catalog_not_reviewed",
    });
    assert.throws(() => prepare(validRequest(), makeCatalog(), null), {
      code: "catalog_not_reviewed",
    });
  });

  it("requires the trusted active table resolution to match the submitted QR token", () => {
    const request = validRequest();
    assert.throws(
      () => prepareDineInOrder(request, token(), makeCatalog(), createTrustedTndCatalogReadiness(17), {
        ...context,
        qrTokenHash: "0".repeat(64),
      }),
      { code: "invalid_table_context" },
    );
    assert.throws(
      () => prepareDineInOrder(request, token(), makeCatalog(), createTrustedTndCatalogReadiness(17), {
        ...context,
        isActive: false,
      }),
      { code: "invalid_table_context" },
    );
  });

  it("rejects nonexistent and unavailable products", () => {
    const catalog = makeCatalog();
    const badProduct = validRequest({ items: [{ productId: "missing", quantity: 1, optionIds: [] }] });
    assert.throws(() => prepare(badProduct, catalog), { code: "invalid_selection" });

    const unavailable = structuredClone(catalog);
    unavailable.items[0].available = false;
    const unavailableRequest = validRequest({
      items: [{ productId: unavailable.items[0].id, quantity: 1, optionIds: [] }],
    });
    assert.throws(() => prepare(unavailableRequest, unavailable), { code: "invalid_selection" });
  });

  it("rejects unknown or duplicate option selections", () => {
    const catalog = makeCatalog();
    assert.throws(
      () => prepare(validRequest({ items: [{ productId: catalog.items[0].id, quantity: 1, optionIds: ["missing"] }] }), catalog),
      { code: "invalid_selection" },
    );
    const optionId = catalog.items[0].options[0].id;
    assert.throws(
      () => prepare(validRequest({ items: [{ productId: catalog.items[0].id, quantity: 1, optionIds: [optionId, optionId] }] }), catalog),
      { code: "invalid_request" },
    );
  });

  it("rejects invalid quantities and excessive request shapes", () => {
    const catalog = makeCatalog();
    for (const quantity of [0, -1, 1.5, 100, Number.MAX_SAFE_INTEGER + 1]) {
      const request = validRequest({
        items: [{ productId: catalog.items[0].id, quantity, optionIds: [] }],
      });
      assert.throws(() => prepare(request, catalog), { code: "invalid_request" });
    }
    assert.throws(() => prepare(validRequest({ items: [] }), catalog), { code: "invalid_request" });
  });

  it("merges duplicate product/option lines and rejects a merged quantity above the cap", () => {
    const catalog = makeCatalog();
    const productId = catalog.items[0].id;
    const optionId = catalog.items[0].options[0].id;
    const merged = canonicalizeDineInOrderRequest(validRequest({
      items: [
        { productId, quantity: 40, optionIds: [optionId] },
        { productId, quantity: 59, optionIds: [optionId] },
      ],
    }));
    assert.equal(merged.items.length, 1);
    assert.equal(merged.items[0].quantity, 99);
    assert.throws(() => canonicalizeDineInOrderRequest(validRequest({
      items: [
        { productId, quantity: 99, optionIds: [optionId] },
        { productId, quantity: 1, optionIds: [optionId] },
      ],
    })), { code: "invalid_request" });
  });

  it("normalizes option order and item order deterministically", () => {
    const catalog = makeCatalog();
    const first = catalog.items[0];
    const second = catalog.items[1];
    const sharedToken = token();
    const sharedInputs = (items) => ({ tableToken: sharedToken, items });
    const canonicalLeft = canonicalizeDineInOrderRequest(sharedInputs([
      { productId: second.id, quantity: 1, optionIds: [] },
      { productId: first.id, quantity: 1, optionIds: [first.options[1].id, first.options[0].id] },
    ]));
    const canonicalRight = canonicalizeDineInOrderRequest(sharedInputs([
      { productId: first.id, quantity: 1, optionIds: [first.options[0].id, first.options[1].id] },
      { productId: second.id, quantity: 1, optionIds: [] },
    ]));
    assert.deepEqual(canonicalLeft, canonicalRight);
    assert.equal(
      prepareDineInOrder(sharedInputs([
        { productId: second.id, quantity: 1, optionIds: [] },
        { productId: first.id, quantity: 1, optionIds: [first.options[1].id, first.options[0].id] },
      ]), token(), catalog, createTrustedTndCatalogReadiness(17), contextFor(sharedToken)).requestHash,
      prepareDineInOrder(sharedInputs([
        { productId: first.id, quantity: 1, optionIds: [first.options[0].id, first.options[1].id] },
        { productId: second.id, quantity: 1, optionIds: [] },
      ]), token(), catalog, createTrustedTndCatalogReadiness(17), contextFor(sharedToken)).requestHash,
    );
  });

  it("normalizes absent and null optional customer fields consistently", () => {
    const request = validRequest();
    const omitted = canonicalizeDineInOrderRequest({
      tableToken: request.tableToken,
      items: request.items,
    });
    const empty = canonicalizeDineInOrderRequest({
      tableToken: request.tableToken,
      customerName: null,
      notes: null,
      items: request.items,
    });
    assert.deepEqual(omitted, empty);
  });

  it("hashes customer order content independently of the current QR token", () => {
    const tableToken = token();
    const request = validRequest({ tableToken });
    const first = prepareDineInOrder(request, token(), makeCatalog(), createTrustedTndCatalogReadiness(17), contextFor(tableToken));
    const same = prepareDineInOrder(structuredClone(request), token(), makeCatalog(), createTrustedTndCatalogReadiness(17), contextFor(tableToken));
    const otherToken = token();
    const otherTable = prepareDineInOrder(
      { ...request, tableToken: otherToken },
      token(),
      makeCatalog(),
      createTrustedTndCatalogReadiness(17),
      { ...context, qrTokenHash: hashTableToken(otherToken) },
    );
    assert.equal(first.requestHash, same.requestHash);
    assert.notEqual(first.canonicalRequest.tableTokenHash, otherTable.canonicalRequest.tableTokenHash);
    assert.equal(first.requestHash, otherTable.requestHash);
  });

  it("identifies a request before mutable catalog and table reads", () => {
    const request = validRequest();
    const identified = identifyDineInOrderRequest(request, token());
    assert.equal(identified.canonicalRequest.tableTokenHash, hashTableToken(request.tableToken));
    assert.match(identified.idempotencyKeyHash, /^[a-f0-9]{64}$/);
    assert.match(identified.requestHash, /^[a-f0-9]{64}$/);
  });

  it("hashes equivalent requests identically despite property insertion order", () => {
    const request = validRequest();
    const item = request.items[0];
    const reordered = {
      items: [{ optionIds: [...item.optionIds], quantity: item.quantity, productId: item.productId }],
      notes: request.notes,
      customerName: request.customerName,
      tableToken: request.tableToken,
    };
    const first = prepareDineInOrder(request, token(), makeCatalog(), createTrustedTndCatalogReadiness(17), contextFor(request.tableToken));
    const second = prepareDineInOrder(reordered, token(), makeCatalog(), createTrustedTndCatalogReadiness(17), contextFor(request.tableToken));
    assert.equal(first.requestHash, second.requestHash);
  });

  it("excludes catalog prices, names, and revision from the request hash", () => {
    const request = validRequest();
    const original = makeCatalog();
    const changed = structuredClone(original);
    changed.revision += 1;
    changed.items[0].price += 500;
    changed.items[0].name.en = "Renamed product";
    changed.items[0].options[0].price += 100;
    changed.items[0].options[0].label.en = "Renamed option";
    const first = prepareDineInOrder(
      request, token(), original, createTrustedTndCatalogReadiness(original.revision), contextFor(request.tableToken),
    );
    const second = prepareDineInOrder(
      request, token(), changed, createTrustedTndCatalogReadiness(changed.revision), contextFor(request.tableToken),
    );
    assert.equal(first.requestHash, second.requestHash);
  });

  it("rejects client-authoritative prices, names, totals, currency, and review fields", () => {
    const catalog = makeCatalog();
    const line = { productId: catalog.items[0].id, quantity: 1, optionIds: [] };
    for (const request of [
      { ...validRequest({ items: [line] }), currency: "TND" },
      { ...validRequest({ items: [line] }), totalMillimes: 1 },
      { ...validRequest({ items: [line] }), reviewedRevision: 17 },
      validRequest({ items: [{ ...line, price: 1 }] }),
      validRequest({ items: [{ ...line, name: "Client name" }] }),
    ]) {
      assert.throws(() => prepare(request, catalog), DineInOrderDomainError);
    }
  });

  it("calculates dine-in snapshots without an additional fee", () => {
    const catalog = makeCatalog();
    const prepared = prepare(validRequest({
      items: [{ productId: catalog.items[0].id, quantity: 1, optionIds: [] }],
    }), catalog);
    assert.equal(prepared.snapshot.subtotalMillimes, catalog.items[0].price);
    assert.equal(prepared.snapshot.totalMillimes, catalog.items[0].price);
  });

  it("checks safe-integer bounds with BigInt", () => {
    assert.equal(toSafeMillimes(BigInt(Number.MAX_SAFE_INTEGER)), Number.MAX_SAFE_INTEGER);
    assert.throws(() => toSafeMillimes(BigInt(Number.MAX_SAFE_INTEGER) + BigInt(1)), DineInOrderDomainError);
    assert.throws(() => toSafeMillimes(BigInt(-1)), DineInOrderDomainError);
  });

  it("validates canonical 32-byte idempotency and tracking tokens", () => {
    const key = token();
    const expectedDigest = createHash("sha256").update(Buffer.from(key, "base64url")).digest("hex");
    assert.equal(hashIdempotencyKey(key), expectedDigest);
    assert.equal(hashIdempotencyKey(`${key}=`), null);
    assert.equal(hashIdempotencyKey("abcd"), null);
    assert.equal(hashIdempotencyKey("!".repeat(43)), null);

    const trackingToken = generateTrackingToken();
    assert.match(trackingToken, /^[A-Za-z0-9_-]{43}$/);
    assert.match(hashTrackingToken(trackingToken), /^[a-f0-9]{64}$/);
    assert.equal(hashTrackingToken("not-a-token"), null);
    assert.equal(hashTrackingToken(`${trackingToken}=`), null);
    assert.equal(hashTrackingToken(`${"A".repeat(42)}!`), null);
  });
});

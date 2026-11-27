import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import "../../support/register-types.mjs";

const requireTs = createRequire(import.meta.url);
const {
  buildDineInOrderDetail,
  createDineInOrderDetailGetHandler,
} = requireTs("../../../features/orders/order-detail.ts");

const id = "10000000-0000-4000-8000-000000000001";

function header(overrides = {}) {
  return {
    orderId: id,
    createdAt: "1790000000000",
    status: "pending",
    customerName: "Guest",
    customerNotes: "No onions",
    tableLabel: "Patio 1",
    subtotalMillimes: "2001700",
    totalMillimes: "2001700",
    ...overrides,
  };
}

function rows(overrides = []) {
  return [
    {
      lineNumber: 1,
      productName: "Historical sandwich",
      quantity: 2,
      unitPriceMillimes: "1000100",
      lineTotalMillimes: "2000200",
      options: [{ id: "extra-cheese", name: "Extra cheese", priceAdjustmentMillimes: 100 }],
    },
    {
      lineNumber: 2,
      productName: "Historical tea",
      quantity: 3,
      unitPriceMillimes: "500",
      lineTotalMillimes: "1500",
      options: [],
    },
    ...overrides,
  ];
}

function request() {
  return new Request(`https://clickmenu.example/api/admin/dine-in/orders/${id}`);
}

describe("normalized dine-in order detail", () => {
  it("requires the administrator before validating the ID or querying the order", async () => {
    let reads = 0;
    const get = createDineInOrderDetailGetHandler({
      getCurrentUser: async () => null,
      getOrder: async () => { reads += 1; return null; },
    });
    const response = await get(request(), { params: Promise.resolve({ id: "bad-id" }) });
    assert.equal(response.status, 401);
    assert.equal(reads, 0);
  });

  it("rejects an invalid UUID without querying and returns 404 for a missing order", async () => {
    let reads = 0;
    const get = createDineInOrderDetailGetHandler({
      getCurrentUser: async () => ({ name: "The Hood" }),
      getOrder: async () => { reads += 1; return null; },
    });
    const invalid = await get(request(), { params: Promise.resolve({ id: "../../orders" }) });
    assert.equal(invalid.status, 400);
    assert.equal(reads, 0);
    const missing = await get(request(), { params: Promise.resolve({ id }) });
    assert.equal(missing.status, 404);
    assert.equal(reads, 1);
  });

  it("returns validated historical snapshots, option effects, and integer millimes", () => {
    const detail = buildDineInOrderDetail(header(), rows());
    assert.deepEqual(detail, {
      orderId: id,
      createdAt: "1790000000000",
      status: "pending",
      customerName: "Guest",
      customerNotes: "No onions",
      tableLabel: "Patio 1",
      subtotalMillimes: 2001700,
      totalMillimes: 2001700,
      items: [
        {
          lineNumber: 1,
          productName: "Historical sandwich",
          quantity: 2,
          unitPriceMillimes: 1000100,
          lineTotalMillimes: 2000200,
          options: [{ id: "extra-cheese", name: "Extra cheese", priceAdjustmentMillimes: 100 }],
        },
        {
          lineNumber: 2,
          productName: "Historical tea",
          quantity: 3,
          unitPriceMillimes: 500,
          lineTotalMillimes: 1500,
          options: [],
        },
      ],
    });
    assert.deepEqual(Object.keys(detail).sort(), [
      "createdAt", "customerName", "customerNotes", "items", "orderId",
      "status", "subtotalMillimes", "tableLabel", "totalMillimes",
    ].sort());
  });

  it("preserves the maximum supported millime value exactly", () => {
    const maximum = "9007199254740991";
    const detail = buildDineInOrderDetail(header({
      subtotalMillimes: maximum,
      totalMillimes: maximum,
    }), [{
      lineNumber: 1,
      productName: "High-value snapshot fixture",
      quantity: 1,
      unitPriceMillimes: maximum,
      lineTotalMillimes: maximum,
      options: [],
    }]);
    assert.equal(detail.totalMillimes, Number.MAX_SAFE_INTEGER);
  });

  it("rejects malformed snapshots and broken header/item invariants", () => {
    const malformedCases = [
      [header(), rows().map((row, index) => index === 0 ? { ...row, options: { id: "bad" } } : row)],
      [header(), rows().map((row, index) => index === 0 ? { ...row, options: [{ id: "x", name: "", priceAdjustmentMillimes: 1 }] } : row)],
      [header(), rows().map((row, index) => index === 0 ? { ...row, unitPriceMillimes: "9007199254740992" } : row)],
      [header(), rows().map((row, index) => index === 0 ? { ...row, lineTotalMillimes: "2000201" } : row)],
      [header({ totalMillimes: "2001701" }), rows()],
      [header({ subtotalMillimes: "2000200", totalMillimes: "2000200" }), rows()],
      [header(), rows().map((row, index) => index === 0 ? { ...row, lineNumber: 2 } : row)],
      [header(), []],
    ];
    for (const [storedHeader, storedRows] of malformedCases)
      assert.throws(() => buildDineInOrderDetail(storedHeader, storedRows));
  });

  it("returns the normal no-store response and never adds security fields", async () => {
    const detail = buildDineInOrderDetail(header(), rows());
    const get = createDineInOrderDetailGetHandler({
      getCurrentUser: async () => ({ name: "The Hood" }),
      getOrder: async (orderId) => orderId === id ? detail : null,
    });
    const response = await get(request(), { params: Promise.resolve({ id }) });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const body = await response.json();
    assert.deepEqual(body, detail);
    assert.doesNotMatch(JSON.stringify(body), /trackingToken|tracking_token_hash|idempotency|recovery|ciphertext|nonce|authTag/iu);
  });
});

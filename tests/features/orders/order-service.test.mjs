import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import "../../support/register-types.mjs";

const requireTs = createRequire(import.meta.url);
import { createTestCatalog } from "../../support/catalog-fixture.mjs";
const { createDineInOrderService } = requireTs("../../../features/orders/order-service.ts");
const { hashTableToken } = requireTs("../../../lib/table-operations.ts");
const { hashTrackingToken } = requireTs("../../../features/orders/crypto.ts");
const { createTrackingTokenRecovery } = requireTs("../../../features/orders/tracking-token-recovery.ts");

const token = () => randomBytes(32).toString("base64url");
const key = token;

function fixture() {
  const tableToken = token();
  const catalog = createTestCatalog();
  catalog.revision = 4;
  catalog.items[0].price = 75_000;
  catalog.items[0].options[0].price = 7_500;
  const store = {
    catalog: JSON.stringify(catalog), revision: 4, reviewedRevision: 4,
    reviewedAt: 1_700_000_000_000, active: true, currentTokenHash: hashTableToken(tableToken),
    orders: new Map(), items: [], lastLookupBeforeCatalog: false,
  };
  const persistence = {
    async withTransaction(callback) {
      const tx = { ...store, catalogLocked: false, orders: new Map(store.orders), items: [...store.items] };
      const result = await callback(tx);
      store.orders = tx.orders;
      store.items = tx.items;
      store.lastLookupBeforeCatalog = tx.lastLookupBeforeCatalog;
      return result;
    },
    async lockIdempotencyKey() {},
    async findByIdempotencyKeyHash(tx, digest) {
      tx.lastLookupBeforeCatalog = !tx.catalogLocked;
      return tx.orders.get(digest) ?? null;
    },
    async lockCatalog(tx) {
      tx.catalogLocked = true;
      return {
        payload: tx.catalog, revision: tx.revision,
        priceReviewedRevision: Object.hasOwn(tx, "reviewedRevision") ? tx.reviewedRevision : tx.revision,
        priceReviewedAt: Object.hasOwn(tx, "reviewedAt") ? tx.reviewedAt : 1_700_000_000_000,
      };
    },
    async lockActiveTable(tx, digest) {
      if (!tx.active || digest !== tx.currentTokenHash) return null;
      return { id: "table-id", label: "Table 3", qrTokenHash: digest };
    },
    async insertOrder(tx, order) {
      if (tx.orders.has(order.idempotencyKeyHash)) return null;
      tx.orders.set(order.idempotencyKeyHash, {
        ...order, status: order.status, createdAt: order.createdAt,
      });
      return {
        id: order.id, tableLabelSnapshot: order.tableLabelSnapshot,
        status: order.status,
        subtotalMillimes: order.subtotalMillimes, totalMillimes: order.totalMillimes,
        createdAt: order.createdAt, updatedAt: order.updatedAt,
      };
    },
    async insertItems(tx, items) {
      tx.items.push(...items);
      return items.map(({ lineNumber, quantity, unitPriceMillimes, lineSubtotalMillimes }) => ({
        lineNumber, quantity, unitPriceMillimes, lineSubtotalMillimes,
      }));
    },
  };
  const recovery = createTrackingTokenRecovery(Buffer.alloc(32, 7).toString("base64"));
  const service = createDineInOrderService(persistence, {
    recovery: () => recovery,
    createOrderId: randomUUID,
    createItemId: randomUUID,
    createTrackingToken: token,
    now: () => 1_700_000_000_123,
  });
  const request = {
    tableToken,
    customerName: "Guest",
    items: [{ productId: catalog.items[0].id, quantity: 2, optionIds: [catalog.items[0].options[0].id] }],
  };
  return { service, store, request, key: key(), persistence, recovery };
}

describe("dine-in order persistence service", () => {
  it("creates a pending order and immutable amount snapshots using saved data", async () => {
    const { service, store, request, key: idempotencyKey } = fixture();
    const result = await service.submit(request, idempotencyKey);
    const saved = [...store.orders.values()][0];
    assert.equal(result.replayed, false);
    assert.equal(result.orderId, saved.id);
    assert.match(result.orderId, /^[0-9a-f-]{36}$/u);
    assert.equal(result.status, "pending");
    assert.equal(store.orders.size, 1);
    assert.equal(store.items.length, 1);
    assert.equal(saved.tableId, "table-id");
    assert.equal(saved.tableLabelSnapshot, "Table 3");
    assert.equal(Object.hasOwn(saved, "currency"), false);
    assert.equal(saved.subtotalMillimes, store.items[0].lineSubtotalMillimes);
    assert.equal(saved.trackingTokenHash, hashTrackingToken(result.trackingToken));
    assert.notEqual(saved.trackingTokenHash, result.trackingToken);
    assert.equal(JSON.stringify(saved).includes(result.trackingToken), false);
    assert.equal(store.items[0].productNameSnapshot, JSON.parse(store.catalog).items[0].name.en);
  });

  it("recovers the same order/token before checking changed table or catalog state", async () => {
    const { service, store, request, key: idempotencyKey } = fixture();
    const original = await service.submit(request, idempotencyKey);
    store.active = false;
    store.reviewedRevision = null;
    store.revision = 5;
    const replay = await service.submit(request, idempotencyKey);
    assert.equal(store.lastLookupBeforeCatalog, true);
    assert.equal(replay.replayed, true);
    assert.equal(replay.orderId, original.orderId);
    assert.equal(replay.trackingToken, original.trackingToken);
    assert.equal(replay.createdAt, original.createdAt);
    assert.equal(store.orders.size, 1);
  });

  it("conflicts when the same key is reused for different canonical order content", async () => {
    const { service, request, key: idempotencyKey } = fixture();
    await service.submit(request, idempotencyKey);
    await assert.rejects(service.submit({ ...request, customerName: "Another guest" }, idempotencyKey), {
      code: "idempotency_conflict",
    });
  });

  it("allows identical order content with different idempotency keys", async () => {
    const { service, store, request } = fixture();
    const a = await service.submit(request, key());
    const b = await service.submit(request, key());
    assert.notEqual(a.trackingToken, b.trackingToken);
    assert.equal(store.orders.size, 2);
    assert.equal(store.items.length, 2);
  });

  it("allows another same-table order in every earlier order status while preserving retries", async () => {
    for (const status of ["pending", "confirmed", "preparing", "completed", "rejected", "cancelled"]) {
      const { service, store, request } = fixture();
      const originalKey = key();
      const original = await service.submit(request, originalKey);
      const saved = [...store.orders.values()][0];
      saved.status = status;

      const anotherKey = key();
      const second = await service.submit(request, anotherKey);
      const retry = await service.submit(request, anotherKey);

      assert.notEqual(second.orderId, original.orderId, `new order should be separate after ${status}`);
      assert.equal(second.replayed, false);
      assert.equal(retry.orderId, second.orderId, `same-key retry should replay after ${status}`);
      assert.equal(retry.replayed, true);
      assert.equal(store.orders.size, 2, `both orders should remain after ${status}`);
    }
  });

  it("rejects inactive or rotated QR tokens for a new order", async () => {
    const { service, store, request } = fixture();
    store.active = false;
    await assert.rejects(service.submit(request, key()), { code: "table_unavailable" });
    assert.equal(store.orders.size, 0);
  });

  it("rejects missing, unknown, rotated, and browser-selected table context before persistence", async () => {
    const { service, store, request } = fixture();

    await assert.rejects(
      service.submit({ ...request, tableToken: undefined }, key()),
      { code: "invalid_request" },
    );
    await assert.rejects(
      service.submit({ ...request, tableToken: token() }, key()),
      { code: "table_unavailable" },
    );
    await assert.rejects(
      service.submit({ ...request, tableId: "attacker-selected-table" }, key()),
      { code: "invalid_request" },
    );

    const rotatedToken = token();
    store.currentTokenHash = hashTableToken(rotatedToken);
    await assert.rejects(service.submit(request, key()), { code: "table_unavailable" });
    assert.equal(store.orders.size, 0);
    assert.equal(store.items.length, 0);
  });

  it("accepts catalogs without currency and rejects unreviewed/stale catalog state", async () => {
    const { service, store, request } = fixture();
    const catalog = JSON.parse(store.catalog);
    delete catalog.settings.currency;
    store.catalog = JSON.stringify(catalog);
    await service.submit(request, key());
    assert.equal(store.orders.size, 1);
    assert.equal(store.items.length, 1);
    store.reviewedRevision = null;
    await assert.rejects(service.submit(request, key()), { code: "catalog_not_reviewed" });
    assert.equal(store.orders.size, 1);
    assert.equal(store.items.length, 1);
  });

  it("does not persist header/items when item insertion fails", async () => {
    const { store, request, key: idempotencyKey, persistence, recovery } = fixture();
    const failing = {
      ...persistence,
      async insertItems() { throw new Error("simulated item failure"); },
    };
    const service = createDineInOrderService(failing, {
      recovery: () => recovery,
      createTrackingToken: token,
    });
    await assert.rejects(service.submit(request, idempotencyKey), /simulated item failure/);
    assert.equal(store.orders.size, 0);
    assert.equal(store.items.length, 0);
  });
});

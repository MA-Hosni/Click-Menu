import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import "../../support/register-types.mjs";

const requireTs = createRequire(import.meta.url);
const dine = requireTs("../../../features/storefront/dine-in-order.ts");
const storefront = requireTs("../../../features/storefront/useStorefront.ts");

const {
  cartFromDineInPayload,
  canCreateNewDineInSubmission,
  canSubmitWithPendingState,
  acknowledgeDineInSubmission,
  createDineInIdempotencyKey,
  createDineInOrderPayload,
  createPendingDineInSubmission,
  dineInOrderSessionHistoryKey,
  deriveTableStorageId,
  getDineInStorage,
  isDineInIdempotencyKey,
  isTerminalDineInSubmissionError,
  loadDineInCart,
  loadDineInOrderSessionHistory,
  loadPendingDineInSubmission,
  markPendingDineInTerminal,
  parsePendingDineInSubmission,
  pendingDineInStorageKey,
  postDineInSubmission,
  reconcileDineInCart,
  removePendingDineInSubmission,
  releaseAcknowledgedDineInOrder,
  rememberDineInOrderInSession,
  reconcilePendingDineInSubmission,
  restoreDineInCart,
  saveDineInCart,
  savePendingDineInSubmission,
  tableCartStorageKey,
  withDineInTableLock,
} = dine;
const tokenA = "A".repeat(43);
const tokenB = "C".repeat(43);
const orderId = "00000000-0000-4000-8000-000000000001";
const item = {
  id: "dish-1",
  category: "food",
  name: { en: "Toast", fr: "Toast", ar: "توست" },
  description: { en: "", fr: "", ar: "" },
  image: null,
  tags: [],
  available: true,
  price: 1250,
  options: [{ id: "extra-1", label: { en: "Egg", fr: "Oeuf", ar: "بيض" }, price: 250 }],
};
function memoryStorage(initial = new Map()) {
  return {
    values: initial,
    getItem(key) { return this.values.get(key) ?? null; },
    setItem(key, value) { this.values.set(key, value); },
    removeItem(key) { this.values.delete(key); },
  };
}
function memoryFallback(initial = new Map()) {
  return {
    values: initial,
    async get(key) { return this.values.get(key) ?? null; },
    async set(key, value) { this.values.set(key, value); },
    async remove(key) { this.values.delete(key); },
  };
}
function payload(tableToken = tokenA) {
  return { tableToken, items: [{ productId: "dish-1", quantity: 1, optionIds: [] }] };
}

function serialLockManager() {
  const queues = new Map();
  return {
    request(name, _options, callback) {
      const previous = queues.get(name) ?? Promise.resolve();
      let release;
      const gate = new Promise((resolve) => { release = resolve; });
      queues.set(name, previous.then(() => gate));
      return previous.then(async () => {
        try { return await callback(); }
        finally { release(); }
      });
    },
  };
}

describe("registered-table dine-in cart and submission", () => {
  it("uses deterministic hashed scopes without putting raw table tokens in storage keys", async () => {
    const idA = await deriveTableStorageId(tokenA);
    assert.equal(idA, await deriveTableStorageId(tokenA));
    assert.notEqual(idA, await deriveTableStorageId(tokenB));
    const cartKey = await tableCartStorageKey(tokenA);
    const pendingKey = await pendingDineInStorageKey(tokenA);
    assert.equal(cartKey.includes(tokenA), false);
    assert.equal(pendingKey.includes(tokenA), false);
    assert.notEqual(cartKey, await tableCartStorageKey(tokenB));
    assert.notEqual(pendingKey, await pendingDineInStorageKey(tokenB));
  });

  it("persists and restores each table cart independently", async () => {
    const storage = memoryStorage();
    const cartA = restoreDineInCart([{ itemId: item.id, optionIds: [], quantity: 2 }]);
    await saveDineInCart(storage, tokenA, cartA);
    assert.equal((await loadDineInCart(storage, tokenA))[0].quantity, 2);
    assert.deepEqual(await loadDineInCart(storage, tokenB), []);
  });

  it("keeps a separate table-session order history, newest first, without exposing the QR token in its key", async () => {
    const storage = memoryStorage();
    const first = { orderId, createdAt: 100 };
    const second = { orderId: "00000000-0000-4000-8000-000000000002", createdAt: 200 };
    await rememberDineInOrderInSession(storage, tokenA, first);
    await rememberDineInOrderInSession(storage, tokenA, second);
    await rememberDineInOrderInSession(storage, tokenA, first);

    assert.deepEqual(await loadDineInOrderSessionHistory(storage, tokenA), [second, first]);
    assert.notEqual(await dineInOrderSessionHistoryKey(tokenA), await dineInOrderSessionHistoryKey(tokenB));
    assert.equal((await dineInOrderSessionHistoryKey(tokenA)).includes(tokenA), false);
    assert.deepEqual(await loadDineInOrderSessionHistory(storage, tokenB), []);
  });

  it("releases the next-order slot only after safely recording a successful receipt", async () => {
    const storage = memoryStorage();
    const fallback = memoryFallback();
    const operation = createPendingDineInSubmission(createDineInIdempotencyKey(), payload());
    await savePendingDineInSubmission(storage, tokenA, operation);

    assert.equal(await releaseAcknowledgedDineInOrder(storage, tokenA, operation, orderId, fallback), true);
    assert.deepEqual(await loadPendingDineInSubmission(storage, tokenA, fallback), { kind: "none" });
    assert.equal(await fallback.get(await deriveTableStorageId(tokenA)), null);
    assert.equal(await releaseAcknowledgedDineInOrder(storage, tokenA, operation, "00000000-0000-4000-8000-000000000002", fallback), false);
  });

  it("does not expose or persist table A cart state under table B's scope", () => {
    const scopeA = `table:${tokenA}`;
    const scopeB = `table:${tokenB}`;
    const stateA = { scope: scopeA, items: [{ itemId: item.id, optionIds: [], quantity: 2 }] };
    assert.deepEqual(storefront.visibleCartForScope(stateA, scopeB), []);
    assert.equal(storefront.cartStateCanPersist(stateA, scopeA, scopeB), false);
    assert.equal(storefront.cartStateCanPersist(stateA, scopeB, scopeB), false);
    const stateB = { scope: scopeB, items: [] };
    assert.deepEqual(storefront.visibleCartForScope(stateB, scopeB), []);
    assert.equal(storefront.cartStateCanPersist(stateB, scopeB, scopeB), true);
    assert.equal(storefront.visibleCartForScope(stateA, scopeA)[0].quantity, 2);
  });

  it("restores stale items/options visibly and rejects invalid quantities", () => {
    const cart = restoreDineInCart([
      { itemId: "removed-dish", optionIds: ["old-option"], quantity: 2 },
      { itemId: item.id, optionIds: ["removed-option"], quantity: 1 },
      { itemId: item.id, optionIds: [], quantity: 0 },
    ]);
    assert.equal(cart.length, 2);
    const result = reconcileDineInCart(cart, [item]);
    assert.equal(result.lines[0].issue, "unavailable");
    assert.equal(result.lines[1].issue, "invalid-options");
    assert.equal(result.valid, false);
    assert.equal(reconcileDineInCart([{ ...cart[0], quantity: 1.5 }], [item]).lines[0].issue, "invalid-quantity");
  });

  it("calculates integer TND dine-in totals with safe arithmetic", () => {
    const cart = restoreDineInCart([{ itemId: item.id, optionIds: ["extra-1"], quantity: 3 }]);
    const result = reconcileDineInCart(cart, [item]);
    assert.equal(result.lines[0].unitPriceMillimes, 1500);
    assert.equal(result.subtotalMillimes, 4500);
    assert.equal(result.valid, true);
    const invalid = reconcileDineInCart(cart, [{ ...item, price: Number.MAX_SAFE_INTEGER + 1 }]);
    assert.equal(invalid.lines[0].issue, "invalid-price");
  });

  it("builds a business-input-only canonical request", () => {
    const cart = restoreDineInCart([{ itemId: item.id, optionIds: ["extra-1"], quantity: 2 }]);
    const result = createDineInOrderPayload(tokenA, "  Sam  ", "  no onions ", cart, [item]);
    assert.equal(result.error, null);
    assert.deepEqual(result.payload, {
      tableToken: tokenA,
      customerName: "Sam",
      notes: "no onions",
      items: [{ productId: "dish-1", quantity: 2, optionIds: ["extra-1"] }],
    });
    assert.equal("price" in result.payload.items[0], false);
    assert.equal("tableId" in result.payload, false);
    assert.equal("currency" in result.payload, false);
  });

  it("generates distinct canonical 32-byte Base64URL idempotency keys", () => {
    const first = createDineInIdempotencyKey();
    const second = createDineInIdempotencyKey();
    assert.match(first, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(isDineInIdempotencyKey(first), true);
    assert.equal(Buffer.from(first, "base64url").length, 32);
    assert.notEqual(first, second);
    assert.equal(isDineInIdempotencyKey(`${first}=`), false);
  });

  it("persists only the exact request JSON and key and restores it after storage reopening", async () => {
    const storage = memoryStorage();
    const operation = createPendingDineInSubmission(createDineInIdempotencyKey(), payload());
    assert.equal(await savePendingDineInSubmission(storage, tokenA, operation), true);
    const storageKey = await pendingDineInStorageKey(tokenA);
    const raw = storage.getItem(storageKey);
    const stored = JSON.parse(raw);
    assert.deepEqual(Object.keys(stored).sort(), ["idempotencyKey", "payloadJson", "state", "version"]);
    assert.equal(stored.state, "pending");
    assert.equal(stored.payloadJson, operation.payloadJson);
    assert.doesNotMatch(raw, /trackingToken|receipt|password/i);
    assert.equal((await loadPendingDineInSubmission(storage, tokenB, memoryFallback())).kind, "none");
    const reopened = memoryStorage(new Map(storage.values));
    const restored = await loadPendingDineInSubmission(reopened, tokenA, memoryFallback());
    assert.equal(restored.kind, "retryable");
    assert.equal(restored.operation.idempotencyKey, operation.idempotencyKey);
    assert.equal(restored.operation.payloadJson, operation.payloadJson);
    assert.equal(parsePendingDineInSubmission(stored, tokenB), null);
    assert.equal(await removePendingDineInSubmission(reopened, tokenA, { kind: "pending", operation: restored.operation }, "abandon", memoryFallback()), "removed");
  });

  it("keeps malformed pending records and reports them as unknown", async () => {
    const key = await pendingDineInStorageKey(tokenA);
    const malformed = memoryStorage(new Map([[key, "{bad"]]));
    const state = await loadPendingDineInSubmission(malformed, tokenA, memoryFallback());
    assert.deepEqual(state, { kind: "unknown", reason: "malformed" });
    assert.equal(malformed.values.has(key), true);
    assert.equal(canCreateNewDineInSubmission(state.kind), false);
    assert.equal(canSubmitWithPendingState(state.kind), false);
  });

  it("fails closed when getItem throws even if removeItem and setItem work", async () => {
    const key = await pendingDineInStorageKey(tokenA);
    const backing = memoryStorage(new Map([[key, "possible committed operation"]]));
    let reads = 0;
    const flaky = {
      getItem() { reads += 1; throw new Error("temporary read failure"); },
      setItem: backing.setItem.bind(backing),
      removeItem: backing.removeItem.bind(backing),
    };
    const state = await loadPendingDineInSubmission(flaky, tokenA, memoryFallback());
    assert.deepEqual(state, { kind: "unknown", reason: "read-failed" });
    assert.equal(reads, 1);
    assert.equal(backing.values.has(key), true);
    assert.equal(canCreateNewDineInSubmission(state.kind), false);
    assert.equal(canSubmitWithPendingState(state.kind), false);
  });

  it("recovers a prior read failure by re-reading the still-present pending request", async () => {
    const key = await pendingDineInStorageKey(tokenA);
    const operation = createPendingDineInSubmission(createDineInIdempotencyKey(), payload());
    const backing = memoryStorage();
    await savePendingDineInSubmission(backing, tokenA, operation);
    let readable = false;
    const recovering = {
      getItem(_value) { if (!readable) throw new Error("blocked"); return backing.getItem(_value); },
      setItem: backing.setItem.bind(backing),
      removeItem: backing.removeItem.bind(backing),
    };
    assert.deepEqual(await loadPendingDineInSubmission(recovering, tokenA, memoryFallback()), { kind: "unknown", reason: "read-failed" });
    assert.equal(backing.values.has(key), true);
    readable = true;
    const recovered = await loadPendingDineInSubmission(recovering, tokenA, memoryFallback());
    assert.equal(recovered.kind, "retryable");
    assert.equal(recovered.operation.idempotencyKey, operation.idempotencyKey);
  });

  it("handles unavailable storage safely", async () => {
    const unavailable = {
      getItem() { throw new Error("blocked"); },
      setItem() { throw new Error("quota"); },
      removeItem() { throw new Error("blocked"); },
    };
    const operation = createPendingDineInSubmission(createDineInIdempotencyKey(), payload());
    assert.deepEqual(await loadPendingDineInSubmission(null, tokenA, memoryFallback()), { kind: "unknown", reason: "unavailable" });
    assert.equal(await savePendingDineInSubmission(unavailable, tokenA, operation), false);
  });

  it("handles a throwing browser-storage getter without crashing", () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", { configurable: true, get() { throw new Error("blocked"); } });
    try {
      assert.equal(getDineInStorage(), null);
    } finally {
      if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
      else delete globalThis.localStorage;
    }
  });

  it("persists terminal idempotency conflicts through reload", async () => {
    const storage = memoryStorage();
    const operation = createPendingDineInSubmission(createDineInIdempotencyKey(), payload());
    await savePendingDineInSubmission(storage, tokenA, operation);
    assert.equal(await markPendingDineInTerminal(storage, tokenA, operation), true);
    const reopened = memoryStorage(new Map(storage.values));
    const restored = await loadPendingDineInSubmission(reopened, tokenA, memoryFallback());
    assert.equal(restored.kind, "terminal-conflict");
    assert.equal(restored.operation.disposition, "terminal-conflict");
    assert.equal(canSubmitWithPendingState(restored.kind), false);
    assert.equal(canCreateNewDineInSubmission(restored.kind), false);
  });

  it("fails closed if the terminal disposition cannot be persisted", async () => {
    const operation = createPendingDineInSubmission(createDineInIdempotencyKey(), payload());
    const failing = {
      getItem() { return null; },
      setItem() { throw new Error("quota"); },
      removeItem() {},
    };
    assert.equal(await markPendingDineInTerminal(failing, tokenA, operation), false);
    assert.equal(canSubmitWithPendingState("unknown"), false);
    assert.equal(canCreateNewDineInSubmission("unknown"), false);
  });

  it("persists a terminal conflict to IndexedDB fallback when the primary write fails", async () => {
    const operation = createPendingDineInSubmission(createDineInIdempotencyKey(), payload());
    const backing = memoryStorage();
    await savePendingDineInSubmission(backing, tokenA, operation);
    const failingPrimary = {
      getItem: backing.getItem.bind(backing),
      setItem() { throw new Error("quota"); },
      removeItem: backing.removeItem.bind(backing),
    };
    const fallback = memoryFallback();
    assert.equal(await markPendingDineInTerminal(failingPrimary, tokenA, operation, fallback), true);
    const restored = await loadPendingDineInSubmission(backing, tokenA, fallback);
    assert.equal(restored.kind, "terminal-conflict");
    assert.equal(restored.operation.idempotencyKey, operation.idempotencyKey);
    assert.equal(canSubmitWithPendingState(restored.kind), false);
  });

  it("rejects a malformed terminal fallback instead of trusting a retryable primary record", async () => {
    const operation = createPendingDineInSubmission(createDineInIdempotencyKey(), payload());
    const primary = memoryStorage();
    await savePendingDineInSubmission(primary, tokenA, operation);
    const fallback = memoryFallback(new Map([[await deriveTableStorageId(tokenA), "{broken"]]));
    const restored = await loadPendingDineInSubmission(primary, tokenA, fallback);
    assert.deepEqual(restored, { kind: "unknown", reason: "malformed" });
    assert.equal(canSubmitWithPendingState(restored.kind), false);
  });

  it("rejects a terminal fallback for a different operation instead of overwriting newer state", async () => {
    const primary = memoryStorage();
    const current = createPendingDineInSubmission(createDineInIdempotencyKey(), payload());
    const obsolete = createPendingDineInSubmission(createDineInIdempotencyKey(), payload());
    await savePendingDineInSubmission(primary, tokenA, current);
    const fallback = memoryFallback();
    await fallback.set(await deriveTableStorageId(tokenA), JSON.stringify({
      version: 2,
      state: "terminal-conflict",
      idempotencyKey: obsolete.idempotencyKey,
      payloadJson: obsolete.payloadJson,
    }));
    const state = await loadPendingDineInSubmission(primary, tokenA, fallback);
    assert.deepEqual(state, { kind: "unknown", reason: "malformed" });
    assert.equal(canSubmitWithPendingState(state.kind), false);
  });

  it("stays blocked when both terminal persistence mechanisms fail", async () => {
    const operation = createPendingDineInSubmission(createDineInIdempotencyKey(), payload());
    const primary = memoryStorage();
    await savePendingDineInSubmission(primary, tokenA, operation);
    const failingPrimary = {
      getItem: primary.getItem.bind(primary),
      setItem() { throw new Error("quota"); },
      removeItem: primary.removeItem.bind(primary),
    };
    const failingFallback = {
      async get() { throw new Error("IndexedDB unavailable"); },
      async set() { throw new Error("IndexedDB unavailable"); },
      async remove() { throw new Error("IndexedDB unavailable"); },
    };
    assert.equal(await markPendingDineInTerminal(failingPrimary, tokenA, operation, failingFallback), false);
    const blocked = await loadPendingDineInSubmission(primary, tokenA, failingFallback);
    assert.deepEqual(blocked, { kind: "unknown", reason: "fallback-failed" });
    assert.equal(canSubmitWithPendingState(blocked.kind), false);
    assert.equal(canCreateNewDineInSubmission(blocked.kind), false);
    const recoveredOnReload = await loadPendingDineInSubmission(primary, tokenA, memoryFallback());
    assert.equal(recoveredOnReload.kind, "retryable");
    assert.equal(recoveredOnReload.operation.idempotencyKey, operation.idempotencyKey);
    assert.equal(recoveredOnReload.operation.payloadJson, operation.payloadJson);
    assert.equal(canCreateNewDineInSubmission(recoveredOnReload.kind), false);
  });

  it("acknowledges only the exact retry operation and then writes a minimal marker", async () => {
    const storage = memoryStorage();
    const operation = createPendingDineInSubmission(createDineInIdempotencyKey(), {
      tableToken: tokenA, customerName: "Guest", notes: "No onions",
      items: [{ productId: "dish-1", quantity: 1, optionIds: [] }],
    });
    await savePendingDineInSubmission(storage, tokenA, operation);
    const fallback = memoryFallback();
    const stale = createPendingDineInSubmission(createDineInIdempotencyKey(), payload());
    assert.equal(await acknowledgeDineInSubmission(storage, tokenA, stale, orderId, fallback), false);
    assert.equal(await acknowledgeDineInSubmission(storage, tokenB, operation, orderId, fallback), false);
    const stillPending = await loadPendingDineInSubmission(storage, tokenA, fallback);
    assert.equal(stillPending.kind, "retryable", JSON.stringify(stillPending));
    assert.equal(await acknowledgeDineInSubmission(storage, tokenA, operation, orderId, fallback), true);
    assert.equal(await acknowledgeDineInSubmission(storage, tokenA, operation, orderId, fallback), true);
    const raw = storage.getItem(await pendingDineInStorageKey(tokenA));
    assert.deepEqual(JSON.parse(raw), { version: 2, state: "completed", orderId });
    assert.doesNotMatch(raw, /Guest|No onions|trackingToken|payloadJson|idempotencyKey/i);
    assert.deepEqual(await loadPendingDineInSubmission(storage, tokenA, fallback), { kind: "completed", orderId });
  });

  it("keeps the exact pending record after receipt acknowledgment and recovers the same token on replay", async () => {
    const storage = memoryStorage();
    const operation = createPendingDineInSubmission(createDineInIdempotencyKey(), payload());
    const fallback = memoryFallback();
    await savePendingDineInSubmission(storage, tokenA, operation);
    const before = storage.getItem(await pendingDineInStorageKey(tokenA));
    const first = await postDineInSubmission(operation, async () => ({
      status: 201,
      json: async () => ({ orderId, trackingToken: tokenA, status: "pending", createdAt: 123 }),
    }));
    assert.equal(first.receipt.trackingToken, tokenA);
    assert.equal(storage.getItem(await pendingDineInStorageKey(tokenA)), before);

    const reloaded = await loadPendingDineInSubmission(memoryStorage(new Map(storage.values)), tokenA, fallback);
    assert.equal(reloaded.kind, "retryable");
    const replay = await postDineInSubmission(reloaded.operation, async (_url, init) => {
      assert.equal(init.headers["idempotency-key"], operation.idempotencyKey);
      assert.equal(init.body, operation.payloadJson);
      return { status: 200, json: async () => ({ orderId, trackingToken: tokenA, status: "pending", createdAt: 123 }) };
    });
    assert.deepEqual(replay.receipt, first.receipt);
    assert.equal((await loadPendingDineInSubmission(storage, tokenA, fallback)).kind, "retryable");
  });

  it("retains the exact retry record when receipt acknowledgment storage fails", async () => {
    const backing = memoryStorage();
    const operation = createPendingDineInSubmission(createDineInIdempotencyKey(), payload());
    await savePendingDineInSubmission(backing, tokenA, operation);
    const failingWrite = {
      getItem: backing.getItem.bind(backing),
      setItem() { throw new Error("quota"); },
      removeItem: backing.removeItem.bind(backing),
    };
    const acknowledged = await acknowledgeDineInSubmission(
      failingWrite, tokenA, operation, orderId, memoryFallback(),
    );
    assert.equal(acknowledged, false);
    const restored = await loadPendingDineInSubmission(backing, tokenA, memoryFallback());
    assert.equal(restored.kind, "retryable");
    assert.equal(restored.operation.idempotencyKey, operation.idempotencyKey);
    assert.equal(restored.operation.payloadJson, operation.payloadJson);
  });

  it("removes primary and terminal fallback records only through the scoped removal helper", async () => {
    const storage = memoryStorage();
    const operation = createPendingDineInSubmission(createDineInIdempotencyKey(), payload());
    await savePendingDineInSubmission(storage, tokenA, operation);
    const fallback = memoryFallback();
    await markPendingDineInTerminal({
      getItem: storage.getItem.bind(storage),
      setItem() { throw new Error("quota"); },
      removeItem: storage.removeItem.bind(storage),
    }, tokenA, operation, fallback);
    assert.equal(await removePendingDineInSubmission(storage, tokenA, { kind: "pending", operation }, "abandon", fallback), "removed");
    assert.deepEqual(await loadPendingDineInSubmission(storage, tokenA, fallback), { kind: "none" });
    assert.equal(await loadPendingDineInSubmission(storage, tokenB, fallback).then((value) => value.kind), "none");
  });

  it("does not let stale abandonment erase a different pending operation", async () => {
    const storage = memoryStorage();
    const first = createPendingDineInSubmission(createDineInIdempotencyKey(), payload());
    const second = createPendingDineInSubmission(createDineInIdempotencyKey(), {
      tableToken: tokenA, customerName: "Different guest", items: payload().items,
    });
    const fallback = memoryFallback();
    await savePendingDineInSubmission(storage, tokenA, first);
    await savePendingDineInSubmission(storage, tokenA, second);
    assert.equal(await removePendingDineInSubmission(storage, tokenA, { kind: "pending", operation: first }, "abandon", fallback), "changed");
    const current = await loadPendingDineInSubmission(storage, tokenA, fallback);
    assert.equal(current.kind, "retryable");
    assert.equal(current.operation.idempotencyKey, second.idempotencyKey);
  });

  it("does not let stale abandonment erase an acknowledged order marker", async () => {
    const storage = memoryStorage();
    const operation = createPendingDineInSubmission(createDineInIdempotencyKey(), payload());
    const fallback = memoryFallback();
    await savePendingDineInSubmission(storage, tokenA, operation);
    assert.equal(await acknowledgeDineInSubmission(storage, tokenA, operation, orderId, fallback), true);
    assert.equal(await removePendingDineInSubmission(storage, tokenA, { kind: "pending", operation }, "abandon", fallback), "changed");
    assert.deepEqual(await loadPendingDineInSubmission(storage, tokenA, fallback), { kind: "completed", orderId });
  });

  it("removes only the expected completed order marker when starting a new order", async () => {
    const storage = memoryStorage();
    const fallback = memoryFallback();
    const operation = createPendingDineInSubmission(createDineInIdempotencyKey(), payload());
    await savePendingDineInSubmission(storage, tokenA, operation);
    await acknowledgeDineInSubmission(storage, tokenA, operation, orderId, fallback);
    const differentOrderId = "00000000-0000-4000-8000-000000000002";
    assert.equal(await removePendingDineInSubmission(storage, tokenA, { kind: "completed", orderId: differentOrderId }, "new-order", fallback), "changed");
    assert.deepEqual(await loadPendingDineInSubmission(storage, tokenA, fallback), { kind: "completed", orderId });
    assert.equal(await removePendingDineInSubmission(storage, tokenA, { kind: "completed", orderId }, "new-order", fallback), "removed");
    assert.deepEqual(await loadPendingDineInSubmission(storage, tokenA, fallback), { kind: "none" });
  });

  it("does not let stale start-new-order cleanup erase a newer pending order", async () => {
    const storage = memoryStorage();
    const fallback = memoryFallback();
    const oldOperation = createPendingDineInSubmission(createDineInIdempotencyKey(), payload());
    await savePendingDineInSubmission(storage, tokenA, oldOperation);
    await acknowledgeDineInSubmission(storage, tokenA, oldOperation, orderId, fallback);
    const newerOperation = createPendingDineInSubmission(createDineInIdempotencyKey(), {
      tableToken: tokenA, customerName: "New order", items: payload().items,
    });
    await savePendingDineInSubmission(storage, tokenA, newerOperation);
    assert.equal(await removePendingDineInSubmission(storage, tokenA, { kind: "completed", orderId }, "new-order", fallback), "changed");
    const current = await loadPendingDineInSubmission(storage, tokenA, fallback);
    assert.equal(current.kind, "retryable");
    assert.equal(current.operation.idempotencyKey, newerOperation.idempotencyKey);
  });

  it("keeps cleanup blocked and recoverable after fallback deletion fails", async () => {
    const storage = memoryStorage();
    const operation = createPendingDineInSubmission(createDineInIdempotencyKey(), payload());
    const backingFallback = memoryFallback();
    await savePendingDineInSubmission(storage, tokenA, operation);
    await markPendingDineInTerminal({
      getItem: storage.getItem.bind(storage), setItem() { throw new Error("quota"); },
      removeItem: storage.removeItem.bind(storage),
    }, tokenA, operation, backingFallback);
    const failingFallback = {
      get: backingFallback.get.bind(backingFallback),
      set: backingFallback.set.bind(backingFallback),
      async remove() { throw new Error("delete failed"); },
    };
    assert.equal(await removePendingDineInSubmission(storage, tokenA, { kind: "pending", operation }, "abandon", failingFallback), "failed");
    assert.deepEqual(await loadPendingDineInSubmission(storage, tokenA, backingFallback), { kind: "unknown", reason: "cleanup-in-progress" });
    assert.deepEqual(await withDineInTableLock(tokenA, () => reconcilePendingDineInSubmission(storage, tokenA, backingFallback)), { kind: "none" });
  });

  it("keeps cleanup blocked after primary marker removal fails and resumes it", async () => {
    const backing = memoryStorage();
    const operation = createPendingDineInSubmission(createDineInIdempotencyKey(), payload());
    const fallback = memoryFallback();
    await savePendingDineInSubmission(backing, tokenA, operation);
    const failRemove = {
      getItem: backing.getItem.bind(backing), setItem: backing.setItem.bind(backing),
      removeItem() { throw new Error("remove failed"); },
    };
    assert.equal(await removePendingDineInSubmission(failRemove, tokenA, { kind: "pending", operation }, "abandon", fallback), "failed");
    assert.deepEqual(await loadPendingDineInSubmission(backing, tokenA, fallback), { kind: "unknown", reason: "cleanup-in-progress" });
    assert.deepEqual(await withDineInTableLock(tokenA, () => reconcilePendingDineInSubmission(backing, tokenA, fallback)), { kind: "none" });
  });

  it("uses a fallback cleanup marker when the primary tombstone write fails", async () => {
    const backing = memoryStorage();
    const operation = createPendingDineInSubmission(createDineInIdempotencyKey(), payload());
    const fallback = memoryFallback();
    await savePendingDineInSubmission(backing, tokenA, operation);
    const failWrite = {
      getItem: backing.getItem.bind(backing), setItem() { throw new Error("quota"); },
      removeItem: backing.removeItem.bind(backing),
    };
    assert.equal(await removePendingDineInSubmission(failWrite, tokenA, { kind: "pending", operation }, "abandon", fallback), "failed");
    assert.deepEqual(await loadPendingDineInSubmission(backing, tokenA, fallback), { kind: "unknown", reason: "cleanup-in-progress" });
    assert.deepEqual(await withDineInTableLock(tokenA, () => reconcilePendingDineInSubmission(backing, tokenA, fallback)), { kind: "none" });
  });

  for (const action of ["abandon", "new-order"]) {
    it(`recovers matching dual ${action} tombstones after interruption between promotion and fallback deletion`, async () => {
      const storage = memoryStorage();
      const fallback = memoryFallback();
      const operation = createPendingDineInSubmission(createDineInIdempotencyKey(), payload());
      if (action === "abandon") await savePendingDineInSubmission(storage, tokenA, operation);
      else storage.setItem(await pendingDineInStorageKey(tokenA), JSON.stringify({ version: 2, state: "completed", orderId }));

      const marker = action === "abandon"
        ? { version: 3, state: "cleanup", action, idempotencyKey: operation.idempotencyKey, payloadJson: operation.payloadJson, orderId: null }
        : { version: 3, state: "cleanup", action, idempotencyKey: null, payloadJson: null, orderId };
      await fallback.set(await deriveTableStorageId(tokenA), JSON.stringify(marker));
      const unrelated = createPendingDineInSubmission(createDineInIdempotencyKey(), payload(tokenB));
      await savePendingDineInSubmission(storage, tokenB, unrelated);

      let removeAttempts = 0;
      const interruptAfterPromotion = {
        get: fallback.get.bind(fallback),
        set: fallback.set.bind(fallback),
        async remove(key) {
          removeAttempts += 1;
          if (removeAttempts <= 2) throw new Error("simulated interruption after promotion");
          return fallback.remove(key);
        },
      };
      const first = await withDineInTableLock(tokenA, () =>
        reconcilePendingDineInSubmission(storage, tokenA, interruptAfterPromotion));
      assert.deepEqual(first, { kind: "unknown", reason: "cleanup-in-progress" });
      const storedPrimary = storage.getItem(await pendingDineInStorageKey(tokenA));
      assert.equal(storedPrimary, JSON.stringify(marker));
      assert.equal(await fallback.get(await deriveTableStorageId(tokenA)), JSON.stringify(marker));
      assert.deepEqual(await loadPendingDineInSubmission(storage, tokenA, fallback), {
        kind: "unknown", reason: "cleanup-in-progress",
      });

      // Recreate wrappers over the same durable stores, as after a page reload.
      const reloadedStorage = memoryStorage(new Map(storage.values));
      const secondReload = memoryStorage(new Map(reloadedStorage.values));
      assert.deepEqual(await withDineInTableLock(tokenA, () =>
        reconcilePendingDineInSubmission(secondReload, tokenA, interruptAfterPromotion)), {
        kind: "unknown", reason: "cleanup-in-progress",
      });
      assert.equal(secondReload.getItem(await pendingDineInStorageKey(tokenA)), JSON.stringify(marker));
      assert.equal(await fallback.get(await deriveTableStorageId(tokenA)), JSON.stringify(marker));

      const finalReload = memoryStorage(new Map(secondReload.values));
      const recovered = await withDineInTableLock(tokenA, () =>
        reconcilePendingDineInSubmission(finalReload, tokenA, fallback));
      assert.deepEqual(recovered, { kind: "none" });
      assert.equal(await fallback.get(await deriveTableStorageId(tokenA)), null);
      assert.equal(await finalReload.getItem(await pendingDineInStorageKey(tokenA)), null);
      const otherTable = await loadPendingDineInSubmission(finalReload, tokenB, fallback);
      assert.equal(otherTable.kind, "retryable");
      assert.equal(otherTable.operation.idempotencyKey, unrelated.idempotencyKey);
    });
  }

  it("retries idempotently when fallback deletion completed before primary tombstone deletion", async () => {
    const storage = memoryStorage();
    const fallback = memoryFallback();
    const operation = createPendingDineInSubmission(createDineInIdempotencyKey(), payload());
    await savePendingDineInSubmission(storage, tokenA, operation);
    const marker = { version: 3, state: "cleanup", action: "abandon", idempotencyKey: operation.idempotencyKey, payloadJson: operation.payloadJson, orderId: null };
    storage.setItem(await pendingDineInStorageKey(tokenA), JSON.stringify(marker));
    let failPrimaryRemove = true;
    const failingPrimary = {
      getItem: storage.getItem.bind(storage), setItem: storage.setItem.bind(storage),
      removeItem(key) { if (failPrimaryRemove) throw new Error("interrupted before primary deletion"); storage.removeItem(key); },
    };
    assert.deepEqual(await withDineInTableLock(tokenA, () => reconcilePendingDineInSubmission(failingPrimary, tokenA, fallback)), {
      kind: "unknown", reason: "cleanup-in-progress",
    });
    assert.equal(await fallback.get(await deriveTableStorageId(tokenA)), null);
    failPrimaryRemove = false;
    assert.deepEqual(await withDineInTableLock(tokenA, () => reconcilePendingDineInSubmission(storage, tokenA, fallback)), { kind: "none" });
  });

  it("keeps mismatched dual tombstones blocked without deleting either marker", async () => {
    const storage = memoryStorage();
    const fallback = memoryFallback();
    const operation = createPendingDineInSubmission(createDineInIdempotencyKey(), payload());
    const primary = { version: 3, state: "cleanup", action: "abandon", idempotencyKey: operation.idempotencyKey, payloadJson: operation.payloadJson, orderId: null };
    const variants = [
      { ...primary, action: "new-order", idempotencyKey: null, payloadJson: null, orderId },
      { ...primary, idempotencyKey: createDineInIdempotencyKey() },
      { ...primary, payloadJson: JSON.stringify({ ...payload(), customerName: "different" }) },
      { ...primary, payloadJson: null },
    ];
    storage.setItem(await pendingDineInStorageKey(tokenA), JSON.stringify(primary));
    for (const secondary of variants) {
      await fallback.set(await deriveTableStorageId(tokenA), JSON.stringify(secondary));
      assert.deepEqual(await loadPendingDineInSubmission(storage, tokenA, fallback), { kind: "unknown", reason: "malformed" });
      assert.deepEqual(await withDineInTableLock(tokenA, () => reconcilePendingDineInSubmission(storage, tokenA, fallback)), {
        kind: "unknown", reason: "malformed",
      });
      assert.equal(storage.getItem(await pendingDineInStorageKey(tokenA)), JSON.stringify(primary));
      assert.equal(await fallback.get(await deriveTableStorageId(tokenA)), JSON.stringify(secondary));
    }
  });

  it("keeps a changed tombstone version blocked without deleting either record", async () => {
    const storage = memoryStorage();
    const fallback = memoryFallback();
    const operation = createPendingDineInSubmission(createDineInIdempotencyKey(), payload());
    const primary = { version: 3, state: "cleanup", action: "abandon", idempotencyKey: operation.idempotencyKey, payloadJson: operation.payloadJson, orderId: null };
    const unsupported = { ...primary, version: 4 };
    storage.setItem(await pendingDineInStorageKey(tokenA), JSON.stringify(primary));
    await fallback.set(await deriveTableStorageId(tokenA), JSON.stringify(unsupported));
    assert.deepEqual(await loadPendingDineInSubmission(storage, tokenA, fallback), { kind: "unknown", reason: "malformed" });
    assert.deepEqual(await withDineInTableLock(tokenA, () => reconcilePendingDineInSubmission(storage, tokenA, fallback)), {
      kind: "unknown", reason: "malformed",
    });
    assert.equal(storage.getItem(await pendingDineInStorageKey(tokenA)), JSON.stringify(primary));
    assert.equal(await fallback.get(await deriveTableStorageId(tokenA)), JSON.stringify(unsupported));
  });

  it("keeps new-order tombstones with different completed order IDs blocked", async () => {
    const storage = memoryStorage();
    const fallback = memoryFallback();
    const otherOrderId = "00000000-0000-4000-8000-000000000002";
    const primary = { version: 3, state: "cleanup", action: "new-order", idempotencyKey: null, payloadJson: null, orderId };
    const secondary = { ...primary, orderId: otherOrderId };
    storage.setItem(await pendingDineInStorageKey(tokenA), JSON.stringify(primary));
    await fallback.set(await deriveTableStorageId(tokenA), JSON.stringify(secondary));
    assert.deepEqual(await loadPendingDineInSubmission(storage, tokenA, fallback), { kind: "unknown", reason: "malformed" });
    assert.deepEqual(await withDineInTableLock(tokenA, () => reconcilePendingDineInSubmission(storage, tokenA, fallback)), {
      kind: "unknown", reason: "malformed",
    });
    assert.equal(storage.getItem(await pendingDineInStorageKey(tokenA)), JSON.stringify(primary));
    assert.equal(await fallback.get(await deriveTableStorageId(tokenA)), JSON.stringify(secondary));
  });

  it("resumes new-order cleanup after the fallback is deleted but primary tombstone removal fails", async () => {
    const storage = memoryStorage();
    const fallback = memoryFallback();
    storage.setItem(await pendingDineInStorageKey(tokenA), JSON.stringify({ version: 2, state: "completed", orderId }));
    const failingPrimary = {
      getItem: storage.getItem.bind(storage), setItem: storage.setItem.bind(storage),
      removeItem() { throw new Error("primary marker deletion failed"); },
    };
    assert.equal(await removePendingDineInSubmission(
      failingPrimary, tokenA, { kind: "completed", orderId }, "new-order", fallback,
    ), "failed");
    assert.deepEqual(await loadPendingDineInSubmission(storage, tokenA, fallback), {
      kind: "unknown", reason: "cleanup-in-progress",
    });
    assert.deepEqual(await withDineInTableLock(tokenA, () => reconcilePendingDineInSubmission(storage, tokenA, fallback)), { kind: "none" });
  });

  it("keeps cleanup blocked and preserves both records when either store cannot be read", async () => {
    const storage = memoryStorage();
    const fallback = memoryFallback();
    const operation = createPendingDineInSubmission(createDineInIdempotencyKey(), payload());
    const marker = { version: 3, state: "cleanup", action: "abandon", idempotencyKey: operation.idempotencyKey, payloadJson: operation.payloadJson, orderId: null };
    storage.setItem(await pendingDineInStorageKey(tokenA), JSON.stringify(marker));
    await fallback.set(await deriveTableStorageId(tokenA), JSON.stringify(marker));
    const failPrimaryRead = { getItem() { throw new Error("primary read failure"); }, setItem: storage.setItem.bind(storage), removeItem: storage.removeItem.bind(storage) };
    assert.deepEqual(await withDineInTableLock(tokenA, () => reconcilePendingDineInSubmission(failPrimaryRead, tokenA, fallback)), {
      kind: "unknown", reason: "read-failed",
    });
    const failFallbackRead = { get() { throw new Error("fallback read failure"); }, set: fallback.set.bind(fallback), remove: fallback.remove.bind(fallback) };
    assert.deepEqual(await withDineInTableLock(tokenA, () => reconcilePendingDineInSubmission(storage, tokenA, failFallbackRead)), {
      kind: "unknown", reason: "fallback-failed",
    });
    assert.equal(storage.getItem(await pendingDineInStorageKey(tokenA)), JSON.stringify(marker));
    assert.equal(await fallback.get(await deriveTableStorageId(tokenA)), JSON.stringify(marker));
  });

  it("fails cleanup closed on storage read errors without deleting either store", async () => {
    const backing = memoryStorage();
    const operation = createPendingDineInSubmission(createDineInIdempotencyKey(), payload());
    const fallback = memoryFallback();
    await savePendingDineInSubmission(backing, tokenA, operation);
    await fallback.set(await deriveTableStorageId(tokenA), JSON.stringify({
      version: 2, state: "terminal-conflict", idempotencyKey: operation.idempotencyKey,
      payloadJson: operation.payloadJson,
    }));
    const failRead = {
      getItem() { throw new Error("read failed"); },
      setItem: backing.setItem.bind(backing), removeItem: backing.removeItem.bind(backing),
    };
    assert.equal(await removePendingDineInSubmission(failRead, tokenA, { kind: "pending", operation }, "abandon", fallback), "failed");
    assert.equal(backing.values.has(await pendingDineInStorageKey(tokenA)), true);
    assert.notEqual(await fallback.get(await deriveTableStorageId(tokenA)), null);
  });

  it("rejects a cleanup marker that disagrees with the stored operation", async () => {
    const storage = memoryStorage();
    const operation = createPendingDineInSubmission(createDineInIdempotencyKey(), payload());
    await savePendingDineInSubmission(storage, tokenA, operation);
    const fallback = memoryFallback();
    await fallback.set(await deriveTableStorageId(tokenA), JSON.stringify({
      version: 2, state: "terminal-conflict", idempotencyKey: operation.idempotencyKey,
      payloadJson: operation.payloadJson,
    }));
    const key = await pendingDineInStorageKey(tokenA);
    storage.setItem(key, JSON.stringify({
      version: 3, state: "cleanup", action: "abandon", idempotencyKey: createDineInIdempotencyKey(),
      payloadJson: operation.payloadJson, orderId: null,
    }));
    assert.deepEqual(await loadPendingDineInSubmission(storage, tokenA, fallback), { kind: "unknown", reason: "malformed" });
  });

  it("retries after an uncertain response with the exact same key and serialized payload", async () => {
    const operation = createPendingDineInSubmission(createDineInIdempotencyKey(), payload());
    const seen = [];
    const fetcher = async (_url, init) => {
      seen.push({ key: init.headers["idempotency-key"], body: init.body });
      if (seen.length === 1) throw new Error("network interrupted");
      return { status: 201, json: async () => ({ orderId, trackingToken: tokenA, status: "pending", createdAt: 123 }) };
    };
    const first = await postDineInSubmission(operation, fetcher);
    const second = await postDineInSubmission(operation, fetcher);
    assert.equal(first.error, "network");
    assert.equal(second.error, null);
    assert.deepEqual(seen[0], seen[1]);
    assert.equal(seen[0].body, operation.payloadJson);
  });

  it("reopened retry ignores a changed visible cart and uses the saved request", async () => {
    const storage = memoryStorage();
    const original = createPendingDineInSubmission(createDineInIdempotencyKey(), payload());
    await savePendingDineInSubmission(storage, tokenA, original);
    const reopened = await loadPendingDineInSubmission(memoryStorage(new Map(storage.values)), tokenA, memoryFallback());
    const changedVisibleCart = [{ itemId: "another-dish", quantity: 5, optionIds: [], key: "changed" }];
    assert.equal(reopened.kind, "retryable");
    assert.notDeepEqual(cartFromDineInPayload(reopened.operation.payload), changedVisibleCart);
    let sent;
    const result = await postDineInSubmission(reopened.operation, async (_url, init) => {
      sent = { key: init.headers["idempotency-key"], body: init.body };
      return { status: 200, json: async () => ({ orderId, trackingToken: tokenA, status: "pending", createdAt: 123 }) };
    });
    assert.equal(result.error, null);
    assert.deepEqual(sent, { key: original.idempotencyKey, body: original.payloadJson });
  });

  it("serializes same-table submissions and makes the waiter observe the first operation", async () => {
    const lockManager = serialLockManager();
    const storage = memoryStorage();
    const firstHasLock = {};
    firstHasLock.promise = new Promise((resolve) => { firstHasLock.resolve = resolve; });
    const releaseFirst = {};
    releaseFirst.promise = new Promise((resolve) => { releaseFirst.resolve = resolve; });
    const observations = [];
    let generated = 0;

    const first = withDineInTableLock(tokenA, async () => {
      observations.push(await loadPendingDineInSubmission(storage, tokenA, memoryFallback()));
      firstHasLock.resolve();
      await releaseFirst.promise;
      const operation = createPendingDineInSubmission(createDineInIdempotencyKey(), payload());
      generated += 1;
      await savePendingDineInSubmission(storage, tokenA, operation);
      const pending = await loadPendingDineInSubmission(storage, tokenA, memoryFallback());
      assert.equal(pending.kind, "retryable");
      await acknowledgeDineInSubmission(storage, tokenA, pending.operation, orderId, memoryFallback());
    }, lockManager);
    await firstHasLock.promise;
    const second = withDineInTableLock(tokenA, async () => {
      const state = await reconcilePendingDineInSubmission(storage, tokenA, memoryFallback());
      observations.push(state);
      if (state.kind === "none") generated += 1;
    }, lockManager);
    releaseFirst.resolve();
    await Promise.all([first, second]);

    assert.equal(observations[0].kind, "none");
    assert.equal(observations[1].kind, "completed");
    assert.equal(generated, 1);
  });

  it("allows independent table locks to proceed concurrently", async () => {
    const lockManager = serialLockManager();
    let entered = 0;
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const first = withDineInTableLock(tokenA, async () => { entered += 1; await gate; }, lockManager);
    const second = withDineInTableLock(tokenB, async () => { entered += 1; await gate; }, lockManager);
    while (entered < 2) await new Promise((resolve) => setImmediate(resolve));
    assert.equal(entered, 2);
    release();
    await Promise.all([first, second]);
  });

  it("fails closed if Web Locks are unavailable or the lock request is rejected", async () => {
    await assert.rejects(withDineInTableLock(tokenA, async () => "submitted", null), /coordination/i);
    await assert.rejects(withDineInTableLock(tokenA, async () => "submitted", {
      request: async () => { throw new Error("lock denied"); },
    }), /lock denied/);
  });

  it("recovers a persisted pending operation after a tab closes while holding its lock", async () => {
    const lockManager = serialLockManager();
    const storage = memoryStorage();
    const operation = createPendingDineInSubmission(createDineInIdempotencyKey(), payload());
    await assert.rejects(withDineInTableLock(tokenA, async () => {
      await savePendingDineInSubmission(storage, tokenA, operation);
      throw new Error("tab closed");
    }, lockManager), /tab closed/);
    const recovered = await withDineInTableLock(tokenA, () => loadPendingDineInSubmission(storage, tokenA, memoryFallback()), lockManager);
    assert.equal(recovered.kind, "retryable");
    assert.equal(recovered.operation.idempotencyKey, operation.idempotencyKey);
    assert.equal(recovered.operation.payloadJson, operation.payloadJson);
  });

  it("maps terminal idempotency and recoverable catalog conflicts separately", async () => {
    const operation = createPendingDineInSubmission(createDineInIdempotencyKey(), payload());
    const terminal = await postDineInSubmission(operation, async () => ({ status: 409, json: async () => ({ code: "idempotency_conflict" }) }));
    const catalog = await postDineInSubmission(operation, async () => ({ status: 409, json: async () => ({ code: "catalog_not_reviewed" }) }));
    assert.equal(terminal.error, "idempotency-conflict");
    assert.equal(catalog.error, "catalog-not-ready");
    assert.equal(isTerminalDineInSubmissionError(terminal.error), true);
    assert.equal(isTerminalDineInSubmissionError("table-unavailable"), true);
    assert.equal(isTerminalDineInSubmissionError(catalog.error), false);
    assert.equal(isTerminalDineInSubmissionError("network"), false);
  });

  it("accepts only valid 200/201 receipts and rejects unexpected or malformed success responses", async () => {
    const operation = createPendingDineInSubmission(createDineInIdempotencyKey(), payload());
    const valid = { orderId, trackingToken: tokenA, status: "pending", createdAt: 123 };
    for (const status of [200, 201])
      assert.equal((await postDineInSubmission(operation, async () => ({ status, json: async () => valid }))).error, null);
    for (const status of [202, 204, 299])
      assert.equal((await postDineInSubmission(operation, async () => ({ status, json: async () => valid }))).error, "server");
    for (const body of [
      null,
      { ...valid, orderId: "bad" },
      { ...valid, trackingToken: `${tokenA.slice(0, -1)}B` },
      { ...valid, status: "processing" },
      { ...valid, createdAt: "123" },
      { ...valid, createdAt: 8_640_000_000_000_001 },
      { ...valid, extra: true },
    ])
      assert.equal((await postDineInSubmission(operation, async () => ({ status: 201, json: async () => body }))).error, "server");
    assert.equal((await postDineInSubmission(operation, async () => ({ status: 201, json: async () => { throw new SyntaxError("bad json"); } }))).error, "server");
  });

  it("does not accept 503 as success", async () => {
    const operation = createPendingDineInSubmission(createDineInIdempotencyKey(), payload());
    assert.deepEqual(await postDineInSubmission(operation, async () => ({ status: 503, json: async () => ({}) })), {
      receipt: null,
      error: "unavailable",
    });
  });
});

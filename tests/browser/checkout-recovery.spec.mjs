import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { test as base, expect } from "@playwright/test";

const baseURL = process.env.CLICKMENU_CHECKOUT_BROWSER_BASE_URL;
if (!/^http:\/\/127\.0\.0\.1:\d+$/u.test(baseURL ?? ""))
  throw new Error("Checkout browser tests require an isolated loopback base URL.");
const tokenA = "A".repeat(43);
const tokenB = "C".repeat(43);
const trackingToken = Buffer.alloc(32, 7).toString("base64url");
const firstOrderId = "00000000-0000-4000-8000-000000000001";
const secondOrderId = "00000000-0000-4000-8000-000000000002";
const item = { productId: "test-product", quantity: 1, optionIds: [] };

const test = base.extend({
  isolated: async ({ browser }, provide) => {
    const session = await createBrowserSession(browser);
    try { await provide(session); }
    finally { await session.context.close(); }
  },
});

async function createBrowserSession(browser) {
  const context = await browser.newContext({ serviceWorkers: "block" });
  const requests = [];
  const blocked = [];
  const waiters = [];
  const receipts = new Map();
  let responder = null;
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== baseURL || url.pathname.startsWith("/api/")) {
      blocked.push(`${route.request().method()} ${url.origin}${url.pathname}`);
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
  });
  await context.route("**/browser-test/order-mock", async (route) => {
    if (route.request().method() !== "POST") {
      blocked.push(`unexpected method ${route.request().method()} for test order transport`);
      await route.abort("blockedbyclient");
      return;
    }
    const request = {
      key: route.request().headers()["idempotency-key"],
      body: route.request().postData() ?? "",
    };
    requests.push(request);
    waiters.shift()?.(request);
    let response;
    if (responder) response = await responder(request, requests.length - 1);
    else {
      let receipt = receipts.get(request.key);
      if (!receipt) {
        receipt = {
          orderId: requests.length === 1 ? firstOrderId : secondOrderId,
          trackingToken,
          status: "pending",
          createdAt: 1_800_000_000_000,
        };
        receipts.set(request.key, receipt);
      }
      response = { status: 201, body: receipt };
    }
    await route.fulfill({ status: response.status, contentType: "application/json", body: JSON.stringify(response.body) });
  });
  return {
    context,
    requests,
    blocked,
    setResponder(value) { responder = value; },
    nextRequest() { return new Promise((resolve) => waiters.push(resolve)); },
    assertIsolated() { assert.deepEqual(blocked, [], `blocked unexpected network requests: ${blocked.join(", ")}`); },
  };
}

async function newPage(session, token = tokenA) {
  const page = await session.context.newPage();
  await page.goto(`/browser-test/checkout/${token}`);
  return page;
}

async function openCheckout(page, { addItem = false } = {}) {
  if (addItem) await page.getByTestId("add-test-item").click();
  await page.getByTestId("open-checkout").click();
  await expect(page.locator("dialog[open]")).toBeVisible();
}

async function submitOrder(page) {
  await page.getByRole("button", { name: "Place dine-in order" }).click();
  await expect(page.getByRole("heading", { name: "Order received", exact: true })).toBeVisible();
}

async function scopedId(page, token) {
  return page.evaluate(async (tableToken) => {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(tableToken));
    return btoa(String.fromCharCode(...new Uint8Array(digest)))
      .replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
  }, token);
}

async function storageKey(page, token) {
  return `tabletap:dine-in-pending:v2:${await scopedId(page, token)}`;
}

async function readPrimary(page, token) {
  const key = await storageKey(page, token);
  return page.evaluate((storageKeyName) => {
    const value = localStorage.getItem(storageKeyName);
    return value === null ? null : JSON.parse(value);
  }, key);
}

async function readFallback(page, token) {
  const id = await scopedId(page, token);
  return page.evaluate((tableStorageId) => new Promise((resolve, reject) => {
    const request = indexedDB.open("tabletap-dine-in-recovery", 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("terminal")) request.result.createObjectStore("terminal");
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction("terminal", "readonly");
      const get = transaction.objectStore("terminal").get(tableStorageId);
      get.onsuccess = () => { resolve(get.result ?? null); db.close(); };
      get.onerror = () => { reject(get.error); db.close(); };
    };
  }), id);
}

async function seedRecords(page, token, primary, fallback) {
  const id = await scopedId(page, token);
  const key = `tabletap:dine-in-pending:v2:${id}`;
  await page.evaluate(async ({ tableStorageId, storageKeyName, primaryRecord, fallbackRecord }) => {
    if (primaryRecord === null) localStorage.removeItem(storageKeyName);
    else localStorage.setItem(storageKeyName, JSON.stringify(primaryRecord));
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("tabletap-dine-in-recovery", 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains("terminal")) request.result.createObjectStore("terminal");
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    await new Promise((resolve, reject) => {
      const transaction = db.transaction("terminal", "readwrite");
      const store = transaction.objectStore("terminal");
      if (fallbackRecord === null) store.delete(tableStorageId);
      else store.put(JSON.stringify(fallbackRecord), tableStorageId);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    db.close();
  }, { tableStorageId: id, storageKeyName: key, primaryRecord: primary, fallbackRecord: fallback });
}

async function injectFaults(page, faults) {
  await page.addInitScript((configuration) => {
    const disabledKey = "__clickmenu_browser_faults_disabled__";
    const faultDisabled = () => sessionStorage.getItem(disabledKey) === "1";
    window.__browserFaultCounts = { idbOpen: 0, idbRead: 0, idbDelete: 0, localRemove: 0 };
    const pendingPrefix = "tabletap:dine-in-pending:v2:";
    if (configuration.idbOpen) {
      const original = IDBFactory.prototype.open;
      IDBFactory.prototype.open = function (...args) {
        if (!faultDisabled()) {
          window.__browserFaultCounts.idbOpen++;
          throw new DOMException("Injected IndexedDB open failure", "UnknownError");
        }
        return original.apply(this, args);
      };
    }
    if (configuration.idbDelete > 0) {
      const original = IDBObjectStore.prototype.delete;
      IDBObjectStore.prototype.delete = function (...args) {
        if (this.name === "terminal" && !faultDisabled()) {
          window.__browserFaultCounts.idbDelete++;
          throw new DOMException("Injected IndexedDB delete failure", "UnknownError");
        }
        return original.apply(this, args);
      };
    }
    if (configuration.idbRead) {
      const original = IDBObjectStore.prototype.get;
      IDBObjectStore.prototype.get = function (...args) {
        if (this.name === "terminal" && !faultDisabled()) {
          window.__browserFaultCounts.idbRead++;
          throw new DOMException("Injected IndexedDB read failure", "UnknownError");
        }
        return original.apply(this, args);
      };
    }
    if (configuration.idbPut) {
      const original = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (value, key) {
        if (this.name === "terminal" && typeof value === "string" && value.includes('"state":"terminal-conflict"'))
          throw new DOMException("Injected IndexedDB write failure", "UnknownError");
        return original.call(this, value, key);
      };
    }
    if (configuration.localRead) {
      const original = Storage.prototype.getItem;
      Storage.prototype.getItem = function (key) {
        if (key.startsWith(pendingPrefix)) throw new DOMException("Injected localStorage read failure", "SecurityError");
        return original.call(this, key);
      };
    }
    if (configuration.localWrite) {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key.startsWith(pendingPrefix)) {
          let record;
          try { record = JSON.parse(value); } catch {}
          if (!configuration.terminalOnly || record?.state === "terminal-conflict")
            throw new DOMException("Injected localStorage write failure", "QuotaExceededError");
        }
        return original.call(this, key, value);
      };
    }
    if (configuration.localRemove > 0) {
      const original = Storage.prototype.removeItem;
      Storage.prototype.removeItem = function (key) {
        if (key.startsWith(pendingPrefix) && !faultDisabled()) {
          window.__browserFaultCounts.localRemove++;
          throw new DOMException("Injected localStorage removal failure", "QuotaExceededError");
        }
        return original.call(this, key);
      };
    }
    if (configuration.locks === "missing")
      Object.defineProperty(navigator, "locks", { configurable: true, value: null });
    if (configuration.locks === "rejected")
      Object.defineProperty(navigator, "locks", { configurable: true, value: { request: () => Promise.reject(new Error("Injected lock rejection")) } });
  }, faults);
}

function pendingRecord(token, key) {
  const payload = { tableToken: token, items: [item] };
  return { version: 2, state: "pending", idempotencyKey: key, payloadJson: JSON.stringify(payload) };
}

function cleanupRecord(action, token, key, orderId) {
  if (action === "abandon") return { ...pendingRecord(token, key), version: 3, state: "cleanup", action, orderId: null };
  return { version: 3, state: "cleanup", action, idempotencyKey: null, payloadJson: null, orderId };
}

async function waitUntilLockHeld(page, token) {
  const lockName = `tabletap:dine-in-submit:${await scopedId(page, token)}`;
  await page.evaluate((name) => {
    window.__testLockHeld = false;
    window.__releaseTestLock = null;
    window.__testLockPromise = navigator.locks.request(name, { mode: "exclusive" }, () => new Promise((resolve) => {
      window.__testLockHeld = true;
      window.__releaseTestLock = resolve;
    }));
  }, lockName);
  await expect.poll(() => page.evaluate(() => window.__testLockHeld)).toBe(true);
  return async () => page.evaluate(() => window.__releaseTestLock?.());
}

async function observeQueuedExclusiveTableLock(page, token) {
  const lockName = `tabletap:dine-in-submit:${await scopedId(page, token)}`;
  await page.evaluate((expectedName) => {
    const lockManager = navigator.locks;
    const originalRequest = lockManager.request.bind(lockManager);
    let resolveQueued;
    let rejectQueued;
    window.__queuedTableLock = false;
    window.__waitForQueuedTableLock = () => new Promise((resolve, reject) => {
      if (window.__queuedTableLock) resolve();
      else {
        const timeout = window.setTimeout(() => rejectQueued?.(new Error("Timed out waiting for a queued exclusive table lock.")), 5_000);
        resolveQueued = () => { window.clearTimeout(timeout); resolve(); };
        rejectQueued = (error) => { window.clearTimeout(timeout); reject(error); };
      }
    });
    Object.defineProperty(lockManager, "request", {
      configurable: true,
      value(name, options, callback) {
        const result = originalRequest(name, options, callback);
        if (name === expectedName && options?.mode === "exclusive") {
          void lockManager.query().then(({ pending }) => {
            if (pending.some((entry) => entry.name === expectedName && entry.mode === "exclusive")) {
              window.__queuedTableLock = true;
              resolveQueued?.();
            }
          }).catch((error) => rejectQueued?.(error));
        }
        return result;
      },
    });
  }, lockName);
}

async function assertLockReleased(page, token) {
  const lockName = `tabletap:dine-in-submit:${await scopedId(page, token)}`;
  assert.equal(await page.evaluate((name) => navigator.locks.request(name, { mode: "exclusive" }, () => true), lockName), true);
}

test("keeps the exact request until acknowledgment and recovers the original receipt after reload", async ({ isolated }) => {
  const page = await newPage(isolated);
  await openCheckout(page, { addItem: true });
  await page.getByLabel(/Your name/i).fill("Synthetic guest");
  await page.getByLabel(/Anything we should know/i).fill("Synthetic note");
  await submitOrder(page);

  const original = await readPrimary(page, tokenA);
  assert.equal(original.state, "pending");
  assert.equal(original.payloadJson, isolated.requests[0].body);
  assert.equal(original.idempotencyKey, isolated.requests[0].key);
  assert.match(original.payloadJson, /Synthetic guest/u);
  assert.equal(original.payloadJson.includes(trackingToken), false);

  await page.reload();
  await expect(page.getByTestId("pending-state")).toHaveText("retryable");
  await openCheckout(page);
  const retryRequest = isolated.nextRequest();
  await page.getByRole("button", { name: "Retry the same order" }).click();
  const replay = await retryRequest;
  assert.deepEqual(replay, isolated.requests[0]);
  await expect(page.getByRole("heading", { name: "Order received", exact: true })).toBeVisible();
  await expect(page.getByText(trackingToken, { exact: true })).toHaveCount(0);
  assert.equal((await readPrimary(page, tokenA)).payloadJson, original.payloadJson);

  await page.getByRole("button", { name: "I saved the tracking link" }).click();
  await expect(page.getByText(/Retry details were removed/u)).toBeVisible();
  const completed = await readPrimary(page, tokenA);
  assert.deepEqual(completed, { version: 2, state: "completed", orderId: firstOrderId });
  assert.equal(JSON.stringify(completed).includes("Synthetic guest"), false);
  assert.equal(JSON.stringify(completed).includes("Synthetic note"), false);
  assert.equal(JSON.stringify(completed).includes(trackingToken), false);
  const trackingKey = `tabletap:order-tracking:v1:${firstOrderId}`;
  const savedTracking = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), trackingKey);
  assert.deepEqual(savedTracking, { orderId: firstOrderId, token: trackingToken });
  assert.equal(await readFallback(page, tokenA), null);

  await page.route(`**/api/dine-in/orders/${firstOrderId}/tracking`, async (route) => {
    assert.equal(route.request().headers().authorization, `Bearer ${trackingToken}`);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      orderReference: firstOrderId.slice(-8).toUpperCase(), status: "completed", updatedAt: 1_800_000_000_000,
    }) });
  });
  await page.goto(`/track/${firstOrderId}`);
  await expect(page.getByText("Order complete", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("Order complete", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Forget this order on this browser" }).click();
  assert.equal(await page.evaluate((key) => localStorage.getItem(key), trackingKey), null);
  isolated.assertIsolated();
});

test("shows a neutral dish placeholder without requesting a fake image URL", async ({ isolated }) => {
  const page = await newPage(isolated);
  const imageRequests = [];
  page.on("request", (request) => {
    if (/\.(?:jpe?g|png|webp)(?:\?|$)/iu.test(request.url())) imageRequests.push(request.url());
  });

  const placeholder = page.getByTestId("dish-photo-placeholder").locator(".photo-fallback");
  await expect(placeholder).toHaveAttribute("aria-label", "Synthetic sandwich");
  await expect(page.getByTestId("dish-photo-placeholder").locator("img")).toHaveCount(0);
  assert.deepEqual(imageRequests, []);
  isolated.assertIsolated();
});

test("serializes a competing same-table submission and reuses the first operation", async ({ isolated }) => {
  const operation = pendingRecord(tokenA, Buffer.alloc(32, 9).toString("base64url"));
  const first = await newPage(isolated);
  await seedRecords(first, tokenA, operation, null);
  await first.reload();
  await openCheckout(first);
  await expect(first.getByTestId("pending-state")).toHaveText("retryable");

  const second = await newPage(isolated);
  await openCheckout(second);
  await expect(second.getByTestId("pending-state")).toHaveText("retryable");
  assert.deepEqual(await readPrimary(first, tokenA), await readPrimary(second, tokenA));

  let releaseResponse;
  let firstRequestArrived;
  const firstArrived = new Promise((resolve) => { firstRequestArrived = resolve; });
  isolated.setResponder(async (_request, index) => {
    if (index === 0) {
      firstRequestArrived();
      await new Promise((resolve) => { releaseResponse = resolve; });
      return { status: 201, body: { orderId: firstOrderId, trackingToken, status: "pending", createdAt: 1_800_000_000_000 } };
    }
    return { status: 200, body: { orderId: firstOrderId, trackingToken, status: "pending", createdAt: 1_800_000_000_000 } };
  });
  const firstWaiter = isolated.nextRequest();
  await first.getByRole("button", { name: "Retry the same order" }).click();
  try {
    const requestA = await firstWaiter;
    await firstArrived;
    assert.equal(requestA.key, operation.idempotencyKey);
    assert.equal(requestA.body, operation.payloadJson);

    await observeQueuedExclusiveTableLock(second, tokenA);
    const secondWaiter = isolated.nextRequest();
    await second.getByRole("button", { name: "Retry the same order" }).click();
    await second.evaluate(() => window.__waitForQueuedTableLock());
    assert.equal(await second.evaluate(() => window.__queuedTableLock), true);
    assert.equal(isolated.requests.length, 1);
    assert.deepEqual(isolated.requests[0], requestA);

    releaseResponse();
    const requestB = await secondWaiter;
    assert.deepEqual(requestB, requestA);
    await expect(first.getByRole("heading", { name: "Order received", exact: true })).toBeVisible();
    await expect(second.getByRole("heading", { name: "Order received", exact: true })).toBeVisible();
    assert.equal(isolated.requests.length, 2);
    assert.deepEqual(isolated.requests[0], requestA);
    assert.deepEqual(isolated.requests[1], requestA);

    const lockName = `tabletap:dine-in-submit:${await scopedId(first, tokenA)}`;
    assert.equal(await first.evaluate((name) => navigator.locks.request(name, { mode: "exclusive" }, () => true), lockName), true);
    isolated.assertIsolated();
  } finally {
    releaseResponse?.();
  }
});

test("different table tokens use independent real browser locks", async ({ isolated }) => {
  const first = await newPage(isolated, tokenA);
  const second = await newPage(isolated, tokenB);
  const release = await waitUntilLockHeld(first, tokenA);
  await openCheckout(second, { addItem: true });
  const pendingRequest = isolated.nextRequest();
  await second.getByRole("button", { name: "Place dine-in order" }).click();
  const submitted = await pendingRequest;
  assert.equal(JSON.parse(submitted.body).tableToken, tokenB);
  release();
  await assertLockReleased(first, tokenA);
  await assertLockReleased(second, tokenB);
  isolated.assertIsolated();
});

test("a real storage event causes the other tab to re-read pending state without exposing a receipt", async ({ isolated }) => {
  const first = await newPage(isolated);
  const second = await newPage(isolated);
  await openCheckout(first);
  await openCheckout(second, { addItem: true });
  await submitOrder(second);
  await expect(first.getByText("Your previous submission may have reached the café.")).toBeVisible();
  await expect(first.getByTestId("pending-state")).toHaveText("retryable");
  await expect(first.getByText(trackingToken, { exact: true })).toHaveCount(0);
  assert.equal(isolated.requests.length, 1);
  isolated.assertIsolated();
});

test("a stale abandonment waiting for the browser lock cannot delete a newer pending operation", async ({ isolated }) => {
  isolated.setResponder(async () => ({ status: 409, body: { code: "idempotency_conflict" } }));
  const first = await newPage(isolated);
  const second = await newPage(isolated);
  await openCheckout(first, { addItem: true });
  await first.getByRole("button", { name: "Place dine-in order" }).click();
  await expect(first.getByRole("button", { name: /Abandon this attempt/u })).toBeVisible();

  const release = await waitUntilLockHeld(second, tokenA);
  await first.getByRole("button", { name: /Abandon this attempt/u }).click();
  const newerKey = Buffer.alloc(32, 9).toString("base64url");
  const newer = pendingRecord(tokenA, newerKey);
  await second.evaluate(async ({ record, token }) => {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
    const id = btoa(String.fromCharCode(...new Uint8Array(digest))).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
    localStorage.setItem(`tabletap:dine-in-pending:v2:${id}`, JSON.stringify(record));
  }, { record: newer, token: tokenA });
  await release();
  await expect(first.getByTestId("pending-state")).toHaveText("retryable");
  assert.deepEqual(await readPrimary(first, tokenA), newer);
  assert.equal(isolated.requests.length, 1);
  isolated.assertIsolated();
});

test("a stale start-new-order action cannot clear another order's newer pending record", async ({ isolated }) => {
  const pageA = await newPage(isolated);
  const pageB = await newPage(isolated);
  await openCheckout(pageA, { addItem: true });
  await submitOrder(pageA);
  await pageA.getByRole("button", { name: "I saved my tracking code" }).click();
  await expect(pageA.getByTestId("pending-state")).toHaveText("completed");

  const release = await waitUntilLockHeld(pageB, tokenA);
  await pageA.getByRole("button", { name: "Start a new order" }).click();
  const newerKey = Buffer.alloc(32, 11).toString("base64url");
  const newer = pendingRecord(tokenA, newerKey);
  await pageB.evaluate(async ({ record, token }) => {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
    const id = btoa(String.fromCharCode(...new Uint8Array(digest))).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
    localStorage.setItem(`tabletap:dine-in-pending:v2:${id}`, JSON.stringify(record));
  }, { record: newer, token: tokenA });
  await release();
  await expect(pageA.getByTestId("pending-state")).toHaveText("retryable");
  assert.deepEqual(await readPrimary(pageA, tokenA), newer);
  isolated.assertIsolated();
});

for (const action of ["abandon", "new-order"]) {
  test(`real IndexedDB resumes ${action} cleanup after repeated interrupted tombstone promotion`, async ({ isolated }) => {
    const page = await newPage(isolated);
    const operationKey = Buffer.alloc(32, action === "abandon" ? 12 : 13).toString("base64url");
    const initial = null;
    const marker = cleanupRecord(action, tokenA, operationKey, firstOrderId);
    await seedRecords(page, tokenA, initial, marker);
    assert.equal(await readPrimary(page, tokenA), null);
    assert.equal(await readFallback(page, tokenA), JSON.stringify(marker));
    const unrelatedKey = Buffer.alloc(32, 14).toString("base64url");
    await seedRecords(page, tokenB, pendingRecord(tokenB, unrelatedKey), null);
    await injectFaults(page, { idbDelete: 2 });
    await page.reload();
    assert.ok((await page.evaluate(() => window.__browserFaultCounts.idbDelete)) > 0, "IndexedDB delete fault injection must run.");
    await expect(page.getByTestId("pending-state")).toHaveText("unknown");
    assert.deepEqual(await readPrimary(page, tokenA), marker);
    assert.equal(await readFallback(page, tokenA), JSON.stringify(marker));

    await page.reload();
    await expect(page.getByTestId("pending-state")).toHaveText("unknown");
    assert.deepEqual(await readPrimary(page, tokenA), marker);
    assert.equal(await readFallback(page, tokenA), JSON.stringify(marker));

    await page.evaluate(() => sessionStorage.setItem("__clickmenu_browser_faults_disabled__", "1"));
    await page.reload();
    await expect(page.getByTestId("pending-state")).toHaveText("none");
    assert.equal(await readPrimary(page, tokenA), null);
    assert.equal(await readFallback(page, tokenA), null);
    assert.equal((await readPrimary(page, tokenB)).idempotencyKey, unrelatedKey);
    isolated.assertIsolated();
  });
}

for (const action of ["abandon", "new-order"]) {
test(`real localStorage primary-tombstone deletion failure resumes ${action} after reload`, async ({ isolated }) => {
  const page = await newPage(isolated);
  const operationKey = Buffer.alloc(32, 15).toString("base64url");
  const marker = cleanupRecord(action, tokenA, operationKey, firstOrderId);
  await seedRecords(page, tokenA, marker, marker);
  await injectFaults(page, { localRemove: 1 });
  await page.reload();
  assert.ok((await page.evaluate(() => window.__browserFaultCounts.localRemove)) > 0, "localStorage delete fault injection must run.");
  await expect(page.getByTestId("pending-state")).toHaveText("unknown");
  assert.deepEqual(await readPrimary(page, tokenA), marker);
  assert.equal(await readFallback(page, tokenA), null);
  await page.evaluate(() => sessionStorage.setItem("__clickmenu_browser_faults_disabled__", "1"));
  await page.reload();
  await expect(page.getByTestId("pending-state")).toHaveText("none");
  assert.equal(await readPrimary(page, tokenA), null);
  await assertLockReleased(page, tokenA);
  isolated.assertIsolated();
});
}

test("mismatched real-browser tombstones remain blocked and unchanged", async ({ isolated }) => {
  const page = await newPage(isolated);
  const keyA = Buffer.alloc(32, 16).toString("base64url");
  const keyB = Buffer.alloc(32, 17).toString("base64url");
  const primary = cleanupRecord("abandon", tokenA, keyA, null);
  const fallback = cleanupRecord("abandon", tokenA, keyB, null);
  await seedRecords(page, tokenA, primary, fallback);
  await page.reload();
  await expect(page.getByTestId("pending-state")).toHaveText("unknown");
  assert.deepEqual(await readPrimary(page, tokenA), primary);
  assert.equal(await readFallback(page, tokenA), JSON.stringify(fallback));
  isolated.assertIsolated();
});

test("IndexedDB open and localStorage read failures fail closed without a request", async ({ isolated }) => {
  const page = await newPage(isolated);
  await injectFaults(page, { idbOpen: true });
  await page.reload();
  assert.ok((await page.evaluate(() => window.__browserFaultCounts.idbOpen)) > 0, "IndexedDB open fault injection must run.");
  await expect(page.getByTestId("pending-state")).toHaveText("unknown");
  await openCheckout(page, { addItem: true });
  await expect(page.getByRole("button", { name: "Place dine-in order" })).toHaveCount(0);
  assert.equal(isolated.requests.length, 0);
  await assertLockReleased(page, tokenA);

  const second = await isolated.context.newPage();
  await second.addInitScript(() => {
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = function (key) {
      if (key.startsWith("tabletap:dine-in-pending:v2:")) throw new DOMException("read denied", "SecurityError");
      return original.call(this, key);
    };
  });
  await second.goto(`/browser-test/checkout/${tokenA}`);
  await expect(second.getByTestId("pending-state")).toHaveText("unknown");
  assert.equal(isolated.requests.length, 0);

  const third = await isolated.context.newPage();
  await third.addInitScript(() => {
    const original = IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get = function (...args) {
      if (this.name === "terminal") throw new DOMException("read denied", "UnknownError");
      return original.apply(this, args);
    };
  });
  await third.goto(`/browser-test/checkout/${tokenB}`);
  await expect(third.getByTestId("pending-state")).toHaveText("unknown");
  assert.equal(isolated.requests.length, 0);
  isolated.assertIsolated();
});

test("localStorage pending-write failure prevents the order API request", async ({ isolated }) => {
  const page = await newPage(isolated);
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith("tabletap:dine-in-pending:v2:")) throw new DOMException("quota", "QuotaExceededError");
      return original.call(this, key, value);
    };
  });
  await page.reload();
  await expect(page.getByTestId("pending-state")).toHaveText("none");
  await openCheckout(page, { addItem: true });
  await page.getByRole("button", { name: "Place dine-in order" }).click();
  await expect(page.getByTestId("pending-state")).toHaveText("unknown");
  assert.equal(isolated.requests.length, 0);
  isolated.assertIsolated();
});

test("terminal localStorage and IndexedDB write failures remain blocked without another request", async ({ isolated }) => {
  isolated.setResponder(async () => ({ status: 409, body: { code: "idempotency_conflict" } }));
  const page = await newPage(isolated);
  await page.addInitScript(() => {
    const originalSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith("tabletap:dine-in-pending:v2:") && JSON.parse(value).state === "terminal-conflict")
        throw new DOMException("quota", "QuotaExceededError");
      return originalSet.call(this, key, value);
    };
    const originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      if (this.name === "terminal" && typeof value === "string" && value.includes('"state":"terminal-conflict"'))
        throw new DOMException("disk full", "QuotaExceededError");
      return originalPut.call(this, value, key);
    };
  });
  await page.reload();
  await expect(page.getByTestId("pending-state")).toHaveText("none");
  await openCheckout(page, { addItem: true });
  await page.getByRole("button", { name: "Place dine-in order" }).click();
  await expect(page.getByTestId("pending-state")).toHaveText("unknown");
  assert.equal(isolated.requests.length, 1);
  const retained = await readPrimary(page, tokenA);
  assert.equal(retained.state, "pending");
  const originalKey = retained.idempotencyKey;
  await expect(page.getByRole("button", { name: "Place dine-in order" })).toHaveCount(0);
  assert.equal((await readPrimary(page, tokenA)).idempotencyKey, originalKey);
  isolated.assertIsolated();
});

for (const mode of ["missing", "rejected"]) {
  test(`fails closed when browser Web Locks are ${mode}`, async ({ isolated }) => {
    const page = await newPage(isolated);
    await page.addInitScript((lockMode) => {
      if (lockMode === "missing") Object.defineProperty(navigator, "locks", { configurable: true, value: null });
      else Object.defineProperty(navigator, "locks", {
        configurable: true,
        value: { request: () => Promise.reject(new Error("lock rejected")) },
      });
    }, mode);
    await page.reload();
    await expect(page.getByTestId("pending-state")).toHaveText("unknown");
    assert.equal(isolated.requests.length, 0);
    isolated.assertIsolated();
  });
}

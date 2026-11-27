import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import "../../support/register-types.mjs";

const requireTs = createRequire(import.meta.url);
const { createCustomerDineInTrackingGetHandler } = requireTs("../../../features/orders/order-tracking-api.ts");
const {
  fetchCustomerOrderTrackingStatus,
  forgetTrackingCapability,
  isTerminalCustomerOrderStatus,
  loadTrackingCapability,
  parseCustomerOrderTrackingStatus,
  resolveTrackingCapability,
  saveTrackingCapability,
  trackingLink,
  trackingTokenFromHash,
} = requireTs("../../../features/storefront/order-tracking.ts");

const id = "00000000-0000-4000-8000-000000000001";
const token = "A".repeat(43);
const status = { orderReference: "00000001", status: "pending", updatedAt: 123 };

function request(auth) {
  return new Request(`https://clickmenu.example/api/dine-in/orders/${id}/tracking`, {
    headers: auth ? { authorization: auth } : {},
  });
}

function handler(getStatus) {
  return createCustomerDineInTrackingGetHandler({
    getStatus,
    getRateLimitStore: () => ({ hit: () => 1 }),
    getClientIp: () => "127.0.0.1",
  });
}

describe("customer order tracking", () => {
  it("requires a bearer capability and returns the same generic response for missing, wrong, and unknown access", async () => {
    const get = handler(async (orderId, providedToken) =>
      orderId === id && providedToken === token ? status : null,
    );
    const responses = await Promise.all([
      get(request(), { params: Promise.resolve({ id }) }),
      get(request("Bearer " + "B".repeat(43)), { params: Promise.resolve({ id }) }),
      get(request(`Bearer ${token}`), { params: Promise.resolve({ id: "00000000-0000-4000-8000-000000000099" }) }),
      get(request(`Bearer ${token}`), { params: Promise.resolve({ id: "1" }) }),
    ]);
    for (const response of responses) {
      assert.equal(response.status, 404);
      assert.deepEqual(await response.json(), { error: "Order tracking is unavailable." });
    }
  });

  it("returns only customer tracking fields for the correct capability", async () => {
    const get = handler(async () => ({ ...status }));
    const response = await get(request(`Bearer ${token}`), { params: Promise.resolve({ id }) });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), status);
  });

  it("reads the capability from a refresh-safe URL fragment and rejects added sensitive fields", () => {
    assert.equal(trackingTokenFromHash(`#${token}`), token);
    assert.equal(trackingTokenFromHash("#bad"), null);
    assert.equal(resolveTrackingCapability(`#${token}`, null, id), token);
    assert.equal(trackingLink("https://clickmenu.example", `/track/${id}`, token), `https://clickmenu.example/track/${id}#${token}`);
    assert.deepEqual(parseCustomerOrderTrackingStatus(status), status);
    assert.equal(parseCustomerOrderTrackingStatus({ ...status, customerNotes: "secret" }), null);
    assert.equal(isTerminalCustomerOrderStatus("completed"), true);
    assert.equal(isTerminalCustomerOrderStatus("rejected"), true);
    assert.equal(isTerminalCustomerOrderStatus("cancelled"), true);
    assert.equal(isTerminalCustomerOrderStatus("preparing"), false);
  });

  it("persists the minimal per-order capability for restart recovery, prefers the fragment, and supports forgetting", () => {
    const values = new Map();
    const storage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    };
    assert.equal(saveTrackingCapability(storage, id, token), true);
    const persisted = JSON.parse(values.get(`tabletap:order-tracking:v1:${id}`));
    assert.deepEqual(Object.keys(persisted).sort(), ["orderId", "token"]);
    assert.equal(loadTrackingCapability(storage, id), token);
    assert.equal(isTerminalCustomerOrderStatus("completed"), true);
    assert.equal(loadTrackingCapability(storage, id), token, "terminal status does not remove saved access");
    // A new storage adapter models a browser restart with the same profile data.
    const restartedProfile = { ...storage };
    assert.equal(resolveTrackingCapability("", restartedProfile, id), token);
    assert.equal(resolveTrackingCapability(`#${"B".repeat(43)}`, storage, id), "B".repeat(43));
    assert.equal(resolveTrackingCapability("#bad", storage, id), null);
    assert.equal(loadTrackingCapability(storage, "00000000-0000-4000-8000-000000000002"), null);
    assert.equal(saveTrackingCapability(storage, "00000000-0000-4000-8000-000000000002", token), true);
    assert.equal(loadTrackingCapability(storage, "00000000-0000-4000-8000-000000000002"), token);
    values.set(`tabletap:order-tracking:v1:${id}`, JSON.stringify({ orderId: "00000000-0000-4000-8000-000000000002", token }));
    assert.equal(loadTrackingCapability(storage, id), null);
    values.set(`tabletap:order-tracking:v1:${id}`, JSON.stringify(persisted));
    assert.equal(forgetTrackingCapability(storage, id), true);
    assert.equal(loadTrackingCapability(storage, id), null);
    assert.equal(resolveTrackingCapability("", null, id), null);
    const unavailable = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } };
    assert.equal(saveTrackingCapability(unavailable, id, token), false);
    assert.equal(loadTrackingCapability(unavailable, id), null);
    assert.equal(forgetTrackingCapability(unavailable, id), false);
  });

  it("keeps server-side rate limiting enabled", async () => {
    let hits = 0;
    const get = createCustomerDineInTrackingGetHandler({
      getStatus: async () => status,
      getRateLimitStore: () => ({ hit: () => { hits += 1; return 61; } }),
      getClientIp: () => "127.0.0.1",
    });
    const response = await get(request(`Bearer ${token}`), { params: Promise.resolve({ id }) });
    assert.equal(response.status, 429);
    assert.equal(hits, 1);
    assert.deepEqual(await response.json(), { error: "Please wait before checking this order again." });
  });

  it("reloads status from the server without sending the token in the URL or cookies", async () => {
    const responses = [status, { ...status, status: "confirmed", updatedAt: 456 }];
    const requests = [];
    const fetcher = async (url, options) => {
      requests.push({ url, options });
      return Response.json(responses.shift());
    };
    const first = await fetchCustomerOrderTrackingStatus(id, token, fetcher);
    const afterReload = await fetchCustomerOrderTrackingStatus(id, token, fetcher);
    assert.equal(first.status, "pending");
    assert.equal(afterReload.status, "confirmed");
    for (const sent of requests) {
      assert.equal(sent.url, `/api/dine-in/orders/${id}/tracking`);
      assert.equal(sent.options.headers.Authorization, `Bearer ${token}`);
      assert.equal(sent.options.cache, "no-store");
      assert.equal(sent.options.credentials, "omit");
    }
  });
});

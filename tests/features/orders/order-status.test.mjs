import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import "../../support/register-types.mjs";

const requireTs = createRequire(import.meta.url);
const {
  DineInOrderTransitionConflict,
  createDineInOrderStatusPatchHandler,
  isAllowedDineInOrderTransition,
} = requireTs("../../../features/orders/order-status.ts");

const id = "10000000-0000-4000-8000-000000000001";
const origin = "https://clickmenu.example";

function request(body, options = {}) {
  return new Request(`${origin}/api/admin/dine-in/orders/${id}`, {
    method: "PATCH",
    headers: {
      origin: options.origin ?? origin,
      "content-type": "application/json",
    },
    body: options.rawBody ?? JSON.stringify(body),
  });
}

function patchHandler({ user = { name: "The Hood" }, updateStatus = async (orderId, status) => ({ orderId, status }) } = {}) {
  return createDineInOrderStatusPatchHandler({
    getCurrentUser: async () => user,
    updateStatus,
  });
}

function context(orderId = id) {
  return { params: Promise.resolve({ id: orderId }) };
}

describe("normalized dine-in order status updates", () => {
  it("allows exactly the directed status transitions", () => {
    const allowed = [
      ["pending", "confirmed"], ["pending", "rejected"], ["pending", "cancelled"],
      ["confirmed", "preparing"], ["confirmed", "cancelled"],
      ["preparing", "completed"], ["preparing", "cancelled"],
    ];
    const statuses = ["pending", "confirmed", "rejected", "preparing", "completed", "cancelled"];
    for (const current of statuses) {
      for (const target of statuses)
        assert.equal(isAllowedDineInOrderTransition(current, target), allowed.some(([from, to]) => from === current && to === target), `${current} -> ${target}`);
    }
    assert.equal(isAllowedDineInOrderTransition("unknown", "confirmed"), false);
  });

  it("authenticates before UUID validation and database access", async () => {
    let updateCalls = 0;
    const patch = patchHandler({
      user: null,
      updateStatus: async () => { updateCalls += 1; return null; },
    });
    const response = await patch(request({ status: "confirmed" }), context("bad-id"));
    assert.equal(response.status, 401);
    assert.equal(updateCalls, 0);
  });

  it("rejects invalid UUIDs without querying", async () => {
    let updateCalls = 0;
    const patch = patchHandler({ updateStatus: async () => { updateCalls += 1; return null; } });
    const response = await patch(request({ status: "confirmed" }), context("../../legacy"));
    assert.equal(response.status, 400);
    assert.equal(updateCalls, 0);
  });

  it("rejects malformed JSON, wrong content type, extra fields, and unknown targets", async () => {
    const patch = patchHandler({ updateStatus: async () => { throw new Error("must not query"); } });
    for (const [req, expected] of [
      [request(null, { rawBody: "{" }), 400],
      [new Request(`${origin}/api/admin/dine-in/orders/${id}`, {
        method: "PATCH", headers: { origin }, body: JSON.stringify({ status: "confirmed" }),
      }), 415],
      [request({ status: "confirmed", currentStatus: "pending" }), 400],
      [request({ status: "pending" }), 400],
      [request({ status: "placed" }), 400],
      [request({}), 400],
    ]) {
      const response = await patch(req, context());
      assert.equal(response.status, expected);
    }
  });

  it("requires same origin before calling the updater", async () => {
    let updateCalls = 0;
    const patch = patchHandler({ updateStatus: async () => { updateCalls += 1; return null; } });
    const response = await patch(request({ status: "confirmed" }, { origin: "https://attacker.example" }), context());
    assert.equal(response.status, 403);
    assert.equal(updateCalls, 0);
  });

  it("returns only the persisted order ID and status with no-store headers", async () => {
    let received;
    const patch = patchHandler({
      updateStatus: async (orderId, status) => {
        received = { orderId, status };
        return { orderId, status };
      },
    });
    const response = await patch(request({ status: "confirmed" }), context());
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(received, { orderId: id, status: "confirmed" });
    assert.deepEqual(await response.json(), { orderId: id, status: "confirmed" });
  });

  it("returns 404 for a valid missing ID and 409 for a disallowed persisted transition", async () => {
    const missing = await patchHandler({ updateStatus: async () => null })(
      request({ status: "confirmed" }), context(),
    );
    assert.equal(missing.status, 404);
    const conflict = await patchHandler({ updateStatus: async () => { throw new DineInOrderTransitionConflict(); } })(
      request({ status: "rejected" }), context(),
    );
    assert.equal(conflict.status, 409);
    assert.deepEqual(await conflict.json(), {
      error: "The order cannot be changed to the requested status from its current status.",
    });
  });

  it("hides database failures behind the generic safe response", async () => {
    const response = await patchHandler({
      updateStatus: async () => { throw new Error("SQL params and private connection details"); },
    })(request({ status: "confirmed" }), context());
    assert.equal(response.status, 503);
    assert.doesNotMatch(await response.text(), /SQL params|private connection/iu);
  });
});

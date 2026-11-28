import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import "../../support/register-types.mjs";

const requireTs = createRequire(import.meta.url);
const { getDineInOrderCardActions, requiresDineInDestructiveConfirmation, requestDineInOrderCardAction } = requireTs("../../../features/admin/dine-in-order-card-actions.ts");

describe("admin dine-in order card actions", () => {
  it("shows only the requested primary and Reject actions for each status", () => {
    assert.deepEqual(getDineInOrderCardActions("pending"), ["confirm_and_prepare", "rejected"]);
    assert.deepEqual(getDineInOrderCardActions("confirmed"), ["preparing"]);
    assert.deepEqual(getDineInOrderCardActions("preparing"), ["completed"]);
    for (const status of ["completed", "rejected", "cancelled"])
      assert.deepEqual(getDineInOrderCardActions(status), []);
    assert.equal(requiresDineInDestructiveConfirmation("rejected"), true);
    assert.equal(requiresDineInDestructiveConfirmation("cancelled"), true);
    assert.equal(requiresDineInDestructiveConfirmation("completed"), false);
  });
});
const orderId = "00000000-0000-4000-8000-000000000001";

describe("admin order card actions", () => {
  it("sends one confirm-and-prepare request with the current list revision", async () => {
    let request;
    const result = await requestDineInOrderCardAction(orderId, { confirmAndPrepareRevision: 123 }, async (url, options) => {
      request = { url: String(url), options };
      return Response.json({ orderId, status: "preparing", revision: 124 });
    });
    assert.deepEqual(request, {
      url: `/api/admin/dine-in/orders/${orderId}`,
      options: {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "confirm_and_prepare", revision: 123 }),
      },
    });
    assert.deepEqual(result, { error: null, status: "preparing", revision: 124 });
  });

  it("sends ordinary status transitions unchanged and maps authorization/conflict errors", async () => {
    const payloads = [];
    const ordinary = await requestDineInOrderCardAction(orderId, { status: "completed" }, async (_url, options) => {
      payloads.push(options.body);
      return Response.json({ orderId, status: "completed" });
    });
    const unauthorized = await requestDineInOrderCardAction(orderId, { status: "cancelled" }, async () => new Response(null, { status: 401 }));
    const conflict = await requestDineInOrderCardAction(orderId, { confirmAndPrepareRevision: 123 }, async () => new Response(null, { status: 409 }));
    assert.deepEqual(payloads, [JSON.stringify({ status: "completed" })]);
    assert.deepEqual(ordinary, { error: null, status: "completed", revision: null });
    assert.equal(unauthorized.error, "unauthorized");
    assert.equal(conflict.error, "conflict");
  });
});

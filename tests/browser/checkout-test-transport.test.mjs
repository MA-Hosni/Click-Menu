import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);
require("../../tests/support/register-types.mjs");
const { postBrowserTestSubmission } = require("./checkout-test-transport.ts");
const operation = {
  idempotencyKey: Buffer.alloc(32, 1).toString("base64url"),
  payloadJson: JSON.stringify({ tableToken: "A".repeat(43), items: [{ productId: "synthetic", quantity: 1, optionIds: [] }] }),
};
const receipt = {
  orderId: "00000000-0000-4000-8000-000000000001",
  trackingToken: Buffer.alloc(32, 2).toString("base64url"),
  status: "pending",
  createdAt: 1_800_000_000_000,
};

test("test transport uses only its mock URL and rejects redirect behavior", async () => {
  let observed;
  const result = await postBrowserTestSubmission(operation, async (url, init) => {
    observed = { url, init };
    return new Response(JSON.stringify(receipt), { status: 201, headers: { "content-type": "application/json" } });
  });
  assert.equal(observed.url, "/browser-test/order-mock");
  assert.equal(observed.init.redirect, "error");
  assert.deepEqual(result.receipt, receipt);

  const redirectResult = await postBrowserTestSubmission(operation, async (_url, init) => {
    assert.equal(init.redirect, "error");
    throw new TypeError("synthetic redirect rejection");
  });
  assert.equal(redirectResult.receipt, null);
  assert.equal(redirectResult.error, "network");
});

test("a missing test mock handler cannot create a receipt", async () => {
  const result = await postBrowserTestSubmission(operation, async () => new Response("not found", { status: 404 }));
  assert.equal(result.receipt, null);
  assert.equal(result.error, "server");
});

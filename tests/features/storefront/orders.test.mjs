import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import "../../support/register-types.mjs";

const requireTs = createRequire(import.meta.url);
const { createSeedCatalog } = requireTs("../../../lib/menu-data.ts");
const { addToCart } = requireTs("../../../lib/cart.ts");
const {
  buildOrderRecord,
  OrderValidationError,
  parseStatusChange,
} = requireTs("../../../lib/orders.ts");

const catalog = createSeedCatalog();
const item = catalog.items.find((candidate) => candidate.available);
const details = {
  name: "Test Customer",
  type: "takeaway",
  table: "",
  address: "",
  notes: "",
};
const id = "a".repeat(32);

describe("order validation", () => {
  it("creates orders using current catalog prices, not browser prices", () => {
    const cart = addToCart([], item, [], 2).map((entry) => ({
      ...entry,
      price: 1,
      total: 2,
    }));
    const order = buildOrderRecord({ id, cart, details, language: "fr" }, catalog, 123);

    assert.equal(order.createdAt, 123);
    assert.equal(order.status, "new");
    assert.equal(order.itemCount, 2);
    assert.equal(order.subtotal, item.price * 2);
    assert.equal(order.total, item.price * 2);
    assert.equal(order.language, "fr");
  });

  it("rejects unavailable and nonexistent items", () => {
    for (const itemId of ["missing", catalog.items.find((candidate) => !candidate.available)?.id]) {
      if (!itemId) continue;
      assert.throws(
        () => buildOrderRecord({ id, cart: [{ itemId, quantity: 1, optionIds: [] }], details }, catalog),
        /no available dishes/i,
      );
    }
  });

  it("rejects malformed order details and IDs", () => {
    assert.throws(
      () => buildOrderRecord({ id, cart: addToCart([], item), details: { ...details, name: "" } }, catalog),
      OrderValidationError,
    );
    assert.throws(
      () => buildOrderRecord({ id, cart: addToCart([], item), details: { ...details, type: "dine-in", table: "!" } }, catalog),
      OrderValidationError,
    );
    assert.throws(
      () => buildOrderRecord({ id: "bad", cart: addToCart([], item), details }, catalog),
      /invalid reference/i,
    );
  });

  it("accepts known status changes and rejects invalid IDs or statuses", () => {
    assert.deepEqual(parseStatusChange({ id, status: "preparing" }), {
      id,
      status: "preparing",
    });
    assert.throws(() => parseStatusChange({ id: "bad", status: "done" }), OrderValidationError);
    assert.throws(() => parseStatusChange({ id, status: "shipped" }), OrderValidationError);
  });
});

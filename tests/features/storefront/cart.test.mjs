import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import "../../support/register-types.mjs";

const requireTs = createRequire(import.meta.url);
const { createSeedCatalog } = requireTs("../../../lib/menu-data.ts");
const {
  addToCart,
  calculateCart,
  sanitizeCart,
  updateCartQuantity,
} = requireTs("../../../lib/cart.ts");

const catalog = createSeedCatalog();
const item = catalog.items.find((candidate) => candidate.available);
const option = item.options[0];

describe("storefront cart", () => {
  it("adds items and merges identical item-option combinations", () => {
    let cart = addToCart([], item, [option.id], 2);
    cart = addToCart(cart, item, [option.id, option.id], 3);

    assert.equal(cart.length, 1);
    assert.equal(cart[0].quantity, 5);
    assert.deepEqual(cart[0].optionIds, [option.id]);
  });

  it("clamps added quantities and ignores invalid quantities on updates", () => {
    const cart = addToCart([], item, [], 120);
    assert.equal(cart[0].quantity, 99);
    assert.equal(addToCart([], item, [], Number.NaN)[0].quantity, 1);
    assert.equal(updateCartQuantity(cart, cart[0].key, Infinity), cart);
    assert.equal(updateCartQuantity(cart, cart[0].key, 0).length, 0);
    assert.equal(updateCartQuantity(cart, cart[0].key, 4.9)[0].quantity, 4);
  });

  it("rejects unavailable items and sanitizes stale browser data", () => {
    const unavailable = { ...item, available: false };
    assert.deepEqual(addToCart([], unavailable), []);

    const restored = sanitizeCart(
      [
        { itemId: item.id, quantity: 2, optionIds: [option.id, "forged"] },
        { itemId: "missing", quantity: 1, optionIds: [] },
        { itemId: item.id, quantity: 0, optionIds: [] },
      ],
      catalog.items,
    );
    assert.equal(restored.length, 1);
    assert.equal(restored[0].quantity, 2);
    assert.deepEqual(restored[0].optionIds, [option.id]);
  });

  it("includes option pricing, delivery fees, and correct totals", () => {
    const cart = addToCart([], item, [option.id], 2);
    const totals = calculateCart(cart, catalog.items, catalog.settings.deliveryFee);
    const expectedSubtotal = (item.price + option.price) * 2;

    assert.equal(totals.itemCount, 2);
    assert.equal(totals.subtotal, expectedSubtotal);
    assert.equal(totals.deliveryFee, catalog.settings.deliveryFee);
    assert.equal(totals.total, expectedSubtotal + catalog.settings.deliveryFee);
    assert.equal(
      calculateCart([], catalog.items, catalog.settings.deliveryFee).deliveryFee,
      0,
    );
  });
});

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import "../../support/register-types.mjs";

const requireTs = createRequire(import.meta.url);
const { POST } = requireTs("../../../app/api/orders/route.ts");
const { createAdminLegacyHistoryGetHandler } = requireTs("../../../lib/legacy-order-history.ts");
const { withStatus } = requireTs("../../../lib/orders.ts");

async function submitLegacyOrder(orderType) {
  return POST(new Request("http://localhost/api/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: "a".repeat(32),
      shop: "the-hood",
      details: { name: "Test customer", type: orderType },
      cart: [{ itemId: "burger", quantity: 1 }],
    }),
  }));
}

describe("retired legacy order endpoint", () => {
  it("rejects delivery submissions without creating an order", async () => {
    const response = await submitLegacyOrder("delivery");
    assert.equal(response.status, 410);
    assert.match((await response.json()).error, /no longer supported/i);
  });

  it("rejects takeaway submissions without creating an order", async () => {
    const response = await submitLegacyOrder("takeaway");
    assert.equal(response.status, 410);
    assert.match((await response.json()).error, /no longer supported/i);
  });

  it("does not trigger WhatsApp even when the request includes a WhatsApp URL", async () => {
    const response = await POST(new Request("http://localhost/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "b".repeat(32),
        whatsapp: "https://wa.me/21612345678",
        details: { type: "dine-in", table: "1" },
      }),
    }));
    assert.equal(response.status, 410);
    assert.equal(response.headers.get("Location"), null);
  });

  it("continues to decode historical legacy order records", () => {
    const archived = {
      id: "c".repeat(32), createdAt: 456, status: "new", language: "fr",
      name: "Historique", type: "delivery", address: "historic address",
      lines: [{ name: "Old item", options: [], quantity: 1, total: 12000 }],
      subtotal: 10000, deliveryFee: 2000, total: 12000, itemCount: 1,
    };
    const decoded = withStatus(archived);
    assert.equal(decoded.id, archived.id);
    assert.equal(decoded.total, 12000);
    assert.equal(decoded.address, "historic address");
    assert.equal(decoded.deliveryFee, 2000);
  });

  it("keeps historical records readable through the authenticated admin history API only", async () => {
    const historical = {
      id: "d".repeat(32), createdAt: 789, status: "new", language: "en",
      name: "Archived customer", type: "delivery", address: "archived address",
      notes: "Old note", lines: [{ name: "Old item", options: [], quantity: 1, total: 15000 }],
      subtotal: 10000, deliveryFee: 5000, total: 15000, itemCount: 1,
    };
    const GET = createAdminLegacyHistoryGetHandler({
      getCurrentUser: async () => ({ name: "Administrator" }),
      listOrders: async () => [withStatus(historical)],
    });
    const response = await GET();
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.orders[0].id, historical.id);
    assert.equal(body.orders[0].lines[0].name, "Old item");
    assert.equal(body.orders[0].lines[0].quantity, 1);
    assert.equal("total" in body.orders[0], false);
    assert.equal("total" in body.orders[0].lines[0], false);
    assert.equal("type" in body.orders[0], false);
    assert.equal("address" in body.orders[0], false);
    assert.equal("deliveryFee" in body.orders[0], false);
  });
});

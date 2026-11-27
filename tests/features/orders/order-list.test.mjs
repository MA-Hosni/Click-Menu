import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import "../../support/register-types.mjs";

const requireTs = createRequire(import.meta.url);
const {
  createDineInOrderListGetHandler,
  parseDineInOrderListOptions,
} = requireTs("../../../features/orders/order-list.ts");

const sampleOrder = {
  orderId: "00000000-0000-4000-8000-000000000001",
  createdAt: "1790000000000",
  status: "pending",
  customerName: "Guest",
  tableLabel: "Patio 1",
  totalMillimes: 4250,
};

function request(query = "") {
  return new Request(`https://clickmenu.example/api/admin/dine-in/orders${query}`);
}

describe("normalized dine-in order listing API", () => {
  it("requires an authenticated singleton administrator before parsing or querying", async () => {
    let listCalls = 0;
    const get = createDineInOrderListGetHandler({
      getCurrentUser: async () => null,
      list: async () => { listCalls += 1; return { orders: [], nextCursor: null }; },
    });
    const response = await get(request("?status=invalid"));
    assert.equal(response.status, 401);
    assert.equal(listCalls, 0);
  });

  it("returns only normalized order summaries and the pagination contract", async () => {
    let received;
    const get = createDineInOrderListGetHandler({
      getCurrentUser: async () => ({ name: "The Hood administrator" }),
      list: async (options) => {
        received = options;
        return { orders: [sampleOrder], nextCursor: "next-page" };
      },
    });
    const response = await get(request());
    assert.equal(response.status, 200);
    assert.deepEqual(received, { limit: 25, status: null, cursor: null });
    assert.deepEqual(await response.json(), {
      orders: [sampleOrder],
      pagination: { limit: 25, nextCursor: "next-page" },
    });
    assert.equal(response.headers.get("cache-control"), "no-store");
  });

  it("passes valid status and maximum page size to the query", async () => {
    assert.deepEqual(
      parseDineInOrderListOptions(new URL("https://clickmenu.example/?status=preparing&limit=100")),
      { limit: 100, status: "preparing", cursor: null },
    );
  });

  it("rejects unsupported, duplicate, or malformed query parameters", () => {
    for (const query of [
      "?status=placed",
      "?status=pending&status=completed",
      "?limit=0",
      "?limit=101",
      "?limit=1.5",
      "?limit=999999999999999999999",
      "?offset=10",
      "?cursor=%%%",
    ]) {
      assert.throws(
        () => parseDineInOrderListOptions(new URL(`https://clickmenu.example/${query}`)),
        { status: 400 },
        query,
      );
    }
  });

  it("rejects a cursor bound to a different status filter", () => {
    const encoded = Buffer.from(JSON.stringify({
      v: 1,
      status: "pending",
      createdAt: "1790000000000",
      orderId: sampleOrder.orderId,
    })).toString("base64url");
    assert.throws(
      () => parseDineInOrderListOptions(new URL(`https://clickmenu.example/?status=completed&cursor=${encoded}`)),
      { status: 400 },
    );
  });

  it("returns empty history and last-page results without a next cursor", async () => {
    const get = createDineInOrderListGetHandler({
      getCurrentUser: async () => ({ name: "Admin" }),
      list: async () => ({ orders: [], nextCursor: null }),
    });
    const empty = await get(request("?status=rejected"));
    assert.deepEqual(await empty.json(), { orders: [], pagination: { limit: 25, nextCursor: null } });

    const lastPage = createDineInOrderListGetHandler({
      getCurrentUser: async () => ({ name: "Admin" }),
      list: async () => ({ orders: [sampleOrder], nextCursor: null }),
    });
    const response = await lastPage(request("?limit=1"));
    assert.equal((await response.json()).pagination.nextCursor, null);
  });
});

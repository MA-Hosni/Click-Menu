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
  revision: 1790000000100,
  customerNotes: null,
  items: [],
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
    assert.deepEqual(received, {
      limit: 25, status: null, scope: "all", query: null, fromDate: null, toDate: null, cursor: null,
    });
    assert.deepEqual(await response.json(), {
      orders: [sampleOrder],
      pagination: { limit: 25, nextCursor: "next-page" },
    });
    assert.equal(response.headers.get("cache-control"), "no-store");
  });

  it("passes valid status, scope, and maximum page size to the query", async () => {
    assert.deepEqual(
      parseDineInOrderListOptions(new URL("https://clickmenu.example/?status=preparing&limit=100")),
      { limit: 100, status: "preparing", scope: "all", query: null, fromDate: null, toDate: null, cursor: null },
    );
    assert.deepEqual(
      parseDineInOrderListOptions(new URL("https://clickmenu.example/?scope=today")),
      { limit: 25, status: null, scope: "today", query: null, fromDate: null, toDate: null, cursor: null },
    );
  });

  it("accepts a search term and a date range", () => {
    assert.deepEqual(
      parseDineInOrderListOptions(new URL("https://clickmenu.example/?q=%20patio%20&from=2026-09-01&to=2026-09-30")),
      { limit: 25, status: null, scope: "all", query: "patio", fromDate: "2026-09-01", toDate: "2026-09-30", cursor: null },
    );
    assert.deepEqual(
      parseDineInOrderListOptions(new URL("https://clickmenu.example/?q=%20%20")),
      { limit: 25, status: null, scope: "all", query: null, fromDate: null, toDate: null, cursor: null },
    );
  });

  it("rejects an unusable search term or date range", () => {
    for (const query of [
      "?q=" + "x".repeat(101),
      "?from=2026-13-01",
      "?from=not-a-date",
      "?from=2026-09-30&to=2026-09-01",
      "?q=one&q=two",
    ]) {
      assert.throws(
        () => parseDineInOrderListOptions(new URL(`https://clickmenu.example/${query}`)),
        { status: 400 },
        query,
      );
    }
  });

  it("binds a cursor to the whole filter, including the search term and date range", () => {
    const filter = JSON.stringify([null, "all", "patio", "2026-09-01", "2026-09-30"]);
    const cursor = Buffer.from(JSON.stringify({
      v: 3, filter, createdAt: "1790000000000", orderId: sampleOrder.orderId,
    })).toString("base64url");
    assert.deepEqual(
      parseDineInOrderListOptions(new URL(
        `https://clickmenu.example/?q=patio&from=2026-09-01&to=2026-09-30&cursor=${cursor}`,
      )),
      {
        limit: 25, status: null, scope: "all", query: "patio",
        fromDate: "2026-09-01", toDate: "2026-09-30", cursor,
      },
    );

    const other = Buffer.from(JSON.stringify({
      v: 3, filter: JSON.stringify([null, "all", "other", "2026-09-01", "2026-09-30"]),
      createdAt: "1790000000000", orderId: sampleOrder.orderId,
    })).toString("base64url");
    assert.throws(
      () => parseDineInOrderListOptions(new URL(
        `https://clickmenu.example/?q=patio&from=2026-09-01&to=2026-09-30&cursor=${other}`,
      )),
      { status: 400 },
    );
  });

  it("accepts grouped views and binds cursors to each view and scope", () => {
    for (const status of ["in_progress", "finished"]) {
      for (const scope of ["all", "today"]) {
        const filter = JSON.stringify([status, scope, null, null, null]);
        const cursor = Buffer.from(JSON.stringify({
          v: 3, filter, createdAt: "1790000000000", orderId: sampleOrder.orderId,
        })).toString("base64url");
        assert.deepEqual(
          parseDineInOrderListOptions(new URL(`https://clickmenu.example/?status=${status}&scope=${scope}&cursor=${cursor}`)),
          {
            limit: 25, status, scope, query: null,
            fromDate: null, toDate: null, cursor,
          },
        );
      }
    }
  });

  it("rejects a cursor bound to a different date scope", () => {
    const filter = JSON.stringify(["pending", "today", null, null, null]);
    const encoded = Buffer.from(JSON.stringify({
      v: 3, filter, createdAt: "1790000000000", orderId: sampleOrder.orderId,
    })).toString("base64url");
    assert.throws(
      () => parseDineInOrderListOptions(new URL(`https://clickmenu.example/?status=pending&scope=all&cursor=${encoded}`)),
      { status: 400 },
    );
  });

  it("rejects unsupported, duplicate, or malformed query parameters", () => {
    for (const query of [
      "?status=placed",
      "?status=pending&status=completed",
      "?scope=week",
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
      v: 3,
      filter: JSON.stringify(["pending", "all", null, null, null]),
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

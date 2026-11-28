import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import "../../support/register-types.mjs";

const requireTs = createRequire(import.meta.url);
const {
  createHistoricalOrdersArchiveController,
  isHistoricalArchiveFilterEmpty,
} = requireTs("../../../features/admin/historical-orders-archive.ts");

const row = (orderId = "00000000-0000-4000-8000-000000000001", overrides = {}) => ({
  orderId,
  createdAt: "1790000000000",
  status: "completed",
  customerName: "Guest",
  tableLabel: "Patio 1",
  totalMillimes: 4250,
  revision: 1790000000100,
  customerNotes: null,
  items: [{ productName: "Toast", quantity: 1, lineTotalMillimes: 4250, options: [] }],
  ...overrides,
});

const page = (orders, nextCursor = null) => ({
  orders,
  pagination: { limit: 25, nextCursor },
});

const response = (body, status = 200) => new Response(JSON.stringify(body), { status });

describe("past order archive", () => {
  it("knows when the archive has no filter", () => {
    assert.equal(isHistoricalArchiveFilterEmpty({ query: "", fromDate: "", toDate: "" }), true);
    assert.equal(isHistoricalArchiveFilterEmpty({ query: "  ", fromDate: "", toDate: "" }), true);
    assert.equal(isHistoricalArchiveFilterEmpty({ query: "", fromDate: "2026-09-01", toDate: "" }), false);
  });

  it("sends the search term and the date range to the list endpoint", async () => {
    const requests = [];
    const controller = createHistoricalOrdersArchiveController(async (url) => {
      requests.push(String(url));
      return response(page([row()]));
    });
    await controller.start();
    await controller.setFilter({ query: "patio", fromDate: "2026-09-01", toDate: "2026-09-30" });

    assert.match(requests[0], /\/api\/admin\/dine-in\/orders\?limit=25$/u);
    const filtered = new URL(requests[1], "https://clickmenu.example");
    assert.equal(filtered.searchParams.get("q"), "patio");
    assert.equal(filtered.searchParams.get("from"), "2026-09-01");
    assert.equal(filtered.searchParams.get("to"), "2026-09-30");
    assert.equal(controller.getSnapshot().orders.length, 1);
    assert.equal(controller.getSnapshot().query, "patio");
  });

  it("replaces the list and the cursor when the filter changes", async () => {
    let requestCount = 0;
    const controller = createHistoricalOrdersArchiveController(async () => {
      requestCount += 1;
      return requestCount === 1
        ? response(page([row()], "cursor-a"))
        : response(page([row("00000000-0000-4000-8000-000000000002")]));
    });
    await controller.start();
    assert.equal(controller.getSnapshot().nextCursor, "cursor-a");
    await controller.setFilter({ query: "guest", fromDate: "", toDate: "" });
    assert.equal(controller.getSnapshot().orders.length, 1);
    assert.equal(controller.getSnapshot().orders[0].orderId, "00000000-0000-4000-8000-000000000002");
    assert.equal(controller.getSnapshot().nextCursor, null);
  });

  it("appends a further page and keeps the filter", async () => {
    const requests = [];
    let requestCount = 0;
    const controller = createHistoricalOrdersArchiveController(async (url) => {
      requests.push(String(url));
      requestCount += 1;
      if (requestCount === 1) return response(page([row()], "cursor-next"));
      if (requestCount === 2) return response(page([row("00000000-0000-4000-8000-000000000002")], "cursor-next-2"));
      return response(page([row("00000000-0000-4000-8000-000000000003")]));
    });
    await controller.start();
    await controller.setFilter({ query: "patio", fromDate: "", toDate: "" });
    await controller.loadMore();
    assert.equal(controller.getSnapshot().orders.length, 2);
    const last = new URL(requests.at(-1), "https://clickmenu.example");
    assert.equal(last.searchParams.get("cursor"), "cursor-next-2");
    assert.equal(last.searchParams.get("q"), "patio");
  });

  it("keeps an empty result and reports the error state", async () => {
    const empty = createHistoricalOrdersArchiveController(async () => response(page([])));
    await empty.start();
    assert.deepEqual(empty.getSnapshot().orders, []);
    assert.equal(empty.getSnapshot().error, false);

    const failed = createHistoricalOrdersArchiveController(async () => new Response("no", { status: 503 }));
    await failed.start();
    assert.equal(failed.getSnapshot().error, true);
  });
});

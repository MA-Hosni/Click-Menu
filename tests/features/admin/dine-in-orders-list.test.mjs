import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import "../../support/register-types.mjs";

const requireTs = createRequire(import.meta.url);
const {
  createDineInOrdersController,
  formatDineInTotal,
  parseDineInCreatedAt,
  startDineInOrdersAutoRefresh,
} = requireTs("../../../features/admin/dine-in-orders-list.ts");
const { DINE_IN_ORDERS_COPY } = requireTs("../../../features/admin/i18n/dine-in-orders-copy.ts");

const row = (orderId = "00000000-0000-4000-8000-000000000001", overrides = {}) => ({
  orderId,
  createdAt: "1790000000000",
  status: "pending",
  customerName: "Guest",
  tableLabel: "Patio 1",
  totalMillimes: 4250,
  ...overrides,
});

const page = (orders, nextCursor = null) => ({
  orders,
  pagination: { limit: 25, nextCursor },
});

const response = (body, status = 200) => new Response(JSON.stringify(body), { status });

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe("normalized dine-in orders list state", () => {
  it("calls only the normalized endpoint and encodes supported status/cursor parameters", async () => {
    const requests = [];
    const controller = createDineInOrdersController(async (url, options) => {
      requests.push({ url: String(url), options });
      return response(page([row()]));
    });
    await controller.start();
    await controller.setStatus("pending");

    assert.equal(requests.length, 2);
    assert.match(requests[0].url, /^\/api\/admin\/dine-in\/orders\?limit=25$/u);
    assert.match(requests[1].url, /^\/api\/admin\/dine-in\/orders\?limit=25&status=pending$/u);
    assert.ok(requests.every(({ options }) => options.cache === "no-store"));
    assert.ok(requests.every(({ url }) => !url.includes("/api/admin/orders?")));
  });

  it("resets rows and cursor when the server-side filter changes", async () => {
    const requests = [];
    const controller = createDineInOrdersController(async (url) => {
      requests.push(String(url));
      if (requests.length === 1) return response(page([row()], "cursor-a"));
      if (requests.length === 2) return response(page([row("00000000-0000-4000-8000-000000000002")], null));
      return response(page([row("00000000-0000-4000-8000-000000000003", { status: "completed" })], null));
    });
    await controller.start();
    await controller.loadMore();
    assert.equal(controller.getSnapshot().orders.length, 2);

    await controller.setStatus("completed");
    assert.deepEqual(controller.getSnapshot().orders.map((order) => order.orderId), [
      "00000000-0000-4000-8000-000000000003",
    ]);
    assert.match(requests[2], /status=completed/u);
    assert.doesNotMatch(requests[2], /cursor=/u);
  });

  it("appends pages and prevents duplicate concurrent load-more requests", async () => {
    const next = deferred();
    let requestCount = 0;
    const controller = createDineInOrdersController(async () => {
      requestCount += 1;
      if (requestCount === 1) return response(page([row()], "cursor-next"));
      return next.promise;
    });
    await controller.start();
    const firstLoadMore = controller.loadMore();
    const duplicateLoadMore = controller.loadMore();
    assert.equal(requestCount, 2);

    next.resolve(response(page([
      row("00000000-0000-4000-8000-000000000002"),
    ])));
    await Promise.all([firstLoadMore, duplicateLoadMore]);
    assert.equal(controller.getSnapshot().orders.length, 2);
    assert.equal(controller.getSnapshot().loadingMore, false);
  });

  it("does not overlap background polling with manual refresh or load-more requests", async () => {
    const loadPending = deferred();
    const refreshPending = deferred();
    let requestCount = 0;
    const controller = createDineInOrdersController(async () => {
      requestCount += 1;
      if (requestCount === 1) return response(page([row()], "cursor-next"));
      return requestCount === 2 ? loadPending.promise : refreshPending.promise;
    });
    await controller.start();
    const loadMore = controller.loadMore();
    await controller.refresh({ background: true });
    assert.equal(requestCount, 2);
    loadPending.resolve(response(page([row("00000000-0000-4000-8000-000000000002")])));
    await loadMore;
    const manualRefresh = controller.refresh();
    await controller.refresh({ background: true });
    assert.equal(requestCount, 3);
    refreshPending.resolve(response(page([row()])));
    await manualRefresh;
  });

  it("keeps loaded rows when load-more fails", async () => {
    let requestCount = 0;
    const controller = createDineInOrdersController(async () => {
      requestCount += 1;
      return requestCount === 1
        ? response(page([row()], "cursor-next"))
        : new Response("unavailable", { status: 503 });
    });
    await controller.start();
    await controller.loadMore();
    assert.deepEqual(controller.getSnapshot().orders, [row()]);
    assert.equal(controller.getSnapshot().loadMoreError, true);
    assert.equal(controller.getSnapshot().nextCursor, "cursor-next");
  });

  it("keeps the current page set when refresh fails and replaces it after a successful refresh", async () => {
    let requestCount = 0;
    const controller = createDineInOrdersController(async () => {
      requestCount += 1;
      if (requestCount === 1) return response(page([row()], "cursor-next"));
      if (requestCount === 2) return new Response("unavailable", { status: 503 });
      return response(page([row("00000000-0000-4000-8000-000000000002")]));
    });
    await controller.start();
    const failedRefresh = controller.refresh();
    assert.deepEqual(controller.getSnapshot().orders, [row()]);
    await failedRefresh;
    assert.deepEqual(controller.getSnapshot().orders, [row()]);
    assert.equal(controller.getSnapshot().error, true);

    await controller.refresh();
    assert.deepEqual(controller.getSnapshot().orders, [
      row("00000000-0000-4000-8000-000000000002"),
    ]);
    assert.equal(controller.getSnapshot().error, false);
  });

  it("exposes loading, empty, and error states", async () => {
    const pending = deferred();
    const controller = createDineInOrdersController(() => pending.promise);
    const started = controller.start();
    assert.equal(controller.getSnapshot().loading, true);
    pending.resolve(response(page([])));
    await started;
    assert.deepEqual(controller.getSnapshot().orders, []);
    assert.equal(controller.getSnapshot().loading, false);

    const failed = createDineInOrdersController(async () => new Response("bad", { status: 500 }));
    await failed.start();
    assert.equal(failed.getSnapshot().error, true);
    assert.deepEqual(failed.getSnapshot().orders, []);
  });

  it("rejects malformed response rows rather than rendering them", async () => {
    for (const invalid of [
      row("not-a-uuid"),
      row("00000000-0000-4000-8000-000000000002", { createdAt: "9007199254740992" }),
      row("00000000-0000-4000-8000-000000000002", { status: "new" }),
      row("00000000-0000-4000-8000-000000000002", { totalMillimes: Number.MAX_SAFE_INTEGER + 1 }),
    ]) {
      const controller = createDineInOrdersController(async () => response(page([invalid])));
      await controller.start();
      assert.equal(controller.getSnapshot().error, true);
      assert.deepEqual(controller.getSnapshot().orders, []);
    }
  });

  it("formats integer millimes explicitly as TND and validates epoch-millisecond text", () => {
    const formatted = formatDineInTotal(4250, "en");
    assert.match(formatted, /TND/u);
    assert.doesNotMatch(formatted, /DH/u);
    assert.equal(parseDineInCreatedAt("1790000000000").getTime(), 1790000000000);
    assert.equal(parseDineInCreatedAt("01"), null);
    assert.equal(parseDineInCreatedAt("-1"), null);
    assert.equal(parseDineInCreatedAt("8640000000000001"), null);
  });

  it("provides a localized new-order label in English, French, and Arabic", () => {
    assert.deepEqual(DINE_IN_ORDERS_COPY, {
      en: { newOrder: "New" },
      fr: { newOrder: "Nouvelle" },
      ar: { newOrder: "جديد" },
    });
  });

  it("polls every 30 seconds only while visible, refreshes on visibility, and cleans up", async () => {
    let intervalCallback;
    let visibilityCallback;
    let visible = false;
    let intervalStopped = 0;
    let visibilityStopped = 0;
    let calls = 0;
    const first = deferred();
    const second = deferred();
    const stop = startDineInOrdersAutoRefresh(() => {
      calls += 1;
      return calls === 1 ? first.promise : second.promise;
    }, {
      startInterval(callback, milliseconds) {
        assert.equal(milliseconds, 30_000);
        intervalCallback = callback;
        return () => { intervalStopped += 1; };
      },
      subscribeVisibility(callback) {
        visibilityCallback = callback;
        return () => { visibilityStopped += 1; };
      },
      isVisible: () => visible,
    });

    intervalCallback();
    assert.equal(calls, 0);
    visible = true;
    visibilityCallback();
    assert.equal(calls, 1);
    intervalCallback();
    assert.equal(calls, 1);
    visible = false;
    visibilityCallback();
    visible = true;
    visibilityCallback();
    first.resolve();
    await first.promise;
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(calls, 2);
    intervalCallback();
    assert.equal(calls, 2);
    stop();
    stop();
    second.resolve();
    await second.promise;
    visibilityCallback();
    assert.equal(calls, 2);
    assert.equal(intervalStopped, 1);
    assert.equal(visibilityStopped, 1);
  });

  it("merges background first-page updates and new orders without dropping loaded pages or cursor", async () => {
    let requestCount = 0;
    const first = row();
    const older = row("00000000-0000-4000-8000-000000000002", { createdAt: "1780000000000" });
    const newest = row("00000000-0000-4000-8000-000000000003", { createdAt: "1800000000000", customerName: "New guest" });
    const sameTimeNewerId = row("00000000-0000-4000-8000-000000000004", { createdAt: "1800000000000" });
    const controller = createDineInOrdersController(async () => {
      requestCount += 1;
      if (requestCount === 1) return response(page([first], "cursor-first"));
      if (requestCount === 2) return response(page([older], "cursor-older"));
      return response(page([sameTimeNewerId, newest, { ...first, tableLabel: "Patio 2" }], "cursor-from-new-first-page"));
    });
    await controller.start();
    await controller.loadMore();
    await controller.refresh({ background: true });
    assert.deepEqual(controller.getSnapshot().orders.map((order) => order.orderId), [
      sameTimeNewerId.orderId, newest.orderId, first.orderId, older.orderId,
    ]);
    assert.equal(controller.getSnapshot().orders[2].tableLabel, "Patio 2");
    assert.equal(controller.getSnapshot().nextCursor, "cursor-older");
    assert.deepEqual(controller.getSnapshot().newOrderIds, [sameTimeNewerId.orderId, newest.orderId]);

    await controller.refresh({ background: true });
    assert.equal(controller.getSnapshot().orders.length, 4);
    assert.deepEqual(controller.getSnapshot().newOrderIds, []);
  });

  it("keeps rows and manual error state separate when a background refresh fails", async () => {
    let requestCount = 0;
    const controller = createDineInOrdersController(async () => {
      requestCount += 1;
      return requestCount === 1
        ? response(page([row()], "cursor-first"))
        : new Response("unavailable", { status: 503 });
    });
    await controller.start();
    await controller.refresh({ background: true });
    assert.deepEqual(controller.getSnapshot().orders, [row()]);
    assert.equal(controller.getSnapshot().backgroundRefreshFailed, true);
    assert.equal(controller.getSnapshot().error, false);
    assert.equal(controller.getSnapshot().nextCursor, "cursor-first");
  });

  it("removes a locally updated order that no longer matches the active status filter", async () => {
    const controller = createDineInOrdersController(async () => response(page([row()], "cursor-first")));
    await controller.start();
    await controller.setStatus("pending");
    controller.updateOrderStatus(row().orderId, "confirmed");
    assert.deepEqual(controller.getSnapshot().orders, []);
    assert.equal(controller.getSnapshot().status, "pending");
    assert.equal(controller.getSnapshot().nextCursor, "cursor-first");
  });

  it("preserves a newer status update when an older background response arrives", async () => {
    const poll = deferred();
    let requestCount = 0;
    const controller = createDineInOrdersController(async () => {
      requestCount += 1;
      if (requestCount === 1) return response(page([row()]));
      return poll.promise;
    });
    await controller.start();
    const background = controller.refresh({ background: true });
    controller.updateOrderStatus(row().orderId, "confirmed");
    poll.resolve(response(page([row()])));
    await background;
    assert.equal(controller.getSnapshot().orders[0].status, "confirmed");
  });

  it("does not reinsert a filtered order from a load-more response older than its status update", async () => {
    const nextPage = deferred();
    let requestCount = 0;
    const controller = createDineInOrdersController(async () => {
      requestCount += 1;
      if (requestCount <= 2) return response(page([row()], "cursor-next"));
      return nextPage.promise;
    });
    await controller.start();
    await controller.setStatus("pending");
    const loadingMore = controller.loadMore();
    controller.updateOrderStatus(row().orderId, "confirmed");
    nextPage.resolve(response(page([row()])));
    await loadingMore;
    assert.deepEqual(controller.getSnapshot().orders, []);
    assert.equal(controller.getSnapshot().nextCursor, null);
  });

  it("ignores an old background result after the active filter changes", async () => {
    const poll = deferred();
    let requestCount = 0;
    const controller = createDineInOrdersController(async () => {
      requestCount += 1;
      if (requestCount === 1) return response(page([row()]));
      if (requestCount === 2) return poll.promise;
      return response(page([row("00000000-0000-4000-8000-000000000002", { status: "completed" })]));
    });
    await controller.start();
    const background = controller.refresh({ background: true });
    await controller.setStatus("completed");
    poll.resolve(response(page([row("00000000-0000-4000-8000-000000000003")])));
    await background;
    assert.equal(controller.getSnapshot().status, "completed");
    assert.deepEqual(controller.getSnapshot().orders.map((order) => order.status), ["completed"]);
  });

});

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import "../../support/register-types.mjs";

const requireTs = createRequire(import.meta.url);
const {
  createDineInOrderDetailController,
  getDineInOrderStatusActions,
  parseDineInOrderDetail,
} = requireTs("../../../features/admin/dine-in-order-detail.ts");
const { formatDineInTableLabel } = requireTs("../../../features/admin/i18n/dine-in-table-label.ts");
const {
  createDineInOrdersController,
  formatDineInTotal,
  parseDineInCreatedAt,
} = requireTs("../../../features/admin/dine-in-orders-list.ts");

const orderId = "00000000-0000-4000-8000-000000000001";
const otherOrderId = "00000000-0000-4000-8000-000000000002";

function detail(overrides = {}) {
  return {
    orderId,
    createdAt: "1790000000000",
    status: "confirmed",
    customerName: "Guest",
    customerNotes: "No onions",
    tableLabel: "Patio 1",
    subtotalMillimes: 2700,
    totalMillimes: 2700,
    items: [
      {
        lineNumber: 1,
        productName: "Historical sandwich",
        quantity: 2,
        unitPriceMillimes: 1100,
        lineTotalMillimes: 2200,
        options: [{ id: "cheese", name: "Extra cheese", priceAdjustmentMillimes: 100 }],
      },
      {
        lineNumber: 2,
        productName: "Historical juice",
        quantity: 1,
        unitPriceMillimes: 500,
        lineTotalMillimes: 500,
        options: [],
      },
    ],
    ...overrides,
  };
}

function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe("normalized dine-in order detail", () => {
  it("fetches only the selected order from the normalized detail endpoint", async () => {
    const requests = [];
    const controller = createDineInOrderDetailController(async (url, options) => {
      requests.push({ url: String(url), options });
      return response(detail());
    });
    await controller.open(orderId);
    assert.deepEqual(requests, [{
      url: `/api/admin/dine-in/orders/${orderId}`,
      options: { cache: "no-store" },
    }]);
    assert.equal(controller.getSnapshot().detail.orderId, orderId);
  });

  it("accepts the endpoint response while retaining the saved item and option order", () => {
    const parsed = parseDineInOrderDetail(detail());
    assert.deepEqual(parsed.items.map((item) => item.productName), [
      "Historical sandwich",
      "Historical juice",
    ]);
    assert.deepEqual(parsed.items[0].options, [
      { id: "cheese", name: "Extra cheese", priceAdjustmentMillimes: 100 },
    ]);
  });

  it("rejects malformed snapshots, totals, timestamps, and sensitive extra fields", () => {
    const invalidDetails = [
      detail({ trackingToken: "should-not-render" }),
      detail({ status: "new" }),
      detail({ currency: "TND" }),
      detail({ createdAt: "9007199254740992" }),
      detail({ totalMillimes: Number.MAX_SAFE_INTEGER + 1 }),
      detail({ items: [detail().items[1], detail().items[0]] }),
      detail({ items: [detail().items[0], { ...detail().items[1], lineTotalMillimes: 501 }] }),
      detail({ items: [
        detail().items[0],
        { ...detail().items[1], options: [{ id: "bad", name: "Option", priceAdjustmentMillimes: 0, internalHash: "x" }] },
      ] }),
    ];
    for (const invalid of invalidDetails) assert.throws(() => parseDineInOrderDetail(invalid));
  });

  it("reports loading then success and accepts absent optional customer fields", async () => {
    const pending = deferred();
    const controller = createDineInOrderDetailController(() => pending.promise);
    const opening = controller.open(orderId);
    assert.equal(controller.getSnapshot().loading, true);
    pending.resolve(response(detail({ customerName: null, customerNotes: null })));
    await opening;
    assert.equal(controller.getSnapshot().loading, false);
    assert.equal(controller.getSnapshot().error, false);
    assert.equal(controller.getSnapshot().detail.customerName, null);
    assert.equal(controller.getSnapshot().detail.customerNotes, null);
  });

  it("shows a safe error and retries the same selected order", async () => {
    let calls = 0;
    const controller = createDineInOrderDetailController(async () => {
      calls += 1;
      return calls === 1 ? new Response("private database detail", { status: 503 }) : response(detail());
    });
    await controller.open(orderId);
    assert.equal(controller.getSnapshot().error, true);
    assert.equal(controller.getSnapshot().detail, null);
    await controller.retry();
    assert.equal(calls, 2);
    assert.equal(controller.getSnapshot().detail.orderId, orderId);
  });

  it("does not let a delayed earlier response replace the newly selected order", async () => {
    const first = deferred();
    const controller = createDineInOrderDetailController((url) =>
      String(url).endsWith(orderId) ? first.promise : Promise.resolve(response(detail({ orderId: otherOrderId }))),
    );
    const openingFirst = controller.open(orderId);
    await controller.open(otherOrderId);
    first.resolve(response(detail()));
    await openingFirst;
    assert.equal(controller.getSnapshot().orderId, otherOrderId);
    assert.equal(controller.getSnapshot().detail.orderId, otherOrderId);
  });

  it("invalidates an in-flight response after close", async () => {
    const pending = deferred();
    const controller = createDineInOrderDetailController(() => pending.promise);
    const opening = controller.open(orderId);
    controller.close();
    pending.resolve(response(detail()));
    await opening;
    assert.deepEqual(controller.getSnapshot(), {
      orderId: null,
      detail: null,
      loading: false,
      error: false,
      statusUpdating: false,
      statusTarget: null,
      statusError: null,
      statusUpdated: false,
    });
  });

  it("keeps list filter, rows, and cursor untouched while details open and close", async () => {
    const list = createDineInOrdersController(async () => response({
      orders: [{
        orderId,
        createdAt: "1790000000000",
        status: "pending",
        customerName: null,
        tableLabel: "Patio 1",
        totalMillimes: 2700,
      }],
      pagination: { limit: 25, nextCursor: "next-page" },
    }));
    await list.start();
    await list.setView("in_progress");
    const before = list.getSnapshot();

    const drawer = createDineInOrderDetailController(async () => response(detail()));
    await drawer.open(orderId);
    drawer.close();
    assert.deepEqual(list.getSnapshot(), before);
  });

  it("uses explicit TND formatting and validates epoch-millisecond display values", () => {
    assert.match(formatDineInTotal(2700, "en"), /TND/u);
    assert.doesNotMatch(formatDineInTotal(2700, "en"), /DH/u);
    assert.equal(parseDineInCreatedAt("1790000000000").toISOString(), "2026-09-21T14:13:20.000Z");
    assert.equal(parseDineInCreatedAt("01"), null);
    assert.equal(parseDineInCreatedAt("-1"), null);
    assert.equal(parseDineInCreatedAt("8640000000000001"), null);
  });

  it("shows only the backend-approved actions and none for terminal statuses", () => {
    assert.deepEqual(getDineInOrderStatusActions("pending"), ["confirmed", "rejected", "cancelled"]);
    assert.deepEqual(getDineInOrderStatusActions("confirmed"), ["preparing", "cancelled"]);
    // An order already being prepared cannot be cancelled: the kitchen started it.
    assert.deepEqual(getDineInOrderStatusActions("preparing"), ["completed"]);
    for (const status of ["completed", "rejected", "cancelled"])
      assert.deepEqual(getDineInOrderStatusActions(status), []);
  });

  it("keeps pending transitions directed and formats table labels without duplicating prefixes", () => {
    assert.deepEqual(getDineInOrderStatusActions("pending"), ["confirmed", "rejected", "cancelled"]);
    assert.ok(!getDineInOrderStatusActions("pending").includes("preparing"));
    assert.equal(formatDineInTableLabel("Table 1", "en"), "Table 1");
    assert.equal(formatDineInTableLabel(" 5 ", "en"), "Table 5");
    assert.equal(formatDineInTableLabel("Patio 1", "fr"), "Patio 1");
    assert.equal(formatDineInTableLabel(" 5 ", "ar"), "طاولة 5");
    assert.equal(formatDineInTableLabel("٥", "ar"), "طاولة ٥");
    assert.equal(formatDineInTableLabel("table 1", "en"), "table 1");
  });

  it("PATCHes only the target status and updates displayed detail after a validated response", async () => {
    const requests = [];
    const controller = createDineInOrderDetailController(async (url, options) => {
      requests.push({ url: String(url), options });
      return options?.method === "PATCH"
        ? response({ orderId, status: "confirmed" })
        : response(detail({ status: "pending" }));
    });
    await controller.open(orderId);
    assert.equal(await controller.updateStatus("confirmed"), null);
    assert.equal(requests.length, 2, "successful PATCH does not trigger a detail refetch");
    assert.deepEqual(requests[1], {
      url: `/api/admin/dine-in/orders/${orderId}`,
      options: { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "confirmed" }) },
    });
    assert.equal(controller.getSnapshot().detail.status, "confirmed");
    assert.equal(controller.getSnapshot().statusUpdated, true);
  });

  it("manages an order through confirmation, preparation, and completion", async () => {
    const transitions = ["confirmed", "preparing", "completed"];
    let persistedStatus = "pending";
    const controller = createDineInOrderDetailController(async (_url, options) => {
      if (options?.method === "PATCH") {
        persistedStatus = JSON.parse(options.body).status;
        return response({ orderId, status: persistedStatus });
      }
      return response(detail({ status: persistedStatus }));
    });

    await controller.open(orderId);
    const opened = controller.getSnapshot().detail;
    assert.equal(opened.customerName, "Guest");
    assert.equal(opened.customerNotes, "No onions");
    assert.equal(opened.tableLabel, "Patio 1");
    assert.equal(opened.totalMillimes, 2700);
    assert.deepEqual(opened.items.map((item) => ({
      productName: item.productName,
      quantity: item.quantity,
      options: item.options,
    })), [
      { productName: "Historical sandwich", quantity: 2, options: [{ id: "cheese", name: "Extra cheese", priceAdjustmentMillimes: 100 }] },
      { productName: "Historical juice", quantity: 1, options: [] },
    ]);

    for (const status of transitions) {
      assert.ok(getDineInOrderStatusActions(controller.getSnapshot().detail.status).includes(status));
      assert.equal(await controller.updateStatus(status), null);
      assert.equal(controller.getSnapshot().detail.status, status);
      assert.equal(persistedStatus, status);
    }
    assert.deepEqual(getDineInOrderStatusActions(controller.getSnapshot().detail.status), []);
  });

  it("rejects malformed success bodies without changing the saved status", async () => {
    const controller = createDineInOrderDetailController(async (_url, options) =>
      options?.method === "PATCH"
        ? response({ orderId, status: "rejected", customerName: "unexpected" })
        : response(detail({ status: "pending" })),
    );
    await controller.open(orderId);
    assert.equal(await controller.updateStatus("confirmed"), "unexpected");
    assert.equal(controller.getSnapshot().detail.status, "pending");
    assert.equal(controller.getSnapshot().statusUpdated, false);
  });

  it("rejects unexpected 2xx statuses instead of treating them as saved", async () => {
    const controller = createDineInOrderDetailController(async (_url, options) =>
      options?.method === "PATCH"
        ? response({ orderId, status: "confirmed" }, 202)
        : response(detail({ status: "pending" })),
    );
    await controller.open(orderId);
    assert.equal(await controller.updateStatus("confirmed"), "unexpected");
    assert.equal(controller.getSnapshot().detail.status, "pending");
  });

  it("prevents duplicate status submissions while the first request is pending", async () => {
    const pending = deferred();
    let patchCalls = 0;
    const controller = createDineInOrderDetailController(async (_url, options) => {
      if (options?.method === "PATCH") { patchCalls += 1; return pending.promise; }
      return response(detail({ status: "pending" }));
    });
    await controller.open(orderId);
    const first = controller.updateStatus("confirmed");
    const second = await controller.updateStatus("rejected");
    assert.equal(second, "unexpected");
    assert.equal(patchCalls, 1);
    pending.resolve(response({ orderId, status: "confirmed" }));
    assert.equal(await first, null);
    assert.equal(controller.getSnapshot().detail.status, "confirmed");
  });

  it("maps HTTP failures safely and reloads current detail after a conflict", async () => {
    for (const [status, expected] of [[401, "unauthorized"], [403, "forbidden"], [404, "notFound"], [503, "unavailable"]]) {
      const controller = createDineInOrderDetailController(async (_url, options) =>
        options?.method === "PATCH" ? new Response("private server detail", { status }) : response(detail({ status: "pending" })),
      );
      await controller.open(orderId);
      assert.equal(await controller.updateStatus("confirmed"), expected);
      assert.equal(controller.getSnapshot().statusError, expected);
      assert.equal(controller.getSnapshot().detail.status, "pending");
    }

    let getCalls = 0;
    const controller = createDineInOrderDetailController(async (_url, options) => {
      if (options?.method === "PATCH") return new Response("conflict", { status: 409 });
      getCalls += 1;
      return response(detail({ status: getCalls === 1 ? "pending" : "preparing" }));
    });
    await controller.open(orderId);
    assert.equal(await controller.updateStatus("confirmed"), "conflict");
    assert.equal(getCalls, 2);
    assert.equal(controller.getSnapshot().detail.status, "preparing");
    assert.equal(controller.getSnapshot().statusError, "conflict");
  });

  it("does not retry an ambiguous failure and refreshes only the selected order", async () => {
    const patch = deferred();
    const calls = [];
    const controller = createDineInOrderDetailController(async (url, options) => {
      calls.push({ url: String(url), method: options?.method ?? "GET" });
      if (options?.method === "PATCH") return patch.promise;
      return response(detail({ orderId: String(url).endsWith(otherOrderId) ? otherOrderId : orderId, status: "pending" }));
    });
    await controller.open(orderId);
    const update = controller.updateStatus("confirmed");
    await controller.open(otherOrderId);
    patch.reject(new TypeError("connection lost"));
    assert.equal(await update, "stale");
    assert.equal(controller.getSnapshot().orderId, otherOrderId);
    assert.equal(calls.filter((call) => call.method === "PATCH").length, 1);
  });

  it("updates only the matching normalized list summary while preserving pagination", async () => {
    const list = createDineInOrdersController(async () => response({
      orders: [{ orderId, createdAt: "1790000000000", status: "pending", customerName: null, tableLabel: "Patio 1", totalMillimes: 2700, revision: 1790000000000, customerNotes: null, items: [] }],
      pagination: { limit: 25, nextCursor: "next-page" },
    }));
    await list.start();
    list.updateOrderStatus(orderId, "confirmed");
    assert.equal(list.getSnapshot().orders[0].status, "confirmed");
    assert.equal(list.getSnapshot().nextCursor, "next-page");
  });
});

describe("millime formatting", () => {
  it("formats integer millimes correctly as TND with decimal point", () => {
    assert.equal(formatDineInTotal(47498, "en"), "47.498 TND");
    assert.equal(formatDineInTotal(500, "en"), "0.500 TND");
    assert.equal(formatDineInTotal(7000, "en"), "7.000 TND");
    assert.equal(formatDineInTotal(0, "en"), "0.000 TND");
    assert.equal(formatDineInTotal(999999, "en"), "999.999 TND");

    assert.equal(formatDineInTotal(47498, "fr"), "47,498 TND");
    assert.equal(formatDineInTotal(500, "fr"), "0,500 TND");

    assert.equal(formatDineInTotal(47498, "ar"), "47,498 TND");
  });
});

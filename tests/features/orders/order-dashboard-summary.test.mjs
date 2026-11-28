import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import "../../support/register-types.mjs";

const requireTs = createRequire(import.meta.url);
const { createDineInOrderDashboardSummaryGetHandler } = requireTs("../../../features/orders/order-dashboard-summary.ts");

describe("admin dine-in order dashboard summary API", () => {
  it("requires an authenticated admin and returns a dataset-wide aggregate", async () => {
    let calls = 0;
    const unauthorized = createDineInOrderDashboardSummaryGetHandler({
      getCurrentUser: async () => null,
      getSummary: async () => { calls += 1; return { pendingCount: 1, preparingCount: 2, todayDoneOrderCount: 5, todayInKitchenTotalMillimes: 38500, todayTotalMillimes: 47498, latestPendingOrder: null }; },
    });
    assert.equal((await unauthorized()).status, 401);
    assert.equal(calls, 0);

    const authorized = createDineInOrderDashboardSummaryGetHandler({
      getCurrentUser: async () => ({ name: "The Hood admin" }),
      getSummary: async () => { calls += 1; return { pendingCount: 3, preparingCount: 5, todayDoneOrderCount: 5, todayInKitchenTotalMillimes: 38500, todayTotalMillimes: 47498, latestPendingOrder: { orderId: "00000000-0000-4000-8000-000000000001", createdAt: "1790000000000" } }; },
    });
    const response = await authorized();
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      pendingCount: 3,
      preparingCount: 5,
      todayDoneOrderCount: 5,
      todayInKitchenTotalMillimes: 38500,
      todayTotalMillimes: 47498,
      latestPendingOrder: { orderId: "00000000-0000-4000-8000-000000000001", createdAt: "1790000000000" },
    });
    assert.equal(calls, 1);
    assert.equal(response.headers.get("cache-control"), "no-store");
  });
});

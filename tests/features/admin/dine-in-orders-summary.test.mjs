import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import "../../support/register-types.mjs";

const requireTs = createRequire(import.meta.url);
const {
  isNewerPendingOrder,
  parseDineInOrdersDashboardSummary,
} = requireTs("../../../features/admin/dine-in-orders-summary.ts");

const summary = (overrides = {}) => ({
  pendingCount: 2,
  preparingCount: 1,
  todayDoneOrderCount: 7,
  todayInKitchenTotalMillimes: 42500,
  todayTotalMillimes: 81000,
  latestPendingOrder: { orderId: "00000000-0000-4000-8000-000000000001", createdAt: "1790000000000" },
  ...overrides,
});

describe("admin order summary reading", () => {
  it("accepts the exact summary shape the endpoint returns", () => {
    const parsed = parseDineInOrdersDashboardSummary(summary());
    assert.equal(parsed.pendingCount, 2);
    assert.equal(parsed.preparingCount, 1);
    assert.equal(parsed.todayDoneOrderCount, 7);
    assert.equal(parsed.todayInKitchenTotalMillimes, 42500);
    assert.equal(parsed.todayTotalMillimes, 81000);
    assert.deepEqual(parsed.latestPendingOrder, {
      orderId: "00000000-0000-4000-8000-000000000001",
      createdAt: "1790000000000",
    });
  });

  it("accepts a null latest pending order", () => {
    const parsed = parseDineInOrdersDashboardSummary(summary({ latestPendingOrder: null }));
    assert.equal(parsed.latestPendingOrder, null);
  });

  it("rejects payloads that are not the exact summary shape", () => {
    for (const invalid of [
      null,
      "not-a-summary",
      [],
      summary({ extra: true }),
      (() => { const value = summary(); delete value.pendingCount; return value; })(),
      summary({ pendingCount: -1 }),
      summary({ pendingCount: 1.5 }),
      summary({ latestPendingOrder: { orderId: "nope", createdAt: "1790000000000" } }),
      summary({ latestPendingOrder: { orderId: "00000000-0000-4000-8000-000000000001", createdAt: "01" } }),
    ]) {
      assert.equal(parseDineInOrdersDashboardSummary(invalid), null);
    }
  });

  it("orders pending orders by creation time and then by id", () => {
    const older = { orderId: "00000000-0000-4000-8000-000000000001", createdAt: "1790000000000" };
    const newer = { orderId: "00000000-0000-4000-8000-000000000002", createdAt: "1800000000000" };
    const sameTimeHigherId = { orderId: "00000000-0000-4000-8000-000000000003", createdAt: "1800000000000" };

    assert.equal(isNewerPendingOrder(newer, older), true);
    assert.equal(isNewerPendingOrder(older, newer), false);
    assert.equal(isNewerPendingOrder(sameTimeHigherId, newer), true);
    assert.equal(isNewerPendingOrder(newer, sameTimeHigherId), false);
    assert.equal(isNewerPendingOrder(null, older), false);
    assert.equal(isNewerPendingOrder(newer, undefined), true);
    assert.equal(isNewerPendingOrder(newer, null), true);
  });
});

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import "../../support/register-types.mjs";

const requireTs = createRequire(import.meta.url);
const { createPostgresConfirmAndPrepareUpdater } = requireTs("../../../features/orders/order-status-store.ts");
const { DineInOrderTransitionConflict } = requireTs("../../../features/orders/order-status.ts");

function fakeDatabase(current) {
  const calls = { locked: 0, updates: 0, set: null };
  const transaction = {
    select() {
      const query = {
        from() { return query; },
        where() { return query; },
        limit() { return query; },
        for(mode) {
          assert.equal(mode, "update");
          calls.locked += 1;
          return current ? [current] : [];
        },
      };
      return query;
    },
    update() {
      return {
        set(values) {
          calls.updates += 1;
          calls.set = values;
          return {
            where() {
              return {
                returning: async () => [{ orderId: current.id, status: values.status }],
              };
            },
          };
        },
      };
    },
  };
  const withTransaction = async (callback) => callback(transaction);
  return { calls, withTransaction };
}

describe("atomic confirm-and-prepare order operation", () => {
  it("locks once, checks revision and pending state, then writes preparing with one new revision", async () => {
    const db = fakeDatabase({ id: "order-1", status: "pending", updatedAt: 100 });
    const update = createPostgresConfirmAndPrepareUpdater(db.withTransaction);
    const result = await update("order-1", 100);
    assert.equal(db.calls.locked, 1);
    assert.equal(db.calls.updates, 1);
    assert.equal(db.calls.set.status, "preparing");
    assert.ok(db.calls.set.updatedAt > 100);
    assert.deepEqual(result, { orderId: "order-1", status: "preparing", revision: db.calls.set.updatedAt });
  });

  it("rejects stale revisions and non-pending rows before writing", async () => {
    for (const current of [
      { id: "order-1", status: "pending", updatedAt: 101 },
      { id: "order-1", status: "confirmed", updatedAt: 100 },
    ]) {
      const db = fakeDatabase(current);
      const update = createPostgresConfirmAndPrepareUpdater(db.withTransaction);
      await assert.rejects(update("order-1", 100), DineInOrderTransitionConflict);
      assert.equal(db.calls.locked, 1);
      assert.equal(db.calls.updates, 0);
    }
  });

  it("returns null for a missing row without updating", async () => {
    const db = fakeDatabase(null);
    const update = createPostgresConfirmAndPrepareUpdater(db.withTransaction);
    assert.equal(await update("missing", 100), null);
    assert.equal(db.calls.locked, 1);
    assert.equal(db.calls.updates, 0);
  });
});

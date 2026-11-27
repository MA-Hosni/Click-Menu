import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import "../support/register-types.mjs";

const requireTs = createRequire(import.meta.url);
const { createTransactionRunner } = requireTs("../../db/transaction.ts");
const { drizzle } = requireTs("drizzle-orm/neon-serverless");
const { sql } = requireTs("drizzle-orm");
const schema = requireTs("../../db/schema.ts");

function makeRunner({ failures = {}, createHandle } = {}) {
  const events = [];
  let nextClientId = 0;
  const released = [];
  const runner = createTransactionRunner({
    acquire: async () => ({
      id: ++nextClientId,
      async query(command) {
        events.push([command, this.id]);
        if (failures[command]) throw failures[command];
        return { rows: [] };
      },
    }),
    createHandle: createHandle ?? ((client, assertActive) => ({
      clientId: client.id,
      async execute() {
        await client.query("SELECT 1");
        return "query-result";
      },
      assertActive,
    })),
    executeCommand: (client, command) => client.query(command),
    release: (client, error) => released.push({ clientId: client.id, error }),
  });
  return { runner, events, released };
}

describe("Neon transaction adapter lifecycle", () => {
  it("returns a business result after ordinary callback queries and commit", async () => {
    const fixture = makeRunner();
    const result = await fixture.runner(async (transaction) => {
      assert.equal(await transaction.execute(), "query-result");
      return { orderId: "business-result" };
    });

    assert.deepEqual(result, { orderId: "business-result" });
    assert.deepEqual(fixture.events.map(([command]) => command), [
      "BEGIN ISOLATION LEVEL READ COMMITTED",
      "SELECT 1",
      "COMMIT",
    ]);
    assert.deepEqual(fixture.released, [{ clientId: 1, error: undefined }]);
  });

  it("guards real Drizzle execution through the checked-out client", async () => {
    const fixture = makeRunner({
      createHandle: (client) => drizzle({
        client,
        schema,
      }),
    });
    let retained;
    let delayedQuery;
    let delayedPreparedQuery;

    const result = await fixture.runner(async (database) => {
      retained = database;
      await database.execute(sql.raw("select 1"));
      delayedQuery = database.select().from(schema.dineInOrders);
      delayedPreparedQuery = database.select().from(schema.dineInOrders).prepare("guarded_after_callback");
      return "query completed";
    });

    assert.equal(result, "query completed");
    const completedQueryCount = fixture.events.length;
    await assert.rejects(retained.execute(sql.raw("select 2")), (error) => {
      assert.match(error.cause?.message ?? "", /no longer active/);
      return true;
    });
    await assert.rejects(delayedQuery, (error) => {
      assert.match(error.cause?.message ?? "", /no longer active/);
      return true;
    });
    await assert.rejects(delayedPreparedQuery.execute(), (error) => {
      assert.match(error.cause?.message ?? "", /no longer active/);
      return true;
    });
    assert.equal(fixture.events.length, completedQueryCount);
  });

  it("rejects returning the raw transaction handle and rolls back", async () => {
    const fixture = makeRunner();
    let handle;

    await assert.rejects(fixture.runner(async (transaction) => {
      handle = transaction;
      return transaction;
    }), /cannot be returned/);

    assert.deepEqual(fixture.events.map(([command]) => command), [
      "BEGIN ISOLATION LEVEL READ COMMITTED",
      "ROLLBACK",
    ]);
    await assert.rejects(handle.execute(), /no longer active/);
  });

  it("blocks a retained handle after successful completion", async () => {
    const fixture = makeRunner();
    let retained;

    await fixture.runner(async (transaction) => {
      retained = transaction;
      return "done";
    });

    await assert.rejects(retained.execute(), /no longer active/);
    assert.equal(fixture.events.some(([command]) => command === "SELECT 1"), false);
  });

  it("blocks a retained handle after callback failure and rollback", async () => {
    const fixture = makeRunner();
    const callbackError = new Error("callback failed");
    let retained;

    await assert.rejects(fixture.runner(async (transaction) => {
      retained = transaction;
      throw callbackError;
    }), callbackError);
    await assert.rejects(retained.execute(), /no longer active/);
    assert.deepEqual(fixture.events.map(([command]) => command), [
      "BEGIN ISOLATION LEVEL READ COMMITTED",
      "ROLLBACK",
    ]);
    assert.equal(fixture.released[0].error, callbackError);
  });

  it("preserves callback and rollback failures together and discards the client", async () => {
    const callbackError = new Error("callback failed");
    const rollbackError = new Error("rollback failed");
    const fixture = makeRunner({ failures: { ROLLBACK: rollbackError } });

    await assert.rejects(fixture.runner(async () => { throw callbackError; }), (error) => {
      assert.ok(error instanceof AggregateError);
      assert.deepEqual(error.errors, [callbackError, rollbackError]);
      assert.equal(error.cause, callbackError);
      return true;
    });
    assert.ok(fixture.released[0].error instanceof AggregateError);
  });

  it("preserves a commit failure and attempts rollback", async () => {
    const commitError = new Error("commit failed");
    const fixture = makeRunner({ failures: { COMMIT: commitError } });

    await assert.rejects(fixture.runner(async () => "result"), commitError);
    assert.deepEqual(fixture.events.map(([command]) => command), [
      "BEGIN ISOLATION LEVEL READ COMMITTED",
      "COMMIT",
      "ROLLBACK",
    ]);
    assert.equal(fixture.released[0].error, commitError);
  });

  it("preserves both commit and rollback errors when both fail", async () => {
    const commitError = new Error("commit failed");
    const rollbackError = new Error("rollback failed");
    const fixture = makeRunner({ failures: { COMMIT: commitError, ROLLBACK: rollbackError } });

    await assert.rejects(fixture.runner(async () => "result"), (error) => {
      assert.ok(error instanceof AggregateError);
      assert.deepEqual(error.errors, [commitError, rollbackError]);
      assert.equal(error.cause, commitError);
      return true;
    });
    assert.ok(fixture.released[0].error instanceof AggregateError);
  });

  it("attempts rollback and discards the client when BEGIN fails", async () => {
    const beginError = new Error("begin failed");
    const fixture = makeRunner({ failures: { "BEGIN ISOLATION LEVEL READ COMMITTED": beginError } });

    await assert.rejects(fixture.runner(async () => "unreachable"), beginError);
    assert.deepEqual(fixture.events.map(([command]) => command), [
      "BEGIN ISOLATION LEVEL READ COMMITTED",
      "ROLLBACK",
    ]);
    assert.equal(fixture.released[0].error, beginError);
  });

  it("uses distinct clients for overlapping transactions", async () => {
    const fixture = makeRunner();
    const entered = [];
    let releaseBoth;
    const bothEntered = new Promise((resolve) => { releaseBoth = resolve; });

    const run = () => fixture.runner(async (transaction) => {
      entered.push(transaction.clientId);
      if (entered.length === 2) releaseBoth();
      await bothEntered;
      await transaction.execute();
      return transaction.clientId;
    });

    const results = await Promise.all([run(), run()]);
    assert.deepEqual(results.sort(), [1, 2]);
    assert.equal(new Set(entered).size, 2);
    assert.equal(fixture.released.length, 2);
  });
});

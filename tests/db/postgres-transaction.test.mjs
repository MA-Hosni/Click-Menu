import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import "../support/register-types.mjs";

const requireTs = createRequire(import.meta.url);
const { sql } = requireTs("drizzle-orm");
const { createPostgresTransactionRunner } = requireTs("../../db/transaction.ts");

function fakePool({ failCommand } = {}) {
  const commands = [];
  const releases = [];
  const client = {
    async query(query) {
      const command = typeof query === "string" ? query : query.text;
      commands.push(command);
      if (command === failCommand) throw new Error(`failed:${command}`);
      return { rows: [], rowCount: 0 };
    },
    release(error) { releases.push(error); },
  };
  return {
    commands,
    releases,
    pool: { async connect() { return client; } },
  };
}

describe("PostgreSQL transaction adapter", () => {
  it("uses READ COMMITTED and commits after Drizzle work", async () => {
    const fixture = fakePool();
    const runner = createPostgresTransactionRunner(fixture.pool);
    const result = await runner(async (transaction) => {
      await transaction.execute(sql.raw("select 1"));
      return "committed";
    });
    assert.equal(result, "committed");
    assert.equal(fixture.commands[0], "BEGIN ISOLATION LEVEL READ COMMITTED");
    assert.match(fixture.commands[1], /select 1/u);
    assert.equal(fixture.commands.at(-1), "COMMIT");
    assert.deepEqual(fixture.releases, [undefined]);
  });

  it("passes advisory and row-lock statements through the checked-out transaction client", async () => {
    const fixture = fakePool();
    const runner = createPostgresTransactionRunner(fixture.pool);
    await runner(async (transaction) => {
      await transaction.execute(sql.raw("SELECT pg_advisory_xact_lock(1)"));
      await transaction.execute(sql.raw("SELECT id FROM dine_in_orders WHERE id = 'synthetic' FOR UPDATE"));
    });
    assert.match(fixture.commands[1], /pg_advisory_xact_lock/u);
    assert.match(fixture.commands[2], /FOR UPDATE/u);
    assert.equal(fixture.commands.at(-1), "COMMIT");
  });

  it("rolls back callback failures and releases the client with the error", async () => {
    const fixture = fakePool();
    const runner = createPostgresTransactionRunner(fixture.pool);
    await assert.rejects(runner(async () => { throw new Error("callback failed"); }), /callback failed/u);
    assert.deepEqual(fixture.commands, ["BEGIN ISOLATION LEVEL READ COMMITTED", "ROLLBACK"]);
    assert.match(fixture.releases[0].message, /callback failed/u);
  });

  it("rolls back and discards a client after commit failure", async () => {
    const fixture = fakePool({ failCommand: "COMMIT" });
    const runner = createPostgresTransactionRunner(fixture.pool);
    await assert.rejects(runner(async () => "done"), /failed:COMMIT/u);
    assert.deepEqual(fixture.commands, [
      "BEGIN ISOLATION LEVEL READ COMMITTED",
      "COMMIT",
      "ROLLBACK",
    ]);
    assert.match(fixture.releases[0].message, /failed:COMMIT/u);
  });

  it("rejects a transaction handle returned from the callback", async () => {
    const fixture = fakePool();
    const runner = createPostgresTransactionRunner(fixture.pool);
    await assert.rejects(runner(async (transaction) => transaction), /cannot be returned/u);
    assert.equal(fixture.commands.at(-1), "ROLLBACK");
  });
});

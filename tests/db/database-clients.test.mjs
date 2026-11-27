import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import "../support/register-types.mjs";

const requireTs = createRequire(import.meta.url);
const { createNeonHttpDatabase, createPostgresDatabase } =
  requireTs("../../db/database-clients.ts");

describe("Drizzle database clients", () => {
  it("attaches the application schema to the PostgreSQL client", () => {
    const pool = {
      async query() { throw new Error("No query should run in this test."); },
      async connect() { throw new Error("No connection should be acquired in this test."); },
    };
    const database = createPostgresDatabase(pool);
    assert.ok(database.query.restaurantCatalogs);
    assert.ok(database.query.dineInOrders);
  });

  it("constructs the unchanged Neon HTTP client without issuing a request", () => {
    const database = createNeonHttpDatabase("postgresql://synthetic:synthetic@ep-test.us-east-1.aws.neon.tech/test");
    assert.ok(database.query.restaurantCatalogs);
    assert.ok(database.query.dineInOrders);
  });

  it("initializes the production PostgreSQL adapter once and attaches the schema", async () => {
    const previousDriver = process.env.DATABASE_DRIVER;
    const previousUrl = process.env.DATABASE_URL;
    const previousPooledUrl = process.env.DATABASE_URL_POOLED;
    process.env.DATABASE_DRIVER = "postgres";
    process.env.DATABASE_URL = "postgresql://synthetic:synthetic@127.0.0.1:1/clickmenu-test";
    delete process.env.DATABASE_URL_POOLED;

    try {
      const { getDb } = requireTs("../../db/index.ts");
      const first = getDb();
      const second = getDb();
      assert.equal(first, second);
      assert.ok(first.query.restaurantCatalogs);
      assert.ok(first.query.dineInOrders);
      assert.equal(globalThis.__clickMenuPostgresPool.options.max, 5);
    } finally {
      const databaseModule = requireTs("../../db/index.ts");
      await databaseModule.closePostgresDatabasePool();
      if (previousDriver === undefined) delete process.env.DATABASE_DRIVER;
      else process.env.DATABASE_DRIVER = previousDriver;
      if (previousUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousUrl;
      if (previousPooledUrl === undefined) delete process.env.DATABASE_URL_POOLED;
      else process.env.DATABASE_URL_POOLED = previousPooledUrl;
    }
  });
});

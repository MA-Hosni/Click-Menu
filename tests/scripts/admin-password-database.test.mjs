import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withAdminPasswordDatabase } from "../../scripts/admin-password-database.mjs";

describe("admin password database selection", () => {
  it("selects local PostgreSQL and always closes its pool after success", async () => {
    let ended = 0;
    let operationDriver;
    const result = await withAdminPasswordDatabase({ driver: "postgres", connectionString: "synthetic-local-url" }, {
      createPostgresPool(url) {
        assert.equal(url, "synthetic-local-url");
        return { async end() { ended += 1; } };
      },
      createNeonQuery() { throw new Error("Neon must not be selected."); },
    }, async (database) => {
      operationDriver = database.driver;
      return "ok";
    });
    assert.equal(result, "ok");
    assert.equal(operationDriver, "postgres");
    assert.equal(ended, 1);
  });

  it("closes the local pool when the operation fails", async () => {
    let ended = 0;
    await assert.rejects(withAdminPasswordDatabase({ driver: "postgres", connectionString: "synthetic-local-url" }, {
      createPostgresPool() { return { async end() { ended += 1; } }; },
      createNeonQuery() { throw new Error("Neon must not be selected."); },
    }, async () => { throw new Error("operation failed"); }), /operation failed/u);
    assert.equal(ended, 1);
  });

  it("preserves the Neon query client path without a local pool", async () => {
    let selected = "";
    await withAdminPasswordDatabase({ driver: "neon", connectionString: "synthetic-neon-url" }, {
      createPostgresPool() { throw new Error("PostgreSQL must not be selected."); },
      createNeonQuery(url) { return { url }; },
    }, async (database) => { selected = database.sql.url; });
    assert.equal(selected, "synthetic-neon-url");
  });
});

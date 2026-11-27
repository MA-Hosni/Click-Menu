import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import "../support/register-types.mjs";

const requireTs = createRequire(import.meta.url);
const { resolveDatabaseDriver } = requireTs("../../db/driver-config.ts");
const { resolveDatabaseRuntimeConfiguration } = requireTs("../../db/runtime-config.ts");

describe("database driver configuration", () => {
  it("preserves Neon as the default and uses the pooled Neon URL", () => {
    assert.equal(resolveDatabaseDriver({ DATABASE_URL_POOLED: "neon-url" }), "neon");
    assert.deepEqual(resolveDatabaseRuntimeConfiguration({ DATABASE_URL_POOLED: "neon-url" }), {
      driver: "neon",
      connectionString: "neon-url",
    });
  });

  it("accepts explicit Neon selection", () => {
    assert.deepEqual(resolveDatabaseRuntimeConfiguration({
      DATABASE_DRIVER: "neon",
      DATABASE_URL_POOLED: "neon-url",
    }), { driver: "neon", connectionString: "neon-url" });
  });

  it("requires the local URL and rejects conflicting pooled configuration", () => {
    assert.throws(() => resolveDatabaseRuntimeConfiguration({ DATABASE_DRIVER: "postgres" }), /DATABASE_URL is required/u);
    assert.throws(() => resolveDatabaseRuntimeConfiguration({
      DATABASE_DRIVER: "postgres",
      DATABASE_URL: "local-url",
      DATABASE_URL_POOLED: "neon-url",
    }), /not allowed/u);
    assert.deepEqual(resolveDatabaseRuntimeConfiguration({
      DATABASE_DRIVER: "postgres",
      DATABASE_URL: "local-url",
    }), { driver: "postgres", connectionString: "local-url" });
  });

  it("rejects unexpected nonempty driver values without falling back", () => {
    assert.throws(() => resolveDatabaseRuntimeConfiguration({
      DATABASE_DRIVER: "POSTGRES",
      DATABASE_URL: "local-url",
      DATABASE_URL_POOLED: "neon-url",
    }), /DATABASE_DRIVER/u);
    assert.throws(() => resolveDatabaseRuntimeConfiguration({
      DATABASE_DRIVER: "",
    }), /DATABASE_URL_POOLED/u);
  });
});

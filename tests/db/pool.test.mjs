import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import "../support/register-types.mjs";

const requireTs = createRequire(import.meta.url);
const { closePool, getOrCreatePool } = requireTs("../../db/pool.ts");

describe("process-scoped pool helper", () => {
  it("creates once, reuses the same pool, and closes it cleanly", async () => {
    let creations = 0;
    let closes = 0;
    const holder = {};
    const create = () => ({ async end() { closes += 1; } });

    const first = getOrCreatePool(holder, () => { creations += 1; return create(); });
    const second = getOrCreatePool(holder, () => { creations += 1; return create(); });
    assert.equal(first, second);
    assert.equal(creations, 1);

    await closePool(holder);
    assert.equal(closes, 1);
    assert.equal(holder.pool, undefined);
  });

  it("does not create or close a pool when none exists", async () => {
    const holder = {};
    await closePool(holder);
    assert.equal(holder.pool, undefined);
  });
});

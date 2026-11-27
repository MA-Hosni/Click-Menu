import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import "../support/register-types.mjs";

const requireTs = createRequire(import.meta.url);
const {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  endSession,
  getSessionUser,
  readSessionToken,
  sessionCookie,
  sha256,
} = requireTs("../../lib/auth.ts");

describe("hashed singleton administrator sessions", () => {
  it("parses only valid tokens and keeps cookie protections", () => {
    const token = "a".repeat(64);
    assert.equal(readSessionToken(`${SESSION_COOKIE}=${token}`), token);
    assert.equal(readSessionToken(`${SESSION_COOKIE}=invalid`), null);
    assert.match(sessionCookie(token, true), /HttpOnly; SameSite=Lax/);
    assert.match(sessionCookie(token, true), /; Secure/);
    assert.doesNotMatch(sessionCookie(token, false), /; Secure/);
  });

  it("looks up sessions by token hash and honors expiration", async () => {
    const token = "b".repeat(64);
    const expectedHash = await sha256(token);
    let deleted = "";
    const store = {
      async getSessionUser(hash, now) {
        assert.equal(hash, expectedHash);
        return now < 20 ? { name: "The Hood" } : null;
      },
      async deleteSession(hash) {
        deleted = hash;
      },
    };
    assert.deepEqual(
      await getSessionUser(store, `${SESSION_COOKIE}=${token}`, 19),
      { name: "The Hood" },
    );
    assert.equal(
      await getSessionUser(store, `${SESSION_COOKIE}=${token}`, 20),
      null,
    );
    await endSession(store, `${SESSION_COOKIE}=${token}`);
    assert.equal(deleted, expectedHash);
    assert.equal(SESSION_TTL_MS, 30 * 24 * 60 * 60_000);
  });
});

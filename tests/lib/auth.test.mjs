import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import "../support/register-types.mjs";

const requireTs = createRequire(import.meta.url);
const {
  CODE_TTL_MS,
  MAX_CODE_ATTEMPTS,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  createSignInCode,
  endSession,
  generateCode,
  getSessionUser,
  normalizeEmail,
  readSessionToken,
  sessionCookie,
  sha256,
  verifySignInCode,
} = requireTs("../../lib/auth.ts");

function createMemoryStore() {
  const state = { code: null, user: null, session: null };
  return {
    state,
    async getCode() {
      return state.code;
    },
    async putCode(_email, code) {
      state.code = code;
    },
    async bumpAttempts() {
      state.code.attempts += 1;
    },
    async deleteCode() {
      state.code = null;
    },
    async findUserByEmail() {
      return state.user;
    },
    async createUser(user) {
      state.user = user;
    },
    async createSession(session) {
      state.session = session;
    },
    async getSessionUser(tokenHash, now) {
      return state.session?.tokenHash === tokenHash && state.session.expiresAt > now
        ? state.user
        : null;
    },
    async deleteSession() {
      state.session = null;
    },
    async deleteExpiredSessions() {},
  };
}

describe("passwordless authentication", () => {
  it("normalizes email and validates malformed addresses", () => {
    assert.equal(normalizeEmail("  OWNER@Example.com "), "owner@example.com");
    assert.throws(() => normalizeEmail("not-an-email"), /valid email/i);
  });

  it("generates a six-digit code, verifies it, and manages a session", async () => {
    const store = createMemoryStore();
    const issued = await createSignInCode(
      store,
      { email: "owner@example.com" },
      1_000,
    );
    assert.match(generateCode(), /^\d{6}$/);
    assert.equal(store.state.code.expiresAt, 1_000 + CODE_TTL_MS);
    assert.notEqual(store.state.code.codeHash, issued.code);

    const result = await verifySignInCode(
      store,
      { email: issued.email, code: issued.code },
      { now: 1_001 },
    );
    assert.equal(result.user.email, "owner@example.com");
    assert.match(result.token, /^[a-f0-9]{64}$/);
    assert.equal(readSessionToken(`${SESSION_COOKIE}=${result.token}`), result.token);
    assert.equal(readSessionToken(`${SESSION_COOKIE}=invalid`), null);
    assert.match(sessionCookie(result.token, true), /HttpOnly; SameSite=Lax/);
    assert.equal(
      (await getSessionUser(store, `${SESSION_COOKIE}=${result.token}`, 1_002)).id,
      result.user.id,
    );
    assert.equal(
      await getSessionUser(
        store,
        `${SESSION_COOKIE}=${result.token}`,
        1_001 + SESSION_TTL_MS,
      ),
      null,
    );
    await endSession(store, `${SESSION_COOKIE}=${result.token}`);
    assert.equal(store.state.session, null);
  });

  it("rejects expired codes, increments wrong-code attempts, and locks at the limit", async () => {
    const store = createMemoryStore();
    const email = "owner@example.com";
    const code = "123456";
    store.state.code = {
      codeHash: await sha256(`${email}:${code}`),
      expiresAt: 10,
      attempts: 0,
      createdAt: 0,
    };
    await assert.rejects(
      verifySignInCode(store, { email, code }, { now: 10 }),
      /expired/i,
    );

    store.state.code.expiresAt = 100;
    await assert.rejects(
      verifySignInCode(store, { email, code: "654321" }, { now: 20 }),
      /isn.t right/i,
    );
    assert.equal(store.state.code.attempts, 1);
    store.state.code.attempts = MAX_CODE_ATTEMPTS;
    await assert.rejects(
      verifySignInCode(store, { email, code }, { now: 20 }),
      /too many wrong codes/i,
    );
    assert.equal(store.state.code, null);
  });
});

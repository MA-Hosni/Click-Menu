import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import "../../support/register-types.mjs";

const requireTs = createRequire(import.meta.url);
const {
  hashAdminPassword,
  initializeAdminPassword,
  loginAdminWithPassword,
  resetAdminPassword,
} = requireTs("../../../features/admin/auth/password-auth.ts");
const { ApiError, requireAdmin } = requireTs("../../../lib/api-security.ts");
const { getSessionUser, sha256, SESSION_COOKIE } = requireTs("../../../lib/auth.ts");
const { enforceLimit } = requireTs("../../../lib/rate-limit.ts");

function createMemoryStore() {
  let credential = null;
  const sessions = new Map();
  const events = [];
  return {
    sessions,
    events,
    async getAdminCredential() { return credential; },
    async initializePassword(passwordHash, eventId, now) {
      if (credential) return false;
      credential = { passwordHash, credentialVersion: 1 };
      events.push({ id: eventId, action: "initialized", actor: "cli", createdAt: now });
      return true;
    },
    async resetPassword(passwordHash, eventId, now) {
      if (!credential) return false;
      credential = { passwordHash, credentialVersion: credential.credentialVersion + 1 };
      sessions.clear();
      events.push({ id: eventId, action: "reset", actor: "cli", createdAt: now });
      return true;
    },
    async createSession(session) { sessions.set(session.tokenHash, session); },
    async getSessionUser(hash, now) {
      const session = sessions.get(hash);
      return credential && session && session.expiresAt > now && session.credentialVersion === credential.credentialVersion
        ? { name: "The Hood" }
        : null;
    },
    async deleteSession(hash) { sessions.delete(hash); },
    async deleteExpiredSessions(now) {
      for (const [hash, session] of sessions) if (session.expiresAt <= now) sessions.delete(hash);
    },
  };
}

const password = "Restaurant-Admin-2026!";

describe("single administrator password authentication", () => {
  it("validates password strength and hashes with Argon2id", async () => {
    await assert.rejects(hashAdminPassword("short1!"), /12–128 characters/);
    await assert.rejects(hashAdminPassword("lowercaseonlypassword"), /three character types/);
    assert.match(await hashAdminPassword(password), /^argon2id\$/);
  });

  it("initializes exactly one admin credential and rejects duplicate setup", async () => {
    const store = createMemoryStore();
    await initializeAdminPassword(store, password, 100);
    assert.notEqual((await store.getAdminCredential()).passwordHash, password);
    assert.equal(store.events[0].action, "initialized");
    await assert.rejects(initializeAdminPassword(store, password, 101), (error) => error instanceof ApiError && error.status === 409);
  });

  it("logs in, stores only a hashed opaque token, and rejects incorrect passwords", async () => {
    const store = createMemoryStore();
    await initializeAdminPassword(store, password, 100);
    const login = await loginAdminWithPassword(store, { password }, 200);
    assert.deepEqual(login.user, { name: "The Hood" });
    assert.equal(store.sessions.size, 1);
    assert.ok(store.sessions.has(await sha256(login.token)));
    assert.equal(await getSessionUser(store, `${SESSION_COOKIE}=${login.token}`, 201) !== null, true);
    await assert.rejects(loginAdminWithPassword(store, { password: "wrong" }, 202), (error) => error instanceof ApiError && error.status === 401);
  });

  it("expires sessions and revokes sessions and old passwords on reset", async () => {
    const store = createMemoryStore();
    await initializeAdminPassword(store, password, 100);
    const login = await loginAdminWithPassword(store, { password }, 200);
    await resetAdminPassword(store, "New-Restaurant-Password-9!", 300);
    assert.equal(store.sessions.size, 0);
    assert.equal(store.events.at(-1).action, "reset");
    await assert.rejects(loginAdminWithPassword(store, { password }, 301), (error) => error instanceof ApiError && error.status === 401);
    const replacement = await loginAdminWithPassword(store, { password: "New-Restaurant-Password-9!" }, 302);
    assert.notEqual(replacement.token, login.token);
    const sessionHash = await sha256(replacement.token);
    assert.equal(await store.getSessionUser(sessionHash, Number.MAX_SAFE_INTEGER), null);
  });

  it("requires the authenticated singleton admin for protected handlers", () => {
    assert.doesNotThrow(() => requireAdmin({ name: "The Hood" }));
    assert.throws(() => requireAdmin(null), (error) => error instanceof ApiError && error.status === 401);
  });

  it("limits repeated login attempts", async () => {
    const counters = new Map();
    const store = { hit(key, windowStart) {
      const previous = counters.get(key);
      const count = previous?.windowStart === windowStart ? previous.count + 1 : 1;
      counters.set(key, { count, windowStart });
      return count;
    } };
    for (let attempt = 0; attempt < 10; attempt++) await enforceLimit(store, "adminLoginPerIp", "198.51.100.10", 1_000);
    await assert.rejects(enforceLimit(store, "adminLoginPerIp", "198.51.100.10", 1_000), (error) => error instanceof ApiError && error.status === 429);
  });
});

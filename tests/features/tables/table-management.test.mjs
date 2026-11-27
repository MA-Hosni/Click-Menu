import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import "../../support/register-types.mjs";

const requireTs = createRequire(import.meta.url);
const {
  createTableOperations,
  DuplicateTableLabelError,
  hashTableToken,
  TableLabelError,
  TableNotFoundError,
} = requireTs("../../../lib/table-operations.ts");
const { loadPublicTableMenu } = requireTs("../../../lib/public-table-menu.ts");
const {
  createAdminTableCollectionHandlers,
  createAdminTableItemHandlers,
} = requireTs("../../../lib/admin-table-handlers.ts");

const id = "11111111-1111-4111-8111-111111111111";
const rotationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
process.env.TABLE_QR_RECOVERY_KEY = Buffer.alloc(32, 42).toString("base64");

function memoryStore() {
  const rows = new Map();
  return {
    rows,
    async list() { return [...rows.values()]; },
    async hasLabel(label, exceptId) {
      const normalized = label.toLocaleLowerCase();
      return [...rows.values()].some(
        (row) => row.id !== exceptId && row.label.toLocaleLowerCase() === normalized,
      );
    },
    async insert(row) {
      if (
        rows.has(row.id) ||
        [...rows.values()].some((current) => current.qrTokenHash === row.qrTokenHash)
      ) return false;
      rows.set(row.id, row);
      return true;
    },
    async update(tableId, changes, updatedAt) {
      const row = rows.get(tableId);
      if (!row) return false;
      rows.set(tableId, { ...row, ...changes, updatedAt });
      return true;
    },
    async readRotation(tableId) {
      const row = rows.get(tableId);
      return row ? {
        qrVersion: row.qrVersion,
        qrTokenHash: row.qrTokenHash,
        rotationRequestHash: row.rotationRequestHash,
        rotationTokenCiphertext: row.rotationTokenCiphertext,
      } : null;
    },
    async readCurrentRecovery(tableId) {
      const row = rows.get(tableId);
      return row ? {
        qrVersion: row.qrVersion,
        qrTokenHash: row.qrTokenHash,
        rotationRequestHash: row.rotationRequestHash,
        rotationTokenCiphertext: row.rotationTokenCiphertext,
        isActive: row.isActive,
      } : null;
    },
    async rotateToken(tableId, expectedVersion, qrTokenHash, rotationRequestHash, rotationTokenCiphertext, updatedAt) {
      const row = rows.get(tableId);
      if (!row || row.qrVersion !== expectedVersion) return null;
      if ([...rows.values()].some((entry) => entry.id !== tableId && entry.qrTokenHash === qrTokenHash)) {
        const error = new Error("duplicate token hash");
        error.code = "23505";
        throw error;
      }
      rows.set(tableId, {
        ...row,
        qrTokenHash,
        qrVersion: expectedVersion + 1,
        rotationRequestHash,
        rotationTokenCiphertext,
        updatedAt,
      });
      return expectedVersion + 1;
    },
    async exists(tableId) { return rows.has(tableId); },
    async resolveActive(qrTokenHash) {
      const row = [...rows.values()].find(
        (entry) => entry.qrTokenHash === qrTokenHash && entry.isActive,
      );
      return row ? { label: row.label } : null;
    },
  };
}

function deterministicToken(byte) {
  return Buffer.alloc(32, byte).toString("base64url");
}

function operationsFor(store, options = {}) {
  let nextId = 0;
  return createTableOperations(store, {
    siteUrl: "https://thehood.example",
    createId: () => nextId++ === 0 ? id : "22222222-2222-4222-8222-222222222222",
    now: () => 1234,
    ...options,
  });
}

describe("restaurant table management", () => {
  it("creates an opaque 32-byte token, stores only its hash, and returns a configured URL", async () => {
    const store = memoryStore();
    const operations = operationsFor(store, { createToken: () => deterministicToken(1) });
    const result = await operations.create("  Patio   1 ");
    const token = new URL(result.url).pathname.split("/").at(-1);
    const row = store.rows.get(id);

    assert.equal(result.table.label, "Patio 1");
    assert.equal(result.url, `https://thehood.example/t/${token}`);
    assert.equal(Buffer.from(token, "base64url").byteLength, 32);
    assert.equal(row.qrTokenHash, hashTableToken(token));
    assert.equal("qrTokenHash" in result.table, false);
    assert.equal(result.table.id, id);
    assert.deepEqual(await operations.resolve(token), { label: "Patio 1" });
  });

  it("rejects malformed, noncanonical, unknown, and inactive tokens without table detail", async () => {
    const store = memoryStore();
    const operations = operationsFor(store, { createToken: () => deterministicToken(2) });
    const result = await operations.create("Window 2");
    const token = new URL(result.url).pathname.split("/").at(-1);
    assert.equal(await operations.resolve("short"), null);
    assert.equal(await operations.resolve(`${token}=`), null);
    assert.equal(await operations.resolve(deterministicToken(3)), null);
    await operations.update(id, { isActive: false });
    assert.equal(await operations.resolve(token), null);
  });

  it("prevents duplicate normalized labels and validates labels server-side", async () => {
    const store = memoryStore();
    const operations = operationsFor(store, { createToken: () => deterministicToken(4) });
    await operations.create("Main Room");
    await assert.rejects(operations.create(" main   room "), DuplicateTableLabelError);
    await assert.rejects(operations.create(" \n "), TableLabelError);
    await assert.rejects(operations.create("x".repeat(41)), TableLabelError);
  });

  it("restores an inactive token when activated and invalidates it when rotated", async () => {
    const store = memoryStore();
    const tokens = [deterministicToken(5), deterministicToken(6)];
    const operations = operationsFor(store, { createToken: () => tokens.shift() });
    const first = await operations.create("Terrace");
    const oldToken = new URL(first.url).pathname.split("/").at(-1);
    await operations.update(id, { isActive: false });
    assert.equal(await operations.resolve(oldToken), null);
    await operations.update(id, { isActive: true });
    assert.deepEqual(await operations.resolve(oldToken), { label: "Terrace" });

    const rotated = await operations.rotate(id, rotationId, 1);
    const newToken = new URL(rotated.url).pathname.split("/").at(-1);
    assert.notEqual(newToken, oldToken);
    assert.equal(await operations.resolve(oldToken), null);
    assert.deepEqual(await operations.resolve(newToken), { label: "Terrace" });
  });

  it("retries a token-hash collision without persisting the colliding token", async () => {
    const store = memoryStore();
    const tokens = [deterministicToken(7), deterministicToken(7), deterministicToken(8)];
    const operations = operationsFor(store, { createToken: () => tokens.shift() });
    await operations.create("Table A");
    const second = await operations.create("Table B");
    assert.equal(new URL(second.url).pathname.split("/").at(-1), deterministicToken(8));
    assert.equal(store.rows.size, 2);
  });

  it("recovers the same rotation token after commit when the response is lost", async () => {
    const base = memoryStore();
    const tokens = [deterministicToken(9), deterministicToken(10)];
    const baseOperations = operationsFor(base, { createToken: () => tokens.shift() });
    const created = await baseOperations.create("Dining Room");
    const oldToken = new URL(created.url).pathname.split("/").at(-1);
    const originalRotate = base.rotateToken.bind(base);
    let loseResponse = true;
    base.rotateToken = async (...args) => {
      const version = await originalRotate(...args);
      if (loseResponse && version !== null) {
        loseResponse = false;
        throw new Error("simulated response loss after commit");
      }
      return version;
    };

    await assert.rejects(baseOperations.rotate(id, rotationId, 1), /simulated response loss/);
    const recovered = await baseOperations.rotate(id, rotationId, 1);
    const repeated = await baseOperations.rotate(id, rotationId, 1);
    assert.equal(recovered.url, repeated.url);
    assert.equal(recovered.qrVersion, 2);
    assert.equal(recovered.recovered, true);
    assert.equal(await baseOperations.resolve(oldToken), null);
    const persisted = base.rows.get(id);
    assert.notEqual(persisted.rotationTokenCiphertext, new URL(recovered.url).pathname.split("/").at(-1));
    assert.match(persisted.rotationTokenCiphertext, /^v1\./);
    assert.equal(persisted.qrVersion, 2);
    assert.equal(persisted.rotationRequestHash, requireTs("node:crypto").createHash("sha256").update(rotationId).digest("hex"));
  });

  it("recovers the latest active rotated QR without the browser request ID", async () => {
    const store = memoryStore();
    const tokens = [deterministicToken(31), deterministicToken(32)];
    const operations = operationsFor(store, { createToken: () => tokens.shift() });
    await operations.create("Recovery");
    const rotated = await operations.rotate(id, rotationId, 1);
    const recovered = await operations.recover(id);
    assert.equal(recovered.url, rotated.url);
    assert.equal(recovered.qrVersion, 2);
    await operations.update(id, { isActive: false });
    await assert.rejects(operations.recover(id), TableNotFoundError);
  });

  it("rejects tampered, malformed, and non-canonical recovery ciphertext without returning a URL", async () => {
    const mutations = [
      (parts) => { parts[1] = `${parts[1][0] === "A" ? "B" : "A"}${parts[1].slice(1)}`; },
      (parts) => { parts[2] = `${parts[2][0] === "A" ? "B" : "A"}${parts[2].slice(1)}`; },
      (parts) => { parts[3] = `${parts[3][0] === "A" ? "B" : "A"}${parts[3].slice(1)}`; },
      (parts) => { parts[1] += "="; },
      (parts) => { parts[2] = "!"; },
      (parts) => { parts.push("extra"); },
      (parts) => { parts[0] = "v2"; },
    ];
    for (const mutate of mutations) {
      const store = memoryStore();
      const tokens = [deterministicToken(33), deterministicToken(34)];
      const operations = operationsFor(store, { createToken: () => tokens.shift() });
      await operations.create("Tamper");
      await operations.rotate(id, rotationId, 1);
      const row = store.rows.get(id);
      const parts = row.rotationTokenCiphertext.split(".");
      mutate(parts);
      row.rotationTokenCiphertext = parts.join(".");
      await assert.rejects(operations.recover(id));
    }
  });

  it("rejects recovery ciphertext bound to a different table or request hash", async () => {
    const store = memoryStore();
    const tokens = [deterministicToken(35), deterministicToken(36), deterministicToken(37)];
    const operations = operationsFor(store, { createToken: () => tokens.shift() });
    await operations.create("First");
    await operations.rotate(id, rotationId, 1);
    const encrypted = store.rows.get(id).rotationTokenCiphertext;
    const secondId = "22222222-2222-4222-8222-222222222222";
    await operations.create("Second");
    const second = store.rows.get(secondId);
    second.qrVersion = 2;
    second.rotationRequestHash = store.rows.get(id).rotationRequestHash;
    second.rotationTokenCiphertext = encrypted;
    await assert.rejects(operations.recover(secondId));

    const original = store.rows.get(id);
    original.rotationRequestHash = requireTs("node:crypto").createHash("sha256").update("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb").digest("hex");
    await assert.rejects(operations.recover(id));
  });

  it("fails closed for missing, malformed, wrong-length, and changed recovery keys", async () => {
    const store = memoryStore();
    const tokens = [deterministicToken(38), deterministicToken(39)];
    const operations = operationsFor(store, { createToken: () => tokens.shift() });
    await operations.create("Key check");
    await operations.rotate(id, rotationId, 1);
    const validKey = process.env.TABLE_QR_RECOVERY_KEY;
    for (const invalid of [undefined, "not-base64!", Buffer.alloc(31).toString("base64")]) {
      if (invalid === undefined) delete process.env.TABLE_QR_RECOVERY_KEY;
      else process.env.TABLE_QR_RECOVERY_KEY = invalid;
      await assert.rejects(operations.recover(id));
    }
    process.env.TABLE_QR_RECOVERY_KEY = Buffer.alloc(32, 43).toString("base64");
    await assert.rejects(operations.recover(id));
    process.env.TABLE_QR_RECOVERY_KEY = validKey;
    assert.match((await operations.recover(id)).url, /^https:\/\/thehood\.example\/t\//);
  });

  it("treats a new intentional rotation as a new operation and rejects stale retries", async () => {
    const store = memoryStore();
    const tokens = [deterministicToken(11), deterministicToken(12), deterministicToken(13)];
    const operations = operationsFor(store, { createToken: () => tokens.shift() });
    const created = await operations.create("Garden");
    const oldToken = new URL(created.url).pathname.split("/").at(-1);
    const first = await operations.rotate(id, rotationId, 1);
    const firstToken = new URL(first.url).pathname.split("/").at(-1);
    const second = await operations.rotate("11111111-1111-4111-8111-111111111111", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", 2);
    const secondToken = new URL(second.url).pathname.split("/").at(-1);
    assert.notEqual(firstToken, secondToken);
    assert.equal(await operations.resolve(oldToken), null);
    assert.equal(await operations.resolve(firstToken), null);
    assert.deepEqual(await operations.resolve(secondToken), { label: "Garden" });
    await assert.rejects(
      operations.rotate(id, rotationId, 1),
      /changed/,
    );
  });

  it("does not expose token material from list or ordinary update results", async () => {
    const store = memoryStore();
    const token = deterministicToken(14);
    const operations = operationsFor(store, { createToken: () => token });
    await operations.create("Front");
    const list = await operations.list();
    const update = await operations.update(id, { label: "Front Room" });
    const publicData = JSON.stringify({ list, update });
    assert.equal(publicData.includes(token), false);
    assert.equal(publicData.includes("qrTokenHash"), false);
    assert.equal(publicData.includes("rotationTokenCiphertext"), false);
    assert.equal("qrTokenHash" in list[0], false);
  });
});

describe("admin table endpoint authorization", () => {
  it("rejects unauthenticated reads and all mutations before calling table operations", async () => {
    let calls = 0;
    const tables = {
      async list() { calls++; return []; },
      async create() { calls++; return {}; },
      async update() { calls++; return {}; },
      async rotate() { calls++; return {}; },
      async recover() { calls++; return {}; },
    };
    const collection = createAdminTableCollectionHandlers({
      async getCurrentUser() { return null; },
      tables,
    });
    const item = createAdminTableItemHandlers({
      async getCurrentUser() { return null; },
      tables,
    });
    const request = new Request("https://thehood.example/api/admin/tables", {
      method: "POST",
      headers: { origin: "https://thehood.example", "content-type": "application/json" },
      body: JSON.stringify({ label: "Table 1" }),
    });
    assert.equal((await collection.GET()).status, 401);
    assert.equal((await collection.POST(request)).status, 401);
    assert.equal((await item.PATCH(request, id)).status, 401);
    assert.equal((await item.rotate(request, id)).status, 401);
    assert.equal((await item.recover(id)).status, 401);
    assert.equal(calls, 0);
  });

  it("requires same origin for authenticated mutations and forwards rotation idempotency", async () => {
    const calls = [];
    const tables = {
      async list() { return []; },
      async create(label) { calls.push(["create", label]); return {}; },
      async update(tableId, changes) { calls.push(["update", tableId, changes]); return {}; },
      async rotate(tableId, requestId, version) {
        calls.push(["rotate", tableId, requestId, version]);
        return { url: "https://thehood.example/t/new-token", qrVersion: 2 };
      },
      async recover(tableId) {
        calls.push(["recover", tableId]);
        return { url: "https://thehood.example/t/current-token", qrVersion: 2 };
      },
    };
    const item = createAdminTableItemHandlers({
      async getCurrentUser() { return { name: "Administrator" }; },
      tables,
    });
    const body = JSON.stringify({ rotationId, expectedVersion: 1 });
    const sameOrigin = new Request(`https://thehood.example/api/admin/tables/${id}/rotate`, {
      method: "POST",
      headers: { origin: "https://thehood.example", "content-type": "application/json" },
      body,
    });
    const crossOrigin = new Request(`https://thehood.example/api/admin/tables/${id}/rotate`, {
      method: "POST",
      headers: { origin: "https://attacker.example", "content-type": "application/json" },
      body,
    });
    assert.equal((await item.rotate(crossOrigin, id)).status, 403);
    const response = await item.rotate(sameOrigin, id);
    assert.equal(response.status, 200);
    assert.deepEqual(calls, [["rotate", id, rotationId, 1]]);
    const recovered = await item.recover(id);
    assert.equal(recovered.status, 200);
    assert.deepEqual(await recovered.json(), {
      url: "https://thehood.example/t/current-token",
      qrVersion: 2,
    });
    assert.deepEqual(calls.at(-1), ["recover", id]);
  });
});

describe("public table menu loading", () => {
  const catalog = { settings: { name: "The Hood" }, categories: [], items: [] };

  it("loads the singleton catalog only after resolving the active token", async () => {
    const calls = [];
    const result = await loadPublicTableMenu("token-a", {
      async resolveTable(token) { calls.push(`table:${token}`); return { label: "Patio" }; },
      async readCatalog() { calls.push("catalog"); return catalog; },
    });
    assert.deepEqual(calls, ["table:token-a", "catalog"]);
    assert.deepEqual(result, { tableLabel: "Patio", catalog });
    assert.equal("id" in result, false);
  });

  it("does not load a catalog for invalid/inactive tokens and handles missing catalogs", async () => {
    let catalogReads = 0;
    const invalid = await loadPublicTableMenu("unknown", {
      async resolveTable() { return null; },
      async readCatalog() { catalogReads++; return catalog; },
    });
    const uninitialized = await loadPublicTableMenu("valid", {
      async resolveTable() { return { label: "Window" }; },
      async readCatalog() { catalogReads++; return null; },
    });
    assert.equal(invalid, null);
    assert.equal(uninitialized, null);
    assert.equal(catalogReads, 1);
  });

  it("keeps table context token-specific and ignores legacy menu query input", async () => {
    const labels = new Map([ ["token-a", "Patio"], ["token-b", "Window"] ]);
    const read = (token) => loadPublicTableMenu(token, {
      async resolveTable(value) { return { label: labels.get(value) }; },
      async readCatalog() { return catalog; },
    });
    assert.equal((await read("token-a")).tableLabel, "Patio");
    assert.equal((await read("token-b")).tableLabel, "Window");

    const hookSource = readFileSync(new URL("../../../features/storefront/useStorefront.ts", import.meta.url), "utf8");
    assert.doesNotMatch(hookSource, /window\.location\.search|params\.get\(["']table/);
  });

  it("keeps general catalog routes browse-only and grants QR context only after server resolution", () => {
    const home = readFileSync(new URL("../../../app/page.tsx", import.meta.url), "utf8");
    const menu = readFileSync(new URL("../../../app/menu/page.tsx", import.meta.url), "utf8");
    const tableRoute = readFileSync(new URL("../../../app/t/[token]/page.tsx", import.meta.url), "utf8");
    const storefront = readFileSync(new URL("../../../components/client/restaurant/RestaurantPage.tsx", import.meta.url), "utf8");

    assert.match(home, /<RestaurantPage\s*\/>/u);
    assert.match(menu, /<RestaurantPage menuOnly\s*\/>/u);
    assert.match(tableRoute, /loadPublicTableMenu\(token/u);
    assert.match(tableRoute, /if \(!data\)/u);
    assert.match(tableRoute, /dineInTableToken=\{token\}/u);
    assert.match(storefront, /const dineInMode = Boolean\(dineInTableToken\)/u);
    assert.match(storefront, /orderingEnabled=\{orderingAvailable\}/u);
    assert.match(storefront, /dineInMode && <DineInCheckout/u);
  });

  it("retires the manual QR page and leaves no reachable legacy QR generator", () => {
    const route = readFileSync(new URL("../../../app/admin/qr/page.tsx", import.meta.url), "utf8");
    const redirect = readFileSync(new URL("../../../components/admin/qr/QrPage.tsx", import.meta.url), "utf8");
    assert.match(redirect, /redirect\(["']\/admin\/tables["']\)/);
    assert.doesNotMatch(route, /QrPanel/);
    assert.throws(() => readFileSync(new URL("../../../components/admin/qr/QrPanel.tsx", import.meta.url), "utf8"));
  });
});

import assert from "node:assert/strict";
import { createCipheriv, randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import "../../support/register-types.mjs";

const requireTs = createRequire(import.meta.url);
const {
  createTrackingTokenRecovery,
  TrackingTokenRecoveryError,
} = requireTs("../../../features/orders/tracking-token-recovery.ts");
const { generateTrackingToken } = requireTs("../../../features/orders/crypto.ts");
const { getTableConfig, PgDialect } = requireTs("drizzle-orm/pg-core");
const schema = requireTs("../../../db/schema.ts");
const dialect = new PgDialect();

const key = Buffer.from(Array.from({ length: 32 }, (_, index) => index));
const encodedKey = key.toString("base64");
const orderId = "order-123";
const idempotencyKeyHash = "a".repeat(64);
const token = () => generateTrackingToken();

function alterBase64(value) {
  const bytes = Buffer.from(value, "base64");
  bytes[0] ^= 1;
  return bytes.toString("base64");
}

function noncanonicalBase64PadBits(value) {
  assert.ok(value.endsWith("=="));
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const finalDataIndex = value.length - 3;
  const current = alphabet.indexOf(value[finalDataIndex]);
  assert.notEqual(current, -1);
  assert.equal(current & 0b1111, 0);
  const invalidIndex = (current & 0b110000) | 1;
  return `${value.slice(0, finalDataIndex)}${alphabet[invalidIndex]}==`;
}

function makeRecovery(keyValue = encodedKey) {
  return createTrackingTokenRecovery(keyValue);
}

describe("order tracking-token recovery encryption", () => {
  it("round-trips a valid tracking token without storing plaintext in the envelope", () => {
    const recovery = makeRecovery();
    const rawToken = token();
    const envelope = recovery.encrypt(rawToken, orderId, idempotencyKeyHash);
    assert.equal(envelope.version, 1);
    assert.equal(recovery.decrypt(envelope, orderId, idempotencyKeyHash), rawToken);
    assert.equal(JSON.stringify(envelope).includes(rawToken), false);
  });

  it("uses a fresh nonce for each encryption of the same token", () => {
    const recovery = makeRecovery();
    const rawToken = token();
    const first = recovery.encrypt(rawToken, orderId, idempotencyKeyHash);
    const second = recovery.encrypt(rawToken, orderId, idempotencyKeyHash);
    assert.notEqual(first.nonce, second.nonce);
  });

  it("accepts canonical Base64 and rejects noncanonical padding bits for padded fields", () => {
    const recovery = makeRecovery();
    const envelope = recovery.encrypt(token(), orderId, idempotencyKeyHash);
    assert.equal(envelope.nonce.length, 16);
    assert.equal(envelope.nonce.includes("="), false);
    for (const field of ["ciphertext", "authTag"]) {
      const canonical = envelope[field];
      const noncanonical = noncanonicalBase64PadBits(canonical);
      assert.deepEqual(Buffer.from(canonical, "base64"), Buffer.from(noncanonical, "base64"));
      assert.throws(
        () => recovery.decrypt({ ...envelope, [field]: noncanonical }, orderId, idempotencyKeyHash),
        TrackingTokenRecoveryError,
      );
    }
    assert.equal(recovery.decrypt(envelope, orderId, idempotencyKeyHash).length, 43);
  });

  it("rejects a wrong key and tampered ciphertext, authentication tag, and nonce", () => {
    const envelope = makeRecovery().encrypt(token(), orderId, idempotencyKeyHash);
    const wrongKey = Buffer.alloc(32, 9).toString("base64");
    assert.throws(
      () => makeRecovery(wrongKey).decrypt(envelope, orderId, idempotencyKeyHash),
      TrackingTokenRecoveryError,
    );
    for (const changed of [
      { ...envelope, ciphertext: alterBase64(envelope.ciphertext) },
      { ...envelope, authTag: alterBase64(envelope.authTag) },
      { ...envelope, nonce: alterBase64(envelope.nonce) },
    ]) {
      assert.throws(
        () => makeRecovery().decrypt(changed, orderId, idempotencyKeyHash),
        TrackingTokenRecoveryError,
      );
    }
  });

  it("binds recovery to the expected order ID and idempotency hash", () => {
    const recovery = makeRecovery();
    const envelope = recovery.encrypt(token(), orderId, idempotencyKeyHash);
    assert.throws(() => recovery.decrypt(envelope, "another-order", idempotencyKeyHash), TrackingTokenRecoveryError);
    assert.throws(() => recovery.decrypt(envelope, orderId, "b".repeat(64)), TrackingTokenRecoveryError);
  });

  it("rejects empty, whitespace-only, oversized, and control-character order IDs", () => {
    const recovery = makeRecovery();
    const rawToken = token();
    for (const invalidOrderId of ["", "   ", "x".repeat(129), "order\u0001id"])
      assert.throws(
        () => recovery.encrypt(rawToken, invalidOrderId, idempotencyKeyHash),
        TrackingTokenRecoveryError,
      );
  });

  it("rejects malformed idempotency-key hashes", () => {
    const recovery = makeRecovery();
    const rawToken = token();
    for (const invalidHash of ["", "a".repeat(63), "a".repeat(63) + "g", "G".repeat(64), "a".repeat(65)])
      assert.throws(
        () => recovery.encrypt(rawToken, orderId, invalidHash),
        TrackingTokenRecoveryError,
      );
  });

  it("rejects unsupported versions and malformed envelope encodings or shapes", () => {
    const recovery = makeRecovery();
    const envelope = recovery.encrypt(token(), orderId, idempotencyKeyHash);
    const cases = [
      { ...envelope, version: 2 },
      { ...envelope, nonce: `${envelope.nonce}=` },
      { ...envelope, nonce: "!".repeat(16) },
      { ...envelope, ciphertext: envelope.ciphertext.slice(1) },
      { ...envelope, authTag: "short" },
      { ...envelope, extra: "field" },
      { version: envelope.version, nonce: envelope.nonce, ciphertext: envelope.ciphertext },
    ];
    for (const malformed of cases)
      assert.throws(() => recovery.decrypt(malformed, orderId, idempotencyKeyHash), TrackingTokenRecoveryError);
  });

  it("rejects authenticated plaintext that is not a valid tracking token", () => {
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, nonce, { authTagLength: 16 });
    cipher.setAAD(Buffer.from(JSON.stringify([
      "click-menu-order-tracking-recovery", 1, orderId, idempotencyKeyHash,
    ])));
    const invalidToken = `!${"a".repeat(42)}`;
    const ciphertext = Buffer.concat([cipher.update(invalidToken, "utf8"), cipher.final()]);
    const invalidPlaintextEnvelope = {
      version: 1,
      nonce: nonce.toString("base64"),
      ciphertext: ciphertext.toString("base64"),
      authTag: cipher.getAuthTag().toString("base64"),
    };
    assert.throws(
      () => makeRecovery().decrypt(invalidPlaintextEnvelope, orderId, idempotencyKeyHash),
      TrackingTokenRecoveryError,
    );
  });

  it("does not expose raw cryptographic errors or token material on failure", () => {
    const rawToken = token();
    const envelope = makeRecovery().encrypt(rawToken, orderId, idempotencyKeyHash);
    const changed = { ...envelope, authTag: alterBase64(envelope.authTag) };
    assert.throws(() => makeRecovery().decrypt(changed, orderId, idempotencyKeyHash), (error) => {
      assert.equal(error.message, "Tracking-token recovery failed.");
      assert.equal(error.message.includes(rawToken), false);
      return true;
    });
  });
});

describe("order tracking recovery key configuration", () => {
  it("accepts canonical Base64 for exactly 32 bytes", () => {
    const recovery = createTrackingTokenRecovery(encodedKey);
    assert.deepEqual(Object.keys(recovery).sort(), ["decrypt", "encrypt"]);
  });

  it("rejects missing, malformed, noncanonical, and incorrectly sized keys", () => {
    for (const value of [undefined, null, "", "%%%", encodedKey.slice(0, -1), Buffer.alloc(16).toString("base64"), Buffer.alloc(33).toString("base64")])
      assert.throws(() => createTrackingTokenRecovery(value), TrackingTokenRecoveryError);
  });

  it("fails without an environment key instead of creating a fallback", () => {
    const original = process.env.ORDER_TRACKING_RECOVERY_KEY;
    try {
      delete process.env.ORDER_TRACKING_RECOVERY_KEY;
      assert.throws(() => requireTs("../../../features/orders/tracking-token-recovery.ts").createTrackingTokenRecoveryFromEnvironment(), TrackingTokenRecoveryError);
    } finally {
      if (original === undefined) delete process.env.ORDER_TRACKING_RECOVERY_KEY;
      else process.env.ORDER_TRACKING_RECOVERY_KEY = original;
    }
  });
});

describe("order tracking recovery schema and migration", () => {
  it("keeps recovery fields nullable and enforces an all-null or supported complete envelope", () => {
    const orderConfig = getTableConfig(schema.dineInOrders);
    const names = [
      "tracking_recovery_version",
      "tracking_recovery_nonce",
      "tracking_recovery_ciphertext",
      "tracking_recovery_auth_tag",
    ];
    for (const name of names) {
      const column = orderConfig.columns.find((entry) => entry.name === name);
      assert.ok(column, `missing ${name}`);
      assert.equal(column.notNull, false);
    }
    const check = orderConfig.checks.find((entry) => entry.name === "dine_in_orders_tracking_recovery_envelope_check");
    assert.ok(check);
    const checkSql = dialect.sqlToQuery(check.value).sql;
    assert.match(checkSql, /IS NULL/);
    assert.match(checkSql, /tracking_recovery_version.*= 1/s);
    assert.match(checkSql, /tracking_recovery_nonce/);
    assert.match(checkSql, /tracking_recovery_ciphertext/);
    assert.match(checkSql, /tracking_recovery_auth_tag/);
    assert.match(checkSql, /tracking_recovery_ciphertext.*\{57\}\[AQgw\]==/);
    assert.match(checkSql, /tracking_recovery_auth_tag.*\{21\}\[AQgw\]==/);
    const migration = readFileSync(new URL("../../../drizzle/0000_init.sql", import.meta.url), "utf8");
    const migrationCheck = migration.match(/CONSTRAINT "dine_in_orders_tracking_recovery_envelope_check"\s+CHECK\s*\(([\s\S]*?)\);/);
    assert.ok(migrationCheck, "initial migration must define the recovery envelope check");
    const snapshot = JSON.parse(readFileSync(new URL("../../../drizzle/meta/0000_snapshot.json", import.meta.url), "utf8"));
    const snapshotCheck = snapshot.tables["public.dine_in_orders"].checkConstraints.dine_in_orders_tracking_recovery_envelope_check.value;
    const normalizeExpression = (value) => value
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\s*([()])\s*/g, "$1")
      .replaceAll('"dine_in_orders".', "");
    assert.equal(normalizeExpression(migrationCheck[1].replace(/\)\s*$/, "")), normalizeExpression(checkSql));
    assert.equal(normalizeExpression(snapshotCheck), normalizeExpression(checkSql));

    const patternFor = (expression, field) => {
      const match = expression.match(new RegExp(`"${field}" ~ '([^']+)'`));
      assert.ok(match, `missing ${field} encoding check`);
      return new RegExp(match[1]);
    };
    const ciphertextPattern = patternFor(migrationCheck[1], "tracking_recovery_ciphertext");
    const tagPattern = patternFor(migrationCheck[1], "tracking_recovery_auth_tag");
    const noncePattern = patternFor(migrationCheck[1], "tracking_recovery_nonce");
    const validNonce = randomBytes(12).toString("base64");
    const validCiphertext = randomBytes(43).toString("base64");
    const validTag = randomBytes(16).toString("base64");
    assert.equal(noncePattern.test(validNonce), true);
    assert.equal(ciphertextPattern.test(validCiphertext), true);
    assert.equal(tagPattern.test(validTag), true);
    assert.equal(ciphertextPattern.test(noncanonicalBase64PadBits(validCiphertext)), false);
    assert.equal(tagPattern.test(noncanonicalBase64PadBits(validTag)), false);
  });

  it("includes nullable recovery fields in the fresh schema without raw token/key columns", () => {
    const migration = readFileSync(new URL("../../../drizzle/0000_init.sql", import.meta.url), "utf8");
    const snapshot = JSON.parse(readFileSync(new URL("../../../drizzle/meta/0000_snapshot.json", import.meta.url), "utf8"));
    for (const [name, type] of [
      ["tracking_recovery_version", "integer"],
      ["tracking_recovery_nonce", "text"],
      ["tracking_recovery_ciphertext", "text"],
      ["tracking_recovery_auth_tag", "text"],
    ]) {
      assert.match(migration, new RegExp(`"${name}" ${type},`));
      assert.equal(snapshot.tables["public.dine_in_orders"].columns[name].notNull, false);
    }
    assert.doesNotMatch(migration, /ADD COLUMN "(?:tracking_token|idempotency_key)"\b/i);
    assert.ok(snapshot.tables["public.dine_in_orders"].checkConstraints.dine_in_orders_tracking_recovery_envelope_check);
    const journal = JSON.parse(readFileSync(new URL("../../../drizzle/meta/_journal.json", import.meta.url), "utf8"));
    assert.deepEqual(journal.entries.map(({ idx, tag }) => ({ idx, tag })), [{ idx: 0, tag: "0000_init" }]);
  });
});

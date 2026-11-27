import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import "../../support/register-types.mjs";

const requireTs = createRequire(import.meta.url);
const { getTableConfig, PgDialect } = requireTs("drizzle-orm/pg-core");
const schema = requireTs("../../../db/schema.ts");
const dialect = new PgDialect();
const maxSafeInteger = "9007199254740991";

function tableConfig(table) {
  return getTableConfig(table);
}

function checkSql(table, name) {
  const check = tableConfig(table).checks.find((entry) => entry.name === name);
  assert.ok(check, `missing check constraint ${name}`);
  return dialect.sqlToQuery(check.value).sql;
}

function column(table, name) {
  const found = tableConfig(table).columns.find((entry) => entry.name === name);
  assert.ok(found, `missing column ${name}`);
  return found;
}

describe("normalized dine-in order schema", () => {
  it("defines the six permitted states and rejects unknown status values in its check", () => {
    const expected = [
      "pending", "confirmed", "preparing", "completed", "rejected", "cancelled",
    ];
    assert.deepEqual(schema.DINE_IN_ORDER_STATUSES, expected);
    for (const status of expected)
      assert.ok(schema.DINE_IN_ORDER_STATUSES.includes(status));
    assert.equal(schema.DINE_IN_ORDER_STATUSES.includes("shipped"), false);
    const sql = checkSql(schema.dineInOrders, "dine_in_orders_status_check");
    for (const status of expected) assert.ok(sql.includes(`'${status}'`));
    assert.equal(sql.includes("'shipped'"), false);
  });

  it("uses BIGINT millime columns with nonnegative JavaScript safe-integer checks", () => {
    for (const [table, name, constraint] of [
      [schema.dineInOrders, "subtotal_millimes", "dine_in_orders_subtotal_millimes_check"],
      [schema.dineInOrders, "total_millimes", "dine_in_orders_total_millimes_check"],
      [schema.dineInOrderItems, "unit_price_millimes", "dine_in_order_items_unit_price_millimes_check"],
      [schema.dineInOrderItems, "line_subtotal_millimes", "dine_in_order_items_line_subtotal_millimes_check"],
    ]) {
      assert.equal(column(table, name).getSQLType(), "bigint");
      const sql = checkSql(table, constraint);
      assert.ok(sql.includes(">= 0"));
      assert.ok(sql.includes(`<= ${maxSafeInteger}`));
    }
    assert.match(
      checkSql(schema.dineInOrders, "dine_in_orders_currency_check"),
      /= 'TND'/,
    );
    assert.match(
      checkSql(schema.dineInOrders, "dine_in_orders_total_equals_subtotal_check"),
      /total_millimes.*subtotal_millimes/,
    );
    assert.match(
      checkSql(schema.dineInOrderItems, "dine_in_order_items_line_total_check"),
      /unit_price_millimes.*quantity/,
    );
  });

  it("preserves table and order-item relationships without mutable catalog foreign keys", () => {
    const orderForeignKeys = tableConfig(schema.dineInOrders).foreignKeys;
    assert.equal(orderForeignKeys.length, 1);
    assert.equal(orderForeignKeys[0].onDelete, "restrict");
    assert.equal(orderForeignKeys[0].onUpdate, "restrict");
    const itemForeignKeys = tableConfig(schema.dineInOrderItems).foreignKeys;
    assert.equal(itemForeignKeys.length, 1);
    assert.equal(itemForeignKeys[0].onDelete, "restrict");
    assert.equal(column(schema.dineInOrderItems, "option_snapshots").getSQLType(), "jsonb");
    assert.match(
      checkSql(schema.dineInOrderItems, "dine_in_order_items_option_snapshots_array_check"),
      /jsonb_typeof.*array/,
    );
    for (const name of ["product_id_snapshot", "product_name_snapshot"])
      assert.ok(column(schema.dineInOrderItems, name));
  });

  it("uses a distinct unique idempotency-key digest and stable history index", () => {
    const order = tableConfig(schema.dineInOrders);
    assert.equal(column(schema.dineInOrders, "idempotency_key_hash").notNull, true);
    assert.equal(column(schema.dineInOrders, "request_hash").notNull, true);
    assert.equal(order.columns.some((entry) => entry.name === "idempotency_key"), false);
    assert.ok(order.uniqueConstraints.some((entry) => entry.name === "dine_in_orders_idempotency_key_hash_unique") ||
      order.indexes.some((entry) => entry.config.name === "dine_in_orders_idempotency_key_hash_unique" && entry.config.unique));
    assert.match(
      checkSql(schema.dineInOrders, "dine_in_orders_idempotency_key_hash_check"),
      /idempotency_key_hash.*\^\[0-9a-f\]\{64\}\$/,
    );

    const historyIndex = order.indexes.find(
      (entry) => entry.config.name === "dine_in_orders_created_id_idx",
    );
    assert.ok(historyIndex);
    assert.deepEqual(historyIndex.config.columns.map((entry) => entry.name), ["created_at", "id"]);
  });

  it("keeps the legacy orders source and copies its record fields without payload transformation", () => {
    const migration = readFileSync(
      new URL("../../../drizzle/0008_legacy_orders_archive.sql", import.meta.url),
      "utf8",
    );
    assert.match(migration, /INSERT INTO "legacy_orders_archive"\s*\("id", "legacy_storage_key", "created_at", "payload"\)\s*SELECT "id", "owner_id", "created_at", "payload"\s*FROM "orders"/s);
    assert.match(migration, /archived\."payload" IS DISTINCT FROM source\."payload"/);
    assert.match(migration, /count\(\*\).*"legacy_orders_archive"/s);
    assert.doesNotMatch(migration, /\b(?:DELETE FROM|DROP TABLE|ALTER TABLE)\s+"orders"/i);
    const archive = tableConfig(schema.legacyOrdersArchive);
    for (const name of ["id", "legacy_storage_key", "created_at", "payload"])
      assert.ok(archive.columns.some((entry) => entry.name === name));
  });

  it("keeps Drizzle snapshots and migration journal ordered through 0009", () => {
    const journal = JSON.parse(readFileSync(new URL("../../../drizzle/meta/_journal.json", import.meta.url), "utf8"));
    const snapshot8 = JSON.parse(readFileSync(new URL("../../../drizzle/meta/0008_snapshot.json", import.meta.url), "utf8"));
    const snapshot9 = JSON.parse(readFileSync(new URL("../../../drizzle/meta/0009_snapshot.json", import.meta.url), "utf8"));
    const entries = journal.entries;
    const entry8 = entries.find((entry) => entry.tag === "0008_legacy_orders_archive");
    const entry9 = entries.find((entry) => entry.tag === "0009_normalized_dine_in_orders");
    assert.ok(entry8);
    assert.ok(entry9);
    assert.equal(entry8.idx, 8);
    assert.equal(entry9.idx, 9);
    assert.ok(entry9.when > entry8.when);
    assert.equal(snapshot8.prevId, "eb32b427-a020-4b97-9927-7af1dd606751");
    assert.equal(snapshot9.prevId, snapshot8.id);
    assert.ok(snapshot9.tables["public.dine_in_orders"]);
    assert.ok(snapshot9.tables["public.dine_in_order_items"]);
    assert.ok(snapshot9.tables["public.legacy_orders_archive"]);
  });

  it("adds only the requested order corrections after 0009 and preserves migration 0008", () => {
    const migration8Url = new URL("../../../drizzle/0008_legacy_orders_archive.sql", import.meta.url);
    const normalizeLineEndings = (content) => content.toString("utf8").replace(/\r\n/g, "\n");
    const migration8Content = normalizeLineEndings(readFileSync(migration8Url));
    const migration8Hash = createHash("sha256").update(migration8Content).digest("hex");
    assert.equal(migration8Hash, "1f30ab1bc4e70b74ee1799214eab701a2a68932bc3b9c88e0b3a11e18a1d258a");
    const migration9Content = normalizeLineEndings(
      readFileSync(new URL("../../../drizzle/0009_normalized_dine_in_orders.sql", import.meta.url)),
    );
    const migration9Hash = createHash("sha256")
      .update(migration9Content)
      .digest("hex");
    assert.equal(migration9Hash, "a281886aa408927129f3e6abedea9e26733015665005f47d70731406c20cf831");
    for (const content of [migration8Content, migration9Content]) {
      const crlfContent = content.replace(/\n/g, "\r\n");
      assert.equal(
        createHash("sha256").update(normalizeLineEndings(crlfContent)).digest("hex"),
        createHash("sha256").update(content).digest("hex"),
      );
    }

    const migration10 = readFileSync(
      new URL("../../../drizzle/0010_order_idempotency_and_history.sql", import.meta.url),
      "utf8",
    );
    assert.match(migration10, /requires an empty dine_in_orders table/);
    assert.match(migration10, /ADD COLUMN "idempotency_key_hash" text NOT NULL/);
    assert.match(migration10, /idempotency_key_hash.*\^\[0-9a-f\]\{64\}\$/);
    assert.match(migration10, /UNIQUE INDEX "dine_in_orders_idempotency_key_hash_unique"/);
    assert.match(migration10, /FOREIGN KEY \("order_id"\)[\s\S]*ON DELETE RESTRICT/i);
    assert.equal((migration10.match(/ADD CONSTRAINT "dine_in_order_items_order_id_dine_in_orders_id_fk"/g) ?? []).length, 1);
    assert.match(migration10, /INDEX "dine_in_orders_created_id_idx".*\("created_at","id"\)/);
    assert.doesNotMatch(migration10, /legacy_orders_archive|ALTER TABLE "orders"|DROP TABLE/i);

    const journal = JSON.parse(readFileSync(new URL("../../../drizzle/meta/_journal.json", import.meta.url), "utf8"));
    const snapshot9 = JSON.parse(readFileSync(new URL("../../../drizzle/meta/0009_snapshot.json", import.meta.url), "utf8"));
    const snapshot10 = JSON.parse(readFileSync(new URL("../../../drizzle/meta/0010_snapshot.json", import.meta.url), "utf8"));
    const entry10 = journal.entries.find((entry) => entry.tag === "0010_order_idempotency_and_history");
    assert.ok(entry10);
    assert.equal(entry10.idx, 10);
    assert.ok(entry10.when > journal.entries.find((entry) => entry.tag === "0009_normalized_dine_in_orders").when);
    assert.equal(snapshot10.prevId, snapshot9.id);
    assert.equal(snapshot10.tables["public.dine_in_orders"].columns.idempotency_key_hash.notNull, true);
    assert.ok(snapshot10.tables["public.dine_in_orders"].indexes.dine_in_orders_idempotency_key_hash_unique);
    assert.ok(snapshot10.tables["public.dine_in_orders"].indexes.dine_in_orders_created_id_idx);
    assert.match(snapshot10.tables["public.dine_in_order_items"].foreignKeys.dine_in_order_items_order_id_dine_in_orders_id_fk.onDelete, /restrict/i);
  });
});

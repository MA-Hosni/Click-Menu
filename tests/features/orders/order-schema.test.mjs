import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import "../../support/register-types.mjs";

const requireTs = createRequire(import.meta.url);
const { getTableConfig, PgDialect } = requireTs("drizzle-orm/pg-core");
const schema = requireTs("../../../db/schema.ts");
const dialect = new PgDialect();
const maxSafeInteger = "9007199254740991";
const initialMigrationUrl = new URL("../../../drizzle/0000_init.sql", import.meta.url);
const snapshotUrl = new URL("../../../drizzle/meta/0000_snapshot.json", import.meta.url);
const journalUrl = new URL("../../../drizzle/meta/_journal.json", import.meta.url);

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

  it("uses BIGINT fixed-scale amounts with nonnegative JavaScript safe-integer checks", () => {
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
    assert.equal(tableConfig(schema.dineInOrders).columns.some((entry) => entry.name === "currency"), false);
    assert.match(
      checkSql(schema.dineInOrders, "dine_in_orders_total_equals_subtotal_check"),
      /total_millimes.*subtotal_millimes/,
    );
    assert.match(
      checkSql(schema.dineInOrderItems, "dine_in_order_items_line_total_check"),
      /unit_price_millimes.*quantity/,
    );
  });

  it("preserves order and table relationships without mutable catalog foreign keys", () => {
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

  it("keeps the legacy order source and immutable archive tables in the fresh schema", () => {
    for (const [table, names] of [
      [schema.orders, ["id", "owner_id", "created_at", "payload"]],
      [schema.legacyOrdersArchive, ["id", "legacy_storage_key", "created_at", "payload"]],
    ])
      for (const name of names) assert.ok(column(table, name));
  });

  it("keeps idempotency uniqueness and the stable order-history index", () => {
    const order = tableConfig(schema.dineInOrders);
    assert.equal(column(schema.dineInOrders, "idempotency_key_hash").notNull, true);
    assert.equal(column(schema.dineInOrders, "request_hash").notNull, true);
    assert.equal(order.columns.some((entry) => entry.name === "idempotency_key"), false);
    assert.ok(order.indexes.some((entry) => entry.config.name === "dine_in_orders_idempotency_key_hash_unique" && entry.config.unique));
    assert.match(
      checkSql(schema.dineInOrders, "dine_in_orders_idempotency_key_hash_check"),
      /idempotency_key_hash.*\^\[0-9a-f\]\{64\}\$/,
    );
    const historyIndex = order.indexes.find((entry) => entry.config.name === "dine_in_orders_created_id_idx");
    assert.ok(historyIndex);
    assert.deepEqual(historyIndex.config.columns.map((entry) => entry.name), ["created_at", "id"]);
  });

  it("has one generated initial migration and metadata matching every Drizzle table", () => {
    const migration = readFileSync(initialMigrationUrl, "utf8");
    const snapshot = JSON.parse(readFileSync(snapshotUrl, "utf8"));
    const journal = JSON.parse(readFileSync(journalUrl, "utf8"));
    const expectedTableNames = [
      "admin_audit_events",
      "admin_credentials",
      "dine_in_order_items",
      "dine_in_orders",
      "image_upload_capacity",
      "legacy_orders_archive",
      "menu_images",
      "orders",
      "rate_limits",
      "restaurant_catalogs",
      "restaurant_tables",
      "sessions",
    ];

    assert.deepEqual(Object.keys(snapshot.tables).map((name) => name.replace("public.", "")).sort(), expectedTableNames);
    assert.deepEqual(journal.entries.map(({ idx, tag }) => ({ idx, tag })), [{ idx: 0, tag: "0000_init" }]);
    assert.equal((migration.match(/CREATE TABLE /g) ?? []).length, expectedTableNames.length);
    assert.doesNotMatch(migration, /\bcurrency\b|\busers\b|\blogin_codes\b|owner_credential_events/iu);
    assert.match(migration, /INSERT INTO "image_upload_capacity" \("id", "image_count"\)\s*VALUES \(1, 0\)/u);

    for (const table of Object.values(schema).filter((value) => value && typeof value === "object" && "_" in value)) {
      let config;
      try {
        config = tableConfig(table);
      } catch {
        continue;
      }
      const current = snapshot.tables[`public.${config.name}`];
      assert.ok(current, `snapshot missing table ${config.name}`);
      assert.deepEqual(Object.keys(current.columns).sort(), config.columns.map(({ name }) => name).sort());
      assert.deepEqual(Object.keys(current.checkConstraints).sort(), config.checks.map(({ name }) => name).sort());
      assert.deepEqual(Object.keys(current.indexes).sort(), config.indexes.map(({ config: index }) => index.name).sort());
      assert.equal(Object.keys(current.foreignKeys).length, config.foreignKeys.length);
      assert.match(migration, new RegExp(`CREATE TABLE "${config.name}"`, "u"));
    }
  });
});

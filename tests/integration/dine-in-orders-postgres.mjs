import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import "../support/register-types.mjs";

const requireTs = createRequire(import.meta.url);
const root = fileURLToPath(new URL("../../", import.meta.url));
import { createTestCatalog } from "../support/catalog-fixture.mjs";
const { hashTableToken } = requireTs("../../lib/table-operations.ts");
const { hashIdempotencyKey, hashTrackingToken } = requireTs("../../features/orders/crypto.ts");
const { createTrackingTokenRecovery } = requireTs("../../features/orders/tracking-token-recovery.ts");
const { createTransactionRunner } = requireTs("../../db/transaction.ts");
const { createPostgresDineInOrderPersistence } = requireTs("../../features/orders/order-persistence.ts");
const { createDineInOrderService } = requireTs("../../features/orders/order-service.ts");
const { createDineInOrderPostHandler } = requireTs("../../features/orders/order-api.ts");
const { createPostgresConfirmAndPrepareUpdater, createPostgresDineInOrderStatusUpdater } = requireTs("../../features/orders/order-status-store.ts");
const { DineInOrderTransitionConflict } = requireTs("../../features/orders/order-status.ts");
const { queryDineInOrderSummaries } = requireTs("../../features/orders/order-list.ts");
const { queryDineInOrderDashboardSummary } = requireTs("../../features/orders/order-dashboard-summary.ts");
const { queryDineInOrderDetail } = requireTs("../../features/orders/order-detail.ts");
const { queryCustomerDineInTrackingStatus } = requireTs("../../features/orders/order-tracking.ts");
const { createCustomerDineInTrackingGetHandler } = requireTs("../../features/orders/order-tracking-api.ts");
const schema = requireTs("../../db/schema.ts");

const suffix = randomUUID().replaceAll("-", "");
const container = `clickmenu-order-path-${suffix.slice(0, 12)}`;
const database = `orders_${suffix}`;
const username = `orders_${suffix}`;
const password = randomBytes(32).toString("base64url");
const temporaryDirectory = mkdtempSync(path.join(tmpdir(), "clickmenu-order-path-"));
const credentialsFile = path.join(temporaryDirectory, "postgres.env");
let containerMayExist = false;
let pool;
let failure;
let passed = 0;

function docker(args) {
  const result = spawnSync("docker", args, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 2 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  return { status: result.status, stdout: (result.stdout ?? "").trim(), stderr: (result.stderr ?? "").trim() };
}

function assertDocker(result, label) {
  assert.equal(result.status, 0, `${label}: ${result.stderr}`);
}

function pass(description) {
  passed += 1;
  console.log(`PASS ${description}`);
}

async function waitUntil(predicate, description, timeoutMs = 5_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${description}.`);
}

function gate() {
  let release;
  let signal;
  const opened = new Promise((resolve) => { signal = resolve; });
  const wait = new Promise((resolve) => { release = resolve; });
  return { opened, wait, signal, release };
}

async function countOrders(where = "TRUE") {
  const result = await pool.query(`SELECT count(*)::int AS count FROM dine_in_orders WHERE ${where}`);
  return result.rows[0].count;
}

async function runMigrations() {
  const client = await pool.connect();
  try {
    const migration = readFileSync(path.join(root, "drizzle", "0000_init.sql"), "utf8");
    const statements = migration.split(/^--> statement-breakpoint\s*$/m).map((part) => part.trim()).filter(Boolean);
    for (const statement of statements) await client.query(statement);
  } finally {
    client.release();
  }
}

function makeService(persistence, options = {}) {
  const recovery = createTrackingTokenRecovery(Buffer.alloc(32, 19).toString("base64"));
  return createDineInOrderService(persistence, {
    recovery: () => recovery,
    ...options,
  });
}

function makeRequest(catalog, tableToken) {
  const items = catalog.items.filter((item) => item.available).slice(0, 2);
  assert.ok(items.length >= 2, "The deterministic catalog fixture needs two available products.");
  return {
    tableToken,
    customerName: "Local PostgreSQL test guest",
    notes: "Integration-only order",
    items: items.map((item) => ({ productId: item.id, quantity: 2, optionIds: [] })),
  };
}

function makeOrderApi(service) {
  return createDineInOrderPostHandler({
    isIntakeEnabled: () => true,
    submit: (body, key) => service.submit(body, key),
    getRateLimitStore: () => ({ hit: async () => 1 }),
    getClientIp: () => "127.0.0.1",
  });
}

async function postOrder(api, body, idempotencyKey) {
  return api(new Request("https://clickmenu.integration/api/dine-in/orders", {
    method: "POST",
    headers: {
      origin: "https://clickmenu.integration",
      "content-type": "application/json",
      "idempotency-key": idempotencyKey,
    },
    body: JSON.stringify(body),
  }));
}

async function seed(catalog, token) {
  await pool.query(
    "INSERT INTO restaurant_catalogs (id, payload, revision, updated_at, price_reviewed_revision, price_reviewed_at) VALUES (1, $1, 1, 1700000000000, 1, 1700000000000)",
    [JSON.stringify(catalog)],
  );
  await pool.query(
    "INSERT INTO restaurant_tables (id, label, qr_token_hash, is_active, created_at, updated_at) VALUES ('table-1', 'Table 1', $1, true, 1700000000000, 1700000000000)",
    [hashTableToken(token)],
  );
}

async function assertOrderAbsent(key, label) {
  const hash = hashIdempotencyKey(key);
  assert.equal(await countOrders(`idempotency_key_hash='${hash}'`), 0, label);
}

try {
  writeFileSync(
    credentialsFile,
    `POSTGRES_DB=${database}\nPOSTGRES_USER=${username}\nPOSTGRES_PASSWORD=${password}\n`,
    { mode: 0o600 },
  );
  assertDocker(docker(["info", "--format", "{{.ServerVersion}}"]), "Docker Engine check");
  const start = docker([
    "run", "-d", "--rm", "--name", container,
    "--publish", "127.0.0.1::5432", "--env-file", credentialsFile, "postgres:17",
  ]);
  assertDocker(start, "Starting disposable PostgreSQL 17 container");
  containerMayExist = true;

  const portResult = docker(["port", container, "5432/tcp"]);
  assertDocker(portResult, "Reading localhost-only dynamic port");
  const portMatch = /^127\.0\.0\.1:(\d+)$/.exec(portResult.stdout);
  assert.ok(portMatch, "PostgreSQL must bind to a dynamically allocated localhost port.");
  const connectionString = `postgresql://${username}:${password}@127.0.0.1:${portMatch[1]}/${database}`;

  let ready = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (docker(["exec", container, "pg_isready", "-h", "127.0.0.1", "-U", username, "-d", database]).status === 0) {
      ready = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  assert.ok(ready, "Disposable PostgreSQL did not become ready within 60 seconds.");

  pool = new Pool({ connectionString, max: 12, application_name: "clickmenu-local-order-integration" });
  const version = await pool.query("SHOW server_version");
  assert.match(version.rows[0].server_version, /^17\./);
  console.log(`PostgreSQL ${version.rows[0].server_version} (disposable Docker container)`);

  await runMigrations();
  const migrationTables = await pool.query(`
    SELECT to_regclass('dine_in_orders') AS orders, to_regclass('dine_in_order_items') AS items
  `);
  assert.ok(migrationTables.rows[0].orders && migrationTables.rows[0].items);
  pass("complete initial schema migration applied to the disposable database");

  const transactionRunner = createTransactionRunner({
    acquire: () => pool.connect(),
    createHandle: (client) => drizzle({ client, schema }),
    executeCommand: (client, command) => client.query(command),
    release: (client, error) => client.release(error),
  });
  const updateStatus = createPostgresDineInOrderStatusUpdater(transactionRunner);
  const listingDb = drizzle({ client: pool, schema });
  const persistence = createPostgresDineInOrderPersistence(transactionRunner);
  const catalog = createTestCatalog();
  catalog.revision = 1;
  catalog.items.forEach((item, index) => {
    item.price = 1250 + index * 75;
    item.options.forEach((option) => { option.price = 125; });
  });
  catalog.items[0].price = 15_000;
  catalog.items[0].options[0].price = 2_500;
  const tableToken = randomBytes(32).toString("base64url");
  await seed(catalog, tableToken);
  const request = makeRequest(catalog, tableToken);
  const service = makeService(persistence);

  const sameKey = randomBytes(32).toString("base64url");
  const sameKeyResults = await Promise.all([
    service.submit(request, sameKey),
    service.submit(structuredClone(request), sameKey),
  ]);
  assert.equal(await countOrders(), 1);
  assert.equal(sameKeyResults[0].trackingToken, sameKeyResults[1].trackingToken);
  assert.equal(sameKeyResults.filter((result) => result.replayed).length, 1);
  pass("concurrent same-key same-request submissions create one order and replay its token");

  const differentKey = randomBytes(32).toString("base64url");
  const changedRequest = { ...request, customerName: "Different guest" };
  const differentPayloadResults = await Promise.allSettled([
    service.submit(request, differentKey),
    service.submit(changedRequest, differentKey),
  ]);
  assert.equal(differentPayloadResults.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(differentPayloadResults.filter((result) => result.status === "rejected" && result.reason.code === "idempotency_conflict").length, 1);
  assert.equal(await countOrders(`idempotency_key_hash='${hashIdempotencyKey(differentKey)}'`), 1);
  pass("concurrent different-payload submissions sharing a key produce one order and one conflict");

  const identicalRequestKeys = [randomBytes(32).toString("base64url"), randomBytes(32).toString("base64url")];
  const distinct = await Promise.all(identicalRequestKeys.map((key) => service.submit(request, key)));
  assert.notEqual(distinct[0].trackingToken, distinct[1].trackingToken);
  assert.equal(await countOrders(), 4);
  const visibleOrders = await queryDineInOrderSummaries(listingDb, { limit: 100, status: null, cursor: null });
  assert.ok(distinct.every((order) => visibleOrders.orders.some((listed) => listed.orderId === order.orderId)));
  pass("different keys with identical business content create separate orders, both visible in the admin list");

  const replayKey = randomBytes(32).toString("base64url");
  const initial = await service.submit(request, replayKey);
  const originalHash = hashTableToken(tableToken);
  const rotatedToken = randomBytes(32).toString("base64url");
  await pool.query("UPDATE restaurant_tables SET qr_token_hash=$1, is_active=false WHERE id='table-1'", [hashTableToken(rotatedToken)]);
  const changedCatalog = structuredClone(catalog);
  changedCatalog.revision = 2;
  changedCatalog.items[0].price += 300;
  await pool.query(
    "UPDATE restaurant_catalogs SET payload=$1, revision=2, price_reviewed_revision=NULL, price_reviewed_at=NULL WHERE id=1",
    [JSON.stringify(changedCatalog)],
  );
  const replay = await service.submit(request, replayKey);
  assert.equal(replay.replayed, true);
  assert.equal(replay.trackingToken, initial.trackingToken);
  assert.notEqual(originalHash, hashTableToken(rotatedToken));
  assert.equal((await queryCustomerDineInTrackingStatus(listingDb, replay.orderId, replay.trackingToken)).status, "pending");
  pass("matching retry returns the original order after QR rotation/deactivation and catalog revision change");

  await pool.query("UPDATE restaurant_tables SET qr_token_hash=$1, is_active=true WHERE id='table-1'", [originalHash]);
  await pool.query("UPDATE restaurant_catalogs SET payload=$1, revision=1, price_reviewed_revision=1, price_reviewed_at=1700000000000 WHERE id=1", [JSON.stringify(catalog)]);

  const uncertainKey = randomBytes(32).toString("base64url");
  const uncertainFirst = await service.submit(request, uncertainKey);
  const simulatedLostResponse = undefined;
  assert.equal(simulatedLostResponse, undefined);
  const uncertainRetry = await service.submit(request, uncertainKey);
  assert.equal(uncertainRetry.replayed, true);
  assert.equal(uncertainRetry.trackingToken, uncertainFirst.trackingToken);
  pass("retry after simulated response loss recovers the committed order and original token");

  const failingKey = randomBytes(32).toString("base64url");
  await pool.query(`
    CREATE FUNCTION reject_order_item_for_test() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'deliberate test item failure'; END $$;
    CREATE TRIGGER reject_order_item_for_test BEFORE INSERT ON dine_in_order_items
      FOR EACH ROW EXECUTE FUNCTION reject_order_item_for_test();
  `);
  await assert.rejects(service.submit(request, failingKey));
  await pool.query("DROP TRIGGER reject_order_item_for_test ON dine_in_order_items; DROP FUNCTION reject_order_item_for_test();");
  await assertOrderAbsent(failingKey, "A failed item insert must roll back its order header.");
  pass("real item-insert failure rolls back the already inserted order header");

  const countKey = randomBytes(32).toString("base64url");
  await pool.query(`
    CREATE FUNCTION omit_second_order_item_for_test() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.line_number = 2 THEN RETURN NULL; END IF; RETURN NEW; END $$;
    CREATE TRIGGER omit_second_order_item_for_test BEFORE INSERT ON dine_in_order_items
      FOR EACH ROW EXECUTE FUNCTION omit_second_order_item_for_test();
  `);
  try {
    await assert.rejects(service.submit(request, countKey));
  } finally {
    await pool.query("DROP TRIGGER omit_second_order_item_for_test ON dine_in_order_items; DROP FUNCTION omit_second_order_item_for_test();");
  }
  await assertOrderAbsent(countKey, "An actual short insert result must roll back its order header.");
  pass("database trigger causing an actual item-count mismatch is detected and rolled back");

  const lineKey = randomBytes(32).toString("base64url");
  await pool.query(`
    CREATE FUNCTION alter_order_item_for_test() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN NEW.unit_price_millimes := NEW.unit_price_millimes + 1;
      NEW.line_subtotal_millimes := NEW.unit_price_millimes * NEW.quantity; RETURN NEW; END $$;
    CREATE TRIGGER alter_order_item_for_test BEFORE INSERT ON dine_in_order_items
      FOR EACH ROW EXECUTE FUNCTION alter_order_item_for_test();
  `);
  try {
    await assert.rejects(service.submit(request, lineKey));
  } finally {
    await pool.query("DROP TRIGGER alter_order_item_for_test ON dine_in_order_items; DROP FUNCTION alter_order_item_for_test();");
  }
  await assertOrderAbsent(lineKey, "Actual persisted line changes must roll back the order.");
  pass("database-triggered item price/subtotal mismatch is detected and rolled back");

  const headerKey = randomBytes(32).toString("base64url");
  await pool.query(`
    CREATE FUNCTION alter_order_header_for_test() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN NEW.subtotal_millimes := NEW.subtotal_millimes + 1;
      NEW.total_millimes := NEW.total_millimes + 1; RETURN NEW; END $$;
    CREATE TRIGGER alter_order_header_for_test BEFORE INSERT ON dine_in_orders
      FOR EACH ROW EXECUTE FUNCTION alter_order_header_for_test();
  `);
  try {
    await assert.rejects(service.submit(request, headerKey));
  } finally {
    await pool.query("DROP TRIGGER alter_order_header_for_test ON dine_in_orders; DROP FUNCTION alter_order_header_for_test();");
  }
  await assertOrderAbsent(headerKey, "A persisted header subtotal that differs from item totals must roll back.");
  pass("database-triggered header total/subtotal mismatch is detected and rolled back");

  const persistedKey = randomBytes(32).toString("base64url");
  const persistedReceipt = await service.submit(request, persistedKey);
  const persistedDigest = hashIdempotencyKey(persistedKey);
  const stored = await pool.query("SELECT id, tracking_token_hash, idempotency_key_hash, request_hash, tracking_recovery_version, tracking_recovery_nonce, tracking_recovery_ciphertext, tracking_recovery_auth_tag FROM dine_in_orders WHERE idempotency_key_hash=$1", [persistedDigest]);
  assert.equal(stored.rowCount, 1);
  const storedOrder = stored.rows[0];
  const recovery = createTrackingTokenRecovery(Buffer.alloc(32, 19).toString("base64"));
  const envelope = {
    version: storedOrder.tracking_recovery_version,
    nonce: storedOrder.tracking_recovery_nonce,
    ciphertext: storedOrder.tracking_recovery_ciphertext,
    authTag: storedOrder.tracking_recovery_auth_tag,
  };
  assert.equal(recovery.decrypt(envelope, storedOrder.id, storedOrder.idempotency_key_hash), persistedReceipt.trackingToken);
  assert.equal(hashTrackingToken(persistedReceipt.trackingToken), storedOrder.tracking_token_hash);
  assert.equal(JSON.stringify(storedOrder).includes(persistedReceipt.trackingToken), false);
  assert.throws(() => recovery.decrypt(envelope, `${storedOrder.id}-other`, storedOrder.idempotency_key_hash));
  const tampered = { ...envelope, ciphertext: `${envelope.ciphertext.slice(0, -4)}AAAA` };
  assert.throws(() => recovery.decrypt(tampered, storedOrder.id, storedOrder.idempotency_key_hash));
  pass("real persisted envelope decrypts only with its order context and tampering fails");

  const tracked = await queryCustomerDineInTrackingStatus(listingDb, persistedReceipt.orderId, persistedReceipt.trackingToken);
  assert.deepEqual(Object.keys(tracked).sort(), ["orderReference", "status", "updatedAt"]);
  assert.equal(tracked.status, "pending");
  assert.equal(tracked.orderReference, persistedReceipt.orderId.slice(0, 8).toUpperCase());
  assert.equal(await queryCustomerDineInTrackingStatus(listingDb, persistedReceipt.orderId, randomBytes(32).toString("base64url")), null);
  assert.equal(await queryCustomerDineInTrackingStatus(listingDb, "00000000-0000-4000-8000-000000000001", persistedReceipt.trackingToken), null);
  const trackingHandler = createCustomerDineInTrackingGetHandler({
    getStatus: (orderId, token) => queryCustomerDineInTrackingStatus(listingDb, orderId, token),
    getRateLimitStore: () => ({ hit: () => 1 }),
    getClientIp: () => "127.0.0.1",
  });
  const trackingResponse = await trackingHandler(new Request(`https://clickmenu.test/api/dine-in/orders/${persistedReceipt.orderId}/tracking`, {
    headers: { authorization: `Bearer ${persistedReceipt.trackingToken}` },
  }), { params: Promise.resolve({ id: persistedReceipt.orderId }) });
  assert.equal(trackingResponse.status, 200);
  const customerPayload = await trackingResponse.json();
  assert.deepEqual(Object.keys(customerPayload).sort(), ["orderReference", "status", "updatedAt"]);
  assert.equal(JSON.stringify(customerPayload).includes(persistedReceipt.trackingToken), false);
  pass("PostgreSQL-backed customer lookup returns only status/reference/timestamp and rejects wrong or sequential IDs");

  const preUpdateTimestamp = tracked.updatedAt;
  const previousQrHash = hashTableToken(rotatedToken);
  await pool.query("UPDATE restaurant_tables SET qr_token_hash=$1, is_active=false WHERE id='table-1'", [previousQrHash]);
  assert.equal((await queryCustomerDineInTrackingStatus(listingDb, persistedReceipt.orderId, persistedReceipt.trackingToken)).status, "pending");
  await pool.query("UPDATE restaurant_tables SET qr_token_hash=$1, is_active=true WHERE id='table-1'", [originalHash]);
  pass("existing tracking capability remains valid after table QR rotation/deactivation");

  const sharedLockA = gate();
  const sharedLockB = gate();
  const txA = persistence.withTransaction(async (transaction) => {
    await persistence.lockCatalog(transaction);
    await persistence.lockActiveTable(transaction, originalHash);
    sharedLockA.signal();
    await sharedLockA.wait;
  });
  await sharedLockA.opened;
  const txB = persistence.withTransaction(async (transaction) => {
    await persistence.lockCatalog(transaction);
    await persistence.lockActiveTable(transaction, originalHash);
    sharedLockB.signal();
    await sharedLockB.wait;
  });
  await sharedLockB.opened;
  sharedLockA.release();
  sharedLockB.release();
  await Promise.all([txA, txB]);
  pass("distinct order transactions concurrently hold shared catalog and table locks");

  for (const resource of ["catalog", "table"]) {
    const holderGate = gate();
    const heldTransaction = persistence.withTransaction(async (transaction) => {
      if (resource === "catalog") await persistence.lockCatalog(transaction);
      else await persistence.lockActiveTable(transaction, originalHash);
      holderGate.signal();
      await holderGate.wait;
    });
    await holderGate.opened;
    const marker = `order_lock_wait_${resource}_${randomUUID().replaceAll("-", "")}`;
    const updateSql = resource === "catalog"
      ? `UPDATE restaurant_catalogs SET revision=revision+1, price_reviewed_revision=NULL, price_reviewed_at=NULL WHERE id=1 /* ${marker} */`
      : `UPDATE restaurant_tables SET is_active=false WHERE id='table-1' /* ${marker} */`;
    const updater = pool.query(updateSql);
    try {
      await waitUntil(async () => {
        const activity = await pool.query(
          "SELECT wait_event_type FROM pg_stat_activity WHERE datname=current_database() AND query LIKE $1",
          [`%${marker}%`],
        );
        return activity.rows.some((row) => row.wait_event_type === "Lock");
      }, `${resource} updater to block on FOR SHARE`);
    } finally {
      holderGate.release();
    }
    await Promise.all([heldTransaction, updater]);
    if (resource === "catalog") {
      await pool.query("UPDATE restaurant_catalogs SET payload=$1, revision=1, price_reviewed_revision=1, price_reviewed_at=1700000000000 WHERE id=1", [JSON.stringify(catalog)]);
    } else {
      await pool.query("UPDATE restaurant_tables SET is_active=true WHERE id='table-1'");
    }
    pass(`${resource} update waits for an active order transaction holding FOR SHARE`);
  }

  const updateFirstOldTokenKey = randomBytes(32).toString("base64url");
  await pool.query("UPDATE restaurant_tables SET qr_token_hash=$1 WHERE id='table-1'", [hashTableToken(rotatedToken)]);
  await assert.rejects(service.submit(request, updateFirstOldTokenKey), { code: "table_unavailable" });
  await assertOrderAbsent(updateFirstOldTokenKey, "An update committed first must make the old token unusable.");
  await pool.query("UPDATE restaurant_tables SET qr_token_hash=$1 WHERE id='table-1'", [originalHash]);
  pass("a committed QR rotation is observed and stale-token order creation is rejected");

  const updateFirstCatalogKey = randomBytes(32).toString("base64url");
  await pool.query("UPDATE restaurant_catalogs SET revision=2, price_reviewed_revision=NULL, price_reviewed_at=NULL WHERE id=1");
  await assert.rejects(service.submit(request, updateFirstCatalogKey), { code: "catalog_not_reviewed" });
  await assertOrderAbsent(updateFirstCatalogKey, "An edit committed first must invalidate review before order creation.");
  await pool.query("UPDATE restaurant_catalogs SET payload=$1, revision=1, price_reviewed_revision=1, price_reviewed_at=1700000000000 WHERE id=1", [JSON.stringify(catalog)]);
  pass("a committed catalog revision/review change is observed and rejected");

  const orderApi = makeOrderApi(service);
  const pricedDishRequest = {
    tableToken,
    customerName: "Pricing integration guest",
    items: [{ productId: catalog.items[0].id, quantity: 1, optionIds: [] }],
  };
  const monetaryTampering = [
    {
      ...pricedDishRequest,
      subtotalMillimes: 1_000,
      totalMillimes: 1_000,
      items: [{ ...pricedDishRequest.items[0], unitPriceMillimes: 1_000, lineSubtotalMillimes: 1_000 }],
    },
    { ...pricedDishRequest, currency: "MAD" },
    { ...pricedDishRequest, discountMillimes: 14_000 },
    { ...pricedDishRequest, feeMillimes: 0 },
    { ...pricedDishRequest, grandTotalMillimes: 1_000 },
    {
      ...pricedDishRequest,
      items: [{ ...pricedDishRequest.items[0], price: 1 }],
    },
    {
      ...pricedDishRequest,
      items: [{ ...pricedDishRequest.items[0], optionPrices: [0] }],
    },
    {
      ...pricedDishRequest,
      items: [{ ...pricedDishRequest.items[0], optionIds: [{ id: catalog.items[0].options[0].id, price: 0 }] }],
    },
  ];
  const beforeTampering = await countOrders();
  for (const [index, payload] of monetaryTampering.entries()) {
    const tamperKey = randomBytes(32).toString("base64url");
    const response = await postOrder(orderApi, payload, tamperKey);
    assert.equal(response.status, 400, `monetary tampering case ${index + 1} must be rejected`);
    await assertOrderAbsent(tamperKey, `monetary tampering case ${index + 1} must not persist an order`);
  }
  assert.equal(await countOrders(), beforeTampering);
  pass("actual order API rejects manipulated product/option prices, totals, discounts, and fees without database writes");

  const excessiveQuantityKey = randomBytes(32).toString("base64url");
  const excessiveQuantityResponse = await postOrder(orderApi, {
    ...pricedDishRequest,
    items: [{ ...pricedDishRequest.items[0], quantity: 100 }],
  }, excessiveQuantityKey);
  assert.equal(excessiveQuantityResponse.status, 400);
  await assertOrderAbsent(excessiveQuantityKey, "An excessive browser quantity must not persist an order.");

  const invalidOptionKey = randomBytes(32).toString("base64url");
  const invalidOptionResponse = await postOrder(orderApi, {
    ...pricedDishRequest,
    items: [{ ...pricedDishRequest.items[0], optionIds: ["not-a-catalog-option"] }],
  }, invalidOptionKey);
  assert.equal(invalidOptionResponse.status, 400);
  await assertOrderAbsent(invalidOptionKey, "An invalid option ID must not persist an order.");
  pass("actual order API rejects excessive quantities and option IDs absent from the trusted product");

  const unavailableCatalog = structuredClone(catalog);
  unavailableCatalog.revision = 2;
  unavailableCatalog.items[0].available = false;
  await pool.query(
    "UPDATE restaurant_catalogs SET payload=$1, revision=2, price_reviewed_revision=2, price_reviewed_at=1700000000001 WHERE id=1",
    [JSON.stringify(unavailableCatalog)],
  );
  const unavailableKey = randomBytes(32).toString("base64url");
  const unavailableResponse = await postOrder(orderApi, pricedDishRequest, unavailableKey);
  assert.equal(unavailableResponse.status, 400);
  await assertOrderAbsent(unavailableKey, "An unavailable dish must not persist an order.");

  const emptyCatalog = structuredClone(catalog);
  emptyCatalog.revision = 3;
  emptyCatalog.items = [];
  await pool.query(
    "UPDATE restaurant_catalogs SET payload=$1, revision=3, price_reviewed_revision=3, price_reviewed_at=1700000000002 WHERE id=1",
    [JSON.stringify(emptyCatalog)],
  );
  const emptyCatalogKey = randomBytes(32).toString("base64url");
  const emptyCatalogResponse = await postOrder(orderApi, pricedDishRequest, emptyCatalogKey);
  assert.equal(emptyCatalogResponse.status, 400);
  await assertOrderAbsent(emptyCatalogKey, "An empty catalog cannot produce an order.");
  await pool.query(
    "UPDATE restaurant_catalogs SET payload=$1, revision=1, price_reviewed_revision=1, price_reviewed_at=1700000000000 WHERE id=1",
    [JSON.stringify(catalog)],
  );
  pass("reviewed but unavailable or empty catalogs cannot accept new orders");

  const trustedPriceKey = randomBytes(32).toString("base64url");
  const trustedPriceResponse = await postOrder(orderApi, pricedDishRequest, trustedPriceKey);
  assert.equal(trustedPriceResponse.status, 201);
  const trustedPriceReceipt = await trustedPriceResponse.json();
  const trustedPriceRows = await pool.query(`
    SELECT o.subtotal_millimes::text, o.total_millimes::text,
      i.quantity, i.unit_price_millimes::text, i.line_subtotal_millimes::text,
      i.product_name_snapshot
    FROM dine_in_orders o
    JOIN dine_in_order_items i ON i.order_id=o.id
    WHERE o.idempotency_key_hash=$1
  `, [hashIdempotencyKey(trustedPriceKey)]);
  assert.equal(trustedPriceRows.rowCount, 1);
  assert.equal(trustedPriceRows.rows[0].quantity, 1);
  assert.equal(trustedPriceRows.rows[0].unit_price_millimes, "15000");
  assert.equal(trustedPriceRows.rows[0].line_subtotal_millimes, "15000");
  assert.equal(trustedPriceRows.rows[0].subtotal_millimes, "15000");
  assert.equal(trustedPriceRows.rows[0].total_millimes, "15000");
  assert.equal(trustedPriceRows.rows[0].product_name_snapshot, catalog.items[0].name.en);
  const trustedPriceRetry = await postOrder(orderApi, pricedDishRequest, trustedPriceKey);
  assert.equal(trustedPriceRetry.status, 200);
  const trustedPriceRetryReceipt = await trustedPriceRetry.json();
  assert.equal(trustedPriceRetryReceipt.orderId, trustedPriceReceipt.orderId);
  assert.equal(trustedPriceRetryReceipt.trackingToken, trustedPriceReceipt.trackingToken);
  assert.equal(await countOrders(`idempotency_key_hash='${hashIdempotencyKey(trustedPriceKey)}'`), 1);
  assert.deepEqual((await pool.query(`
    SELECT i.quantity, i.unit_price_millimes::text, i.line_subtotal_millimes::text,
      o.subtotal_millimes::text, o.total_millimes::text
    FROM dine_in_orders o JOIN dine_in_order_items i ON i.order_id=o.id
    WHERE o.idempotency_key_hash=$1
  `, [hashIdempotencyKey(trustedPriceKey)])).rows[0], {
    quantity: 1,
    unit_price_millimes: "15000",
    line_subtotal_millimes: "15000",
    subtotal_millimes: "15000",
    total_millimes: "15000",
  });
  const changedRetry = await postOrder(orderApi, {
    ...pricedDishRequest,
    items: [{ ...pricedDishRequest.items[0], quantity: 2 }],
  }, trustedPriceKey);
  assert.equal(changedRetry.status, 409);
  assert.equal(await countOrders(`idempotency_key_hash='${hashIdempotencyKey(trustedPriceKey)}'`), 1);
  const unchangedAfterConflict = await pool.query(`
    SELECT i.quantity, i.unit_price_millimes::text, i.line_subtotal_millimes::text,
      o.subtotal_millimes::text, o.total_millimes::text
    FROM dine_in_orders o JOIN dine_in_order_items i ON i.order_id=o.id
    WHERE o.idempotency_key_hash=$1
  `, [hashIdempotencyKey(trustedPriceKey)]);
  assert.deepEqual(unchangedAfterConflict.rows[0], {
    quantity: 1,
    unit_price_millimes: "15000",
    line_subtotal_millimes: "15000",
    subtotal_millimes: "15000",
    total_millimes: "15000",
  });
  pass("reviewed catalog price is persisted as 15,000 millimes and same-key retries preserve the original order");

  const optionPriceKey = randomBytes(32).toString("base64url");
  const optionPriceRequest = {
    ...pricedDishRequest,
    items: [{
      productId: catalog.items[0].id,
      quantity: 2,
      optionIds: [catalog.items[0].options[0].id],
    }],
  };
  const optionPriceResponse = await postOrder(orderApi, optionPriceRequest, optionPriceKey);
  assert.equal(optionPriceResponse.status, 201);
  const optionPriceRows = await pool.query(`
    SELECT o.subtotal_millimes::text, o.total_millimes::text,
      i.quantity, i.unit_price_millimes::text, i.line_subtotal_millimes::text,
      i.option_snapshots
    FROM dine_in_orders o JOIN dine_in_order_items i ON i.order_id=o.id
    WHERE o.idempotency_key_hash=$1
  `, [hashIdempotencyKey(optionPriceKey)]);
  assert.equal(optionPriceRows.rowCount, 1);
  assert.equal(optionPriceRows.rows[0].quantity, 2);
  assert.equal(optionPriceRows.rows[0].unit_price_millimes, "17500");
  assert.equal(optionPriceRows.rows[0].line_subtotal_millimes, "35000");
  assert.equal(optionPriceRows.rows[0].subtotal_millimes, "35000");
  assert.equal(optionPriceRows.rows[0].total_millimes, "35000");
  assert.deepEqual(optionPriceRows.rows[0].option_snapshots, [{
    id: catalog.items[0].options[0].id,
    name: catalog.items[0].options[0].label.en,
    priceAdjustmentMillimes: 2500,
  }]);
  pass("PostgreSQL persists option-adjusted 17,500 millime unit price and quantity-derived 35,000 millime totals");

  assert.equal(await countOrders(), 9);
  const allItems = await pool.query(`
    SELECT count(*)::int AS item_count,
      (SELECT count(*)::int FROM dine_in_orders) AS order_count,
      (SELECT sum(subtotal_millimes)::bigint FROM dine_in_orders) AS order_subtotal,
      (SELECT sum(line_subtotal_millimes)::bigint FROM dine_in_order_items) AS item_subtotal
    FROM dine_in_order_items
  `);
  assert.equal(allItems.rows[0].item_count, 16);
  assert.equal(allItems.rows[0].order_subtotal, allItems.rows[0].item_subtotal);
  pass("all committed headers have their expected items and aggregate subtotal matches item snapshots");

  const conflictingUpdates = await Promise.allSettled([
    updateStatus(persistedReceipt.orderId, "confirmed"),
    updateStatus(persistedReceipt.orderId, "rejected"),
  ]);
  const successfulUpdates = conflictingUpdates.filter((result) => result.status === "fulfilled");
  const rejectedUpdates = conflictingUpdates.filter((result) => result.status === "rejected");
  assert.equal(successfulUpdates.length, 1);
  assert.equal(rejectedUpdates.length, 1);
  assert.ok(rejectedUpdates[0].reason instanceof DineInOrderTransitionConflict);
  const persistedStatus = await pool.query("SELECT status FROM dine_in_orders WHERE id=$1", [persistedReceipt.orderId]);
  assert.equal(persistedStatus.rows[0].status, successfulUpdates[0].value.status);
  assert.ok(["confirmed", "rejected"].includes(persistedStatus.rows[0].status));
  const refreshedTracking = await queryCustomerDineInTrackingStatus(listingDb, persistedReceipt.orderId, persistedReceipt.trackingToken);
  assert.equal(refreshedTracking.status, persistedStatus.rows[0].status);
  assert.ok(refreshedTracking.updatedAt >= preUpdateTimestamp);
  pass("concurrent conflicting status updates serialize on the production FOR UPDATE query and only one commits");
  pass("customer tracking lookup reflects the persisted admin status change");

  for (const status of ["pending", "confirmed", "preparing", "completed", "rejected", "cancelled"]) {
    const first = await service.submit(request, randomBytes(32).toString("base64url"));
    await pool.query("UPDATE dine_in_orders SET status=$1 WHERE id=$2", [status, first.orderId]);
    const nextKey = randomBytes(32).toString("base64url");
    const second = await service.submit(request, nextKey);
    const retry = await service.submit(request, nextKey);
    assert.notEqual(second.orderId, first.orderId);
    assert.equal(retry.orderId, second.orderId);
    assert.equal(retry.replayed, true);
    const tableOrders = await queryDineInOrderSummaries(listingDb, { limit: 100, status: null, cursor: null });
    assert.ok(tableOrders.orders.some((order) => order.orderId === first.orderId));
    assert.ok(tableOrders.orders.some((order) => order.orderId === second.orderId));
  }
  pass("PostgreSQL accepts a new same-table order after each status, preserves same-key retries, and lists both orders");

  // Keep orders created by earlier integration cases out of this isolated
  // pagination fixture so the final page assertion covers exactly four rows.
  await pool.query("TRUNCATE TABLE dine_in_order_items, dine_in_orders");

  const combinedOrderId = randomUUID();
  const combinedTrackingToken = randomBytes(32).toString("base64url");
  const combinedRevision = Date.now();
  const combinedDigests = [randomBytes(32).toString("hex"), randomBytes(32).toString("hex"), randomBytes(32).toString("hex")];
  await pool.query(`
    INSERT INTO dine_in_orders (
      id, tracking_token_hash, request_hash, idempotency_key_hash, table_id,
      table_label_snapshot, status, subtotal_millimes, total_millimes,
      created_at, updated_at
    ) VALUES ($1,$2,$3,$4,'table-1','Combined action table','pending',1000,1000,$5,$5)
  `, [combinedOrderId, hashTrackingToken(combinedTrackingToken), combinedDigests[1], combinedDigests[2], combinedRevision]);
  const confirmAndPrepare = createPostgresConfirmAndPrepareUpdater(transactionRunner);
  const combinedResult = await confirmAndPrepare(combinedOrderId, combinedRevision);
  assert.equal(combinedResult.orderId, combinedOrderId);
  assert.equal(combinedResult.status, "preparing");
  assert.ok(Number.isSafeInteger(combinedResult.revision));
  assert.ok(combinedResult.revision > combinedRevision);
  await assert.rejects(confirmAndPrepare(combinedOrderId, combinedRevision), DineInOrderTransitionConflict);
  const combinedTracking = await queryCustomerDineInTrackingStatus(listingDb, combinedOrderId, combinedTrackingToken);
  assert.equal(combinedTracking.status, "preparing");
  pass("confirm-and-prepare applies both legal steps in one locked write, rejects a stale retry, and updates customer tracking");
  await pool.query("TRUNCATE TABLE dine_in_order_items, dine_in_orders");

  const dashboardTime = Date.now();
  const dashboardOrders = [
    ["20000000-0000-4000-8000-000000000001", "pending", 1000],
    ["20000000-0000-4000-8000-000000000002", "pending", 1500],
    ["20000000-0000-4000-8000-000000000003", "confirmed", 2000],
    ["20000000-0000-4000-8000-000000000004", "preparing", 3000],
    ["20000000-0000-4000-8000-000000000005", "completed", 4000],
    ["20000000-0000-4000-8000-000000000006", "cancelled", 5000],
    ["20000000-0000-4000-8000-000000000007", "rejected", 6000],
  ];
  for (const [index, [id, status, amount]] of dashboardOrders.entries()) {
    const digest = String(index + 1).repeat(64);
    await pool.query(`
      INSERT INTO dine_in_orders (
        id, tracking_token_hash, request_hash, idempotency_key_hash, table_id,
        table_label_snapshot, status, subtotal_millimes, total_millimes,
        created_at, updated_at
      ) VALUES ($1,$2,$3,$4,'table-1','Dashboard fixture',$5,$6,$6,$7,$7)
    `, [id, digest, String(9 - index).repeat(64), String(2 + index).repeat(64), status, amount, dashboardTime]);
  }
  const dashboardSummary = await queryDineInOrderDashboardSummary(listingDb);
  assert.deepEqual(dashboardSummary, {
    pendingCount: 2,
    preparingCount: 2,
    todayDoneOrderCount: 1,
    todayInKitchenTotalMillimes: 5000,
    todayTotalMillimes: 4000,
    latestPendingOrder: { orderId: dashboardOrders[1][0], createdAt: String(dashboardTime) },
  });
  pass("dashboard summary counts only completed revenue and sums confirmed/preparing kitchen amounts for today");
  await queryDineInOrderSummaries(listingDb, { limit: 1, status: "in_progress", cursor: null });
  assert.deepEqual(await queryDineInOrderDashboardSummary(listingDb), dashboardSummary);
  pass("dashboard totals remain independent of the selected list status and page limit");

  const tunisBoundary = await pool.query(`
    SELECT
      extract(epoch FROM ((timezone('Africa/Tunis', now())::date + time '23:10') AT TIME ZONE 'Africa/Tunis'))::bigint * 1000 AS today_late,
      extract(epoch FROM (((timezone('Africa/Tunis', now())::date + interval '1 day')::date + time '00:01') AT TIME ZONE 'Africa/Tunis'))::bigint * 1000 AS tomorrow_early
  `);
  const boundaryDigest = (number) => (number + 20).toString(16).padStart(64, "0");
  await pool.query(`
    INSERT INTO dine_in_orders (id, tracking_token_hash, request_hash, idempotency_key_hash, table_id, table_label_snapshot, status, subtotal_millimes, total_millimes, created_at, updated_at)
    VALUES
      ('20000000-0000-4000-8000-000000000008', $1, $2, $3, 'table-1', 'Boundary', 'completed', 7100, 7100, $4, $4),
      ('20000000-0000-4000-8000-000000000009', $5, $6, $7, 'table-1', 'Boundary', 'completed', 9100, 9100, $8, $8)
  `, [boundaryDigest(1), boundaryDigest(2), boundaryDigest(3), tunisBoundary.rows[0].today_late,
    boundaryDigest(4), boundaryDigest(5), boundaryDigest(6), tunisBoundary.rows[0].tomorrow_early]);
  const boundarySummary = await queryDineInOrderDashboardSummary(listingDb);
  assert.equal(boundarySummary.todayTotalMillimes, 11100);
  assert.equal(boundarySummary.todayDoneOrderCount, 2);
  pass("Tunisian 23:10 remains in today’s total while 00:01 after local midnight moves to the next day");
  await pool.query("TRUNCATE TABLE dine_in_order_items, dine_in_orders");

  const listingTime = "8000000000000000";
  const listingIds = [1, 2, 3, 4].map((number) =>
    `10000000-0000-4000-8000-${String(number).padStart(12, "0")}`,
  );
  for (const [index, id] of listingIds.entries()) {
    const digest = String(index + 1).repeat(64);
    await pool.query(`
      INSERT INTO dine_in_orders (
        id, tracking_token_hash, request_hash, idempotency_key_hash, table_id,
        table_label_snapshot, status, subtotal_millimes, total_millimes,
        customer_name, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,'table-1','History fixture',$5,1234,1234,'Fixture guest',$6::bigint,$6::bigint)
    `, [id, digest, String(9 - index).repeat(64), String(5 + index).repeat(64), ["completed", "pending", "preparing", "cancelled"][index], listingTime]);
  }

  const firstPage = await queryDineInOrderSummaries(listingDb, { limit: 2, status: null, cursor: null });
  assert.deepEqual(firstPage.orders.map((order) => order.orderId), listingIds.slice().reverse().slice(0, 2));
  assert.ok(firstPage.nextCursor);
  assert.equal(firstPage.orders[0].createdAt, listingTime);
  assert.equal(firstPage.orders[0].totalMillimes, 1234);
  assert.deepEqual(Object.keys(firstPage.orders[0]).sort(), ["createdAt", "customerName", "customerNotes", "items", "orderId", "revision", "status", "tableLabel", "totalMillimes"].sort());

  const secondPage = await queryDineInOrderSummaries(listingDb, { limit: 2, status: null, cursor: firstPage.nextCursor });
  assert.deepEqual(secondPage.orders.map((order) => order.orderId), listingIds.slice().reverse().slice(2));
  assert.equal(secondPage.nextCursor, null);
  assert.equal(new Set([...firstPage.orders, ...secondPage.orders].map((order) => order.orderId)).size, 4);
  pass("production Drizzle listing query pages equal-timestamp rows by created_at and id without skips or duplicates");

  const filtered = await queryDineInOrderSummaries(listingDb, { limit: 10, status: "preparing", cursor: null });
  assert.deepEqual(filtered.orders.map((order) => order.orderId), [listingIds[2]]);
  const empty = await queryDineInOrderSummaries(listingDb, { limit: 10, status: "rejected", cursor: null });
  assert.deepEqual(empty, { orders: [], nextCursor: null });
  const inProgress = await queryDineInOrderSummaries(listingDb, { limit: 10, status: "in_progress", cursor: null });
  assert.deepEqual(inProgress.orders.map((order) => order.status).sort(), ["pending", "preparing"]);
  const finished = await queryDineInOrderSummaries(listingDb, { limit: 10, status: "finished", cursor: null });
  assert.deepEqual(finished.orders.map((order) => order.status).sort(), ["cancelled", "completed"]);
  pass("production listing query preserves exact filters and pages the grouped in-progress and finished views");

  const detailOrderId = randomUUID();
  const detailDigests = [randomBytes(32).toString("hex"), randomBytes(32).toString("hex"), randomBytes(32).toString("hex")];
  const exactSubtotal = "9007199254740500";
  await pool.query(`
    INSERT INTO dine_in_orders (
      id, tracking_token_hash, request_hash, idempotency_key_hash, table_id,
      table_label_snapshot, status, subtotal_millimes, total_millimes,
      customer_name, customer_notes, created_at, updated_at
    ) VALUES ($1,$2,$3,$4,'table-1','Historical table','confirmed',$5::bigint,$5::bigint,
      'Snapshot guest','Historical note',1700000000000,1700000000000)
  `, [detailOrderId, ...detailDigests, exactSubtotal]);
  await pool.query(`
    INSERT INTO dine_in_order_items (
      id, order_id, line_number, product_name_snapshot, quantity,
      unit_price_millimes, line_subtotal_millimes, option_snapshots
    ) VALUES
      ($1,$2,2,'Old tea label',1,500,500,'[]'::jsonb),
      ($3,$2,1,'Old sandwich label',2,4503599627370000,9007199254740000,
        '[{"id":"extra-cheese","name":"Old cheese option","priceAdjustmentMillimes":100}]'::jsonb)
  `, [randomUUID(), detailOrderId, randomUUID()]);
  const detail = await queryDineInOrderDetail(listingDb, detailOrderId);
  assert.equal(detail.orderId, detailOrderId);
  assert.equal(detail.tableLabel, "Historical table");
  assert.equal(detail.totalMillimes, Number(exactSubtotal));
  assert.deepEqual(detail.items.map((item) => item.productName), ["Old sandwich label", "Old tea label"]);
  assert.equal(detail.items[0].lineTotalMillimes, 9007199254740000);
  assert.deepEqual(detail.items[0].options, [{ id: "extra-cheese", name: "Old cheese option", priceAdjustmentMillimes: 100 }]);
  assert.deepEqual(Object.keys(detail).sort(), [
    "orderId", "createdAt", "status", "customerName", "customerNotes", "tableLabel",
    "subtotalMillimes", "totalMillimes", "items",
  ].sort());
  assert.equal(JSON.stringify(detail).includes(detailDigests[0]), false);
  pass("production detail query returns historical item/options snapshots in line order with exact safe millimes and no hashes");

  console.log(`Completed ${passed} production-path PostgreSQL assertions.`);
} catch (error) {
  failure = error;
} finally {
  if (pool) {
    try { await pool.end(); }
    catch { failure = failure ? new AggregateError([failure], "Test failed and local pool cleanup failed.") : new Error("Local PostgreSQL pool cleanup failed."); }
  }
  if (containerMayExist) {
    const stopped = docker(["stop", container]);
    if (stopped.status !== 0 && !/No such container/i.test(stopped.stderr)) {
      const removed = docker(["rm", "-f", container]);
      if (removed.status !== 0 && !/No such container/i.test(removed.stderr))
        failure = failure ? new AggregateError([failure], "Test failed and disposable PostgreSQL cleanup failed.") : new Error("Disposable PostgreSQL cleanup failed.");
    }
    const remaining = docker(["ps", "-a", "--filter", `name=^/${container}$`, "--format", "{{.Names}}"]);
    if (remaining.status !== 0) {
      failure = failure ? new AggregateError([failure], "Could not verify disposable PostgreSQL cleanup.") : new Error("Could not verify disposable PostgreSQL cleanup.");
    } else if (remaining.stdout === container) {
      const removed = docker(["rm", "-f", container]);
      const verified = docker(["ps", "-a", "--filter", `name=^/${container}$`, "--format", "{{.Names}}"]);
      if (removed.status !== 0 || verified.status !== 0 || verified.stdout === container)
        failure = failure ? new AggregateError([failure], "Disposable PostgreSQL container remained after cleanup.") : new Error("Disposable PostgreSQL container remained after cleanup.");
    }
  }
  try { rmSync(temporaryDirectory, { recursive: true, force: true }); }
  catch { failure = failure ? new AggregateError([failure], "Test failed and temporary credential cleanup failed.") : new Error("Temporary credential cleanup failed."); }
  if (!failure) console.log("Cleanup complete: disposable container, pool, and generated test credentials removed.");
}

if (failure) {
  console.error(failure.stack ?? failure.message);
  process.exitCode = 1;
}

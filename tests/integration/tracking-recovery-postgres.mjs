import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
const migrationPath = path.join(projectRoot, "drizzle/0000_init.sql");
const suffix = randomUUID().replaceAll("-", "");
const containerName = `clickmenu-pg17-${suffix.slice(0, 12)}`;
const databaseName = `tracking_test_${suffix}`;
const databaseUser = `tracking_user_${suffix}`;
const databasePassword = randomBytes(32).toString("base64url");
const tempDirectory = mkdtempSync(path.join(tmpdir(), "clickmenu-pg17-"));
const envFile = path.join(tempDirectory, "postgres.env");
const recoveryConstraint = "dine_in_orders_tracking_recovery_envelope_check";

let containerMayExist = false;
let passed = 0;

function docker(args, input) {
  const result = spawnSync("docker", args, {
    cwd: projectRoot,
    encoding: "utf8",
    input,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  });

  if (result.error) throw result.error;
  return {
    status: result.status,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  };
}

function psql(sql) {
  return docker(
    [
      "exec",
      "-i",
      containerName,
      "psql",
      "-h",
      "127.0.0.1",
      "-X",
      "-q",
      "-A",
      "-t",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      databaseUser,
      "-d",
      databaseName,
    ],
    sql,
  );
}

function sqlString(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function insertSql(id, version, nonce, ciphertext, authTag) {
  const hash = (value) => createHash("sha256").update(value).digest("hex");
  const values = [
    sqlString(id),
    sqlString(hash(`tracking:${id}`)),
    sqlString(hash(`idempotency:${id}`)),
    sqlString(hash(`request:${id}`)),
    "'recovery-table'",
    "'Recovery test'",
    "'pending'",
    "0",
    "0",
    "NULL",
    "NULL",
    version,
    nonce === null ? "NULL" : sqlString(nonce),
    ciphertext === null ? "NULL" : sqlString(ciphertext),
    authTag === null ? "NULL" : sqlString(authTag),
    "1",
    "1",
  ];

  return `INSERT INTO dine_in_orders (id, tracking_token_hash, idempotency_key_hash, request_hash, table_id, table_label_snapshot, status, subtotal_millimes, total_millimes, customer_name, customer_notes, tracking_recovery_version, tracking_recovery_nonce, tracking_recovery_ciphertext, tracking_recovery_auth_tag, created_at, updated_at) VALUES (${values.join(", ")});`;
}

function accepted(name, sql) {
  const result = psql(sql);
  assert.equal(result.status, 0, `${name} should be accepted: ${result.stderr}`);
  passed += 1;
  console.log(`PASS accept: ${name}`);
}

function rejectedInsert(name, id, sql) {
  const result = psql(sql);
  assert.notEqual(result.status, 0, `${name} should be rejected`);
  assert.match(result.stderr, new RegExp(recoveryConstraint));

  const count = psql(
    `SELECT count(*) FROM dine_in_orders WHERE id = ${sqlString(id)};`,
  );
  assert.equal(count.status, 0, `Could not check state after ${name}`);
  assert.equal(count.stdout, "0", `Failed insert ${name} left a row behind`);

  // Reuse the failed row's ID to show the failed statement left no residue.
  accepted(`${name}: same ID can be inserted after failure`, insertSql(id, "NULL", null, null, null));
  passed += 1;
  console.log(`PASS reject by ${recoveryConstraint}: ${name}`);
}

function rejectedUpdate(name, sql, unchangedRowQuery) {
  const result = psql(sql);
  assert.notEqual(result.status, 0, `${name} should be rejected`);
  assert.match(result.stderr, new RegExp(recoveryConstraint));

  const row = psql(unchangedRowQuery);
  assert.equal(row.status, 0, `Could not inspect row after ${name}`);
  assert.equal(row.stdout, "1", `Failed update ${name} changed the existing row`);
  passed += 1;
  console.log(`PASS reject update by ${recoveryConstraint}: ${name}`);
}

function makeNoncanonicalPadBits(value) {
  assert.ok(value.endsWith("=="));
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const lastDataCharacter = value.length - 3;
  const originalIndex = alphabet.indexOf(value[lastDataCharacter]);
  assert.notEqual(originalIndex, -1);
  assert.equal(originalIndex & 0b1111, 0);

  const noncanonicalIndex = (originalIndex & 0b110000) | 1;
  const altered =
    value.slice(0, lastDataCharacter) + alphabet[noncanonicalIndex] + "==";
  assert.deepEqual(Buffer.from(altered, "base64"), Buffer.from(value, "base64"));
  return altered;
}

function assertCommand(result, label) {
  assert.equal(result.status, 0, `${label} failed: ${result.stderr}`);
}

function waitForPostgres() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const result = docker([
      "exec",
      containerName,
      "pg_isready",
      "-h",
      "127.0.0.1",
      "-U",
      databaseUser,
      "-d",
      databaseName,
    ]);
    if (result.status === 0) return;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
  }
  throw new Error("Disposable PostgreSQL did not become ready within 60 seconds.");
}

let runError;
try {
  writeFileSync(
    envFile,
    `POSTGRES_DB=${databaseName}\nPOSTGRES_USER=${databaseUser}\nPOSTGRES_PASSWORD=${databasePassword}\nPGPASSWORD=${databasePassword}\n`,
    { mode: 0o600 },
  );

  const engine = docker(["info", "--format", "{{.ServerVersion}}"]);
  assertCommand(engine, "Docker Engine check");
  console.log(`Docker Server: ${engine.stdout}`);

  const started = docker([
    "run",
    "-d",
    "--rm",
    "--name",
    containerName,
    "--publish",
    "127.0.0.1::5432",
    "--env-file",
    envFile,
    "postgres:17",
  ]);
  assertCommand(started, "Starting disposable PostgreSQL 17 container");
  containerMayExist = true;

  const port = docker(["port", containerName, "5432/tcp"]);
  assertCommand(port, "Inspecting disposable container port");
  assert.match(port.stdout, /^127\.0\.0\.1:\d+$/);
  console.log(`Container port mapping: ${port.stdout}`);

  waitForPostgres();
  const version = psql("SHOW server_version;");
  assertCommand(version, "Checking PostgreSQL version");
  assert.match(version.stdout, /^17\./);
  console.log(`PostgreSQL version: ${version.stdout}`);

  const migrationSql = readFileSync(migrationPath, "utf8");
  assertCommand(psql(migrationSql), "Executing the complete initial schema migration");
  assertCommand(psql(`
    INSERT INTO restaurant_tables (id, label, qr_token_hash, created_at, updated_at)
    VALUES ('recovery-table', 'Recovery test', '${"a".repeat(64)}', 1, 1);
  `), "Creating the required order table reference");
  console.log("PASS setup: complete initial schema migration executed");

  const nonce = randomBytes(12).toString("base64");
  const ciphertext = randomBytes(43).toString("base64");
  const authTag = randomBytes(16).toString("base64");
  assert.equal(Buffer.from(nonce, "base64").byteLength, 12);
  assert.equal(Buffer.from(ciphertext, "base64").byteLength, 43);
  assert.equal(Buffer.from(authTag, "base64").byteLength, 16);

  accepted("all four recovery fields NULL", insertSql("accept-null", "NULL", null, null, null));
  accepted(
    "complete valid version-1 envelope with canonical 12/43/16-byte fields",
    insertSql("accept-envelope", "1", nonce, ciphertext, authTag),
  );
  accepted(
    "UPDATE from all-NULL fields to a complete envelope",
    `${insertSql("accept-update", "NULL", null, null, null)} UPDATE dine_in_orders SET tracking_recovery_version=1, tracking_recovery_nonce=${sqlString(nonce)}, tracking_recovery_ciphertext=${sqlString(ciphertext)}, tracking_recovery_auth_tag=${sqlString(authTag)} WHERE id='accept-update';`,
  );

  const invalidCases = [
    { name: "partially populated envelope", version: "1", nonce, ciphertext: null, authTag: null },
    { name: "unsupported version", version: "2", nonce, ciphertext, authTag },
    { name: "invalid nonce length", version: "1", nonce: "AAAA", ciphertext, authTag },
    { name: "invalid ciphertext length", version: "1", nonce, ciphertext: "AAAA==", authTag },
    { name: "invalid authentication-tag length", version: "1", nonce, ciphertext, authTag: "AAAA==" },
    { name: "invalid nonce Base64 character", version: "1", nonce: `!${nonce.slice(1)}`, ciphertext, authTag },
    { name: "invalid ciphertext Base64 character", version: "1", nonce, ciphertext: `!${ciphertext.slice(1)}`, authTag },
    { name: "invalid authentication-tag Base64 character", version: "1", nonce, ciphertext, authTag: `!${authTag.slice(1)}` },
    { name: "incorrectly padded nonce", version: "1", nonce: "AAAAAAAAAAAAAAA=", ciphertext, authTag },
    { name: "ciphertext missing required padding", version: "1", nonce, ciphertext: ciphertext.replace(/=+$/, ""), authTag },
    { name: "ciphertext with extra padding", version: "1", nonce, ciphertext: `${ciphertext}=`, authTag },
    { name: "authentication tag missing required padding", version: "1", nonce, ciphertext, authTag: authTag.replace(/=+$/, "") },
    { name: "authentication tag with extra padding", version: "1", nonce, ciphertext, authTag: `${authTag}=` },
    { name: "noncanonical ciphertext padding bits", version: "1", nonce, ciphertext: makeNoncanonicalPadBits(ciphertext), authTag },
    { name: "noncanonical authentication-tag padding bits", version: "1", nonce, ciphertext, authTag: makeNoncanonicalPadBits(authTag) },
  ];

  invalidCases.forEach((testCase, index) => {
    const id = `reject-${index + 1}`;
    rejectedInsert(
      testCase.name,
      id,
      insertSql(id, testCase.version, testCase.nonce, testCase.ciphertext, testCase.authTag),
    );
  });

  rejectedUpdate(
    "partial recovery update",
    `UPDATE dine_in_orders SET tracking_recovery_version=1, tracking_recovery_nonce=${sqlString(nonce)}, tracking_recovery_ciphertext=NULL, tracking_recovery_auth_tag=NULL WHERE id='accept-null';`,
    "SELECT count(*) FROM dine_in_orders WHERE id='accept-null' AND tracking_recovery_version IS NULL AND tracking_recovery_nonce IS NULL AND tracking_recovery_ciphertext IS NULL AND tracking_recovery_auth_tag IS NULL;",
  );

  console.log(`Integration result: ${passed} PostgreSQL assertions passed; 0 failed.`);
} catch (error) {
  runError = error;
} finally {
  const cleanupErrors = [];
  if (containerMayExist) {
    const stopped = docker(["stop", containerName]);
    if (stopped.status !== 0) {
      const removed = docker(["rm", "-f", containerName]);
      if (removed.status !== 0 && !removed.stderr.includes("No such container")) {
        cleanupErrors.push(`Could not stop/remove test container: ${removed.stderr}`);
      }
    }
    const remaining = docker([
      "ps",
      "-a",
      "--filter",
      `name=^/${containerName}$`,
      "--format",
      "{{.Names}}",
    ]);
    if (remaining.status !== 0) cleanupErrors.push(`Could not verify container cleanup: ${remaining.stderr}`);
    else if (remaining.stdout === containerName) {
      const removed = docker(["rm", "-f", containerName]);
      if (removed.status !== 0) cleanupErrors.push(`Test container remains: ${removed.stderr}`);
    }
  }

  try {
    rmSync(tempDirectory, { recursive: true, force: true });
  } catch (error) {
    cleanupErrors.push(`Could not remove temporary credential directory: ${error.message}`);
  }

  if (cleanupErrors.length > 0) {
    const cleanupError = new Error(cleanupErrors.join("\n"));
    runError = runError
      ? new AggregateError([runError, cleanupError], "Integration run and cleanup failed.")
      : cleanupError;
  }
  if (!runError) console.log("Cleanup: disposable container and test credentials removed.");
}

if (runError) {
  console.error(runError.message);
  process.exitCode = 1;
}

import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
const suffix = randomUUID().replaceAll("-", "");
const containerName = `clickmenu-tx-${suffix.slice(0, 12)}`;
const databaseName = `tx_test_${suffix}`;
const databaseUser = `tx_user_${suffix}`;
const databasePassword = randomBytes(32).toString("base64url");
const tempDirectory = mkdtempSync(path.join(tmpdir(), "clickmenu-tx-pg17-"));
const envFile = path.join(tempDirectory, "postgres.env");

let containerMayExist = false;
let runError;
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
  return { status: result.status, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}

function dockerAsync(args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, { cwd: projectRoot, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stdout: stdout.trim(), stderr: stderr.trim() }));
    child.stdin.end(input);
  });
}

function psql(sql, { stopOnError = true } = {}) {
  const args = [
    "exec", "-i", containerName, "psql", "-h", "127.0.0.1", "-X", "-q", "-A", "-t",
    "-v", `ON_ERROR_STOP=${stopOnError ? 1 : 0}`, "-U", databaseUser, "-d", databaseName,
  ];
  return docker(args, sql);
}

function psqlAsync(sql) {
  return dockerAsync([
    "exec", "-i", containerName, "psql", "-h", "127.0.0.1", "-X", "-q", "-A", "-t",
    "-v", "ON_ERROR_STOP=1", "-U", databaseUser, "-d", databaseName,
  ], sql);
}

function passedCase(name) {
  passed += 1;
  console.log(`PASS: ${name}`);
}

function assertCommand(result, label) {
  assert.equal(result.status, 0, `${label} failed: ${result.stderr}`);
}

async function waitForQuery(fragment, timeoutMs = 5_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const result = psql(`
      SELECT count(*) FROM pg_stat_activity
      WHERE datname = current_database() AND pid <> pg_backend_pid()
        AND query LIKE '%${fragment}%';
    `);
    assertCommand(result, "Checking PostgreSQL test session state");
    if (Number(result.stdout) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("A test transaction did not reach its synchronization query.");
}

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
    "run", "-d", "--rm", "--name", containerName,
    "--publish", "127.0.0.1::5432", "--env-file", envFile, "postgres:17",
  ]);
  assertCommand(started, "Starting disposable PostgreSQL 17 container");
  containerMayExist = true;

  const mapping = docker(["port", containerName, "5432/tcp"]);
  assertCommand(mapping, "Inspecting disposable container port");
  assert.match(mapping.stdout, /^127\.0\.0\.1:\d+$/);
  console.log(`Container port mapping: ${mapping.stdout}`);

  let ready = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const result = docker(["exec", containerName, "pg_isready", "-h", "127.0.0.1", "-U", databaseUser, "-d", databaseName]);
    if (result.status === 0) { ready = true; break; }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  assert.ok(ready, "Disposable PostgreSQL did not become ready within 60 seconds.");

  const version = psql("SHOW server_version;");
  assertCommand(version, "Checking PostgreSQL version");
  assert.match(version.stdout, /^17\./);
  console.log(`PostgreSQL version: ${version.stdout}`);
  assertCommand(psql("CREATE TABLE tx_rows (id text PRIMARY KEY, value text NOT NULL);"), "Creating isolated transaction table");

  assertCommand(psql("BEGIN ISOLATION LEVEL READ COMMITTED; INSERT INTO tx_rows VALUES ('commit-a','a'), ('commit-b','b'); COMMIT;"), "Committing multiple writes");
  const committed = psql("SELECT count(*) FROM tx_rows WHERE id IN ('commit-a','commit-b');");
  assertCommand(committed, "Reading committed writes");
  assert.equal(committed.stdout, "2");
  passedCase("multiple writes commit together and are visible after commit");

  const rollback = psql(`
    BEGIN ISOLATION LEVEL READ COMMITTED;
    INSERT INTO tx_rows VALUES ('rollback-a','must roll back');
    INSERT INTO tx_rows VALUES ('commit-a','duplicate key forces failure');
    ROLLBACK;
  `, { stopOnError: false });
  assert.match(rollback.stderr, /duplicate key value violates unique constraint/);
  const rollbackCount = psql("SELECT count(*) FROM tx_rows WHERE id='rollback-a';");
  assertCommand(rollbackCount, "Verifying rollback");
  assert.equal(rollbackCount.stdout, "0");
  passedCase("a deliberate statement failure rolls back earlier writes");

  const uncommitted = psqlAsync(`
    BEGIN ISOLATION LEVEL READ COMMITTED;
    INSERT INTO tx_rows VALUES ('not-yet-committed','hidden');
    SELECT pg_sleep(1.5);
    COMMIT;
  `);
  await waitForQuery("pg_sleep(1.5)");
  const invisible = psql("SELECT count(*) FROM tx_rows WHERE id='not-yet-committed';");
  assertCommand(invisible, "Checking uncommitted visibility");
  assert.equal(invisible.stdout, "0");
  await uncommitted.then((result) => assertCommand(result, "Committing visibility test transaction"));
  const visible = psql("SELECT count(*) FROM tx_rows WHERE id='not-yet-committed';");
  assertCommand(visible, "Checking visibility after commit");
  assert.equal(visible.stdout, "1");
  passedCase("a separate transaction cannot see uncommitted writes");

  const lockId = "748239184";
  const holder = psqlAsync(`
    BEGIN ISOLATION LEVEL READ COMMITTED;
    SELECT pg_advisory_xact_lock(${lockId}::bigint);
    INSERT INTO tx_rows VALUES ('advisory-winner','committed by first transaction');
    SELECT pg_sleep(1.5);
    COMMIT;
  `);
  await waitForQuery("pg_sleep(1.5)");
  const waiterStarted = Date.now();
  const waiter = psql(`
    BEGIN ISOLATION LEVEL READ COMMITTED;
    SELECT pg_advisory_xact_lock(${lockId}::bigint);
    SELECT count(*) FROM tx_rows WHERE id='advisory-winner';
    COMMIT;
  `);
  const waiterDuration = Date.now() - waiterStarted;
  assertCommand(waiter, "Waiting transaction");
  assert.equal(waiter.stdout, "1", "Post-lock statement must observe the first transaction's commit");
  assert.ok(waiterDuration >= 500, `Expected the advisory-lock waiter to block, observed ${waiterDuration} ms`);
  await holder.then((result) => assertCommand(result, "Committing advisory-lock holder"));
  passedCase("same advisory lock serializes transactions and READ COMMITTED sees the committed row");

  const lockRollback = psql(`
    BEGIN ISOLATION LEVEL READ COMMITTED;
    SELECT pg_advisory_xact_lock(${lockId}::bigint);
    INSERT INTO tx_rows VALUES ('lock-rollback','will roll back');
    INSERT INTO tx_rows VALUES ('commit-a','duplicate key forces rollback');
    ROLLBACK;
  `, { stopOnError: false });
  assert.match(lockRollback.stderr, /duplicate key value violates unique constraint/);
  const reacquire = psql(`
    SET statement_timeout='2s';
    BEGIN ISOLATION LEVEL READ COMMITTED;
    SELECT pg_advisory_xact_lock(${lockId}::bigint);
    ROLLBACK;
  `);
  assertCommand(reacquire, "Verifying lock release after rollback");
  const noResidue = psql("SELECT count(*) FROM tx_rows WHERE id='lock-rollback';");
  assertCommand(noResidue, "Verifying rollback left no row");
  assert.equal(noResidue.stdout, "0");
  passedCase("rollback removes writes and releases transaction advisory locks");

  console.log(`PostgreSQL semantics result: ${passed} assertions passed; 0 failed.`);
} catch (error) {
  runError = error;
} finally {
  const cleanupErrors = [];
  if (containerMayExist) {
    const stopped = docker(["stop", containerName]);
    if (stopped.status !== 0) {
      const removed = docker(["rm", "-f", containerName]);
      if (removed.status !== 0 && !removed.stderr.includes("No such container"))
        cleanupErrors.push(`Could not stop/remove test container: ${removed.stderr}`);
    }
    const remaining = docker(["ps", "-a", "--filter", `name=^/${containerName}$`, "--format", "{{.Names}}"]);
    if (remaining.status !== 0) cleanupErrors.push(`Could not verify container cleanup: ${remaining.stderr}`);
    else if (remaining.stdout === containerName) {
      const removed = docker(["rm", "-f", containerName]);
      if (removed.status !== 0) cleanupErrors.push(`Test container remains: ${removed.stderr}`);
    }
  }
  try { rmSync(tempDirectory, { recursive: true, force: true }); }
  catch (error) { cleanupErrors.push(`Could not remove temporary credentials: ${error.message}`); }
  if (cleanupErrors.length) {
    const cleanupError = new Error(cleanupErrors.join("\n"));
    runError = runError ? new AggregateError([runError, cleanupError], "Test and cleanup failed.") : cleanupError;
  }
  if (!runError) console.log("Cleanup: disposable container and generated credentials removed.");
}

if (runError) {
  console.error(runError.message);
  process.exitCode = 1;
}

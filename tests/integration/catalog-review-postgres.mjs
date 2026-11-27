import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
const migrationPath = path.join(projectRoot, "drizzle/0000_init.sql");
const suffix = randomUUID().replaceAll("-", "");
const containerName = `clickmenu-schema-${suffix.slice(0, 12)}`;
const databaseName = `schema_test_${suffix}`;
const databaseUser = `schema_user_${suffix}`;
const databasePassword = randomBytes(32).toString("base64url");
const tempDirectory = mkdtempSync(path.join(tmpdir(), "clickmenu-schema-pg17-"));
const envFile = path.join(tempDirectory, "postgres.env");
const pairConstraint = "restaurant_catalogs_price_review_state_pair_check";
const revisionConstraint = "restaurant_catalogs_price_review_revision_check";

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
  return { status: result.status, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}

function psql(sql) {
  return docker([
    "exec", "-i", containerName, "psql", "-h", "127.0.0.1", "-X", "-q", "-A", "-t",
    "-v", "ON_ERROR_STOP=1", "-U", databaseUser, "-d", databaseName,
  ], sql);
}

function assertCommand(result, label) {
  assert.equal(result.status, 0, `${label} failed: ${result.stderr}`);
}

function rejectedUpdate(name, constraint, statement, expectedState) {
  const result = psql(statement);
  assert.notEqual(result.status, 0, `${name} should be rejected`);
  assert.match(result.stderr, new RegExp(constraint));
  const state = psql(expectedState);
  assertCommand(state, `Checking row state after ${name}`);
  assert.equal(state.stdout, "t", `${name} changed the catalog row`);
  passed += 1;
  console.log(`PASS reject by ${constraint}: ${name}`);
}

function waitForPostgres() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const result = docker([
      "exec", containerName, "pg_isready", "-h", "127.0.0.1", "-U", databaseUser, "-d", databaseName,
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
  const started = docker([
    "run", "-d", "--rm", "--name", containerName,
    "--publish", "127.0.0.1::5432", "--env-file", envFile, "postgres:17",
  ]);
  assertCommand(started, "Starting disposable PostgreSQL 17 container");
  containerMayExist = true;

  const port = docker(["port", containerName, "5432/tcp"]);
  assertCommand(port, "Inspecting disposable container port");
  assert.match(port.stdout, /^127\.0\.0\.1:\d+$/);
  waitForPostgres();
  const version = psql("SHOW server_version;");
  assertCommand(version, "Checking PostgreSQL version");
  assert.match(version.stdout, /^17\./);

  const migrationSql = readFileSync(migrationPath, "utf8");
  assertCommand(psql(migrationSql), "Executing complete initial schema migration");
  console.log("PASS setup: complete initial schema migration executed");

  const schemaChecks = psql(`
    SELECT NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='dine_in_orders' AND column_name='currency'
    ) AND EXISTS (
      SELECT 1 FROM image_upload_capacity WHERE id=1 AND image_count=0
    );
  `);
  assertCommand(schemaChecks, "Checking currency-free schema and initial image capacity");
  assert.equal(schemaChecks.stdout, "t");
  passed += 1;

  assertCommand(psql(`
    INSERT INTO admin_credentials (id, password_hash, credential_version, password_changed_at)
    VALUES (1, 'test-only-hash', 1, 1000);
    INSERT INTO admin_audit_events (id, action, actor, created_at)
    VALUES ('test-init', 'initialized', 'cli', 1000);
    INSERT INTO restaurant_catalogs (id, payload, revision, updated_at)
    VALUES (1, '{"settings":{}}', 3, 1000);
  `), "Checking administrator setup and initial catalog insertion");
  passed += 1;
  console.log("PASS setup: password initialization tables and fresh catalog row accept valid writes");

  const unreviewed = psql("SELECT price_reviewed_revision IS NULL AND price_reviewed_at IS NULL FROM restaurant_catalogs WHERE id=1;");
  assertCommand(unreviewed, "Checking fresh catalog review state");
  assert.equal(unreviewed.stdout, "t");
  passed += 1;

  assertCommand(psql("UPDATE restaurant_catalogs SET price_reviewed_revision=3, price_reviewed_at=2000 WHERE id=1;"), "Setting a valid review");
  const reviewed = "SELECT revision=3 AND price_reviewed_revision=3 AND price_reviewed_at=2000 FROM restaurant_catalogs WHERE id=1;";
  const validReview = psql(reviewed);
  assertCommand(validReview, "Checking valid review state");
  assert.equal(validReview.stdout, "t");
  passed += 1;

  rejectedUpdate(
    "review revision without timestamp", pairConstraint,
    "UPDATE restaurant_catalogs SET price_reviewed_at=NULL WHERE id=1;",
    reviewed,
  );
  rejectedUpdate(
    "review timestamp without revision", pairConstraint,
    "UPDATE restaurant_catalogs SET price_reviewed_revision=NULL WHERE id=1;",
    reviewed,
  );
  rejectedUpdate(
    "review revision differs from current revision", revisionConstraint,
    "UPDATE restaurant_catalogs SET price_reviewed_revision=2 WHERE id=1;",
    reviewed,
  );
  rejectedUpdate(
    "revision cannot advance while leaving review state stale", revisionConstraint,
    "UPDATE restaurant_catalogs SET revision=4 WHERE id=1;",
    reviewed,
  );

  const edit = psql(`
    UPDATE restaurant_catalogs
    SET payload='{"settings":{"name":"The Hood"}}', revision=4,
        price_reviewed_revision=NULL, price_reviewed_at=NULL, updated_at=3000
    WHERE id=1;
  `);
  assertCommand(edit, "Advancing a catalog revision and clearing its review");
  passed += 1;
  assertCommand(psql("UPDATE restaurant_catalogs SET price_reviewed_revision=4, price_reviewed_at=4000 WHERE id=1 AND revision=4;"), "Reviewing the new current revision");
  const stillReviewed = psql("SELECT revision=4 AND price_reviewed_revision=4 AND price_reviewed_at=4000 FROM restaurant_catalogs WHERE id=1;");
  assertCommand(stillReviewed, "Checking the new review state");
  assert.equal(stillReviewed.stdout, "t");
  passed += 1;

  console.log(`Integration result: ${passed} PostgreSQL assertions passed; 0 failed.`);
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
  try {
    rmSync(tempDirectory, { recursive: true, force: true });
  } catch (error) {
    cleanupErrors.push(`Could not remove temporary credential directory: ${error.message}`);
  }
  if (cleanupErrors.length) {
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

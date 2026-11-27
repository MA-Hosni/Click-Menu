import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
const migrationPath = path.join(projectRoot, "drizzle/0012_tnd_catalog_price_review.sql");
const suffix = randomUUID().replaceAll("-", "");
const containerName = `clickmenu-review-${suffix.slice(0, 12)}`;
const databaseName = `review_test_${suffix}`;
const databaseUser = `review_user_${suffix}`;
const databasePassword = randomBytes(32).toString("base64url");
const tempDirectory = mkdtempSync(path.join(tmpdir(), "clickmenu-review-pg17-"));
const envFile = path.join(tempDirectory, "postgres.env");
const pairConstraint = "restaurant_catalogs_tnd_review_state_pair_check";
const revisionConstraint = "restaurant_catalogs_tnd_review_revision_check";

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
  return docker([
    "exec", "-i", containerName, "psql", "-h", "127.0.0.1", "-X", "-q", "-A", "-t",
    "-v", "ON_ERROR_STOP=1", "-U", databaseUser, "-d", databaseName,
  ], sql);
}

function sqlString(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function accepted(name, sql) {
  const result = psql(sql);
  assert.equal(result.status, 0, `${name} should be accepted: ${result.stderr}`);
  passed += 1;
  console.log(`PASS accept: ${name}`);
}

function rejected(name, id, constraint, sql, recoverySql) {
  const result = psql(sql);
  assert.notEqual(result.status, 0, `${name} should be rejected`);
  assert.match(result.stderr, new RegExp(constraint));
  const verify = psql(`SELECT count(*) FROM restaurant_catalogs WHERE id = ${sqlString(id)};`);
  assert.equal(verify.status, 0, `Could not verify ${name}`);
  assert.equal(verify.stdout, "0", `Rejected insert ${name} left a row behind`);
  accepted(`${name}: failed insert left no row`, recoverySql);
  passed += 1;
  console.log(`PASS reject by ${constraint}: ${name}`);
}

function assertCommand(result, label) {
  assert.equal(result.status, 0, `${label} failed: ${result.stderr}`);
}

function waitForPostgres() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const result = docker([
      "exec", containerName, "pg_isready", "-h", "127.0.0.1", "-U", databaseUser,
      "-d", databaseName,
    ]);
    if (result.status === 0) return;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1_000);
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
    "run", "-d", "--rm", "--name", containerName,
    "--publish", "127.0.0.1::5432", "--env-file", envFile, "postgres:17",
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

  assertCommand(psql(`
    CREATE TABLE restaurant_catalogs (
      id integer PRIMARY KEY,
      payload text NOT NULL,
      revision integer NOT NULL,
      updated_at bigint NOT NULL
    );
    INSERT INTO restaurant_catalogs (id, payload, revision, updated_at)
    VALUES (1, '{"settings":{"currency":"EUR"}}', 3, 1000);
  `), "Creating minimal prerequisite catalog table and pre-migration row");

  const migrationSql = readFileSync(migrationPath, "utf8");
  assertCommand(psql(migrationSql), "Executing actual migration 0012 SQL");
  console.log("PASS setup: actual migration 0012 SQL executed");

  const oldRow = psql("SELECT tnd_reviewed_revision IS NULL AND tnd_reviewed_at IS NULL FROM restaurant_catalogs WHERE id=1;");
  assertCommand(oldRow, "Checking existing-row defaults");
  assert.equal(oldRow.stdout, "t", "Existing catalog must remain unreviewed after migration");
  passed += 1;
  console.log("PASS existing catalog: review fields start NULL");

  accepted("all review fields NULL", `
    INSERT INTO restaurant_catalogs (id, payload, revision, updated_at, tnd_reviewed_revision, tnd_reviewed_at)
    VALUES (2, '{}', 4, 1000, NULL, NULL);
  `);
  accepted("complete review matching current revision", `
    INSERT INTO restaurant_catalogs (id, payload, revision, updated_at, tnd_reviewed_revision, tnd_reviewed_at)
    VALUES (3, '{}', 8, 1000, 8, 2000);
  `);

  const insertBase = (id, revision, reviewRevision, reviewedAt) => `
    INSERT INTO restaurant_catalogs (id, payload, revision, updated_at, tnd_reviewed_revision, tnd_reviewed_at)
    VALUES (${id}, '{}', ${revision}, 1000, ${reviewRevision}, ${reviewedAt});
  `;
  rejected(
    "review revision without timestamp", "4", pairConstraint,
    insertBase(4, 8, 8, "NULL"),
    insertBase(4, 8, "NULL", "NULL"),
  );
  rejected(
    "timestamp without review revision", "5", pairConstraint,
    insertBase(5, 8, "NULL", 2000),
    insertBase(5, 8, "NULL", "NULL"),
  );
  rejected(
    "review revision differs from current revision", "6", revisionConstraint,
    insertBase(6, 9, 8, 2000),
    insertBase(6, 9, "NULL", "NULL"),
  );

  accepted("catalog edit advances revision and clears review atomically", `
    UPDATE restaurant_catalogs
    SET payload='{"settings":{"currency":"TND"}}', revision=4,
        tnd_reviewed_revision=NULL, tnd_reviewed_at=NULL, updated_at=3000
    WHERE id=1;
  `);
  accepted("new current revision can be reviewed after edit", `
    UPDATE restaurant_catalogs
    SET tnd_reviewed_revision=4, tnd_reviewed_at=4000
    WHERE id=1 AND revision=4;
  `);

  const badEdit = psql("UPDATE restaurant_catalogs SET revision=5 WHERE id=1;");
  assert.notEqual(badEdit.status, 0, "Revision update without clearing review should fail");
  assert.match(badEdit.stderr, new RegExp(revisionConstraint));
  const stillReviewed = psql("SELECT revision=4 AND tnd_reviewed_revision=4 AND tnd_reviewed_at=4000 FROM restaurant_catalogs WHERE id=1;");
  assertCommand(stillReviewed, "Checking failed edit rollback");
  assert.equal(stillReviewed.stdout, "t", "Failed revision change must preserve the prior row");
  passed += 1;
  console.log("PASS update rejection: revision cannot advance while leaving stale review state");

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

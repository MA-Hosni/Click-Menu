import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import ts from "typescript";
import { config } from "dotenv";
import { neon } from "@neondatabase/serverless";
import pg from "pg";
import { withAdminPasswordDatabase } from "./admin-password-database.mjs";

const requireTs = createRequire(import.meta.url);

requireTs.extensions[".ts"] = (module, filename) => {
  const source = fs.readFileSync(filename, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filename,
  });
  module._compile(outputText, filename);
};

async function readPassword(prompt) {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") {
    throw new Error("Run this command in an interactive terminal.");
  }
  process.stdout.write(prompt);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
  return new Promise((resolve, reject) => {
    let value = "";
    const finish = (error) => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener("data", onData);
      process.stdout.write("\n");
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (chunk) => {
      for (const character of chunk) {
        if (character === "\u0003") return finish(new Error("Cancelled."));
        if (character === "\r" || character === "\n") return finish();
        if (character === "\u007f" || character === "\b") {
          value = value.slice(0, -1);
        } else if (character >= " ") {
          value += character;
        }
      }
    };
    process.stdin.on("data", onData);
  });
}

async function main() {
  config({ path: path.resolve(process.cwd(), ".env.local") });
  const { resolveDatabaseDriver } = requireTs("../db/driver-config.ts");
  const driver = resolveDatabaseDriver(process.env);
  if (driver === "postgres" && process.env.DATABASE_URL_POOLED)
    throw new Error("DATABASE_URL_POOLED is not allowed with DATABASE_DRIVER=postgres.");
  const connectionString = driver === "postgres"
    ? process.env.DATABASE_URL
    : process.env.DATABASE_URL_POOLED;
  const variable = driver === "postgres" ? "DATABASE_URL" : "DATABASE_URL_POOLED";
  if (!connectionString)
    throw new Error(`${variable} is required for the ${driver} database driver.`);
  const configuration = { driver, connectionString };
  const reset = process.argv.includes("--reset");
  if (process.argv.some((argument) => argument !== "--reset" && argument !== process.argv[0] && argument !== process.argv[1])) {
    throw new Error("Usage: npm run admin:password [-- --reset]");
  }
  if (reset) {
    const confirmation = await readPassword("Type RESET to revoke sessions and replace the administrator password: ");
    if (confirmation !== "RESET") throw new Error("Reset was not confirmed.");
  }
  const password = await readPassword("New administrator password: ");
  const repeated = await readPassword("Repeat administrator password: ");
  if (password !== repeated) throw new Error("Passwords do not match.");
  const { hashAdminPassword } = requireTs("../features/admin/auth/password-auth.ts");
  const passwordHash = await hashAdminPassword(password);
  const now = Date.now();
  const eventId = randomUUID();
  await withAdminPasswordDatabase(configuration, {
    createPostgresPool(connectionString) {
      return new pg.Pool({
        connectionString,
        max: 1,
        idleTimeoutMillis: 5_000,
        connectionTimeoutMillis: 5_000,
        allowExitOnIdle: true,
      });
    },
    createNeonQuery(connectionString) {
      return neon(connectionString);
    },
  }, async (database) => {
    if (database.driver === "postgres") {
      const statement = reset
        ? `
        WITH updated AS (
          UPDATE admin_credentials
          SET password_hash = $1, credential_version = credential_version + 1,
              password_changed_at = $2
          WHERE id = 1 RETURNING id
        ), revoked AS (
          DELETE FROM sessions WHERE EXISTS (SELECT 1 FROM updated) RETURNING token_hash
        ), audited AS (
          INSERT INTO admin_audit_events (id, action, actor, created_at)
          SELECT $3, 'reset', 'cli', $2 FROM updated RETURNING id
        ) SELECT id FROM audited
      `
        : `
        WITH inserted AS (
          INSERT INTO admin_credentials (id, password_hash, credential_version, password_changed_at)
          VALUES (1, $1, 1, $2) ON CONFLICT (id) DO NOTHING RETURNING id
        ), audited AS (
          INSERT INTO admin_audit_events (id, action, actor, created_at)
          SELECT $3, 'initialized', 'cli', $2 FROM inserted RETURNING id
        ) SELECT id FROM audited
      `;
      const result = await database.pool.query(statement, [passwordHash, now, eventId]);
      if (!result.rows.length) {
        throw new Error(reset ? "Initialize the administrator password first." : "The administrator password is already initialized.");
      }
    } else {
      const sql = database.sql;
      const rows = reset
        ? await sql`
            WITH updated AS (
              UPDATE admin_credentials
              SET password_hash = ${passwordHash}, credential_version = credential_version + 1,
                  password_changed_at = ${now}
              WHERE id = 1 RETURNING id
            ), revoked AS (
              DELETE FROM sessions WHERE EXISTS (SELECT 1 FROM updated) RETURNING token_hash
            ), audited AS (
              INSERT INTO admin_audit_events (id, action, actor, created_at)
              SELECT ${eventId}, 'reset', 'cli', ${now} FROM updated RETURNING id
            ) SELECT id FROM audited
          `
        : await sql`
            WITH inserted AS (
              INSERT INTO admin_credentials (id, password_hash, credential_version, password_changed_at)
              VALUES (1, ${passwordHash}, 1, ${now}) ON CONFLICT (id) DO NOTHING RETURNING id
            ), audited AS (
              INSERT INTO admin_audit_events (id, action, actor, created_at)
              SELECT ${eventId}, 'initialized', 'cli', ${now} FROM inserted RETURNING id
            ) SELECT id FROM audited
          `;
      if (!rows.length) {
        throw new Error(reset ? "Initialize the administrator password first." : "The administrator password is already initialized.");
      }
    }
  });
  process.stdout.write(reset ? "Administrator password reset; all sessions revoked.\n" : "Administrator password initialized.\n");
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Password operation failed."}\n`);
  process.exitCode = 1;
});

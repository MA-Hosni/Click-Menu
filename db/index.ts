
import "server-only";

import { Pool as PostgresPool } from "pg";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import * as schema from "./schema";
import { resolveDatabaseRuntimeConfiguration } from "./runtime-config";
import { closePool, getOrCreatePool } from "./pool";
import { createNeonHttpDatabase, createPostgresDatabase } from "./database-clients";

type DatabaseGlobals = typeof globalThis & {
  __clickMenuPostgresPool?: PostgresPool;
};

const configuration = resolveDatabaseRuntimeConfiguration();

function createPostgresPool(): PostgresPool {
  const globals = globalThis as DatabaseGlobals;
  return getOrCreatePool({
    get pool() { return globals.__clickMenuPostgresPool; },
    set pool(value) { globals.__clickMenuPostgresPool = value; },
  }, () => {
    const pool = new PostgresPool({
      connectionString: configuration.connectionString,
      max: 5,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 5_000,
      allowExitOnIdle: true,
    });
    pool.on("error", () => {
      console.error("An idle PostgreSQL connection failed.");
    });
    return pool;
  });
}

const db: PgDatabase<PgQueryResultHKT, typeof schema> = configuration.driver === "postgres"
  ? createPostgresDatabase(createPostgresPool())
  : createNeonHttpDatabase(configuration.connectionString);

export function getDb() {
  return db;
}

export type Database = typeof db;

export async function closePostgresDatabasePool(): Promise<void> {
  const globals = globalThis as DatabaseGlobals;
  await closePool({
    get pool() { return globals.__clickMenuPostgresPool; },
    set pool(value) { globals.__clickMenuPostgresPool = value; },
  });
}

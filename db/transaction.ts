import "server-only";

import { Pool as NeonPool, type PoolClient as NeonPoolClient } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-serverless";
import { Pool as PostgresPool, type PoolClient as PostgresPoolClient } from "pg";
import { drizzle as drizzlePostgres } from "drizzle-orm/node-postgres";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";
import { resolveDatabaseRuntimeConfiguration } from "./runtime-config";
import { closePool, getOrCreatePool } from "./pool";

export type DatabaseTransaction = Pick<
  PgDatabase<PgQueryResultHKT, typeof schema>,
  "execute" | "select" | "insert" | "update"
>;

type ActiveGuard = () => void;

type TransactionRunnerOptions<Client, Transaction> = {
  acquire: () => Promise<Client>;
  createHandle: (client: Client, assertActive: ActiveGuard) => Transaction;
  executeCommand: (client: Client, command: string) => Promise<unknown>;
  release: (client: Client, failure?: Error | boolean) => void;
};

/**
 * Runs explicit PostgreSQL transaction commands around a guarded handle. The
 * small injection seam keeps lifecycle behavior testable without a database.
 */
export function createTransactionRunner<Client extends object, Transaction>({
  acquire,
  createHandle,
  executeCommand,
  release,
}: TransactionRunnerOptions<Client, Transaction>) {
  return async function withTransaction<Result>(
    callback: (transaction: Transaction) => Promise<Result>,
  ): Promise<Result> {
    const client = await acquire();
    let active = true;
    let failure: Error | boolean | undefined;
    let beginAttempted = false;
    let transactionHandle: Transaction | undefined;

    const assertActive = () => {
      if (!active) throw new Error("The transaction handle is no longer active.");
    };

    try {
      beginAttempted = true;
      await executeCommand(client, "BEGIN ISOLATION LEVEL READ COMMITTED");

      const guardedClient = guardClient(client, assertActive);
      transactionHandle = createHandle(guardedClient, assertActive);
      const result = await callback(transactionHandle);
      active = false;

      if (result === transactionHandle) {
        throw new TypeError("A transaction handle cannot be returned from its callback.");
      }

      await executeCommand(client, "COMMIT");
      return result;
    } catch (originalError) {
      active = false;
      let propagatedError = originalError;

      // BEGIN can fail after PostgreSQL has received it. Attempt rollback in
      // every failure path after sending BEGIN, then discard the client below.
      if (beginAttempted) {
        try {
          await executeCommand(client, "ROLLBACK");
        } catch (rollbackError) {
          propagatedError = new AggregateError(
            [originalError, rollbackError],
            "The transaction failed and rollback also failed.",
            { cause: originalError },
          );
        }
      }

      failure = propagatedError instanceof Error ? propagatedError : true;
      throw propagatedError;
    } finally {
      release(client, failure);
    }
  };
}

function guardClient<Client extends object>(client: Client, assertActive: ActiveGuard): Client {
  return new Proxy(client, {
    get(target, property) {
      const value: unknown = Reflect.get(target, property, target);

      if (property === "release" || property === "end") {
        return () => {
          throw new Error("Transaction clients are managed by the transaction adapter.");
        };
      }

      if (property === "query" && typeof value === "function") {
        return (...args: unknown[]) => {
          assertActive();
          return Reflect.apply(value, target, args);
        };
      }

      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function guardTransactionHandle<Database extends object>(database: Database): Database {
  return new Proxy(database, {
    get(target, property, receiver) {
      if (property === "$client" || property === "session") return undefined;
      if (property === "transaction") {
        return () => {
          throw new Error("Nested transactions are not supported by this adapter.");
        };
      }

      const value: unknown = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

type TransactionGlobals = typeof globalThis & {
  __clickMenuNeonTransactionPool?: NeonPool;
  __clickMenuPostgresTransactionPool?: PostgresPool;
};

function assertNodeRuntime(): void {
  if (typeof process === "undefined" || !process.versions?.node || process.env.NEXT_RUNTIME === "edge")
    throw new Error("The PostgreSQL transaction adapter requires the Node.js runtime.");
}

function getNeonPool(): NeonPool {
  assertNodeRuntime();
  if (typeof globalThis.WebSocket !== "function")
    throw new Error("The Neon transaction adapter requires Node.js WebSocket support.");

  const globals = globalThis as TransactionGlobals;
  const configuration = resolveDatabaseRuntimeConfiguration();
  if (configuration.driver !== "neon")
    throw new Error("The Neon transaction pool cannot be used with the PostgreSQL driver.");

  return getOrCreatePool({
    get pool() { return globals.__clickMenuNeonTransactionPool; },
    set pool(value) { globals.__clickMenuNeonTransactionPool = value; },
  }, () => new NeonPool({
    connectionString: configuration.connectionString,
    max: 2,
    idleTimeoutMillis: 5_000,
    maxLifetimeSeconds: 300,
    allowExitOnIdle: true,
  }).on("error", () => {
    console.error("An idle Neon transaction connection failed.");
  }));
}

function getPostgresPool(): PostgresPool {
  assertNodeRuntime();
  const globals = globalThis as TransactionGlobals;
  const configuration = resolveDatabaseRuntimeConfiguration();
  if (configuration.driver !== "postgres")
    throw new Error("The PostgreSQL transaction pool cannot be used with the Neon driver.");
  return getOrCreatePool({
    get pool() { return globals.__clickMenuPostgresTransactionPool; },
    set pool(value) { globals.__clickMenuPostgresTransactionPool = value; },
  }, () => new PostgresPool({
    connectionString: configuration.connectionString,
    max: 5,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
    allowExitOnIdle: true,
  }).on("error", () => {
    console.error("An idle PostgreSQL transaction connection failed.");
  }));
}

const runNeonTransaction = createTransactionRunner<NeonPoolClient, DatabaseTransaction>({
  acquire: () => getNeonPool().connect(),
  createHandle: (client) => guardTransactionHandle(
    drizzleNeon({ client, schema }),
  ),
  executeCommand: (client, command) => client.query(command),
  release: (client, failure) => client.release(failure),
});

let runPostgresTransaction: ReturnType<typeof createPostgresTransactionRunner> | undefined;

export function createPostgresTransactionRunner(
  pool: Pick<PostgresPool, "connect">,
) {
  return createTransactionRunner<PostgresPoolClient, DatabaseTransaction>({
    acquire: () => pool.connect(),
    createHandle: (client) => guardTransactionHandle(
      drizzlePostgres({ client, schema }),
    ),
    executeCommand: (client, command) => client.query(command),
    release: (client, failure) => client.release(failure),
  });
}

/** Runs one isolated, guarded transaction at PostgreSQL READ COMMITTED. */
export async function withDatabaseTransaction<Result>(
  callback: (transaction: DatabaseTransaction) => Promise<Result>,
): Promise<Result> {
  const { driver } = resolveDatabaseRuntimeConfiguration();
  if (driver === "neon") return runNeonTransaction(callback);
  runPostgresTransaction ??= createPostgresTransactionRunner(getPostgresPool());
  return runPostgresTransaction(callback);
}

export async function closePostgresTransactionPool(): Promise<void> {
  const globals = globalThis as TransactionGlobals;
  await closePool({
    get pool() { return globals.__clickMenuPostgresTransactionPool; },
    set pool(value) { globals.__clickMenuPostgresTransactionPool = value; },
  });
}


import "server-only";

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL_POOLED;

if (!connectionString) {
  throw new Error("DATABASE_URL_POOLED is not configured");
}

const client = neon(connectionString);

const db = drizzle({
  client,
  schema,
});

export function getDb() {
  return db;
}

export type Database = typeof db;

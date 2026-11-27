import "server-only";

import { neon } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import { drizzle as drizzlePostgres } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import * as schema from "./schema";

export function createNeonHttpDatabase(connectionString: string) {
  return drizzleNeon({ client: neon(connectionString), schema });
}

export function createPostgresDatabase(pool: Pool) {
  return drizzlePostgres({ client: pool, schema });
}

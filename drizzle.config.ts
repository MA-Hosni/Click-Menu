
import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";
import { resolveDatabaseDriver } from "./db/driver-config";

config({ path: ".env.local" });

const driver = resolveDatabaseDriver(process.env);
if (driver === "postgres" && process.env.DATABASE_URL_POOLED)
  throw new Error("DATABASE_URL_POOLED is ambiguous in local PostgreSQL migration mode.");

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is not configured");
}

export default defineConfig({
  schema: "./db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",

  dbCredentials: {
    url: connectionString,
  },

  migrations: {
    schema: "public",
    table: "__drizzle_migrations",
  },
});

import "server-only";
import { resolveDatabaseDriver } from "./driver-config";

export interface DatabaseRuntimeConfiguration {
  driver: "neon" | "postgres";
  connectionString: string;
}

export function resolveDatabaseRuntimeConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
): DatabaseRuntimeConfiguration {
  const driver = resolveDatabaseDriver(environment);
  if (driver === "postgres" && environment.DATABASE_URL_POOLED)
    throw new Error("DATABASE_URL_POOLED is not allowed with DATABASE_DRIVER=postgres.");

  const connectionString = driver === "postgres"
    ? environment.DATABASE_URL
    : environment.DATABASE_URL_POOLED;
  const variable = driver === "postgres" ? "DATABASE_URL" : "DATABASE_URL_POOLED";
  if (!connectionString)
    throw new Error(`${variable} is required for the ${driver} database driver.`);

  return { driver, connectionString };
}

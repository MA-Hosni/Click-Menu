export type DatabaseDriver = "neon" | "postgres";

export function resolveDatabaseDriver(
  environment: NodeJS.ProcessEnv = process.env,
): DatabaseDriver {
  const configuredDriver = environment.DATABASE_DRIVER;
  const driver = configuredDriver ? configuredDriver : "neon";
  if (driver !== "neon" && driver !== "postgres")
    throw new Error("DATABASE_DRIVER must be either 'neon' or 'postgres'.");
  return driver;
}

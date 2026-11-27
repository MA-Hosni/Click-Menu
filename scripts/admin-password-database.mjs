export async function withAdminPasswordDatabase(
  configuration,
  factories,
  operation,
) {
  if (configuration.driver === "postgres") {
    const pool = factories.createPostgresPool(configuration.connectionString);
    try {
      return await operation({ driver: "postgres", pool });
    } finally {
      await pool.end();
    }
  }

  return operation({
    driver: "neon",
    sql: factories.createNeonQuery(configuration.connectionString),
  });
}

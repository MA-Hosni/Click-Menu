export function hasDatabaseRows(result: unknown): boolean {
  if (!result || typeof result !== "object" || Array.isArray(result))
    throw new Error("The database driver returned an invalid query result.");
  if (!("rows" in result) || !Array.isArray(result.rows))
    throw new Error("The database driver returned an invalid query result.");
  return result.rows.length > 0;
}

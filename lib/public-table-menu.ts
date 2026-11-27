import type { Catalog } from "./types";

/** Resolve the table before loading The Hood's public catalog. */
export async function loadPublicTableMenu(
  token: string,
  dependencies: {
    resolveTable: (token: string) => Promise<{ label: string } | null>;
    readCatalog: () => Promise<Catalog | null>;
  },
): Promise<{ tableLabel: string; catalog: Catalog } | null> {
  const table = await dependencies.resolveTable(token);
  if (!table) return null;
  const catalog = await dependencies.readCatalog();
  if (!catalog) return null;
  return { tableLabel: table.label, catalog };
}

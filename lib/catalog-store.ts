import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { getDb } from "../db";
import { hasDatabaseRows } from "../db/result";
import { restaurantCatalogs } from "../db/schema";
import { createCatalogOperations } from "./catalog-operations";
import { createEmptyCatalog } from "./menu-data";
import type { Catalog } from "./types";

const SINGLETON_ID = 1;

const catalogOperations = createCatalogOperations({
  async read() {
    const [row] = await getDb()
      .select({
        payload: restaurantCatalogs.payload,
        revision: restaurantCatalogs.revision,
        priceReviewedRevision: restaurantCatalogs.priceReviewedRevision,
        priceReviewedAt: restaurantCatalogs.priceReviewedAt,
      })
      .from(restaurantCatalogs)
      .where(eq(restaurantCatalogs.id, SINGLETON_ID))
      .limit(1);
    return row ?? null;
  },
  async create(payload, revision, updatedAt) {
    const [row] = await getDb()
      .insert(restaurantCatalogs)
      .values({
        id: SINGLETON_ID,
        payload,
        revision,
        priceReviewedRevision: null,
        priceReviewedAt: null,
        updatedAt,
      })
      .onConflictDoNothing()
      .returning({ id: restaurantCatalogs.id });
    return Boolean(row);
  },
  async update(expectedRevision, payload, revision, updatedAt) {
    const [row] = await getDb()
      .update(restaurantCatalogs)
      .set({
        payload,
        revision,
        priceReviewedRevision: null,
        priceReviewedAt: null,
        updatedAt,
      })
      .where(
        and(
          eq(restaurantCatalogs.id, SINGLETON_ID),
          eq(restaurantCatalogs.revision, expectedRevision),
        ),
      )
      .returning({ id: restaurantCatalogs.id });
    return Boolean(row);
  },
  async review(expectedRevision, reviewedAt, expectedPayload, eventId, actor) {
    const result = await getDb().execute(sql`
      WITH reviewed AS (
        UPDATE restaurant_catalogs
        SET price_reviewed_revision = revision,
            price_reviewed_at = ${reviewedAt}
        WHERE id = ${SINGLETON_ID}
          AND revision = ${expectedRevision}
          AND payload = ${expectedPayload}
        RETURNING revision
      ), audited AS (
        INSERT INTO admin_audit_events (id, action, actor, created_at)
        SELECT ${eventId}, 'catalog_prices_reviewed', ${actor}, ${reviewedAt}
        FROM reviewed
        RETURNING id
      )
      SELECT id FROM audited
    `);
    return hasDatabaseRows(result);
  },
});

export const readCatalog = catalogOperations.read;
export const saveCatalog = (catalog: Catalog) => catalogOperations.save(catalog);
export const readCatalogReviewState = catalogOperations.readReviewState;
export const reviewCatalogPrices = (expectedRevision: unknown, actor: string) =>
  catalogOperations.review(expectedRevision, actor);

/** Public URLs may retain old query strings, but they never select a different catalog. */
export async function readPublicCatalog(): Promise<Catalog> {
  return (await readCatalog()) ?? createEmptyCatalog();
}

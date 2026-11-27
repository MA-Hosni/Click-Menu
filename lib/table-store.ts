import "server-only";

import { and, asc, eq, ne, sql } from "drizzle-orm";
import { getDb } from "../db";
import { restaurantTables } from "../db/schema";
import type {
  RestaurantTable,
  RestaurantTableStore,
  TableChanges,
} from "./table-operations";

export function createRestaurantTableStore(): RestaurantTableStore {
  const db = getDb();
  return {
    async list() {
      return db
        .select({
          id: restaurantTables.id,
          label: restaurantTables.label,
          isActive: restaurantTables.isActive,
          qrVersion: restaurantTables.qrVersion,
          createdAt: restaurantTables.createdAt,
          updatedAt: restaurantTables.updatedAt,
        })
        .from(restaurantTables)
        .orderBy(asc(restaurantTables.label));
    },
    async hasLabel(label, exceptId) {
      const conditions = [sql`lower(${restaurantTables.label}) = lower(${label})`];
      if (exceptId) conditions.push(ne(restaurantTables.id, exceptId));
      const [row] = await db
        .select({ id: restaurantTables.id })
        .from(restaurantTables)
        .where(and(...conditions))
        .limit(1);
      return Boolean(row);
    },
    async insert(table: RestaurantTable & { qrTokenHash: string }) {
      const [row] = await db
        .insert(restaurantTables)
        .values(table)
        .onConflictDoNothing()
        .returning({ id: restaurantTables.id });
      return Boolean(row);
    },
    async update(id: string, changes: TableChanges, updatedAt: number) {
      const [row] = await db
        .update(restaurantTables)
        .set({ ...changes, updatedAt })
        .where(eq(restaurantTables.id, id))
        .returning({ id: restaurantTables.id });
      return Boolean(row);
    },
    async readRotation(id) {
      const [row] = await db
        .select({
          qrVersion: restaurantTables.qrVersion,
          qrTokenHash: restaurantTables.qrTokenHash,
          rotationRequestHash: restaurantTables.rotationRequestHash,
          rotationTokenCiphertext: restaurantTables.rotationTokenCiphertext,
        })
        .from(restaurantTables)
        .where(eq(restaurantTables.id, id))
        .limit(1);
      return row ?? null;
    },
    async readCurrentRecovery(id) {
      const [row] = await db
        .select({
          qrVersion: restaurantTables.qrVersion,
          qrTokenHash: restaurantTables.qrTokenHash,
          rotationRequestHash: restaurantTables.rotationRequestHash,
          rotationTokenCiphertext: restaurantTables.rotationTokenCiphertext,
          isActive: restaurantTables.isActive,
        })
        .from(restaurantTables)
        .where(eq(restaurantTables.id, id))
        .limit(1);
      return row ?? null;
    },
    async rotateToken(id, expectedVersion, qrTokenHash, rotationRequestHash, rotationTokenCiphertext, updatedAt) {
      const [row] = await db
        .update(restaurantTables)
        .set({
          qrTokenHash,
          qrVersion: sql`${restaurantTables.qrVersion} + 1`,
          rotationRequestHash,
          rotationTokenCiphertext,
          updatedAt,
        })
        .where(
          and(
            eq(restaurantTables.id, id),
            eq(restaurantTables.qrVersion, expectedVersion),
          ),
        )
        .returning({ qrVersion: restaurantTables.qrVersion });
      return row?.qrVersion ?? null;
    },
    async exists(id) {
      const [row] = await db
        .select({ id: restaurantTables.id })
        .from(restaurantTables)
        .where(eq(restaurantTables.id, id))
        .limit(1);
      return Boolean(row);
    },
    async resolveActive(qrTokenHash) {
      const [row] = await db
        .select({ label: restaurantTables.label })
        .from(restaurantTables)
        .where(
          and(
            eq(restaurantTables.qrTokenHash, qrTokenHash),
            eq(restaurantTables.isActive, true),
          ),
        )
        .limit(1);
      return row ?? null;
    },
  };
}

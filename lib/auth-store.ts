import { and, eq, gt, lte } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { getDb } from "../db";
import { hasDatabaseRows } from "../db/result";
import { adminCredentials, sessions } from "../db/schema";
import type { AuthStore } from "./auth";

/** PostgreSQL-backed singleton administrator credentials and hashed sessions. */
export function postgresAuthStore(): AuthStore {
  const db = getDb();
  return {
    async getAdminCredential() {
      const [row] = await db
        .select({
          passwordHash: adminCredentials.passwordHash,
          credentialVersion: adminCredentials.credentialVersion,
        })
        .from(adminCredentials)
        .where(eq(adminCredentials.id, 1))
        .limit(1);
      return row ?? null;
    },
    async initializePassword(passwordHash, eventId, now) {
      const result = await db.execute<{ id: number }>(sql`
        WITH inserted AS (
          INSERT INTO admin_credentials (id, password_hash, credential_version, password_changed_at)
          VALUES (1, ${passwordHash}, 1, ${now})
          ON CONFLICT (id) DO NOTHING
          RETURNING id
        ), audited AS (
          INSERT INTO admin_audit_events (id, action, actor, created_at)
          SELECT ${eventId}, 'initialized', 'cli', ${now} FROM inserted
          RETURNING id
        )
        SELECT id FROM audited
      `);
      return hasDatabaseRows(result);
    },
    async resetPassword(passwordHash, eventId, now) {
      const result = await db.execute<{ id: number }>(sql`
        WITH updated AS (
          UPDATE admin_credentials
          SET password_hash = ${passwordHash},
              credential_version = credential_version + 1,
              password_changed_at = ${now}
          WHERE id = 1
          RETURNING id
        ), revoked AS (
          DELETE FROM sessions WHERE EXISTS (SELECT 1 FROM updated)
          RETURNING token_hash
        ), audited AS (
          INSERT INTO admin_audit_events (id, action, actor, created_at)
          SELECT ${eventId}, 'reset', 'cli', ${now} FROM updated
          RETURNING id
        )
        SELECT id FROM audited
      `);
      return hasDatabaseRows(result);
    },
    async createSession(session) {
      await db.insert(sessions).values(session);
    },
    async getSessionUser(tokenHash, now) {
      const [row] = await db
        .select({ tokenHash: sessions.tokenHash })
        .from(sessions)
        .innerJoin(
          adminCredentials,
          eq(adminCredentials.credentialVersion, sessions.credentialVersion),
        )
        .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, now)))
        .limit(1);
      return row ? { name: "The Hood" } : null;
    },
    async deleteSession(tokenHash) {
      await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
    },
    async deleteExpiredSessions(now) {
      await db.delete(sessions).where(lte(sessions.expiresAt, now));
    },
  };
}

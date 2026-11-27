-- Refuse an implicit merge if this database contains multiple legacy accounts.
DO $$
DECLARE
  legacy_account_count integer;
BEGIN
  SELECT count(DISTINCT legacy_id) INTO legacy_account_count
  FROM (
    SELECT id AS legacy_id FROM users
    UNION SELECT owner_id FROM restaurant_catalogs
    UNION SELECT owner_id FROM menu_images
    UNION SELECT owner_id FROM orders
    UNION SELECT owner_id FROM owner_credential_events
  ) AS legacy_accounts;
  IF legacy_account_count > 1 THEN
    RAISE EXCEPTION 'Single-admin migration requires at most one legacy account; found %', legacy_account_count;
  END IF;
END $$;
--> statement-breakpoint
CREATE TABLE "admin_audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"action" text NOT NULL,
	"actor" text NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_credentials" (
	"id" integer PRIMARY KEY NOT NULL,
	"password_hash" text NOT NULL,
	"credential_version" integer DEFAULT 1 NOT NULL,
	"password_changed_at" bigint,
	CONSTRAINT "admin_credentials_singleton_check" CHECK ("admin_credentials"."id" = 1)
);
--> statement-breakpoint
-- Keep an existing password verifier; leave credential setup empty if none existed.
INSERT INTO admin_credentials (id, password_hash, credential_version, password_changed_at)
SELECT 1, password_hash, GREATEST(credential_version, 1), NULL
FROM users
WHERE password_hash IS NOT NULL
LIMIT 1;
--> statement-breakpoint
INSERT INTO admin_audit_events (id, action, actor, created_at)
SELECT id, action, actor, created_at FROM owner_credential_events
ON CONFLICT (id) DO NOTHING;
--> statement-breakpoint
-- These legacy owner_id values are storage partitions only in the new model.
UPDATE restaurant_catalogs SET owner_id = 'the-hood-legacy-storage';
--> statement-breakpoint
UPDATE menu_images SET owner_id = 'the-hood-legacy-storage';
--> statement-breakpoint
UPDATE orders SET owner_id = 'the-hood-legacy-storage';
--> statement-breakpoint
-- Force re-authentication and remove the user-bound session column.
DELETE FROM sessions;
--> statement-breakpoint
DROP INDEX "sessions_user_idx";
--> statement-breakpoint
ALTER TABLE "sessions" DROP COLUMN "user_id";
--> statement-breakpoint
DROP TABLE "login_codes";
--> statement-breakpoint
DROP TABLE "owner_credential_events";
--> statement-breakpoint
DROP TABLE "users";

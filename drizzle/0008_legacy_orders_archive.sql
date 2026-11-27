CREATE TABLE IF NOT EXISTS "legacy_orders_archive" (
	"id" text PRIMARY KEY NOT NULL,
	"legacy_storage_key" text NOT NULL,
	"created_at" bigint NOT NULL,
	"payload" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "legacy_orders_archive_created_idx" ON "legacy_orders_archive" USING btree ("created_at");--> statement-breakpoint
INSERT INTO "legacy_orders_archive" ("id", "legacy_storage_key", "created_at", "payload")
SELECT "id", "owner_id", "created_at", "payload"
FROM "orders"
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "orders" AS source
    LEFT JOIN "legacy_orders_archive" AS archived ON archived."id" = source."id"
    WHERE archived."id" IS NULL
      OR archived."legacy_storage_key" IS DISTINCT FROM source."owner_id"
      OR archived."created_at" IS DISTINCT FROM source."created_at"
      OR archived."payload" IS DISTINCT FROM source."payload"
  ) OR (
    SELECT count(*) FROM "orders"
  ) <> (
    SELECT count(*) FROM "legacy_orders_archive"
  ) THEN
    RAISE EXCEPTION 'Legacy order archive verification failed';
  END IF;
END $$;

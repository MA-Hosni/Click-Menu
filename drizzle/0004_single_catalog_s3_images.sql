-- If legacy images exist, first run the documented S3 transfer procedure in
-- docs/DATABASE_SCHEMA.md. The procedure uploads every image to its stable key
-- menu-images/<id> and must finish successfully before this migration is run.
DO $$
DECLARE
  catalog_count integer;
BEGIN
  SELECT count(*) INTO catalog_count FROM restaurant_catalogs;
  IF catalog_count > 1 THEN
    RAISE EXCEPTION 'Single-catalog migration requires at most one catalog row; found %', catalog_count;
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "restaurant_catalogs" DROP CONSTRAINT "restaurant_catalogs_pkey";
--> statement-breakpoint
ALTER TABLE "restaurant_catalogs" DROP CONSTRAINT IF EXISTS "restaurant_catalogs_slug_unique";
--> statement-breakpoint
ALTER TABLE "restaurant_catalogs" ADD COLUMN "id" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "restaurant_catalogs" DROP COLUMN "owner_id";
--> statement-breakpoint
ALTER TABLE "restaurant_catalogs" DROP COLUMN "slug";
--> statement-breakpoint
ALTER TABLE "restaurant_catalogs" ADD CONSTRAINT "restaurant_catalogs_pkey" PRIMARY KEY ("id");
--> statement-breakpoint
ALTER TABLE "restaurant_catalogs" ADD CONSTRAINT "restaurant_catalogs_singleton_check" CHECK ("restaurant_catalogs"."id" = 1);
--> statement-breakpoint
ALTER TABLE "menu_images" ADD COLUMN "object_key" text;
--> statement-breakpoint
UPDATE "menu_images" SET "object_key" = 'menu-images/' || "id";
--> statement-breakpoint
ALTER TABLE "menu_images" ALTER COLUMN "object_key" SET NOT NULL;
--> statement-breakpoint
DROP INDEX "menu_images_owner_idx";
--> statement-breakpoint
ALTER TABLE "menu_images" DROP COLUMN "owner_id";
--> statement-breakpoint
ALTER TABLE "menu_images" DROP COLUMN "data";

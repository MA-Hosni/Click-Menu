DO $$
DECLARE
  existing_image_count integer;
BEGIN
  SELECT count(*) INTO existing_image_count FROM menu_images;
  IF existing_image_count > 300 THEN
    RAISE EXCEPTION 'Image capacity migration requires no more than 300 images; found %', existing_image_count;
  END IF;
END $$;
--> statement-breakpoint
CREATE TABLE "image_upload_capacity" (
	"id" integer PRIMARY KEY NOT NULL,
	"image_count" integer NOT NULL,
	CONSTRAINT "image_upload_capacity_singleton_check" CHECK ("id" = 1),
	CONSTRAINT "image_upload_capacity_count_check" CHECK ("image_count" >= 0 AND "image_count" <= 300)
);
--> statement-breakpoint
INSERT INTO "image_upload_capacity" ("id", "image_count")
SELECT 1, count(*)::integer FROM "menu_images";
--> statement-breakpoint
CREATE UNIQUE INDEX "menu_images_object_key_unique" ON "menu_images" USING btree ("object_key");

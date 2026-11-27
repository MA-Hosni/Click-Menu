ALTER TABLE "restaurant_tables" ADD COLUMN "qr_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "restaurant_tables" ADD COLUMN "rotation_request_hash" text;--> statement-breakpoint
ALTER TABLE "restaurant_tables" ADD COLUMN "rotation_token_ciphertext" text;--> statement-breakpoint
ALTER TABLE "restaurant_tables" ADD CONSTRAINT "restaurant_tables_qr_version_check" CHECK ("restaurant_tables"."qr_version" >= 1);--> statement-breakpoint
ALTER TABLE "restaurant_tables" ADD CONSTRAINT "restaurant_tables_rotation_recovery_pair_check" CHECK (("restaurant_tables"."rotation_request_hash" IS NULL) = ("restaurant_tables"."rotation_token_ciphertext" IS NULL));
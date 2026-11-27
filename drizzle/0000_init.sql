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
CREATE TABLE "dine_in_order_items" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"line_number" integer NOT NULL,
	"product_id_snapshot" text,
	"product_name_snapshot" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price_millimes" bigint NOT NULL,
	"line_subtotal_millimes" bigint NOT NULL,
	"option_snapshots" jsonb NOT NULL,
	CONSTRAINT "dine_in_order_items_line_number_check" CHECK ("dine_in_order_items"."line_number" > 0),
	CONSTRAINT "dine_in_order_items_quantity_check" CHECK ("dine_in_order_items"."quantity" > 0),
	CONSTRAINT "dine_in_order_items_unit_price_millimes_check" CHECK ("dine_in_order_items"."unit_price_millimes" >= 0 AND "dine_in_order_items"."unit_price_millimes" <= 9007199254740991),
	CONSTRAINT "dine_in_order_items_line_subtotal_millimes_check" CHECK ("dine_in_order_items"."line_subtotal_millimes" >= 0 AND "dine_in_order_items"."line_subtotal_millimes" <= 9007199254740991),
	CONSTRAINT "dine_in_order_items_line_total_check" CHECK ("dine_in_order_items"."line_subtotal_millimes" = "dine_in_order_items"."unit_price_millimes" * "dine_in_order_items"."quantity"),
	CONSTRAINT "dine_in_order_items_option_snapshots_array_check" CHECK (jsonb_typeof("dine_in_order_items"."option_snapshots") = 'array')
);
--> statement-breakpoint
CREATE TABLE "dine_in_orders" (
	"id" text PRIMARY KEY NOT NULL,
	"tracking_token_hash" text NOT NULL,
	"idempotency_key_hash" text NOT NULL,
	"request_hash" text NOT NULL,
	"table_id" text NOT NULL,
	"table_label_snapshot" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"subtotal_millimes" bigint NOT NULL,
	"total_millimes" bigint NOT NULL,
	"customer_name" text,
	"customer_notes" text,
	"tracking_recovery_version" integer,
	"tracking_recovery_nonce" text,
	"tracking_recovery_ciphertext" text,
	"tracking_recovery_auth_tag" text,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "dine_in_orders_tracking_token_hash_check" CHECK ("dine_in_orders"."tracking_token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "dine_in_orders_request_hash_check" CHECK ("dine_in_orders"."request_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "dine_in_orders_idempotency_key_hash_check" CHECK ("dine_in_orders"."idempotency_key_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "dine_in_orders_status_check" CHECK ("dine_in_orders"."status" IN ('pending', 'confirmed', 'preparing', 'completed', 'rejected', 'cancelled')),
	CONSTRAINT "dine_in_orders_subtotal_millimes_check" CHECK ("dine_in_orders"."subtotal_millimes" >= 0 AND "dine_in_orders"."subtotal_millimes" <= 9007199254740991),
	CONSTRAINT "dine_in_orders_total_millimes_check" CHECK ("dine_in_orders"."total_millimes" >= 0 AND "dine_in_orders"."total_millimes" <= 9007199254740991),
	CONSTRAINT "dine_in_orders_total_equals_subtotal_check" CHECK ("dine_in_orders"."total_millimes" = "dine_in_orders"."subtotal_millimes"),
	CONSTRAINT "dine_in_orders_tracking_recovery_envelope_check" CHECK (("dine_in_orders"."tracking_recovery_version" IS NULL AND "dine_in_orders"."tracking_recovery_nonce" IS NULL AND "dine_in_orders"."tracking_recovery_ciphertext" IS NULL AND "dine_in_orders"."tracking_recovery_auth_tag" IS NULL) OR ("dine_in_orders"."tracking_recovery_version" IS NOT NULL AND "dine_in_orders"."tracking_recovery_version" = 1 AND "dine_in_orders"."tracking_recovery_nonce" IS NOT NULL AND "dine_in_orders"."tracking_recovery_nonce" ~ '^[A-Za-z0-9+/]{16}$' AND "dine_in_orders"."tracking_recovery_ciphertext" IS NOT NULL AND "dine_in_orders"."tracking_recovery_ciphertext" ~ '^[A-Za-z0-9+/]{57}[AQgw]==$' AND "dine_in_orders"."tracking_recovery_auth_tag" IS NOT NULL AND "dine_in_orders"."tracking_recovery_auth_tag" ~ '^[A-Za-z0-9+/]{21}[AQgw]==$'))
);
--> statement-breakpoint
CREATE TABLE "image_upload_capacity" (
	"id" integer PRIMARY KEY NOT NULL,
	"image_count" integer NOT NULL,
	CONSTRAINT "image_upload_capacity_singleton_check" CHECK ("image_upload_capacity"."id" = 1),
	CONSTRAINT "image_upload_capacity_count_check" CHECK ("image_upload_capacity"."image_count" >= 0 AND "image_upload_capacity"."image_count" <= 300)
);
--> statement-breakpoint
-- Seed the singleton counter so fresh databases can reserve image capacity.
INSERT INTO "image_upload_capacity" ("id", "image_count") VALUES (1, 0);
--> statement-breakpoint
CREATE TABLE "legacy_orders_archive" (
	"id" text PRIMARY KEY NOT NULL,
	"legacy_storage_key" text NOT NULL,
	"created_at" bigint NOT NULL,
	"payload" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "menu_images" (
	"id" text PRIMARY KEY NOT NULL,
	"object_key" text NOT NULL,
	"content_type" text NOT NULL,
	"byte_length" integer NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"created_at" bigint NOT NULL,
	"payload" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"window_start" bigint NOT NULL,
	"count" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "restaurant_catalogs" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"payload" text NOT NULL,
	"revision" integer NOT NULL,
	"price_reviewed_revision" integer,
	"price_reviewed_at" bigint,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "restaurant_catalogs_singleton_check" CHECK ("restaurant_catalogs"."id" = 1),
	CONSTRAINT "restaurant_catalogs_price_review_state_pair_check" CHECK (("restaurant_catalogs"."price_reviewed_revision" IS NULL) = ("restaurant_catalogs"."price_reviewed_at" IS NULL)),
	CONSTRAINT "restaurant_catalogs_price_review_revision_check" CHECK ("restaurant_catalogs"."price_reviewed_revision" IS NULL OR "restaurant_catalogs"."price_reviewed_revision" = "restaurant_catalogs"."revision")
);
--> statement-breakpoint
CREATE TABLE "restaurant_tables" (
	"id" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"qr_token_hash" text NOT NULL,
	"qr_version" integer DEFAULT 1 NOT NULL,
	"rotation_request_hash" text,
	"rotation_token_ciphertext" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "restaurant_tables_qr_version_check" CHECK ("restaurant_tables"."qr_version" >= 1),
	CONSTRAINT "restaurant_tables_rotation_recovery_pair_check" CHECK (("restaurant_tables"."rotation_request_hash" IS NULL) = ("restaurant_tables"."rotation_token_ciphertext" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"credential_version" integer DEFAULT 0 NOT NULL,
	"expires_at" bigint NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dine_in_order_items" ADD CONSTRAINT "dine_in_order_items_order_id_dine_in_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."dine_in_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dine_in_orders" ADD CONSTRAINT "dine_in_orders_table_id_restaurant_tables_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."restaurant_tables"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE UNIQUE INDEX "dine_in_order_items_order_line_unique" ON "dine_in_order_items" USING btree ("order_id","line_number");--> statement-breakpoint
CREATE UNIQUE INDEX "dine_in_orders_tracking_token_hash_unique" ON "dine_in_orders" USING btree ("tracking_token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "dine_in_orders_idempotency_key_hash_unique" ON "dine_in_orders" USING btree ("idempotency_key_hash");--> statement-breakpoint
CREATE INDEX "dine_in_orders_status_created_idx" ON "dine_in_orders" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "dine_in_orders_table_created_idx" ON "dine_in_orders" USING btree ("table_id","created_at");--> statement-breakpoint
CREATE INDEX "dine_in_orders_created_id_idx" ON "dine_in_orders" USING btree ("created_at","id");--> statement-breakpoint
CREATE INDEX "legacy_orders_archive_created_idx" ON "legacy_orders_archive" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "menu_images_object_key_unique" ON "menu_images" USING btree ("object_key");--> statement-breakpoint
CREATE INDEX "orders_owner_created_idx" ON "orders" USING btree ("owner_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "restaurant_tables_label_unique" ON "restaurant_tables" USING btree (lower("label"));--> statement-breakpoint
CREATE UNIQUE INDEX "restaurant_tables_qr_token_hash_unique" ON "restaurant_tables" USING btree ("qr_token_hash");

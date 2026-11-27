CREATE TABLE "restaurant_tables" (
	"id" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"qr_token_hash" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "restaurant_tables_label_unique" ON "restaurant_tables" USING btree (lower("label"));
--> statement-breakpoint
CREATE UNIQUE INDEX "restaurant_tables_qr_token_hash_unique" ON "restaurant_tables" USING btree ("qr_token_hash");

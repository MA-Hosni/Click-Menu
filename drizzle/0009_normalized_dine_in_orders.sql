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
	"request_hash" text NOT NULL,
	"table_id" text NOT NULL,
	"table_label_snapshot" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"currency" text DEFAULT 'TND' NOT NULL,
	"subtotal_millimes" bigint NOT NULL,
	"total_millimes" bigint NOT NULL,
	"customer_name" text,
	"customer_notes" text,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "dine_in_orders_tracking_token_hash_check" CHECK ("dine_in_orders"."tracking_token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "dine_in_orders_request_hash_check" CHECK ("dine_in_orders"."request_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "dine_in_orders_status_check" CHECK ("dine_in_orders"."status" IN ('pending', 'confirmed', 'preparing', 'completed', 'rejected', 'cancelled')),
	CONSTRAINT "dine_in_orders_currency_check" CHECK ("dine_in_orders"."currency" = 'TND'),
	CONSTRAINT "dine_in_orders_subtotal_millimes_check" CHECK ("dine_in_orders"."subtotal_millimes" >= 0 AND "dine_in_orders"."subtotal_millimes" <= 9007199254740991),
	CONSTRAINT "dine_in_orders_total_millimes_check" CHECK ("dine_in_orders"."total_millimes" >= 0 AND "dine_in_orders"."total_millimes" <= 9007199254740991),
	CONSTRAINT "dine_in_orders_total_equals_subtotal_check" CHECK ("dine_in_orders"."total_millimes" = "dine_in_orders"."subtotal_millimes")
);
--> statement-breakpoint
ALTER TABLE "dine_in_order_items" ADD CONSTRAINT "dine_in_order_items_order_id_dine_in_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."dine_in_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dine_in_orders" ADD CONSTRAINT "dine_in_orders_table_id_restaurant_tables_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."restaurant_tables"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE UNIQUE INDEX "dine_in_order_items_order_line_unique" ON "dine_in_order_items" USING btree ("order_id","line_number");--> statement-breakpoint
CREATE UNIQUE INDEX "dine_in_orders_tracking_token_hash_unique" ON "dine_in_orders" USING btree ("tracking_token_hash");--> statement-breakpoint
CREATE INDEX "dine_in_orders_status_created_idx" ON "dine_in_orders" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "dine_in_orders_table_created_idx" ON "dine_in_orders" USING btree ("table_id","created_at");

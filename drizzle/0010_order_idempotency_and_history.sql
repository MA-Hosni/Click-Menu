DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "dine_in_orders") THEN
    RAISE EXCEPTION 'Migration 0010 requires an empty dine_in_orders table because legacy rows have no idempotency key';
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "dine_in_order_items"
  DROP CONSTRAINT "dine_in_order_items_order_id_dine_in_orders_id_fk",
  ADD CONSTRAINT "dine_in_order_items_order_id_dine_in_orders_id_fk"
    FOREIGN KEY ("order_id") REFERENCES "public"."dine_in_orders"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;
--> statement-breakpoint
ALTER TABLE "dine_in_orders" ADD COLUMN "idempotency_key_hash" text NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "dine_in_orders_idempotency_key_hash_unique" ON "dine_in_orders" USING btree ("idempotency_key_hash");--> statement-breakpoint
CREATE INDEX "dine_in_orders_created_id_idx" ON "dine_in_orders" USING btree ("created_at","id");--> statement-breakpoint
ALTER TABLE "dine_in_orders" ADD CONSTRAINT "dine_in_orders_idempotency_key_hash_check" CHECK ("dine_in_orders"."idempotency_key_hash" ~ '^[0-9a-f]{64}$');

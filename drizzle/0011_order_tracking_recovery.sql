ALTER TABLE "dine_in_orders"
  ADD COLUMN "tracking_recovery_version" integer,
  ADD COLUMN "tracking_recovery_nonce" text,
  ADD COLUMN "tracking_recovery_ciphertext" text,
  ADD COLUMN "tracking_recovery_auth_tag" text;
--> statement-breakpoint
ALTER TABLE "dine_in_orders"
  ADD CONSTRAINT "dine_in_orders_tracking_recovery_envelope_check"
  CHECK (
    (
      "tracking_recovery_version" IS NULL AND
      "tracking_recovery_nonce" IS NULL AND
      "tracking_recovery_ciphertext" IS NULL AND
      "tracking_recovery_auth_tag" IS NULL
    ) OR (
      "tracking_recovery_version" IS NOT NULL AND
      "tracking_recovery_version" = 1 AND
      "tracking_recovery_nonce" IS NOT NULL AND
      "tracking_recovery_nonce" ~ '^[A-Za-z0-9+/]{16}$' AND
      "tracking_recovery_ciphertext" IS NOT NULL AND
      "tracking_recovery_ciphertext" ~ '^[A-Za-z0-9+/]{57}[AQgw]==$' AND
      "tracking_recovery_auth_tag" IS NOT NULL AND
      "tracking_recovery_auth_tag" ~ '^[A-Za-z0-9+/]{21}[AQgw]==$'
    )
  );

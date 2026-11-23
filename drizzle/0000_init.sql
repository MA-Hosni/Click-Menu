CREATE TABLE "login_codes" (
	"email" text PRIMARY KEY NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" bigint NOT NULL,
	"attempts" integer NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "menu_images" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"content_type" text NOT NULL,
	"data" text NOT NULL,
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
	"owner_id" text PRIMARY KEY NOT NULL,
	"payload" text NOT NULL,
	"revision" integer NOT NULL,
	"updated_at" bigint NOT NULL,
	"slug" text,
	CONSTRAINT "restaurant_catalogs_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" bigint NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"created_at" bigint NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE INDEX "menu_images_owner_idx" ON "menu_images" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "orders_owner_created_idx" ON "orders" USING btree ("owner_id","created_at");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");
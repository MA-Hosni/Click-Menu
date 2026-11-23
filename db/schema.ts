import {
  bigint,
  index,
  integer,
  pgTable,
  text,
} from "drizzle-orm/pg-core";

// Restaurant menu and settings, stored as a JSON payload.
export const restaurantCatalogs = pgTable("restaurant_catalogs", {
  ownerId: text("owner_id").primaryKey(),
  payload: text("payload").notNull(),
  revision: integer("revision").notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  slug: text("slug").unique(),
});

// Uploaded restaurant food photos.
export const menuImages = pgTable(
  "menu_images",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    contentType: text("content_type").notNull(),
    data: text("data").notNull(),
    byteLength: integer("byte_length").notNull(),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (table) => [
    index("menu_images_owner_idx").on(table.ownerId),
  ],
);

// Customer orders.
export const orders = pgTable(
  "orders",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    payload: text("payload").notNull(),
  },
  (table) => [
    index("orders_owner_created_idx").on(
      table.ownerId,
      table.createdAt,
    ),
  ],
);

// Restaurant owners.
export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

// Pending email sign-in codes.
export const loginCodes = pgTable("login_codes", {
  email: text("email").primaryKey(),
  codeHash: text("code_hash").notNull(),
  expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
  attempts: integer("attempts").notNull(),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

// Authenticated browser sessions.
export const sessions = pgTable(
  "sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: text("user_id").notNull(),
    expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (table) => [
    index("sessions_user_idx").on(table.userId),
  ],
);

// Request rate-limit counters.
export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  windowStart: bigint("window_start", { mode: "number" }).notNull(),
  count: integer("count").notNull(),
});

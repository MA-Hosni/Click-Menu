import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const DINE_IN_ORDER_STATUSES = [
  "pending",
  "confirmed",
  "preparing",
  "completed",
  "rejected",
  "cancelled",
] as const;

export type DineInOrderStatus = (typeof DINE_IN_ORDER_STATUSES)[number];

export interface OrderOptionSnapshot {
  id: string;
  name: string;
  priceAdjustmentMillimes: number;
}

// Restaurant menu and settings, stored as a JSON payload.
export const restaurantCatalogs = pgTable("restaurant_catalogs", {
  id: integer("id").primaryKey().default(1),
  payload: text("payload").notNull(),
  revision: integer("revision").notNull(),
  tndReviewedRevision: integer("tnd_reviewed_revision"),
  tndReviewedAt: bigint("tnd_reviewed_at", { mode: "number" }),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
}, (table) => [
  check("restaurant_catalogs_singleton_check", sql`${table.id} = 1`),
  check(
    "restaurant_catalogs_tnd_review_state_pair_check",
    sql`(${table.tndReviewedRevision} IS NULL) = (${table.tndReviewedAt} IS NULL)`,
  ),
  check(
    "restaurant_catalogs_tnd_review_revision_check",
    sql`${table.tndReviewedRevision} IS NULL OR ${table.tndReviewedRevision} = ${table.revision}`,
  ),
]);

// Uploaded restaurant food photos.
export const menuImages = pgTable(
  "menu_images",
  {
    id: text("id").primaryKey(),
    objectKey: text("object_key").notNull(),
    contentType: text("content_type").notNull(),
    byteLength: integer("byte_length").notNull(),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (table) => [uniqueIndex("menu_images_object_key_unique").on(table.objectKey)],
);

// Restaurant floor plan and public QR credentials.
export const restaurantTables = pgTable(
  "restaurant_tables",
  {
    id: text("id").primaryKey(),
    label: text("label").notNull(),
    qrTokenHash: text("qr_token_hash").notNull(),
    qrVersion: integer("qr_version").notNull().default(1),
    rotationRequestHash: text("rotation_request_hash"),
    rotationTokenCiphertext: text("rotation_token_ciphertext"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  },
  (table) => [
    uniqueIndex("restaurant_tables_label_unique").on(sql`lower(${table.label})`),
    uniqueIndex("restaurant_tables_qr_token_hash_unique").on(table.qrTokenHash),
    check("restaurant_tables_qr_version_check", sql`${table.qrVersion} >= 1`),
    check(
      "restaurant_tables_rotation_recovery_pair_check",
      sql`(${table.rotationRequestHash} IS NULL) = (${table.rotationTokenCiphertext} IS NULL)`,
    ),
  ],
);

// One-row counter reserved atomically with each menu image metadata insert.
export const imageUploadCapacity = pgTable(
  "image_upload_capacity",
  {
    id: integer("id").primaryKey(),
    imageCount: integer("image_count").notNull(),
  },
  (table) => [
    check("image_upload_capacity_singleton_check", sql`${table.id} = 1`),
    check("image_upload_capacity_count_check", sql`${table.imageCount} >= 0 AND ${table.imageCount} <= 300`),
  ],
);

// Customer orders.
export const orders = pgTable(
  "orders",
  {
    id: text("id").primaryKey(),
    // Temporary legacy storage partition; remove with the later storage redesign.
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

// Immutable copy of legacy order rows; its storage key is historical provenance only.
export const legacyOrdersArchive = pgTable(
  "legacy_orders_archive",
  {
    id: text("id").primaryKey(),
    legacyStorageKey: text("legacy_storage_key").notNull(),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    payload: text("payload").notNull(),
  },
  (table) => [index("legacy_orders_archive_created_idx").on(table.createdAt)],
);

const statusSql = sql.join(
  DINE_IN_ORDER_STATUSES.map((status) => sql.raw(`'${status}'`)),
  sql`, `,
);
const maxSafeInteger = sql.raw("9007199254740991");

// The normalized API persists dine-in orders here; customer checkout UI is not connected yet.
export const dineInOrders = pgTable(
  "dine_in_orders",
  {
    id: text("id").primaryKey(),
    trackingTokenHash: text("tracking_token_hash").notNull(),
    idempotencyKeyHash: text("idempotency_key_hash").notNull(),
    requestHash: text("request_hash").notNull(),
    tableId: text("table_id")
      .notNull()
      .references(() => restaurantTables.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    tableLabelSnapshot: text("table_label_snapshot").notNull(),
    status: text("status").notNull().default("pending"),
    currency: text("currency").notNull().default("TND"),
    subtotalMillimes: bigint("subtotal_millimes", { mode: "number" }).notNull(),
    totalMillimes: bigint("total_millimes", { mode: "number" }).notNull(),
    customerName: text("customer_name"),
    customerNotes: text("customer_notes"),
    trackingRecoveryVersion: integer("tracking_recovery_version"),
    trackingRecoveryNonce: text("tracking_recovery_nonce"),
    trackingRecoveryCiphertext: text("tracking_recovery_ciphertext"),
    trackingRecoveryAuthTag: text("tracking_recovery_auth_tag"),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  },
  (table) => [
    uniqueIndex("dine_in_orders_tracking_token_hash_unique").on(
      table.trackingTokenHash,
    ),
    uniqueIndex("dine_in_orders_idempotency_key_hash_unique").on(
      table.idempotencyKeyHash,
    ),
    index("dine_in_orders_status_created_idx").on(table.status, table.createdAt),
    index("dine_in_orders_table_created_idx").on(table.tableId, table.createdAt),
    index("dine_in_orders_created_id_idx").on(table.createdAt, table.id),
    check(
      "dine_in_orders_tracking_token_hash_check",
      sql`${table.trackingTokenHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "dine_in_orders_request_hash_check",
      sql`${table.requestHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "dine_in_orders_idempotency_key_hash_check",
      sql`${table.idempotencyKeyHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "dine_in_orders_status_check",
      sql`${table.status} IN (${statusSql})`,
    ),
    check("dine_in_orders_currency_check", sql`${table.currency} = 'TND'`),
    check(
      "dine_in_orders_subtotal_millimes_check",
      sql`${table.subtotalMillimes} >= 0 AND ${table.subtotalMillimes} <= ${maxSafeInteger}`,
    ),
    check(
      "dine_in_orders_total_millimes_check",
      sql`${table.totalMillimes} >= 0 AND ${table.totalMillimes} <= ${maxSafeInteger}`,
    ),
    check(
      "dine_in_orders_total_equals_subtotal_check",
      sql`${table.totalMillimes} = ${table.subtotalMillimes}`,
    ),
    check(
      "dine_in_orders_tracking_recovery_envelope_check",
      sql`(${table.trackingRecoveryVersion} IS NULL AND ${table.trackingRecoveryNonce} IS NULL AND ${table.trackingRecoveryCiphertext} IS NULL AND ${table.trackingRecoveryAuthTag} IS NULL) OR (${table.trackingRecoveryVersion} IS NOT NULL AND ${table.trackingRecoveryVersion} = 1 AND ${table.trackingRecoveryNonce} IS NOT NULL AND ${table.trackingRecoveryNonce} ~ '^[A-Za-z0-9+/]{16}$' AND ${table.trackingRecoveryCiphertext} IS NOT NULL AND ${table.trackingRecoveryCiphertext} ~ '^[A-Za-z0-9+/]{57}[AQgw]==$' AND ${table.trackingRecoveryAuthTag} IS NOT NULL AND ${table.trackingRecoveryAuthTag} ~ '^[A-Za-z0-9+/]{21}[AQgw]==$')`,
    ),
  ],
);

export const dineInOrderItems = pgTable(
  "dine_in_order_items",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id")
      .notNull()
      .references(() => dineInOrders.id, { onDelete: "restrict" }),
    lineNumber: integer("line_number").notNull(),
    productIdSnapshot: text("product_id_snapshot"),
    productNameSnapshot: text("product_name_snapshot").notNull(),
    quantity: integer("quantity").notNull(),
    unitPriceMillimes: bigint("unit_price_millimes", { mode: "number" }).notNull(),
    lineSubtotalMillimes: bigint("line_subtotal_millimes", { mode: "number" }).notNull(),
    optionSnapshots: jsonb("option_snapshots")
      .$type<OrderOptionSnapshot[]>()
      .notNull(),
  },
  (table) => [
    uniqueIndex("dine_in_order_items_order_line_unique").on(
      table.orderId,
      table.lineNumber,
    ),
    check("dine_in_order_items_line_number_check", sql`${table.lineNumber} > 0`),
    check("dine_in_order_items_quantity_check", sql`${table.quantity} > 0`),
    check(
      "dine_in_order_items_unit_price_millimes_check",
      sql`${table.unitPriceMillimes} >= 0 AND ${table.unitPriceMillimes} <= ${maxSafeInteger}`,
    ),
    check(
      "dine_in_order_items_line_subtotal_millimes_check",
      sql`${table.lineSubtotalMillimes} >= 0 AND ${table.lineSubtotalMillimes} <= ${maxSafeInteger}`,
    ),
    check(
      "dine_in_order_items_line_total_check",
      sql`${table.lineSubtotalMillimes} = ${table.unitPriceMillimes} * ${table.quantity}`,
    ),
    check(
      "dine_in_order_items_option_snapshots_array_check",
      sql`jsonb_typeof(${table.optionSnapshots}) = 'array'`,
    ),
  ],
);

// Singleton administrator credential. Row id is constrained to exactly 1.
export const adminCredentials = pgTable("admin_credentials", {
  id: integer("id").primaryKey(),
  passwordHash: text("password_hash").notNull(),
  credentialVersion: integer("credential_version").notNull().default(1),
  passwordChangedAt: bigint("password_changed_at", { mode: "number" }),
}, (table) => [
  check("admin_credentials_singleton_check", sql`${table.id} = 1`),
]);

// Records credential changes without storing credentials or password hashes.
export const adminAuditEvents = pgTable("admin_audit_events", {
  id: text("id").primaryKey(),
  action: text("action").notNull(),
  actor: text("actor").notNull(),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

// Authenticated browser sessions.
export const sessions = pgTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  credentialVersion: integer("credential_version").notNull().default(0),
  expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

// Request rate-limit counters.
export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  windowStart: bigint("window_start", { mode: "number" }).notNull(),
  count: integer("count").notNull(),
});

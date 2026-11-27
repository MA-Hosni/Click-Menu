# Database schema

The current schema is defined in db/schema.ts. The checked-in initial migration is drizzle/0000_init.sql; Drizzle metadata is in drizzle/meta/. PostgreSQL is accessed through Drizzle ORM and @neondatabase/serverless. This is the sole migration for a clean first database; it creates the current schema directly.

## Tables

| Table | Stored data |
| --- | --- |
| restaurant_catalogs | Singleton row (`id = 1`), serialized currency-free catalog payload, integer revision, nullable price-reviewed revision and timestamp, update timestamp |
| menu_images | Random image ID primary key, S3 object key, content type, byte length, creation time |
| restaurant_tables | Random internal ID, case-insensitively unique label, unique SHA-256 QR token hash, QR version, latest rotation idempotency hash and encrypted recovery token, active state, created/updated timestamps |
| orders | Legacy source table: order ID, `owner_id` partition, creation time, serialized JSON payload; retained unchanged |
| legacy_orders_archive | Copy of legacy order ID, original storage key as historical provenance, creation time, and exact JSON payload |
| dine_in_orders | New normalized dine-in order header with tracking, idempotency-key, and request hashes, registered table reference and label snapshot, status, integer totals, optional customer name/notes, nullable encrypted tracking-token recovery envelope, and timestamps |
| dine_in_order_items | New normalized item snapshots with product name/ID snapshot, quantity, integer prices at scale 1,000, line number, and immutable JSONB option snapshots |
| admin_credentials | Singleton key constrained to 1, Argon2id password hash, credential version, password changed time |
| admin_audit_events | Event ID, action, actor label, creation time; contains no password or hash |
| sessions | Hashed token primary key, credential version, expiry, creation time. A version mismatch invalidates sessions from an older password. |
| rate_limits | Hashed limit key primary key, window start, request count |

The singleton catalog and legacy orders still use serialized text payloads. `legacy_orders_archive` preserves the legacy payload exactly; its `legacy_storage_key` is inert historical provenance, not identity or authorization. The normalized dine-in order service persists orders through `POST /api/dine-in/orders`; customer checkout, tracking, and staff order management use this normalized workflow, while intake remains controlled by the server-only feature flag. The tables have foreign keys from order items to their order and from orders to registered tables, with deletion restricted so order references remain valid. Menu products/options are not referenced by foreign keys; snapshots preserve history independently of catalog edits.

Catalog edits use compare-and-swap revision updates against the singleton row. A missing row is an explicit uninitialized state; public access returns a blank The Hood catalog and the authenticated admin receives the same blank catalog to set up. No catalog row or demo product is written by that fallback. Legacy currency labels in saved catalog JSON are ignored and omitted from validated API payloads.

Price review is stored on the singleton catalog row. Both review fields are NULL for existing and newly created catalogs until an authenticated administrator explicitly confirms the saved revision. The database requires the reviewed revision to equal the current catalog revision and requires the revision/timestamp fields to be both NULL or both present. Every successful catalog save increments the revision and clears both fields in the same compare-and-swap update. The review operation validates the full catalog, checks the expected revision, and writes an administrator audit event atomically with the review marker. This records an administrator attestation; it does not verify commercial correctness or alter any stored monetary values.

### Normalized dine-in orders

`dine_in_orders` and `dine_in_order_items` are used by the normalized server order API, customer checkout, customer tracking, and staff order-management interface. New order creation is gated on the server flag and persisted review of the exact current catalog revision.

All normalized amounts are PostgreSQL `BIGINT` integers at a fixed scale of 1,000. The frontend supplies display labels; no currency code is stored in catalog payloads, order rows, or order API responses. Item unit price includes selected option adjustments; line subtotal is unit price multiplied by quantity; order subtotal is the sum of line subtotals. For this initial dine-in scope, total equals subtotal because no fees, discounts, or taxes are modeled. The database constrains header totals to be equal and each line subtotal to match its unit price and quantity; the application must still verify that the header subtotal equals the sum of all order items. Application code must reject values outside JavaScript's safe-integer range and must use integer arithmetic.

`idempotency_key_hash` is a unique lowercase SHA-256 digest of the client's idempotency key; the raw key is never persisted. `request_hash` separately identifies canonical business inputs (customer details and normalized product/option selections), excluding the current QR token and mutable catalog state. The service acquires a transaction-scoped advisory lock from the digest, then looks up the order before reading the mutable table or catalog. A matching key/request retry returns the existing receipt and recovers its tracking token; a reused key with different request contents returns HTTP 409; identical contents under different keys create distinct orders. The unique database index remains the final guard if advisory-lock digests collide or a writer bypasses the service lock.

The service lock order is: idempotency advisory lock, singleton catalog row `FOR SHARE`, then active table row `FOR SHARE`. Different orders can hold compatible shared locks together. Catalog saves and review changes issue ordinary `UPDATE`s that acquire conflicting row locks; table activation, label, and QR-token changes do the same. Those mutations wait for active order transactions, while an update committed first is visible to a subsequent locking statement under READ COMMITTED. Do not weaken these reads to `FOR KEY SHARE`: ordinary updates of non-key catalog/table fields need not conflict with that lock mode. The order reads one locked catalog payload/revision/review state and one active token/table-label snapshot. Retries locate an existing order before current-state checks, so later catalog edits, token rotation, or deactivation do not prevent receipt recovery. Header and all item snapshots use the same READ COMMITTED transaction; any failed item insert or verification aborts the transaction. The endpoint responds only after commit resolves. If commit outcome is uncertain, retry through the same idempotency protocol.

Option snapshots remain JSONB. The order domain validates each selected option against the saved catalog, checks its price adjustment within safe integer arithmetic, and calculates all prices and totals itself; client-supplied option prices are untrusted. Negative adjustments remain governed by the catalog's own validation rules.

For deterministic all-orders keyset pagination, sort by `created_at DESC, id DESC` and use both fields as the cursor: `WHERE (created_at, id) < ($1::bigint, $2::text)`, binding the prior row's `created_at` and `id` in that order. The `(created_at, id)` index supports this ordering, including multiple orders created at the same timestamp.

Order status values are `pending`, `confirmed`, `preparing`, `completed`, `rejected`, and `cancelled`. The documented transitions are pending → confirmed/rejected/cancelled, confirmed → preparing/cancelled, and preparing → completed/cancelled. Completed, rejected, and cancelled are terminal. The initial schema constrains the allowed status values; transition enforcement belongs to the domain/API implementation. Order items restrict deletion of their parent order; the service must prohibit hard deletion. Cancellation and rejection are the supported alternatives.

Catalog item and option prices are integer amounts at scale 1,000. The authenticated price-review workflow validates the catalog and records an administrator attestation for the exact saved revision. It does not certify commercial correctness. Every catalog save clears that review. `POST /api/dine-in/orders` requires a persisted review matching the exact current catalog revision and validates it while holding the catalog row lock. The initial schema uses currency-neutral review metadata and has no currency column; historical legacy order JSON remains preserved and only a read-only, fulfillment-neutral projection is exposed in admin history.

### Temporary legacy `owner_id` dependencies

Only orders retain a temporary legacy storage partition. The sole runtime value comes from the server-only `LEGACY_RESTAURANT_STORAGE_KEY` in `lib/legacy-restaurant-key.ts`; it does not determine identity or authorization.

- `db/schema.ts`: only `orders.ownerId` maps to `orders.owner_id`.
- `lib/order-store.ts`: `listOrders(ownerId, ...)` reads historical legacy records for the administrator history view; it has no write or status-update operation.
- `app/api/admin/orders/route.ts` GET requires administrator authorization and returns a fulfillment-neutral projection. The legacy PATCH route has been removed.
- `app/api/orders/route.ts` POST returns 410 and performs no catalog or storage operation.
- The current initial schema retains only the legacy order `owner_id` partition used by the read-only history store; old account, catalog-owner, and image-owner schema is not part of the fresh database.

Only the retained legacy order history uses the temporary `owner_id` partition. Catalog and image metadata are singleton/global records in the current schema.

## Image object storage

`menu_images` stores only a random image ID, private bucket object key, MIME type, byte length, and creation time. Image bytes are stored in the private Neon S3-compatible bucket `uploads` in `eu-central-1`. The public `/api/images/[id]` route looks up metadata and retrieves bytes server-side; credentials never reach the browser.

For an older database that still contains base64 images, the legacy transfer utility remains available to verify and copy those bytes to object storage without deleting source data. The consolidated initial migration is for a clean database and creates only the current metadata schema; it does not run legacy account conversion, image transfer, or order archival data-copy procedures.

The initial migration creates and seeds the singleton image-capacity counter with zero. Its database constraint caps image count at 300.

`restaurant_tables` stores each physical table. Admin APIs return internal IDs only to authenticated administrators. Public URLs contain a cryptographically random 32-byte token; only its SHA-256 hash is stored. Deactivation makes the token resolve as not found; reactivation restores it unless it has been rotated.

QR versions and recovery fields are part of the initial schema. The raw token is encrypted with AES-256-GCM using the server-only `TABLE_QR_RECOVERY_KEY`; it is never stored in plaintext. Keep this canonical Base64 encoding of 32 random bytes stable across every deployment instance. Losing it makes stored recovery ciphertext unusable. To replace it, retain the old key and decrypt/re-encrypt each current recovery value, verify it, then remove the old key. The schema has no key-version field, so perform this as a controlled maintenance operation while both keys are available. If recovery state is no longer needed, it can be cleared only after ensuring administrators have saved their current QR codes.

The initial schema creates both retained legacy order tables and the normalized dine-in order tables. A fresh database has no historical rows to copy. The normalized schema includes a unique idempotency-key hash, a stable `(created_at, id)` pagination index, and restricted deletion of an order that has items.

Nullable tracking-token recovery envelope fields are part of the initial `dine_in_orders` schema: format version, Base64 nonce, ciphertext, and authentication tag. New envelopes use AES-256-GCM and bind the order ID and idempotency-key hash as authenticated additional data. The raw tracking token and raw idempotency key are not stored. `ORDER_TRACKING_RECOVERY_KEY` is a stable server-only secret; its configuration and loss/rotation implications are described in the deployment runbook.

## Database clients

- `DATABASE_DRIVER` selects the server-side adapter. If unset, the application keeps its existing Neon behavior. `neon` uses the Neon HTTP client from `DATABASE_URL_POOLED` for ordinary queries and the Neon WebSocket pool for transactions. `postgres` uses process-scoped `pg.Pool` instances and `drizzle-orm/node-postgres` with `DATABASE_URL`; `DATABASE_URL_POOLED` is rejected in this mode to avoid an ambiguous target. Driver selection is server-only and never falls back after initialization or connection errors.
- `drizzle.config.ts` uses `DATABASE_URL` for Drizzle Kit commands in either mode. The migration files use PostgreSQL SQL and do not depend on Neon-specific database features.
- `db/transaction.ts` uses the shared guarded transaction runner with a driver-specific Drizzle handle. Both drivers use explicit `BEGIN ISOLATION LEVEL READ COMMITTED`, commit/rollback, and client release/discard behavior. The callback-scoped handle rejects later queries and nested transaction access. Local PostgreSQL and Neon use the same order persistence statements and lock clauses.
- Neon’s transaction pool remains process-local, has at most two clients per process, retires idle connections after five seconds and limits client lifetime to five minutes. Multiple Vercel function instances can multiply total connections. Local PostgreSQL uses a separate process-scoped bounded `pg.Pool`; the ordinary-query and transaction pools are separate. The current Next.js configuration uses the default Node runtime and does not support an explicit `runtime` route export while Cache Components is enabled.
- The Neon WebSocket Pool and hosted Vercel behavior remain unverified without a controlled preview. Local PostgreSQL adapter tests do not prove Neon connectivity. The legacy image transfer utility remains Neon-specific.
- `withDatabaseTransaction(callback)` explicitly issues `BEGIN ISOLATION LEVEL READ COMMITTED`, then `COMMIT` on callback success or `ROLLBACK` on failure. Drizzle receives a guarded client whose query operation rejects after the callback completes, so retained handles cannot issue later database work. The transaction handle itself must not be retained or returned; a direct return is rejected at runtime. Do not expose the checked-out client or use nested transactions.
- Transaction failures propagate to the server caller; any future route or service must map them to safe client-facing errors and must not return raw Drizzle/driver errors, SQL, parameters, or connection details.
- The transaction adapter explicitly requests PostgreSQL `READ COMMITTED`. Under this isolation, each statement gets a fresh snapshot. The order service acquires a transaction-scoped advisory lock derived from the SHA-256 idempotency digest, then looks up the order in a subsequent statement; after waiting, the lookup sees the competing transaction's committed order. Advisory lock hash collisions can only serialize distinct keys unnecessarily; the unique idempotency digest index remains the correctness boundary. Do not change isolation to `REPEATABLE READ` or `SERIALIZABLE` without redesigning this contract.
- Continue using HTTP through `db/index.ts` / `getDb()` for ordinary independent reads and writes; it remains unchanged. Interactive multi-statement workflows must use the WebSocket adapter. Existing stores continue using the ordinary HTTP client unless an operation specifically requires a transaction.
- Local PostgreSQL transaction tests validate commit/rollback, visibility, advisory-lock serialization, and `READ COMMITTED` semantics. They do not establish that the Neon WebSocket driver connects to a deployed Neon endpoint or that Vercel preserves the required runtime behavior.
- The order service reads persisted catalog review revision and timestamp from the locked database row inside its transaction. `TrustedCatalogReadiness` remains only an internal domain marker, not database authorization; never construct it from request input. The local order integration suite executes the shared production TypeScript service and Drizzle persistence statements through the generic transaction runner and a node-postgres client against disposable PostgreSQL 17. The Neon-specific WebSocket Pool and hosted Vercel behavior remain unverified and require Preview verification.

## Migrations

`drizzle/0000_init.sql` is generated from the current `db/schema.ts` and creates all current tables, columns, constraints, and indexes for a clean database. It initializes the image-capacity singleton at zero. It deliberately omits data migration steps for legacy users, account credentials, old image payloads, and legacy-order archival because fresh databases do not contain those rows. The retained legacy order tables remain available for application history compatibility.

After an intentional schema change, update db/schema.ts, generate and review SQL with:

    npm run db:generate

Apply checked-in migrations using:

    npm run db:migrate

Drizzle Studio is available with:

    npm run db:studio

These commands use DATABASE_URL. Do not run migrations as part of routine application startup. Back up the target database and review generated SQL before applying a production migration.

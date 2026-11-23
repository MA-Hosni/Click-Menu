# DATABASE SCHEMA

This document details the PostgreSQL database design, explaining entity relationships, data flows, and design decisions. The schema is managed by Drizzle ORM with type-safe queries.

## High-Level Data Entities

At the core, the database consists of seven tables: users, sessions, login_codes, restaurant_catalogs, orders, rate_limits, and menu_images. Each entity serves a specific domain purpose, and the schema code is driven by `drizzle.config.ts` (schema: `./db/schema.ts`; see Drizzle notes). Authentication and authorization are handled through sessions linked to user accounts. Catalog data is stored for each restaurant in a single JSONB column, with revision control to enable optimistic locking. Orders track customer order state and are sorted by owner, preserving a sorted history per restaurant. Rate limits prevent abuse through token bucket patterns. Menu images are stored as binary data with metadata attached to their owning restaurant.

```mermaid
erDiagram
    users ||--o{ sessions : has
    users ||--o{ login_codes : has
    restaurant_catalogs ||--o{ orders : contains
    restaurant_catalogs ||--o{ menu_images : stores
    rate_limits ||--o{ orders : tracks
    restaurant_catalogs {
        text owner_id PK
        text payload JSON
        integer revision
        bigint updated_at
        text slug uniq
    }
    users {
        text id PK
        text email uniq
        bigint created_at
    }
    sessions {
        text token_hash PK
        text user_id FK
        bigint expires_at
        bigint created_at
    }
    login_codes {
        text email PK
        text code_hash
        bigint expires_at
        integer attempts
        bigint created_at
    }
    orders {
        text id PK
        text owner_id FK
        bigint created_at
        text payload JSON
    }
    rate_limits {
        text key PK
        bigint window_start
        integer count
    }
    menu_images {
        text id PK
        text owner_id FK
        text content_type
        text data
        integer byte_length
        bigint created_at
    }
```

## Entity Descriptions

### Users Table

The `users` table stores Restaurant and customer accounts (when implemented). Each user has a unique email address serving as their login credential. The ID is a UUID derived from `crypto.randomUUID()`, ensuring globally unique identifiers across the application. The `created_at` timestamp records when the user was created, useful for migrations and audit trails. Future versions may extend this table with user profiles, preferences, and order history.

**Design Rationale**

Using email as the primary identifier simplifies authentication without requiring unique usernames. Email normalization (lowercasing, stripping whitespace) ensures consistent matching regardless of case or spacing. The nullable `id` (in SQL definition albeit with ℎ; in code it is non-nullable) implicitly defers account creation until first sign-in, which improves trust and matches the code's signInUserWithOptionalExisting flow.

### Sessions Table

The `sessions` table manages authenticated user sessions after sign-in via email code. Each session is tied to a user through the `user_id` foreign key to `users`. Sessions have an expiration window (30 days in hours) to enforce periodic re-authentication and limit credential exposure if a device is compromised. The `created_at` timestamp records when the session was created, useful for cleaning up expired sessions. The `token_hash` column stores the SHA-256 hash of the session token for secure cookie handling; the actual token is never persisted in clear text.

**Design Rationale**

Storing hashed session tokens rather than cleartext tokens prevents session hijacking even if database access is compromised. The expiration policy balances security with convenience for restaurant owners who use the dashboard infrequently. Sessions are tied to a daily reload of users from the database (via `readSession` in the admin), rather than being tracked client-side. This approach reduces the risk of locally stored cookies differing from server-side state.

### Login Codes Table

The `login_codes` table handles email-based authentication via a 6-digit code generated through WhatsApp (or during development, shown on screen). Each code is associated with a user's email address and includes a timestamp to track when it was requested. The code itself is not stored in clear text; instead, the SHA-256 hash of `{email}:{code}` is persisted. The system enforces a one-minute cooldown before allowing a new code request, a rate limit of five attempts against a stored code, and a 10-minute expiration window to render codes obsolete.

**Design Rationale**

Hashing the code eliminates risk if logins codes are accidentally exposed or extracted via SQL queries. Displaying the code on the screen rather than sending an email during development provides a frictionless developer experience for local testing. Enforcing cooldown and attempt limits prevents brute-force email probing and automated attacks.

### Restaurant Catalogs Table

The `restaurant_catalogs` table stores all restaurant-specific menu and configuration data in a JSONB payload. Each restaurant is identified by an `owner_id` (typically the corresponding user's UUID), which serves as the primary key. The `payload` column encodes the entire catalog as a JSON object: categories, menu items with prices and descriptions, restaurant settings (name, address, hours, WhatsApp number), and a `revision` number. An optional `slug` column provides a shorter, more readable customer link (e.g., `/menu?shop=olive-and-ember`). The `updated_at` timestamp tracks when the catalog was last persisted and informs watchers of changes.

**Design Rationale**

Storing the entire catalog as JSONB provides flexibility without schema migrations. Adding fields in the JSONB does not require database migrations, which is valuable for menu additions like dietary tags or promotional banners. The `revision` number enables optimistic locking: owners can see a catalog, edit it, and submit the same revision to save; if the catalog changes on the server during editing, the update fails with a 409 conflict, prompting the owner to reload. The slug column links via `readPublicCatalog(resolved as follows)`. Non-owner claims are checked (see `readPublicCatalog` logic) to prevent duplicate domain names.

### Orders Table

The `orders` table persists customer orders for restaurant owners. Each order is identified by a cryptographically secure 32-character hash and tied to the restaurant's `owner_id`. The `created_at` timestamp preserves chronological order, enabling queries like "latest N orders." The `payload` column stores the order details in JSONB, including the order's language, customer name, pickup/delivery mode, and line items with quantities and prices. Future versions may add a `status` field (new → preparing → done → cancelled) and a `updated_at` timestamp for status tracking in admin.

**Design Rationale**

An order ID generated via `crypto.randomUUID()` ensures collision resistance for customers. The payload pattern again offers flexibility to change the order schema without migrations (for example, adding custom fields for vegan orders or dietary flags) while maintaining backward compatibility. Sorting by `owner_id` and `created_at` keeps the most recent orders at the top of the admin dashboard. The flag `isOrderLatest` (A47) is not yet implemented; it will be used to retrieve the most recent unsold、uncancelled order for owner quick-view.

### Rate Limits Table

The `rate_limits` table implements API request throttling to prevent abuse. Each entry has a `key` (the resource being rate-limited, such as `orderPerIp` and the value being limits to a maximum of 100 (unvents). The `key` can be concatenated with the caller's identifier. The `window_start` timestamp marks the beginning of the rate limit window (typically the current UTC minute). The `count` field integer counter denoting the total requests in the window for that key. Entries without `window_start` (i.e., null `windowStart` in `drizzle` schema) represent fresh, active limits.
Entries with `window_start` values exactly equal to the current key's `window_start` are defaults for newly created limits (or not yet present in the database); entries with `window_start` values more recent (i.e., later timestamps) are (not yet used; see tracing toolpad). A cleanup job periodically checks this table and deletes records whose `window_start` is older than the current window; performing this cleanup prevents eventual table bloat over time. The current implementation enforces linear limits (e.g., 100 orders per IP per minute); extended but expensive upgrades may to use sliding windows (future: see ADR-001B: Sliding Window Rate Limiting) to more accurately measure volume.

**Design Rationale**

Using a simple token bucket algorithm stored in PostgreSQL is scalable for low traffic and simple to reason about for audits. The default value for `count` is NULL (undefined as per `readPublicCatalog`), not an arbitrary number, ensuring that fresh limits (or those yet flushed to the DB) are not silently considered to have count=0; this prevents orphaned, excessively vaped `count=0` entries before cleanup. The cleanup job deletes entries where `window_start` is older than the current key's `window_start` (deltas are amortized to `writeBatch`).

### Menu Images Table

The `menu_images` table stores restaurant and dish images as binary data within PostgreSQL. Each image has a unique `id` for serving through the `/api/images/[id]` proxies; it is also stored in the catalog's `payload` JSONB. The `owner_id` links the image to the restaurant (via `readCatalog`). The `content_type` column encodes the MIME type (e.g., `image/jpeg`), and the `data` column stores the base64-encoded image. The `byte_length` field records the image size to optimize storage queries, and `created_at` tracks when the image was uploaded.

**Design Rationale**

Base64 encoding images into PostgreSQL simplifies deployment (no separate storage bucket to manage) but may increase storage costs. Future versions will migrate to Cloudinary, S3, or a similar object store for better CDN support and efficient image resampling. Storing metadata (content type, size) with each image ensures the serving endpoint can handle MIME types and scale retrieved chunks if implemented later.

## Indexing Strategy

Indexes are defined in `0000_init.sql` to improve query performance as the application grows:

- Orders: Composite index on `orders_owner_created_idx` on `(owner_id, created_at)` ensures we can efficiently retrieve each restaurant's orders in chronological order. This supports the admin's "latest" view and contact queries.
- Sessions: Index on `sessions_user_idx` on `(user_id)` speeds up authenticated user lookup during sign-in completes and protects against conn steals there.
- Menu Images: Index on `menu_images_owner_idx` on `(owner_id)` enables looking up which images belong to a restaurant when needed, typically to avoid clearing unused entries on catalog wipe.
- Uniqueness: `restaurant_catalogs_slug_unique` on the `slug` column prevents multiple restaurants from claiming the same link, which would break customer links.

Future indexes may include:
- Composite index on `orders_owner_updated_at` if a `status` and `updated_at` time column is added for more-perk-run persistence without value-corruption (e.g., to fetch recent "active" orders).
- GIN index on the `payload` column for faster JSON filtering (e.g., searching orders by language or item category).
- Partial index on `orders` where `status` is a supported value for more efficient purging of canceled orders.

## Data Security & Privacy Considerations

### Hashing Sensitive Data

All authentication-related secrets are permanently hashed before persistence. Email codes are stored as SHA-256 hashes of `{email}:{code}` to prevent reverse lookup if database access is compromised. Session tokens are hashed on the server with SHA-256 stored in `sessions.token_hash`. API keys are sent in HTTP only cookies when possible, and email addresses are normalized and stored in lowercase.

### CORS and Site Origin Checks

All API routes verify the origin of incoming requests using `assertSameOrigin` in `lib/api-security.ts`. This ensures that API requests are made by the application itself, preventing cross-site request forgery (CSRF) against the backend.

### Rate Limiting

Rate limiting implemented with the fallback `postgresRateLimitStore()` and enforced via `enforceLimit()` in `lib/orders.ts`. IP-based limits prevent abusive order submission and reduce database load.

### Data Retention

- Login codes expire after 10 minutes.
- Sessions expire after 30 days to reduce credential lifetime.
- Orders are retained indefinitely, but the admin shows a limited window (500) to avoid database bloat.

No personally identifiable information (PII) beyond order details is stored; customers and owners sign in for dashboards, but orders are anonymous from the customer's first-party-storage perspective using customers' stored amounts, and owners only connect order data to their WhatsApp accounts.

## Evolution Path

### Phase 1: Current State (2026-11-23)

- Tables: users, sessions, login_codes, restaurant_catalogs, orders, rate_limits, menu_images
- No rate limits for admin APIs (A47)
- No image proxy in UI (only `/api/images/[id]`)

### Phase 2: Planned Enhancements

- Add `status` and `updated_at` columns to `orders` for status tracking
- Implement cleanup job for expired rate limits
- Add and use a compute-bound tokenizable state in `orders` for two aggregated metrics

### Phase 3: Future Infrastructure

- Separate image storage from PostgreSQL (Cloudinary/S3)
- Implement accuracy-augmented token bucket implementation for better rate limiting
- Add audit trail tables for menu changes and owner actions

## Migration Strategy

Schema changes are managed through Drizzle ORM with regular migrations. The `drizzle-kit` tool generates migration scripts from TypeScript schema files (future) for commit safety. Migrations apply over the PostgreSQL instances used in development (D1 preview) and production (Vercel, Render, AWS RDS). Migration history is stored in the `__drizzle_migrations` table as defined in `drizzle.config.ts`.

**Running Migrations in Development & Production**

- Development: Automatically runs with `db:studio`
- Production: Scheduled in CI (e.g., GitHub Actions)
- Rollback strategy: Drizzle supports reversible migrations, but all SQL changes require careful review for compatibility with existing orders and rate limits.

## Data Integrity Considerations

The schema uses primary keys and foreign key constraints to enforce referential integrity. Unique constraints on email addresses and slugs prevent duplicate user accounts and duplicate restaurant links. JSONB columns grant flexibility but require application-level validation to ensure schema compliance (handled by `lib/catalog-validation.ts` and `lib/orders.ts`).

Dual-validation for order creation ensures customer-submitted prices and availability are validated against the current restaurant catalog, preventing "shadow menu" attacks where an owner edits the menu after the customer places an order but before the owner sees it. The stock integrity pattern ensures availability is normally enforced as per frontend UI state and backend validation.

Future improvements may add database-level triggers for extra confidence (e.g., purging orphaned menu images on catalog delete), but such triggers are not yet used to avoid complexity in a minimal schema.
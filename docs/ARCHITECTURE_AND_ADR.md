# Architecture and decisions

## Runtime shape

ClickMenu uses Next.js 16 App Router. The root app/ directory owns routes, layouts, metadata, and HTTP handlers. Interactive UI lives under components/. Domain operations and shared state live under features/ and lib/.

    Customer browser
      -> app/page.tsx or app/menu/page.tsx
      -> components/client/
      -> features/storefront/
      -> /api/catalog (legacy order POST returns 410)
      -> lib validation and stores
      -> db/ PostgreSQL (Neon by default; explicit local `pg` mode)

    Owner browser
      -> app/admin/layout.tsx
      -> one features/admin/AdminProvider
      -> components/admin/
      -> /api/me and /api/admin/*
      -> lib authentication, catalog, order, image stores
      -> db/ PostgreSQL (Neon by default; explicit local `pg` mode)

## Dependency direction

- app may compose components and features.
- components may depend on features and shared lib modules.
- features may depend on suitable features and lib, but not app or components.
- lib remains independent of React UI.
- db is server-side infrastructure; never import its client or stores into browser components.

Admin localization/context lives in features/admin/i18n/admin-copy.ts. Customer translations live in features/storefront/i18n/copy.ts.

## State ownership

### Admin catalog

app/admin/layout.tsx mounts AdminProvider once and keeps it mounted across child routes. It owns exactly one catalog draft and one saved snapshot. Menu, categories, and restaurant pages update the same draft. Dirty state is derived from the draft and saved snapshot. Saves validate a submitted snapshot and use the existing API revision check. If edits arrive while a save is pending, the response updates the saved snapshot while retaining the newer draft with the server's returned revision. A 409 remains a conflict requiring explicit reload.

QR reads saved catalog settings. Orders own separate loading, polling, filtering, notification, and status state.

### Customer storefront

features/storefront/useStorefront owns the loaded catalog, language, and cart. Legacy cart data is restaurant-scoped; registered-table cart data uses a SHA-256-derived table scope in localStorage. Dine-in pending attempts use a separate record with the exact retry request, coordinated across tabs with Web Locks. Acknowledgment stores only the completed order reference in the retry record and separately saves the tracking capability under an order-scoped localStorage key. The tracking page accepts the URL fragment first, then a matching order-scoped local copy; local storage is recovery convenience, not authorization. Tracking links contain the capability in the fragment and customers can copy/share the link. The token is not rendered into server HTML. A customer may remove the saved local entry explicitly; terminal status does not remove it. Browser data can be cleared or unavailable, and cross-device recovery requires the private tracking link. Pending retry state uses conditional cleanup, tombstones, and IndexedDB fallback to prevent uncertain writes from being mistaken for an empty state. Server-side idempotency is the final duplicate safeguard. If required storage or Web Locks cannot be used, dine-in submission fails closed. There is no global storefront provider; RestaurantPage composes the hooks.

The legacy WhatsApp checkout was removed. The normalized dine-in browser harness remains gated to a development loopback test route and uses a mocked transport; it does not exercise persistence. Intake remains disabled by default.

## Data and security boundaries

- GET /api/catalog reads The Hood's singleton catalog from PostgreSQL. Legacy `shop` query parameters are ignored; a missing catalog row yields a blank currency-free catalog rather than demo data.
- POST /api/orders is retired and always returns 410 without reading or writing order data. GET /api/admin/orders exposes only an authenticated, read-only projection of retained historical records.
- Admin handlers validate the singleton administrator from the hashed session cookie, not request payloads.
- The singleton administrator password uses an Argon2id hash initialized/reset by an interactive server-side CLI. Hashed session tokens and credential versions are stored in PostgreSQL. Session cookies are HttpOnly and SameSite=Lax; HTTPS requests also receive Secure.
- `owner_id` remains temporarily only as a server-side legacy partition key in the order store. It is not identity or authorization and is scheduled for removal with the later order persistence phase.
- Mutation requests use same-origin validation.
- Menu photo bytes live in private S3-compatible object storage; PostgreSQL stores image IDs and metadata. The server image route retrieves object bytes without exposing storage credentials.
- The /menu metadata lookup is request-time because it uses searchParams and a database lookup. Failure does not prevent the menu route itself from rendering.

## Decisions

### App Router and feature-oriented modules

Route files remain small and compose feature presentation. Shared admin state lives at the nested layout so navigation does not reset catalog drafts. Customer state remains scoped to the storefront composition because its consumers are already in that hierarchy.

### Optimistic catalog revisions

The database revision is the concurrency boundary between browser drafts. The client does not overwrite a newer in-flight draft with a completed save response. The server still rejects stale database revisions with HTTP 409.

### Minimal test tooling

Tests use Node's built-in test runner and the TypeScript compiler already installed by the project. This avoids another test dependency and exercises current TypeScript source through a small test-only loader. Authentication tests use in-memory stores and do not connect to Neon.

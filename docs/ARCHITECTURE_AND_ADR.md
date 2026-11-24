# Architecture and decisions

## Runtime shape

ClickMenu uses Next.js 16 App Router. The root app/ directory owns routes, layouts, metadata, and HTTP handlers. Interactive UI lives under components/. Domain operations and shared state live under features/ and lib/.

    Customer browser
      -> app/page.tsx or app/menu/page.tsx
      -> components/client/
      -> features/storefront/
      -> /api/catalog and /api/orders
      -> lib validation and stores
      -> db/ Neon PostgreSQL

    Owner browser
      -> app/admin/layout.tsx
      -> one features/admin/AdminProvider
      -> components/admin/
      -> /api/me and /api/admin/*
      -> lib authentication, catalog, order, image stores
      -> db/ Neon PostgreSQL

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

features/storefront/useStorefront owns the loaded catalog, language, and cart. Cart data is keyed by restaurant in localStorage and sanitized against the current published menu. Cart totals are derived by lib/cart.ts. useCheckout owns checkout state, validation, WhatsApp message preview, and order submission. There is no global storefront provider; RestaurantPage composes the hooks.

## Data and security boundaries

- GET /api/catalog returns a demo seed catalog when shop is omitted. With shop, it reads the published catalog from PostgreSQL.
- POST /api/orders accepts item, option, and quantity identifiers; lib/orders.ts validates availability and recomputes amounts against the stored catalog. Client prices and totals are not trusted.
- Admin handlers identify the owner from the session cookie, not request payloads.
- Passwordless email codes and hashed session tokens use PostgreSQL stores. Session cookies are HttpOnly and SameSite=Lax; HTTPS requests also receive Secure.
- Mutation requests use same-origin validation.
- Menu photos are stored in PostgreSQL and served through a read-only image route.
- The /menu metadata lookup is request-time because it uses searchParams and a database lookup. Failure does not prevent the menu route itself from rendering.

## Decisions

### App Router and feature-oriented modules

Route files remain small and compose feature presentation. Shared admin state lives at the nested layout so navigation does not reset catalog drafts. Customer state remains scoped to the storefront composition because its consumers are already in that hierarchy.

### Optimistic catalog revisions

The database revision is the concurrency boundary between browser drafts. The client does not overwrite a newer in-flight draft with a completed save response. The server still rejects stale database revisions with HTTP 409.

### Minimal test tooling

Tests use Node's built-in test runner and the TypeScript compiler already installed by the project. This avoids another test dependency and exercises current TypeScript source through a small test-only loader. Authentication tests use in-memory stores and do not connect to Neon.

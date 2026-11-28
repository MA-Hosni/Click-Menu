<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `dist/docs/` before writing any code. Heed deprecation notices.

<!-- END:nextjs-agent-rules -->

# ClickMenu architecture and contributor guidelines

## Project objective

ClickMenu is an existing Next.js restaurant menu and ordering application. Refactors should make the code easier to understand and maintain while preserving its behavior. Prefer clear responsibilities, feature-oriented folders, explicit dependency boundaries, predictable imports, and small verifiable changes.

## Understand before changing

Before substantial work, inspect the implementation and its dependencies. Trace state ownership, API contracts, database access, and business rules. Verify documentation against current source. Do not perform mechanical file splitting or introduce abstractions without a concrete reason.

Preserve all existing user changes; never reset, discard, overwrite, or stash them. Treat the current source as authoritative when it differs from documentation.

## Preserve behavior

Unless specifically requested, preserve user-visible design, routes, API contracts, authentication/session security, database schema, catalog validation and revision conflicts, server-side order price validation, language switching, Arabic RTL, and error behavior.

## Next.js App Router conventions

- page.tsx defines a route; layout.tsx defines shared UI for a segment and descendants.
- loading.tsx, error.tsx, and other special files must follow the installed Next.js conventions.
- A file named pages.tsx is not an App Router route entry point.
- Keep route files small; they should compose feature components.
- Use nested layouts for persistent UI.
- Prefer Server Components; add use client only for browser APIs, state, effects, handlers, or client interaction.
- Do not make a whole route tree client-side just because one child needs interaction.
- Read the relevant installed Next.js guide before using unfamiliar or changed APIs.

## Actual organization

### app/

Owns routes, layouts, metadata, and API handlers. Customer routes are /, /menu, /t/[token], and /track/[orderId]. Only /t/[token] establishes registered table context; /menu query parameters do not. Admin routes are /admin/login, /admin/menu, /admin/categories, /admin/orders, /admin/restaurant, and /admin/tables. /admin/qr redirects to /admin/tables; /admin redirects to /admin/menu.

app/browser-test/ holds the development-only checkout harness and is never mounted in production deployments.

The nested app/admin/layout.tsx mounts the shared AdminProvider and persistent layout once. API handlers stay under app/api/ and should delegate reusable domain work to suitable modules.

### components/admin/

Contains admin presentation grouped under layout/, auth/, menu/, categories/, orders/, restaurant/, tables/, and qr/. Shared layout belongs in layout/. Do not place domain state or database operations in feature UI.

### components/client/

Contains storefront presentation grouped under restaurant/, menu/, cart/, ordering/, and shared/.

### components/ui/

Contains generic UI primitives, not ClickMenu-specific business components. This project compiles plain CSS only: Tailwind is installed but no utility is ever generated, so a component must not rely on a utility class. Give a primitive its own class names and define them in app/globals.css.

### features/

features/admin/ owns AdminProvider, shared catalog lifecycle, save reconciliation, the admin orders board state, and admin translations/context in features/admin/i18n/.

features/orders/ owns the normalized dine-in order domain: request canonicalization, price derivation, persistence, list/detail/status queries, the dashboard summary, customer tracking, and tracking-token recovery.

features/storefront/ owns catalog/cart and checkout hooks plus customer translations in features/storefront/i18n/.

Feature modules may depend on appropriate features, lib modules, and the shared db/schema constants. They must not import from app/ or components/.

### lib/, db/, and drizzle/

lib/ contains shared domain utilities, validation, server-side data access, and types; do not import React UI into lib/.

db/ contains the Drizzle schema, the Neon client, the local node-postgres driver path, the connection pool, and the transaction helpers. Keep the database client and stores server-only.

drizzle/ contains committed SQL migrations and metadata. Do not change the schema or migration files for a UI-only refactor.

### hooks/

Contains generic shared React hooks. Feature-specific hooks belong under features/.

## Critical domain constraints

### Shared admin catalog

Menu, categories, and restaurant settings edit one catalog draft owned by AdminProvider. Preserve the saved snapshot, dirty state, validation, revision-based optimistic concurrency, 409 conflict detection, and explicit reload behavior. Saves must preserve edits made while a request is in flight. QR reads saved settings, not unsaved draft settings.

### Orders and authentication

Orders own independent loading, filtering, polling, notification, and status state. The admin orders board and the past-order archive read the normalized order history; the preserved legacy history is a separate read path over a separate store, and the two are never merged into one list. Preserve password-only singleton administrator authentication, secure hashed session cookies, credential-version invalidation, and administrator checks in every protected API. Never expose secrets or trust client identity.

The restaurant is The Hood; there are no owner IDs in authentication. The catalog uses one fixed singleton row and menu image bytes use private S3-compatible object storage, with metadata in PostgreSQL. A temporary server-only key in `lib/legacy-restaurant-key.ts` remains only for the legacy order store. Do not use it as identity or expose it to clients. Remove the remaining order `owner_id` column and store parameter in the order persistence phase.

An order that is already being prepared cannot be cancelled: the kitchen has started on it. Keep the server transition table and the administrator client in agreement.

### Customer ordering

The server validates order details and derives prices, totals, and availability from the published catalog. Never trust client-provided prices or totals. The short order reference shown to the customer, in the customer order list, and in the admin order drawer must stay the same value.

### Localization

Preserve English, French, and Arabic. Arabic must retain correct RTL behavior. Keep dictionaries in their owning feature i18n directory. Every customer-facing string needs a French and an Arabic translation; an English-only key that falls back through the shared dictionary is a defect, not a shortcut.

## Code quality

- Give components one clear responsibility and typed props.
- Keep business rules outside visual components where practical.
- Avoid duplicate state owners, circular dependencies, unnecessary prop drilling, and barrel files without a clear benefit.
- Keep imports predictable and avoid dependencies that point from features to presentation or routes.
- Remove obsolete files only after checking references.
- Do not add a library unless it has a justified requirement.
- Do not weaken authentication, authorization, session security, or server-side validation.
- Treat database schema and migration changes as high risk: inspect generated SQL, test against an isolated development database, and review before applying to production.

## Verification

After meaningful changes, run npm run lint, npm test, npx tsc --noEmit, npm run build, and git diff --check. Run relevant tests and verify affected workflows where the environment permits. Never claim a check passed unless it was executed. Report infrastructure or runtime checks that could not be performed.

## Contributor guide

- New URL: app/<segment>/page.tsx.
- Admin UI: components/admin/<feature>/.
- Customer UI: components/client/<feature>/.
- Generic primitive: components/ui/.
- Feature state, operations, and translations: features/<feature>/.
- Shared utilities and domain types: lib/.
- Database schema/client: db/; migrations: drizzle/.
- Tests: tests/<domain>/.

Use the actual source as the authority and update the relevant docs when ownership, routes, API behavior, or tests change.

Before opening a pull request, run the checks listed above and report any that could not be completed.

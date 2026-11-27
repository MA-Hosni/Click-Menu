# File explorer

This guide points to current entry points and domain modules. Only App Router special files define routes; ordinary TS/TSX files do not create URLs.

## Customer application

- app/page.tsx composes the restaurant landing page.
- app/menu/page.tsx renders the menu-only view and builds metadata from The Hood's singleton catalog. Its request-time connection boundary remains under Suspense for Next.js Cache Components.
- app/t/[token]/page.tsx resolves an active table and reads the singleton catalog server-side, then renders its menu and registered-table dine-in checkout.
- components/client/restaurant/RestaurantPage.tsx composes the restaurant and menu for public browsing, with cart and dine-in checkout available only in registered-table context.
- components/client/menu/MenuSection.tsx owns local search, category selection, vegetarian filtering, and item-details selection.
- components/client/ordering/DineInCheckout.tsx renders the registered-table dine-in checkout.
- features/storefront/useStorefront.ts owns catalog loading, language, local-storage cart, and cart operations.
- features/storefront/i18n/copy.ts contains customer interface translations.

## Admin application

- app/admin/layout.tsx mounts AdminProvider once and composes the persistent shell.
- app/admin/page.tsx redirects to /admin/menu. Nested page files compose focused components from components/admin/.
- app/admin/qr/page.tsx redirects the retired manual QR generator to /admin/tables.
- components/admin/layout/ owns shared shell, navigation, header, and route-level save/status UI.
- components/admin/menu/, categories/, restaurant/, orders/, and tables/ own their respective presentation. The components/admin/qr/QrPage.tsx file exists only as a redirect shim; manual QR generation was removed.
- components/admin/tables/TablesPage.tsx lists and manages tables and displays, downloads, and prints generated QR codes.
- components/admin/auth/ contains the administrator password sign-in UI and account controls.
- features/admin/AdminProvider.tsx owns the authenticated user, single catalog draft, saved snapshot, dirty state, loading/saving, validation, conflicts, localization context, and save reconciliation.
- features/admin/reconcileCatalogSave.ts is the pure reconciliation rule.
- features/admin/i18n/admin-copy.ts contains admin dictionaries, context, localization helpers, and error mapping.

## HTTP and persistence

- app/api/ contains route handlers. Public customer handlers include catalog and orders; protected administrator handlers live under admin.
- lib/cart.ts contains cart calculations and checkout/order-message rules.
- lib/orders.ts validates customer submissions against the saved menu and computes trusted prices.
- lib/catalog-validation.ts validates currency-free singleton catalog payloads and integer prices.
- lib/catalog-store.ts performs catalog reads and revision-checked writes.
- lib/order-store.ts persists order records.
- features/admin/auth/ contains password verification. `scripts/admin-password.mjs` initializes or resets the singleton credential from a hidden terminal prompt. lib/auth.ts owns hashed session-cookie utilities; lib/auth-store.ts and lib/rate-limit-store.ts adapt authentication and rate limits to PostgreSQL.
- `lib/legacy-restaurant-key.ts` contains the server-only temporary partition key used only by the legacy order store; remove it in the order persistence phase.
- lib/image-store.ts stores menu image metadata in PostgreSQL and bytes in private S3-compatible storage; app/api/images/[id]/route.ts retrieves and serves image bytes.
- lib/table-operations.ts validates and hashes public table tokens; lib/table-store.ts resolves only active tables and persists table records. Admin table APIs require the existing administrator session. Rotation recovery encrypts the most recent token using the server-only TABLE_QR_RECOVERY_KEY.
- `scripts/migrate-menu-images-to-s3.mjs` verifies legacy base64 images and deterministic private S3 objects for an older database; the clean initial schema does not migrate legacy image bytes.
- db/schema.ts defines tables; drizzle/0000_init.sql is the generated schema for a clean database, with Drizzle metadata in drizzle/meta/.

## Shared styling and utilities

- app/globals.css contains storefront styles.
- app/admin/admin.css contains admin styles.
- components/ui/ contains generic primitives.
- lib/text.ts selects localized strings; lib/utils.ts contains shared utilities.
- hooks/ contains generic hooks, including viewport detection.

When changing routes or contracts, update API_REFERENCE.md and relevant tests. Update PROJECT_STRUCTURE.md when ownership or folders change.

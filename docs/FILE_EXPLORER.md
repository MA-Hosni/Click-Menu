# File explorer

This guide points to current entry points and domain modules. Only App Router special files define routes; ordinary TS/TSX files do not create URLs.

## Customer application

- app/page.tsx composes the restaurant landing page.
- app/menu/page.tsx renders the menu-only view and owns shop-specific generateMetadata(). Its request-time connection boundary remains under Suspense for Next.js Cache Components.
- components/client/restaurant/RestaurantPage.tsx composes restaurant, menu, cart, and checkout UI.
- components/client/menu/MenuSection.tsx owns local search, category selection, vegetarian filtering, and item-details selection.
- components/client/cart/ and components/client/ordering/ render cart and checkout flows.
- features/storefront/useStorefront.ts owns catalog loading, language, local-storage cart, and cart operations.
- features/storefront/useCheckout.ts owns checkout details, validation, message preview, and the customer order request.
- features/storefront/i18n/copy.ts contains customer interface translations.

## Admin application

- app/admin/layout.tsx mounts AdminProvider once and composes the persistent shell.
- app/admin/page.tsx redirects to /admin/menu. Nested page files compose focused components from components/admin/.
- components/admin/layout/ owns shared shell, navigation, header, and route-level save/status UI.
- components/admin/menu/, categories/, restaurant/, orders/, and qr/ own their respective presentation.
- components/admin/auth/ contains the passwordless sign-in UI.
- features/admin/AdminProvider.tsx owns the authenticated user, single catalog draft, saved snapshot, dirty state, loading/saving, validation, conflicts, localization context, and save reconciliation.
- features/admin/reconcileCatalogSave.ts is the pure reconciliation rule.
- features/admin/i18n/admin-copy.ts contains admin dictionaries, context, localization helpers, and error mapping.

## HTTP and persistence

- app/api/ contains route handlers. Public customer handlers include catalog and orders; protected owner handlers live under admin.
- lib/cart.ts contains cart calculations and checkout/order-message rules.
- lib/orders.ts validates customer submissions against the saved menu and computes trusted prices.
- lib/catalog-validation.ts validates catalog payloads and slugs.
- lib/catalog-store.ts performs catalog reads and revision-checked writes.
- lib/order-store.ts persists order records.
- lib/auth.ts contains passwordless authentication rules; lib/auth-store.ts and lib/rate-limit-store.ts adapt those rules to PostgreSQL.
- lib/image-store.ts persists uploaded images; app/api/images/[id]/route.ts serves them.
- db/schema.ts defines tables; drizzle/ contains SQL migrations.

## Shared styling and utilities

- app/globals.css contains storefront styles.
- app/admin/admin.css contains admin styles.
- components/ui/ contains generic primitives.
- lib/text.ts selects localized strings; lib/utils.ts contains shared utilities.
- hooks/ contains generic hooks, including viewport detection.

When changing routes or contracts, update API_REFERENCE.md and relevant tests. Update PROJECT_STRUCTURE.md when ownership or folders change.

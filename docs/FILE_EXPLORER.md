# File explorer

This guide points to current entry points and domain modules. Only App Router special files define routes; ordinary TS/TSX files do not create URLs.

## Customer application

- app/page.tsx composes the restaurant landing page.
- app/menu/page.tsx renders the menu-only view and builds metadata from The Hood's singleton catalog. Its request-time connection boundary remains under Suspense for Next.js Cache Components.
- app/t/[token]/page.tsx resolves an active table and reads the singleton catalog server-side, then renders its menu and registered-table dine-in checkout.
- app/track/[orderId]/page.tsx renders the customer order status page; the tracking capability arrives in the URL fragment.
- components/client/restaurant/RestaurantPage.tsx composes the restaurant and menu for public browsing, with cart and dine-in checkout available only in registered-table context.
- components/client/menu/MenuSection.tsx owns local search, category selection, vegetarian filtering, and item-details selection.
- components/client/ordering/DineInCheckout.tsx renders the registered-table dine-in checkout.
- components/client/ordering/CustomerOrderTracking.tsx renders the customer status view and builds the `/track/<orderId>#<token>` link.
- features/storefront/useStorefront.ts owns catalog loading, language, local-storage cart, and cart operations.
- features/storefront/useDineInCheckout.ts owns the registered-table submission, retry, and acknowledgment flow.
- features/storefront/i18n/copy.ts contains customer interface translations.

## Admin application

- app/admin/layout.tsx mounts AdminProvider once and composes the persistent shell.
- app/admin/page.tsx redirects to /admin/menu. Nested page files compose focused components from components/admin/.
- app/admin/qr/page.tsx redirects the retired manual QR generator to /admin/tables.
- components/admin/layout/ owns shared shell, navigation, header, and route-level save/status UI.
- components/admin/menu/, categories/, restaurant/, and tables/ own their respective presentation. The components/admin/qr/QrPage.tsx file exists only as a redirect shim; manual QR generation was removed.
- components/admin/tables/TablesPage.tsx lists and manages tables and displays, downloads, and prints generated QR codes.
- components/admin/orders/OrdersPage.tsx switches between the live registered-table board and the past-order archive; DineInOrdersPanel.tsx owns the board, its polling, its scope, and the summary; DineInOrdersSummary.tsx renders the figures; DineInOrderTicket.tsx renders one order; DineInOrderDetailDrawer.tsx renders the full order; HistoricalOrders.tsx reads the searchable archive.
- components/admin/auth/ contains the administrator password sign-in UI and account controls.
- features/admin/AdminProvider.tsx owns the authenticated user, single catalog draft, saved snapshot, dirty state, loading/saving, validation, conflicts, localization context, and save reconciliation.
- features/admin/reconcileCatalogSave.ts is the pure reconciliation rule.
- features/admin/dine-in-orders-list.ts is the client controller for the board: filtering, pagination, polling, and the merge of background refreshes.
- features/admin/dine-in-orders-summary.ts reads and validates the board summary counters.
- features/admin/historical-orders-archive.ts is the client controller for the past-order archive: the search term, the date range, and pagination.
- features/admin/dine-in-order-detail.ts owns the selected-order detail and its status transitions.
- features/admin/dine-in-order-card-actions.ts owns the request and error mapping for the actions shown on a ticket.
- features/admin/i18n/admin-copy.ts contains admin dictionaries, context, localization helpers, and error mapping. features/admin/i18n/dine-in-table-label.ts formats table labels per language.

## Normalized dine-in orders

- features/orders/order-domain.ts canonicalizes a customer request and rejects untrusted price, total, status, and identity fields.
- features/orders/order-service.ts derives prices and totals from the locked catalog row and decides idempotent retries.
- features/orders/order-persistence.ts writes orders, items, tracking-token recovery, and idempotency hashes.
- features/orders/order-api.ts is the customer POST handler; features/orders/order-intake.ts reads the server-only intake flag.
- features/orders/order-list.ts and order-list-store.ts serve the admin list query, its cursor, the date scope, and the archive search.
- features/orders/order-detail.ts and order-detail-store.ts serve the admin order detail.
- features/orders/order-status.ts and order-status-store.ts serve the status transitions, including the atomic confirm-and-prepare action. An order being prepared can only be completed.
- features/orders/order-dashboard-summary.ts and order-dashboard-summary-store.ts serve the admin board counters.
- features/orders/order-tracking.ts and order-tracking-api.ts serve the customer tracking status; features/orders/tracking-token-recovery.ts encrypts the tracking token for server-side retry recovery; features/orders/crypto.ts holds the hashing and token helpers.

## HTTP and persistence

- app/api/ contains route handlers. Public customer handlers include catalog, dine-in orders, and tracking; protected administrator handlers live under admin.
- lib/cart.ts contains cart calculations and saved-cart sanitization.
- lib/orders.ts holds the legacy order record shape read by the admin history view.
- lib/catalog-validation.ts validates currency-free singleton catalog payloads and integer prices.
- lib/catalog-store.ts performs catalog reads and revision-checked writes.
- lib/order-store.ts is the read-only adapter for the retained legacy `orders` rows. New orders are persisted by features/orders/order-persistence.ts.
- features/admin/auth/ contains password verification. `scripts/admin-password.mjs` initializes or resets the singleton credential from a hidden terminal prompt. lib/auth.ts owns hashed session-cookie utilities; lib/auth-store.ts and lib/rate-limit-store.ts adapt authentication and rate limits to PostgreSQL.
- `lib/legacy-restaurant-key.ts` contains the server-only temporary partition key used only by the legacy order store; remove it in the order persistence phase.
- lib/image-store.ts stores menu image metadata in PostgreSQL and bytes in private S3-compatible storage; app/api/images/[id]/route.ts retrieves and serves image bytes.
- lib/table-operations.ts validates and hashes public table tokens; lib/table-store.ts resolves only active tables and persists table records. Admin table APIs require the existing administrator session. Rotation recovery encrypts the most recent token using the server-only TABLE_QR_RECOVERY_KEY.
- `scripts/migrate-menu-images-to-s3.mjs` verifies legacy base64 images and deterministic private S3 objects for an older database; the clean initial schema does not migrate legacy image bytes.
- db/schema.ts defines tables; drizzle/0000_init.sql is the generated schema for a clean database, with Drizzle metadata in drizzle/meta/.

## Shared styling and utilities

- app/globals.css contains storefront styles and the generic sheet primitive rules.
- app/admin/admin.css contains admin styles.
- components/ui/ contains generic primitives. `components/ui/sheet.tsx` carries its own `ui-sheet-*` class names because this project compiles plain CSS only; Tailwind is installed but no utility is ever generated, so a utility class in a component would be an inert no-op.
- lib/text.ts selects localized strings; lib/utils.ts contains shared utilities.
- hooks/ contains generic hooks, including viewport detection.

When changing routes or contracts, update API_REFERENCE.md and relevant tests. Update PROJECT_STRUCTURE.md when ownership or folders change.

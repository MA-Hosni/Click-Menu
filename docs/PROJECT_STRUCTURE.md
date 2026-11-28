# Project structure

The Next.js App Router lives at the repository root; there is no src/ directory.

    app/
      admin/{categories,login,menu,orders,qr,restaurant,tables}/page.tsx
      admin/layout.tsx
      admin/page.tsx
      admin/admin.css
      api/{admin,auth,catalog,dine-in,health,images,me,orders}/route.ts
      browser-test/            development-only checkout harness
      menu/page.tsx
      t/[token]/page.tsx
      track/[orderId]/page.tsx
      page.tsx
      layout.tsx
      auth.ts
      globals.css
    components/
      admin/{auth,categories,layout,menu,orders,qr,restaurant,tables}/
      client/{cart,menu,ordering,restaurant,shared}/
      ui/
    features/
      admin/
      orders/
      storefront/
    db/
    drizzle/
    hooks/
    lib/
    public/
    scripts/
    tests/

## Responsibilities

### app/

Owns App Router conventions: route page.tsx files, layouts, metadata, and HTTP route handlers. Customer routes are /, /menu, /t/[token], and /track/[orderId] (order status tracking). Admin routes are /admin/login, /admin/menu, /admin/categories, /admin/orders, /admin/restaurant, and /admin/tables. The legacy /admin/qr URL redirects to /admin/tables; /admin redirects to /admin/menu.

app/browser-test/ holds the development-only checkout harness and its loopback guard. It is not part of a production deployment.

app/auth.ts exposes the administrator session lookup used by the protected route handlers.

### app/api/

Owns HTTP method handling, request parsing, same-origin checks, authentication boundaries, and response status codes. Keep HTTP contracts here; delegate reusable validation and data operations to features or lib.

### components/admin/

Admin-only presentation grouped by auth, categories, layout, menu, orders, restaurant, tables, and qr. `components/admin/qr/QrPage.tsx` is only a redirect shim for the retired `/admin/qr` URL. Shared catalog state and admin localization come from features/admin.

The orders folder is split by responsibility: `OrdersPage.tsx` owns the switch between the live board and the past-order archive, `DineInOrdersPanel.tsx` owns the board and its polling, `DineInOrdersSummary.tsx` renders the board figures, `DineInOrderTicket.tsx` renders one order, `DineInOrderDetailDrawer.tsx` renders the full order, and `HistoricalOrders.tsx` reads the searchable archive.

### components/client/

Customer presentation grouped under restaurant, menu, cart, ordering, and shared components. Route definitions remain in app/.

### components/ui/

Generic interface primitives without ClickMenu-specific business behavior. This project compiles plain CSS only; Tailwind is installed but no utility class is ever generated, so a primitive carries its own class names and `app/globals.css` defines them.

### features/admin/

Owns the one AdminProvider, catalog lifecycle and save reconciliation, the admin orders board controllers and card actions, and admin localization under features/admin/i18n/. Order UI state remains independent of catalog state.

### features/orders/

Owns the normalized dine-in order domain on the server side: request canonicalization, catalog-derived pricing, persistence, the list/detail/status queries, the dashboard summary, customer tracking, and tracking-token recovery.

### features/storefront/

Owns storefront catalog/cart and checkout hooks plus customer translations under features/storefront/i18n/. Feature modules must not import from app/ or components/.

### lib/

Shared types, validation, cart/order domain logic, server-side stores, and utilities. Keep React UI out of lib. Database-dependent modules must remain server-only.

`lib/table-operations.ts` owns QR-token validation, hashing, label normalization, and table operations. `lib/table-store.ts` is the server-only Drizzle adapter for table persistence. Admin table presentation belongs in `components/admin/tables/`; its HTTP handlers are under `app/api/admin/tables/`.

`lib/order-store.ts` is the read-only adapter for the retained legacy `orders` rows; new dine-in orders are persisted by `features/orders/order-persistence.ts`.

### db/

Drizzle schema and database clients. db/schema.ts defines the PostgreSQL tables; db/index.ts selects Neon by default or an explicitly configured local node-postgres client, with the driver choice, pool, and transaction helpers in db/driver-config.ts, db/pool.ts, and db/transaction.ts.

### drizzle/

Committed SQL migrations and Drizzle metadata. Update the schema and generate/review a migration only when a schema change is requested.

### hooks/

Generic shared React hooks. Feature-specific hooks belong in features/admin/ or features/storefront/.

## Where to put changes

- New route: app/<segment>/page.tsx or the relevant App Router special file.
- Admin UI: components/admin/<feature>/.
- Customer UI: components/client/<feature>/.
- Generic primitive: components/ui/.
- Business logic: the owning feature or shared lib module.
- Feature hooks/state: features/admin/, features/orders/, or features/storefront/.
- Translations: the feature's i18n/ directory.
- Database operations: server-only lib modules using db/.
- Tests: tests/<domain>/ with *.test.mjs files.

Keep dependencies directed inward: app may compose components and features; components may depend on features and lib; features may depend on features, lib, and the shared db/schema constants, but not app or components.

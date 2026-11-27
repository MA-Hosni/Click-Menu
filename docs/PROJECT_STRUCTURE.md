# Project structure

The Next.js App Router lives at the repository root; there is no src/ directory.

    app/
      admin/{categories,menu,orders,qr,restaurant,tables}/page.tsx
      admin/layout.tsx
      admin/page.tsx
      api/{admin,auth,catalog,health,images,me,orders}/
      menu/page.tsx
      t/[token]/page.tsx
      page.tsx
      layout.tsx
      globals.css
    components/
      admin/{auth,categories,layout,menu,orders,qr,restaurant}/
      client/{cart,menu,ordering,restaurant,shared}/
      ui/
    features/
      admin/i18n/
      storefront/i18n/
    db/
    drizzle/
    hooks/
    lib/
    public/
    tests/

## Responsibilities

### app/

Owns App Router conventions: route page.tsx files, layouts, metadata, and HTTP route handlers. Customer routes are /, /menu, and /t/[token] (table QR menu). Admin routes are /admin/menu, /admin/categories, /admin/orders, /admin/restaurant, and /admin/tables. The legacy /admin/qr URL redirects to /admin/tables; /admin redirects to /admin/menu.

### app/api/

Owns HTTP method handling, request parsing, same-origin checks, authentication boundaries, and response status codes. Keep HTTP contracts here; delegate reusable validation and data operations to features or lib.

### components/admin/

Admin-only presentation grouped by auth, categories, layout, menu, orders, restaurant, and tables. `components/admin/qr/QrPage.tsx` is only a redirect shim for the retired `/admin/qr` URL. Shared catalog state and admin localization come from features/admin.

### components/client/

Customer presentation grouped by restaurant, menu, cart, ordering, and shared components. Route definitions remain in app/.

### components/ui/

Generic interface primitives without ClickMenu-specific business behavior.

### features/admin/

Owns the one AdminProvider, catalog lifecycle and save reconciliation, and admin localization under features/admin/i18n/. Order UI state remains independent of catalog state.

### features/storefront/

Owns storefront catalog/cart and checkout hooks plus customer translations under features/storefront/i18n/. Feature modules must not import from app/ or components/.

### lib/

Shared types, validation, cart/order domain logic, server-side stores, and utilities. Keep React UI out of lib. Database-dependent modules must remain server-only.

`lib/table-operations.ts` owns QR-token validation, hashing, label normalization, and table operations. `lib/table-store.ts` is the server-only Drizzle adapter for table persistence. Admin table presentation belongs in `components/admin/tables/`; its HTTP handlers are under `app/api/admin/tables/`.

### db/

Drizzle schema and database clients. db/schema.ts defines the PostgreSQL tables; db/index.ts selects Neon by default or an explicitly configured local node-postgres client.

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
- Feature hooks/state: features/admin/ or features/storefront/.
- Translations: the feature's i18n/ directory.
- Database operations: server-only lib modules using db/.
- Tests: tests/<domain>/ with *.test.mjs files.

Keep dependencies directed inward: app may compose components and features; components may depend on features and lib; features must not import app or components.

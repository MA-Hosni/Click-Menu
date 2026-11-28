# ClickMenu

ClickMenu is the digital menu and QR-only dine-in ordering application for The Hood in Tunisia. Public visitors can browse the menu; only customers arriving through an active table QR token can access ordering. The server-side order-intake flag remains disabled by default.

## Capabilities

- English, French, and Arabic customer menus, including Arabic RTL.
- Category navigation, search, and TND prices on the public menu; ordering controls are available only in validated table QR context.
- Server-authoritative integer-millime pricing, idempotent order persistence, and customer status tracking/recovery.
- Password-only administrator sign-in, with password setup and reset through an interactive server-side CLI.
- An admin orders board: live registered-table orders with a summary strip, per-order status actions, and an order detail drawer.
- Preserved records from the previous ordering system, readable read-only from a separate admin tab.
- Admin catalog editing, restaurant settings, QR generation, and order status management.
- Revision checks that reject conflicting catalog saves.

## Technology and prerequisites

ClickMenu uses Next.js 16 App Router, React 19, TypeScript, Drizzle ORM, Neon serverless PostgreSQL, custom CSS, Tailwind CSS 4, and Node's built-in test runner.

Use Node.js 26 and npm. This repository declares `"node": ">=26 <27"` in `package.json`. Next.js 16.4.6 itself has a lower minimum of Node.js 20.9, but the repository's engine requirement is stricter and takes precedence. npm is the project's package manager and `package-lock.json` is the lockfile.

Database-backed features require PostgreSQL/Neon credentials. The administrator credential is a singleton database record initialized or reset with `npm run admin:password`.

## Install and configure

    npm ci
    Copy-Item .env.example .env.local

Replace the example values in .env.local. `DATABASE_URL` is used by Drizzle Kit; `DATABASE_URL_POOLED` is used by the application. Image uploads also require server-side `AWS_ENDPOINT_URL_S3`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, and `AWS_SECRET_ACCESS_KEY` values. The private `uploads` bucket is in `eu-central-1`. Table QR rotation also requires a random 32-byte base64 `TABLE_QR_RECOVERY_KEY`; generate it with Node's `crypto.randomBytes(32)` and keep it stable across deployments. After applying migrations, initialize or intentionally reset the password from an interactive terminal with `npm run admin:password` or `npm run admin:password -- --reset`. Password input is hidden; the plaintext and hash are not printed.

Apply the committed migration:

    npm run db:migrate

Run the development server:

    npm run dev

## Commands

    npm run dev
    npm run build
    npm run start
    npm run lint
    npm test
    npx tsc --noEmit
    npm run db:generate
    npm run db:migrate
    npm run db:studio
    npm run admin:password
    npm run test:browser:checkout
    npm run test:integration:tracking-recovery
    npm run test:integration:catalog-review
    npm run test:integration:transactions
    npm run test:integration:dine-in-orders

## Routes

| URL | Purpose |
| --- | --- |
| / | Customer landing page and menu |
| /menu | The Hood menu; query parameters do not establish registered table identity |
| /t/[token] | Registered-table QR route; resolves an active table before showing its menu |
| /track/[orderId] | Customer order status tracking; the tracking token is supplied in the URL fragment |
| /admin | Redirects to /admin/menu |
| /admin/login | Administrator password sign-in |
| /admin/menu | Menu editor |
| /admin/categories | Category editor |
| /admin/orders | Order board for registered-table orders and preserved history |
| /admin/restaurant | Restaurant settings |
| /admin/tables | Manage restaurant tables and their QR codes |
| /admin/qr | Redirects to /admin/tables |
| /api/catalog | The Hood's public catalog; returns an empty TND catalog before initial setup |
| /api/orders | Retired legacy endpoint; `POST` always returns 410 and new ordering is QR dine-in only |
| /api/dine-in/orders | Customer dine-in order submission; disabled unless `DINE_IN_ORDER_INTAKE_ENABLED` is exactly `true` |
| /api/dine-in/orders/[id]/tracking | Customer order status for a holder of the tracking token |
| /api/auth/login | Administrator password sign-in |

See [CONTRIBUTING.md](CONTRIBUTING.md) for local development and pull request guidance. See [docs/README.md](docs/README.md) for technical documentation and [AGENTS.md](AGENTS.md) and [docs/PROJECT_STRUCTURE.md](docs/PROJECT_STRUCTURE.md) for architecture guidance.

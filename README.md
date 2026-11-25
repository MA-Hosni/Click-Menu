# ClickMenu

ClickMenu is a multilingual restaurant menu and ordering application. Customers browse restaurant menus, customize items, review a cart, and continue an order through WhatsApp. Restaurant owners manage their catalog and review order records in a passwordless admin dashboard.

## Capabilities

- English, French, and Arabic customer menus, including Arabic RTL.
- Category navigation, search, item options, persistent browser cart, and checkout validation.
- WhatsApp order messages and server-side order validation and persistence.
- Passwordless email-code owner sign-in.
- Admin catalog editing, restaurant settings, QR generation, and order status management.
- Revision checks that reject conflicting catalog saves.

## Technology and prerequisites

ClickMenu uses Next.js 16 App Router, React 19, TypeScript, Drizzle ORM, Neon serverless PostgreSQL, custom CSS, Tailwind CSS 4, and Node's built-in test runner.

Use Node.js 26 and npm. This repository declares `"node": ">=26 <27"` in `package.json`. Next.js 16.4.6 itself has a lower minimum of Node.js 20.9, but the repository's engine requirement is stricter and takes precedence. npm is the project's package manager and `package-lock.json` is the lockfile.

Database-backed features require PostgreSQL/Neon credentials. Production email sign-in requires a Resend API key and verified sender.

## Install and configure

    npm ci
    Copy-Item .env.example .env.local

Replace the example values in .env.local. DATABASE_URL is used by Drizzle Kit; DATABASE_URL_POOLED is used by the application. Both are required for the documented database workflow. RESEND_API_KEY and EMAIL_FROM are required for production sign-in. In development, leaving both blank causes the code to be displayed in the sign-in screen.

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

## Routes

| URL | Purpose |
| --- | --- |
| / | Customer landing page and menu |
| /menu | Menu page; accepts shop and table query parameters |
| /admin | Redirects to /admin/menu |
| /admin/menu | Menu editor |
| /admin/categories | Category editor |
| /admin/orders | Owner order management |
| /admin/restaurant | Restaurant settings |
| /admin/qr | QR generation |
| /api/catalog | Public catalog; no shop returns the demo catalog |
| /api/orders | Customer order submission |

See [CONTRIBUTING.md](CONTRIBUTING.md) for local development and pull request guidance. See [docs/README.md](docs/README.md) for technical documentation and [AGENTS.md](AGENTS.md) and [docs/PROJECT_STRUCTURE.md](docs/PROJECT_STRUCTURE.md) for architecture guidance.

# Deployment and operations

This guide describes the current application requirements without assuming a hosting provider.

## Runtime requirements

- Node.js 26 and npm. The repository declares `"node": ">=26 <27"` in `package.json`; use Node.js 26 for local development and deployment.
- Next.js 16.4.6 itself has a lower minimum requirement of Node.js 20.9, but the repository's engine requirement is stricter and takes precedence.
- npm is the package manager; `package-lock.json` is the npm lockfile.
- PostgreSQL reachable from the application; the current driver is Neon serverless PostgreSQL.
- Database migrations applied before the app serves stored data.
- In production, Resend credentials and a verified sender for owner email sign-in.

## Environment variables

| Variable | Required | Used by |
| --- | --- | --- |
| DATABASE_URL | For Drizzle Kit commands | drizzle.config.ts |
| DATABASE_URL_POOLED | For database-backed application routes and build module initialization | db/index.ts |
| SITE_URL | Optional | Root metadata base URL; defaults to http://localhost:3000 |
| RESEND_API_KEY | Required with EMAIL_FROM in production | Email sign-in code delivery |
| EMAIL_FROM | Required with RESEND_API_KEY in production | Sender for sign-in emails |

Copy .env.example to .env.local and replace placeholders. Never commit credentials. Only add deployment variables when source code consumes them.

## First deployment

1. Provision PostgreSQL and set DATABASE_URL (direct connection) and DATABASE_URL_POOLED (pooled Neon URL).
2. Apply committed migrations with npm run db:migrate using DATABASE_URL.
3. Set SITE_URL to the public origin used for metadata.
4. Configure RESEND_API_KEY and EMAIL_FROM for production passwordless sign-in. In development, omitting both shows the code in the sign-in screen.
5. Install with npm ci, run lint/tests/type-check/build, then deploy the production build with npm run start or a compatible Next.js runtime.

The database URL is required during db/index.ts module initialization. A production build needs a syntactically valid DATABASE_URL_POOLED even though it must not perform database requests during build. CI uses a fake, non-routable placeholder.

## Operational checks

- GET /api/health/db performs a read-only SELECT 1. Success returns success=true; failure returns HTTP 500 and logs details server-side.
- GET /api/catalog without shop returns the demo seed catalog without a database lookup.
- GET /api/catalog?shop=<slug-or-owner-id> reads a published catalog.
- /menu?shop=<slug-or-owner-id> uses that endpoint after hydration; metadata lookup failure falls back to base metadata.
- /api/admin/catalog and /api/admin/orders require a valid owner session.
- Production order submission and sign-in depend on database connectivity and PostgreSQL-backed rate limits.

## Troubleshooting

### Database routes return 503 or health returns 500

Check DATABASE_URL_POOLED and Neon connectivity. Confirm DNS and outbound HTTPS from the runtime to Neon. Client responses are generic while the underlying server error is logged. Do not replace a failed real-shop lookup with demo data.

### Owner cannot request a sign-in code

Check database availability because rate-limit counters and sign-in codes are stored in PostgreSQL. In production, also verify RESEND_API_KEY and EMAIL_FROM. Provider credentials are never returned to clients.

### Catalog save returns 409

Another save changed the stored revision. The dashboard requires explicit reload before replacing the draft with the current saved version.

### Images fail to load

Uploads accept JPEG, PNG, and WebP, are capped at 700,000 bytes, and are stored in PostgreSQL. Check database availability and upload responses.

## CI

GitHub Actions runs npm ci, ESLint, unit tests, TypeScript checking, and the production build. Unit tests use in-memory data. Build receives a fake CI-only database URL and does not require Neon credentials or make database requests.

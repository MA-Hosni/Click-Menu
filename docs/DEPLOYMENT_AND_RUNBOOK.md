# Deployment and operations

This guide describes the current application requirements without assuming a hosting provider.

## Runtime requirements

- Node.js 26 and npm. The repository declares `"node": ">=26 <27"` in `package.json`; use Node.js 26 for local development and deployment.
- Next.js 16.4.6 itself has a lower minimum requirement of Node.js 20.9, but the repository's engine requirement is stricter and takes precedence.
- npm is the package manager; `package-lock.json` is the npm lockfile.
- PostgreSQL reachable from the application. Neon serverless remains the default runtime; an explicit local mode uses node-postgres.
- Database migrations applied before the app serves stored data.
- A singleton administrator credential initialized through the server-side CLI.

## Environment variables

| Variable | Required | Used by |
| --- | --- | --- |
| DATABASE_DRIVER | Optional; defaults to `neon`; accepted values are `neon` and `postgres` | `db/driver-config.ts`, `db/index.ts`, `db/transaction.ts` |
| DATABASE_URL | Required by Drizzle Kit; also required by the app when `DATABASE_DRIVER=postgres` | `drizzle.config.ts`; local runtime adapter |
| DATABASE_URL_POOLED | Required by the app when using Neon | Neon runtime adapter in `db/index.ts` and `db/transaction.ts` |
| SITE_URL | Optional | Root metadata base URL; defaults to http://localhost:3000 |
| TABLE_QR_RECOVERY_KEY | Required for table QR rotations | 32-byte base64 AES-256-GCM recovery key; server-side only |
| ORDER_TRACKING_RECOVERY_KEY | Required for future recoverable order tracking tokens | Canonical Base64 encoding of 32 random bytes; server-side only |
| DINE_IN_ORDER_INTAKE_ENABLED | Optional; defaults to disabled | Only exact lowercase `true` enables public dine-in order creation; server-side only |
| AWS_ENDPOINT_URL_S3 | Required for image uploads | Neon S3-compatible endpoint |
| AWS_REGION | Optional; defaults to eu-central-1 | S3 signing region |
| AWS_ACCESS_KEY_ID | Required for image uploads | Server-side object-storage access key |
| AWS_SECRET_ACCESS_KEY | Required for image uploads | Server-side object-storage secret |

The application uses the private bucket `uploads`. Keep it private; the app serves images through `/api/images/[id]` and never returns storage credentials. Do not configure bucket public access. Only server-side runtime environments need S3 credentials.

### Local PostgreSQL development

For an isolated local PostgreSQL database, set `DATABASE_DRIVER=postgres` and point `DATABASE_URL` to that database. Remove `DATABASE_URL_POOLED` in this mode so the target is unambiguous. The app uses process-scoped `pg.Pool` instances for ordinary queries and transactions; `npm run db:migrate` also uses `DATABASE_URL`. Unset `DATABASE_DRIVER` continues to select Neon, and `DATABASE_DRIVER=neon` preserves the existing Neon HTTP and WebSocket paths. The adapters do not fall back to one another after an error. The `admin:password` command uses the selected driver and URL; the legacy image transfer utility remains Neon-specific.

The legacy image transfer utility (`scripts/migrate-menu-images-to-s3.mjs`) remains Neon-specific. Local databases with legacy image payloads must not use that utility until local-driver support is added; a fresh local database does not need legacy image transfer. Use only synthetic data in disposable local databases. Keep `DINE_IN_ORDER_INTAKE_ENABLED` absent or `false`; order intake remains disabled unless an isolated test has been deliberately prepared.

Copy .env.example to .env.local and replace placeholders. Never commit credentials. Only add deployment variables when source code consumes them. Initialize/reset the singleton administrator password from a trusted interactive server terminal with `npm run admin:password` or `npm run admin:password -- --reset`; there is no public provisioning endpoint.

Generate `TABLE_QR_RECOVERY_KEY` once with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"`. It must be a canonical Base64 encoding of exactly 32 random bytes, is server-only, and must be stored in secret configuration rather than source control. Every application instance and deployment serving this database must use the same stable key; deployments must never generate a replacement automatically. Losing the key makes the stored recovery ciphertext unusable. Replacing it requires retaining the old key, decrypting and re-encrypting every current recovery ciphertext under the new key, verifying the results, and only then removing the old key. Keep a protected backup of the key.

Generate `ORDER_TRACKING_RECOVERY_KEY` locally with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"`. Do not commit or paste the output into source control. It must be canonical padded Base64 encoding of exactly 32 random bytes, remain server-only, and stay stable across every application instance that may recover order tracking tokens. Order creation encrypts a recovery envelope with this key, and matching retries decrypt it. Do not generate a replacement automatically. Losing or replacing this key makes previously stored recovery envelopes unrecoverable; existing tracking tokens remain usable only if a customer already saved them. Key rotation needs a separately planned process that retains the old key and re-encrypts and verifies every stored envelope before removing it. Replacing the environment value alone is not safe.

## Neon WebSocket transaction adapter preview verification

Ordinary application reads and writes remain on the Neon HTTP client. The separate WebSocket adapter is for future workflows requiring an interactive transaction. Node.js 26 is selected by the repository's `"node": ">=26 <27"` engine requirement and is used by CI; Node 26 provides the global WebSocket required by the installed Neon driver. The current Next.js configuration enables Cache Components, which uses the default Node.js runtime and does not support an explicit `runtime` route export. Keep adapter-using routes on that default Node runtime and do not add `export const runtime = "nodejs"` unless the Next.js configuration changes. The adapter checks the runtime before creating its pool.

The adapter lazily creates one process-local pool and reuses it across requests in that process. The pool allows at most two clients per process, retires idle clients after five seconds, and limits each client's lifetime to five minutes. It checks out a distinct client for every overlapping transaction, then commits or rolls back and releases the client before returning. The limit is not deployment-wide: concurrent Vercel function instances each have their own pool and can multiply total database connections. Before enabling transaction traffic, compare expected Vercel instance concurrency with the Neon project's connection limits and pooled-endpoint capacity. Process termination is not required for correctness because transaction completion and client release are explicit; idle and lifetime settings recycle connections during instance reuse. The adapter propagates server-side transaction errors; future route handlers must map them to safe responses without exposing SQL, parameters, connection strings, or raw driver details.

Before enabling a feature that uses the adapter, verify it in a Vercel Preview deployment with preview-only database configuration and synthetic test rows:

1. Confirm the deployed function uses Node.js 26 and the route is configured for `nodejs`, not Edge.
2. Invoke the transaction flow only through an authenticated, access-restricted preview route or preview-only feature. Do not add an unauthenticated database diagnostic endpoint.
3. Verify WebSocket connection establishment and a harmless `SELECT 1` in the transaction.
4. Verify multiple synthetic writes commit together; then force a controlled statement failure in a separate synthetic transaction and verify all of its writes roll back.
5. Hold a transaction-scoped advisory lock in one request and submit a second request for the same lock. Confirm it waits, then its subsequent statement sees the first request's committed row under `READ COMMITTED`.
6. Repeat with rollback and verify the waiter proceeds without seeing rolled-back data. Confirm failed transactions return errors to the caller.
7. Send sequential requests to verify connection reuse, then overlapping requests to verify separate transaction clients. Observe connection counts and idle cleanup/function recycling.
8. Measure request duration and test connection, lock-wait, and statement timeout behavior against Preview limits. Confirm callers return success only after commit completes.
9. Remove temporary preview-only verification code and synthetic data after the check.

Local PostgreSQL tests execute the production TypeScript order service and Drizzle persistence statements through the shared transaction runner using node-postgres. They cannot verify Neon WebSocket connectivity, Vercel's hosted runtime, deployment networking, Neon pool behavior, or request timeouts. No live Neon or Vercel Preview verification has been performed. Order persistence reads persisted catalog review fields inside its transaction; the domain readiness marker is not authorization and must never come from customer input. Catalog-review concurrency coverage through the production Neon adapter and route-authentication tests remain outstanding.

## First deployment

1. Provision PostgreSQL and set DATABASE_URL (direct connection) and DATABASE_URL_POOLED (pooled Neon URL).
2. Apply the committed initial schema to the clean database with `npm run db:migrate` using DATABASE_URL. This migration creates the current schema and seeds the image-capacity counter at zero. It is not a data migration for a database with existing application tables or legacy rows.
3. For a separate older database that still contains legacy image bytes, use the documented image-transfer procedure before any migration that removes those bytes. The consolidated initial schema does not perform legacy image transfer or account/order data migration.
4. From a trusted interactive terminal with the target environment's selected database configuration, run `npm run admin:password` to initialize the administrator credential. Neon uses `DATABASE_URL_POOLED`; local PostgreSQL uses `DATABASE_URL` with `DATABASE_DRIVER=postgres`. Use `-- --reset` only for an intentional reset; this increments the credential version and revokes all sessions.
5. Set SITE_URL to the public origin used for metadata.
6. Configure TABLE_QR_RECOVERY_KEY before enabling table QR rotation.
7. Configure the same stable server-only `ORDER_TRACKING_RECOVERY_KEY` on every runtime instance before any normalized dine-in submissions. Keep `DINE_IN_ORDER_INTAKE_ENABLED` absent or set to `false`. Only the exact server-side value `true` enables `POST /api/dine-in/orders`; request data cannot change it. This switch remains disabled until checkout, tracking, staff processing, and operational review are complete.
8. Install with npm ci, run lint/tests/type-check/build, then deploy the production build with npm run start or a compatible Next.js runtime.

The initial migration must only be used for a clean database. Do not run it over an existing schema or use this reset history to erase tables in a database that may contain data. For Neon, confirm the target is empty and obtain explicit approval before applying it.

The selected driver's runtime URL is required during `db/index.ts` module initialization: `DATABASE_URL_POOLED` for Neon and `DATABASE_URL` for PostgreSQL. A production Neon build needs a syntactically valid `DATABASE_URL_POOLED` even though it must not perform database requests during build. CI uses a fake, non-routable placeholder.

## Empty catalog and restaurant setup

An empty database does not receive generated menu data. Public `GET /api/catalog` and the storefront return a blank The Hood catalog with no categories or dishes; the authenticated admin catalog setup starts at revision 0. Sign in at `/admin/login`, create and save categories at `/admin/categories`, then create dishes at `/admin/menu`. Enter prices through the frontend price input (stored as integer units at scale 1,000); dish images are optional. There are no seed dishes or prices.

Create each physical table in `/admin/tables` and use its generated QR code for that table. QR URLs contain opaque tokens, not table IDs. Rotating a QR token invalidates its previous token. Review the saved catalog revision using the TND price review control after checking its prices. Any subsequent catalog save invalidates that review and requires review of the new exact revision. Empty catalogs cannot accept orders.

Do not enable order intake as part of initial setup. The feature flag remains absent or `false`; with it disabled, the normalized order endpoint returns 503 and does not persist an order. Checkout acceptance requires a deliberate server-side configuration change after the workflow has been reviewed.

## Operational checks

- GET /api/health/db performs a read-only SELECT 1. Success returns success=true; failure returns HTTP 500 and logs details server-side.
- GET /api/catalog reads The Hood's singleton catalog; `shop` query parameters are ignored. Before initial setup it returns a blank catalog with no categories or dishes.
- /menu loads the singleton catalog after hydration; metadata lookup failure falls back to base metadata.
- /api/admin/catalog, /api/admin/orders, and /api/admin/images require a valid singleton administrator session.
- Production order submission and administrator sign-in depend on database connectivity and PostgreSQL-backed rate limits.
- Forwarded headers are trusted only when requests reach the app through a controlled reverse proxy. Configure the proxy to **overwrite**, not append or pass through client-supplied, `X-Real-IP`, `X-Forwarded-For`, and `X-Forwarded-Proto` values. The app uses `X-Real-IP` or the first `X-Forwarded-For` value for rate-limit identity and the first `X-Forwarded-Proto` value to recognize HTTPS and set Secure cookies. Block public access to the application origin so clients cannot bypass the trusted proxy or spoof these headers.
- Administrator login requires HTTPS in production. The app recognizes the request URL protocol or the first `X-Forwarded-Proto` value, so TLS must terminate at the trusted proxy and the proxy must set the header from the actual client connection. Never trust this header when the application is directly internet-accessible. HTTPS requests receive Secure session cookies.
- Password initialization/reset audit events are stored without passwords or hashes in `admin_audit_events`.

## Troubleshooting

### Database routes return 503 or health returns 500

Check the selected database URL and driver. In Neon mode, confirm `DATABASE_URL_POOLED` and Neon connectivity; in local PostgreSQL mode, confirm `DATABASE_URL` and that the local server is reachable. Client responses and server log messages are generic. A database connectivity failure returns 503; a missing catalog row is an expected blank setup catalog, not an error or demo data.

### Administrator cannot sign in

Check database availability and PostgreSQL-backed rate limits. Confirm the singleton credential was initialized and that the deployment proxy overwrites client-IP headers.

### Catalog save returns 409

Another save changed the stored revision. The dashboard requires explicit reload before replacing the draft with the current saved version.

### Images fail to load

Uploads accept JPEG, PNG, and WebP signatures, are capped at 700,000 bytes, and are stored in the private `uploads` S3-compatible bucket. PostgreSQL stores only image metadata and object keys. Check database and object-storage availability and upload responses.

## CI

GitHub Actions runs npm ci, ESLint, unit tests, TypeScript checking, and the production build. Unit tests use in-memory data. Build receives a fake CI-only database URL and does not require Neon credentials or make database requests.

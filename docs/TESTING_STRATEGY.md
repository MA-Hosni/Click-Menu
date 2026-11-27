# Testing strategy

## Commands

| Purpose | Command |
| --- | --- |
| Lint | `npm run lint` |
| Unit tests | `npm test` |
| Normalized checkout browser recovery | `npm run test:browser:checkout` |
| Tracking recovery PostgreSQL integration | `npm run test:integration:tracking-recovery` |
| TND catalog review PostgreSQL integration | `npm run test:integration:catalog-review` |
| PostgreSQL transaction semantics integration | `npm run test:integration:transactions` |
| Normalized order production-path PostgreSQL integration | `npm run test:integration:dine-in-orders` |
| TypeScript check | `npx tsc --noEmit` |
| Production build | `npm run build` |

Unit tests use Node's built-in `node:test` and strict assertions. The `npm test` script discovers the repository's `.test.mjs` files. `tests/support/register-types.mjs` uses the TypeScript compiler already installed by the project to load actual TypeScript modules. This needs no test library dependency, Neon connection, or production fixture.

The tracking recovery PostgreSQL integration command requires Docker Engine and the `postgres:17` image. It starts a disposable PostgreSQL 17 container with a generated test-only database/user/password, binds a random host port to localhost, creates only the minimal prerequisite `dine_in_orders` table, and executes the actual `drizzle/0011_order_tracking_recovery.sql`. The harness removes its container and temporary credential file in a `finally` cleanup path. It never reads project database environment variables and does not apply earlier migrations.

The catalog review PostgreSQL integration command uses the same disposable-container safeguards. It creates only the minimum `restaurant_catalogs` columns required by migration 0012, seeds an existing unreviewed row, executes the actual `drizzle/0012_tnd_catalog_price_review.sql`, and verifies the database CHECK constraints and failed-write rollback. It never reads project database environment variables or applies other migrations.

The transaction integration command uses the same isolated PostgreSQL 17 safeguards. It verifies multi-write commit, rollback after a deliberate statement failure, visibility before and after commit, advisory-lock serialization, post-lock visibility under `READ COMMITTED`, and lock release after rollback. It uses no Neon or project database configuration. Adapter lifecycle tests use a transaction-client/command double to check explicit `BEGIN` isolation, commit/rollback commands, failure aggregation, client discard/release, rejection of a returned handle, post-completion query blocking, and separate clients for overlapping callbacks. One test uses the installed Drizzle query builder against the fake client to verify the guard at the actual driver query boundary. These tests do not open Neon's WebSocket driver and do not establish hosted Neon connectivity.

The normalized order integration command starts a disposable PostgreSQL 17 container on a dynamically allocated localhost-only port with generated credentials. It creates only prerequisite catalog/table definitions and executes the relevant order/review migrations 0009–0012 inside that disposable database; it never connects to an application database. It imports and runs the actual TypeScript order service and the same Drizzle persistence implementation used in production. The injected boundary is only the transaction runner: tests use the guarded READ COMMITTED runner with a node-postgres client, while production supplies the Neon WebSocket runner. PostgreSQL therefore executes the production persistence statements and service decisions, but the test does not execute Neon's WebSocket transport. Coverage includes concurrent idempotency, retries after mutable state changes, rollback after item failures and verification mismatches, real recovery-envelope persistence/decryption, and shared-lock/update behavior. Container, pool, and generated credentials are removed in `finally`. This does not prove hosted Neon/Vercel connectivity, runtime configuration, or serverless pool behavior.

## Current coverage

- tests/features/storefront/cart.test.mjs: adding/merging, quantity handling, unavailable items, saved-cart sanitization, option pricing, and dine-in totals.
- tests/features/storefront/orders.test.mjs: delivery and takeaway rejection, legacy endpoint retirement, WhatsApp non-triggering behavior, and historical legacy record decoding.
- tests/browser/checkout-recovery.spec.mjs: normalized dine-in receipt recovery, retry idempotency, table scoping, and browser storage behavior with a mocked order transport.
- tests/features/admin/catalog.test.mjs: singleton catalog validation, legacy tenant-slug stripping, empty public catalog behavior, and save-response reconciliation with or without concurrent draft edits.
- tests/features/admin/catalog-review.test.mjs: exact-revision TND review, MAD and invalid-price rejection, stale/concurrent edit handling, review invalidation on save, audit recording, and price-value preservation using an in-memory persistence double.
- tests/lib/auth.test.mjs: hashed session tokens, cookie protections, expiration, and sign-out using an in-memory store.
- tests/features/admin/password-auth.test.mjs: password policy and hashing, singleton initialization and duplicate rejection, correct/incorrect login, reset and session revocation, administrator authorization, and rate limiting using an in-memory store.

`tests/features/orders/order-api.test.mjs` exercises the order route handler with mocked submission and rate-limit dependencies. `tests/features/orders/order-service.test.mjs` exercises service decisions with an in-memory persistence double. Neither test connects to the application database.

The registered-table unit tests exercise cart/request helpers, storage-record parsing, response validation, explicit receipt acknowledgment, terminal fallback reconciliation, conditional cleanup markers, and an injectable in-memory Web Locks-style coordinator. Cleanup tests cover promoted fallback tombstones, repeated interruption, malformed or mismatched pairs, unsupported versions, mismatched completed order IDs, and primary-removal failure for `new-order`. These unit tests do not establish browser API behavior. Hydration and storage-event reconciliation acquire the table lock before reading and applying pending state; submission and record resolution fail closed if required storage or Web Locks are unavailable.

The normalized dine-in browser harness uses synthetic table data and a mocked transport; it does not verify database persistence. PostgreSQL integration suites verify persistence separately. The legacy WhatsApp checkout UI has been removed; customer order tracking is covered by tracking API/client and persistence tests.

## Coverage boundaries

The catalog review PostgreSQL test verifies the catalog review constraints against PostgreSQL; its conditional application operation is covered with an in-memory persistence double, not the Neon adapter. The tracking recovery PostgreSQL test covers its database constraint and the dine-in order test executes the real TypeScript service and persistence statements against local PostgreSQL using node-postgres, but not the Neon-specific transaction transport. The browser recovery suite uses a mocked request and does not verify server persistence. A disposable Neon Preview verification is still required for Neon WebSocket connectivity and hosted Vercel behavior; do not point local tests at an application database. Manual customer/admin journeys need a safe test restaurant. Never submit real customer orders during routine verification.

Pending customer request details are retained in localStorage until the customer explicitly confirms saving the tracking code. A successful response alone does not retire the record: reopening before acknowledgment replays the same key and payload to recover the same receipt. Acknowledgment verifies the exact operation under the table lock and then replaces the personal request payload with a minimal order-ID marker. Abandonment and new-order cleanup first verify the exact expected operation/completed order and write a cleanup marker. The marker stays blocking until both localStorage and IndexedDB cleanup has been reconciled; partial cleanup must not appear as an empty state. If writing an idempotency-conflict disposition to localStorage fails, IndexedDB is used as a fallback and takes precedence over a matching retryable localStorage record. If both terminal writes fail, the current page stays blocked and does not automatically retry, but the terminal disposition is not durable and may be lost on reload. In that case, reload may restore only the exact persisted key and payload as retryable; an explicit retry uses that same pair, with server-side idempotency as the final duplicate safeguard. Browser storage may also be cleared or evicted. Explicit abandonment warns that an uncertain order may already have been accepted. These storage and locking tests use in-memory doubles, not browser integration tests.

## Adding tests

Keep tests under tests/ grouped by domain. Prefer pure validation and state-transition tests. For stores, supply an in-memory implementation of the existing interface where possible. Database integration tests must require an explicitly isolated test database and must not run against production.

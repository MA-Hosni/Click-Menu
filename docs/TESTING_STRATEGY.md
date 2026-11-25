# Testing strategy

## Commands

| Purpose | Command |
| --- | --- |
| Lint | `npm run lint` |
| Unit tests | `npm test` |
| TypeScript check | `npx tsc --noEmit` |
| Production build | `npm run build` |

Tests use Node's built-in `node:test` and strict assertions. The `npm test` script runs `node --test`, which discovers the repository's `.test.mjs` files. `tests/support/register-types.mjs` uses the TypeScript compiler already installed by the project to load actual TypeScript modules. This needs no test library dependency, Neon connection, or production fixture.

## Current coverage

- tests/features/storefront/cart.test.mjs: adding/merging, quantity handling, unavailable items, saved-cart sanitization, option pricing, delivery fees, and totals.
- tests/features/storefront/orders.test.mjs: order construction, trusted server-side pricing, missing/unavailable dishes, invalid details/IDs, and status validation.
- tests/features/admin/catalog.test.mjs: catalog/slug validation and save-response reconciliation with or without concurrent draft edits.
- tests/lib/auth.test.mjs: email normalization, code generation and hashing, correct/expired/invalid codes, attempt limits, session tokens, expiration, and sign-out using an in-memory store.

Run tests after changes to their domain modules. Tests do not call the HTTP order mutation or connect to the database.

## Coverage boundaries

The revision compare-and-swap in lib/catalog-store.ts and actual PostgreSQL persistence are not integration-tested because they require a database. No end-to-end browser runner is configured. Manual customer/admin journeys need a reachable database and a safe test restaurant. Never submit real customer orders during routine verification.

## Adding tests

Keep tests under tests/ grouped by domain. Prefer pure validation and state-transition tests. For stores, supply an in-memory implementation of the existing interface where possible. Database integration tests must require an explicitly isolated test database and must not run against production.

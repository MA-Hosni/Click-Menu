# Contributing to ClickMenu

ClickMenu is a multilingual restaurant menu and ordering application. Before changing code, read [AGENTS.md](AGENTS.md), [Project Structure](docs/PROJECT_STRUCTURE.md), and the relevant [architecture notes](docs/ARCHITECTURE_AND_ADR.md). The source code is authoritative when documentation differs.

## Prerequisites and setup

- Node.js 26, as pinned in `.nvmrc` and required by `package.json` (`>=26 <27`).
- npm, the package manager used by this repository.
- PostgreSQL/Neon for database-backed features. Use an isolated development database or Neon branch.

Install dependencies and copy the environment template:

```sh
npm ci
cp .env.example .env.local
```

Set `DATABASE_URL` to the direct development connection used by Drizzle Kit and `DATABASE_URL_POOLED` to the pooled connection used by the application. Set `SITE_URL` only when you need a different metadata origin. Configure a random 32-byte base64 `TABLE_QR_RECOVERY_KEY` for QR rotation and keep it stable. Use an isolated development database and never point setup or migration commands at production. After migrations, initialize the singleton administrator password using `npm run admin:password`; intentional resets require `npm run admin:password -- --reset`.

Run the committed migrations against an empty development database before using database-backed features:

```sh
npm run db:migrate
```

Start the application with `npm run dev`. The schema and migration workflow is documented in [Database Schema](docs/DATABASE_SCHEMA.md), and environment and deployment details are in [Deployment and Runbook](docs/DEPLOYMENT_AND_RUNBOOK.md).

## Changes and branches

Use these recommended branch prefixes:

- `feature/...` for user-facing capabilities.
- `fix/...` for bug fixes.
- `docs/...` for documentation.
- `refactor/...` for structural changes.

These names are conventions, not enforced repository rules. Use concise commit messages that describe the change; a recommended format is `type(scope): summary`, such as `fix(admin): preserve QR route rendering` or `docs: clarify local database setup`. This format is also a recommendation, not an enforced policy.

## Quality checks

Before opening a pull request, run:

```sh
npm run lint
npm test
npx tsc --noEmit
npm run build
git diff --check
```

These are recommended local preflight checks. For pull requests targeting `main`, GitHub Actions runs lint, tests, TypeScript checking, and the production build; it does not run `git diff --check`. GitHub merge-blocking branch protection and any mandatory review requirement must be confirmed in repository settings.

## Pull requests

Explain the motivation and the change, describe behavior or risk, and list the checks actually run. Include screenshots for visible UI changes. State whether a database migration is needed and summarize its effect. Call out API or other breaking changes. Keep changes focused and preserve unrelated work in the shared worktree.

Do not test order submission or migrations against production. Never commit credentials or populated `.env.local` files. For schema changes, update `db/schema.ts`, generate and inspect the migration with `npm run db:generate`, and test it on an isolated development database before production review.

## AI coding agents

AI agents must read the root [AGENTS.md](AGENTS.md) before making changes. Preserve existing work, follow the current feature boundaries, protect authentication and authorization, and run the relevant tests and checks. For framework APIs, read the documentation installed with the repository's Next.js version.

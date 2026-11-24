# Database schema

The current schema is defined in db/schema.ts. The checked-in initial migration is drizzle/0000_init.sql; Drizzle metadata is in drizzle/meta/. PostgreSQL is accessed through Drizzle ORM and @neondatabase/serverless.

## Tables

| Table | Stored data |
| --- | --- |
| restaurant_catalogs | Owner ID primary key, serialized catalog payload, integer revision, update timestamp, unique optional slug |
| menu_images | Image ID primary key, owner ID, content type, base64 data, byte length, creation time; indexed by owner |
| orders | Order ID primary key, owner ID, creation time, serialized order payload; indexed by owner and creation time |
| users | User ID primary key, unique email, creation time |
| login_codes | Email primary key, hashed code, expiry, failed-attempt count, creation time |
| sessions | Hashed token primary key, user ID, expiry, creation time; indexed by user |
| rate_limits | Hashed limit key primary key, window start, request count |

Catalog and order records use serialized text payloads and are validated by application code. The current schema does not declare foreign-key constraints. Order status and catalog fields are inside payloads, not separate columns.

## Database clients

- db/index.ts initializes the application Neon serverless HTTP client from DATABASE_URL_POOLED.
- drizzle.config.ts uses DATABASE_URL for Drizzle Kit commands.
- Keep database modules server-side. Route handlers use lib/catalog-store.ts, lib/order-store.ts, lib/auth-store.ts, lib/rate-limit-store.ts, and lib/image-store.ts.

## Migrations

After an intentional schema change, update db/schema.ts, generate and review SQL with:

    npm run db:generate

Apply checked-in migrations using:

    npm run db:migrate

Drizzle Studio is available with:

    npm run db:studio

These commands use DATABASE_URL. Do not run migrations as part of routine application startup. Back up the target database and review generated SQL before applying a production migration.

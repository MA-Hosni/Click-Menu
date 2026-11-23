# PROJECT STRUCTURE

This guide explains the ClickMenu project organization, directory responsibilities, and architectural patterns. Understanding the structure is essential for making informed changes and extending the platform.

## Root Directory

The project root contains configuration files, package definitions, and source code directories. Key files and directories include:

- **`package.json`** — Node.js project definition with scripts, dependencies, and build configuration. This is the reference point for available npm commands.
- **`tsconfig.json`** — TypeScript compiler options, paths, and module resolution. Ensures consistent type checking across the codebase.
- **`next.config.ts`** — Next.js application configuration, including image domains, headers, and build optimizations.
- **`drizzle.config.ts`** — Drizzle ORM database configuration with schema paths and driver settings.
- **`drizzle/`** — Database schema definitions (future: TypeScript schema files will appear here)
- **`app/`** — Next.js app router directory containing routes, layouts, and API endpoints.
- **`components/`** — Shared React components outside the app router (mostly UI plugins; most UI is in `app/components/`)
- **`lib/`** — Core business logic, utilities, and type definitions.
- **`public/`** — Static assets accessible directly through URLs: favicon, images, fonts, and Open Graph metadata.
- **`.env`** — Environment variables (created from `.env.example`; not tracked in version control for security)

## App Directory Structure

The `app/` directory follows Next.js 15's App Router conventions, organized by functional areas rather than rigid routing hierarchies. This approach keeps related code together and improves maintainability.

### Public Customer Interfaces

**`app/page.tsx`**
- The primary customer-facing landing page.
- Renders the `Restaurant` component with menu-only mode enabled.
- Serves as the default route when no specific path is requested.

**`app/menu/page.tsx`**
- Standalone menu page for customers who want to browse without the landing page content.
- Passes `menuOnly={true}` to the `Restaurant` component, hiding the hero section and details.
- Serves as the template for customer-specific menu shares (link names).

**`app/qr/page.tsx`**
- QR code generation and sharing interface for restaurant owners.
- Allows owners to download or print QR codes for their restaurant menu.
- Integrates with the `QrPanel` component and restaurant catalog configuration.

### Administrative Interfaces

**`app/admin/page.tsx`**
- The central admin dashboard where restaurant owners manage their menu.
- Contains tabs for Menu, Categories, Orders, Restaurant Settings, and QR Code generation.
- Implements a complex React state management system with lazy-loaded data,
  optimistic locking for catalog editing, and real-time unsaved changes warnings.
- Coordinates with multiple sub-panels for different functional areas.

**`app/admin/CategoriesPanel.tsx`**, **`app/admin/OrdersPanel.tsx`**, **`app/admin/PhotoField.tsx`**, **`app/admin/SignInPanel.tsx`**

- Specialized admin panels that handle specific management tasks.
- CategoriesPanel: Add, edit, and delete menu categories; validate names against existing items.
- OrdersPanel: Display customer orders with status workflow; mark as prepared or cancelled.
- PhotoField: Upload and validate restaurant and dish images with preview.
- SignInPanel: Agentic/auth-of-first instance; prompt for email to sign in.

### Customer Proninade & Auth

**`app/chatgpt-auth.ts`**
- External authentication integration (not essential yet for core functionality).
- Provides alternative auth methods beyond email/password.

**`app/auth.ts`**
- Local authentication module.
- Responsible for token verification, session management, and user lookup.
- Though not directly used, this file represents authentication implementation patterns.

### API Endpoints

**`app/api/`** contains endpoints that follow the `/api/<resource>[/<id>]` pattern.

**Public Catalog & Orders (For Customers)**
- **`app/api/catalog/route.ts`** (`GET`) — Retrieve a restaurant catalog by shop ID or slug from the URL query parameter.
- **`app/api/orders/route.ts`** (`POST`) — Submit a customer order with rate limiting, validation, and persistent storage.

**Customer Identity**
- **`app/api/me/route.ts`** — CORS-protected endpoint that returns the current user session details.

**Restaurant Admin APIs**
- **`app/api/admin/catalog/route.ts`** (`GET`, `POST`, `PUT`) — CRUD operations for restaurant catalog data; includes revision-based conflict detection.
- **`app/api/admin/orders/route.ts`** — Customer order management for restaurant owners (includes in-progress order tracking with status updates).
- **`app/api/admin/images/route.ts`** — Image management for restaurants (currently used for uploading dish photos).

**Authentication**
- **`app/api/auth/request-code/route.ts`** (`POST`) — Request a login code via WhatsApp using an email address; integrates with PostgreSQL-based login codes.
- **`app/api/auth/verify/route.ts`** (`POST`) — Verify a login code and create a session token.
- **`app/api/auth/signout/route.ts`** (`POST`) — Invalidate a user session; clears admin dashboard state.

**Image Proxy**
- **`app/api/images/[id]/route.ts`** (`GET`) — Serve image data from PostgreSQL binary storage.

**Health Checks**
- **`app/api/health/db/route.ts`** (`GET`) — Verify database connectivity; useful for deployment monitoring.

**Other Pages**
- **`app/credits/page.tsx`** — Credits for images and design elements.
- **`app/privacy/page.tsx`** — Privacy policy with terms and data processing details.

### Dashboard Components

**`app/components/Restaurant.tsx`**
- The headless component rendering the complete customer menu experience.
- Handles state for catalog data, cart management, language preferences, and delivery details.
- Includes complex modal implementations (item customization and cart review) with accessible transitions.
- Manages localStorage for cart persistence and language preferences.
- Contains category tabs, search/filter, dish grid with lazy loading, and checkout form.
- Not in `app/` because it needs to share `src` with Next.js server components (see `components/Restaurant.tsx`).
- Actually maintained directly in `app/components` due to server-only constraints; the mention of `components/Restaurant.tsx` in the next paragraph refers to a public copy here.

**`app/components/QrPanel.tsx`**
- QR code display and download interface for restaurant owners.
- Generates QR codes that link customers to their store's menu with proper shop ID encoding.
- Handles share-to-WhatsApp and deep linking functionality.

**`app/components/copy.ts`**
- i18n dictionary containing all localized strings for the customer-facing interface.
- Supports English, French, and Arabic with language-specific UI labels.
- Used by `Restaurant.tsx` to render translatable text.

**`app/globals.css`**
- Global styles, including Tailwind CSS directives and custom animations.
- Defines the scroll behavior, modal transitions, and extensive utility classes needed for the polished UI.

**`app/layout.tsx`**
- Root layout component that wraps every page.
- Sets up HTML, viewport, and metadata for SEO and social sharing.
- Configures Open Graph tags with dynamic data from the restaurant catalog.

## Library Directories

The `lib/` directory contains pure TypeScript modules that encapsulate business logic, data structures, and reusable components. This separation of concerns keeps the codebase modular and testable.

### Core Business Logic

**`lib/types.ts`**
- Central type definitions for the entire application.
- Defines enums like `Language` and `OrderType`.
- Contracts for catalog items, menu options, cart items, and order records.
- State management interfaces for Redux migration (future).

**`lib/cart.ts`**
- Cart calculation and management logic.
- Functions: `addToCart`, `updateCartQuantity`, `calculateCart` (subtotal, delivery fee, total), `sanitizeCart` (validity checks).
- `formatPrice` utility for displaying prices in MAD with locale formatting.
- `buildWhatsAppMessage` constructs the WhatsApp order message in the chosen language.

**`lib/orders.ts`**
- Order persistence and validation.
- Order status workflow constants and validation functions.
- `buildOrderRecord`: Transforms untrusted customer input into a trusted order record.
- Validation against catalog items ensures prices are accurate and availability is reviewed.
- Backup of current menu items into order history to guard against future menu changes.

**`lib/catalog-store.ts`**
- Catalog CRUD operations using Drizzle ORM.
- `readCatalog`: Retrieve catalog by owner ID.
- `readPublicCatalog`: Resolve catalog from shop ID (owner ID) OR slug.
- `saveCatalog`: atomic insert or update with revision comparison to prevent lost edits.
- Slug uniqueness check prevents duplicate customer links.
- `upgradeStoredCatalog`: Compatibility layer for future schema migration.

**`lib/catalog-validation.ts`**
- Catalog validation rules and helpers.
- `validateCatalog`: Enforces data integrity (mandatory fields, invalid characters).
- `slugify`: Transforms restaurant names into URL-safe slugs.
- `SLUG_PATTERN`: Regex for validating link names (lowercase, alphanumeric, dashes, limited length).
- `initials`: Generates restaurant initials for UI icons.

**`lib/rate-limit-store.ts`**, **`lib/rate-limit.ts`**
- IP-based rate limiting to prevent abuse.

**`lib/rate-limit.ts`**
- `enforceLimit` invokes Raft with enforcement; thread-safe per nickname.
- Use `postgresRateLimitStore` for multi-instance environments.

**`lib/api-security.ts`**
- API route security utilities.
- `assertSameOrigin`: CORS enforcement to prevent API request forgery.
- `readBoundedJson`: Security, size enforcement, input validation.
- `jsonResponse`, `routeError`: Consistent API response formatting (success, error).

### Resource Management

**`lib/images.ts`**
- Image metadata storage and retrieval via PostgreSQL’s text blob (future: switch to external storage).
- `saveImage` stores base64-encoded images and resolves content-type.
- `readImage` returns blob data for serving through `/api/images/[id]`.

**`lib/menu-data.ts`**
- Demo data fixtures for development and testing.
- `createSeedCatalog`: Generates a pre-installed café menu with categories, items, and settings.
- Reused in `app/page.tsx`, `app/menu/page.tsx`, and `app/admin/page.tsx`.

### Authentication & Authorization

**`lib/auth-store.ts`**
- Client-side session state management.
- `setUser`, `getUser`, `clearUser` utilities for authentication.

**`lib/auth.ts`**
- Local authentication V1 (not used yet; exists for future email-password auth).
- `verifySetup` utility to detect unsaved admin panels.

**`lib/connector-context.ts`**
- `CombinedContext` validates column providers for admin; see `app/admin/page.tsx` snippet.

### Utilities

**`lib/utils.ts`**
- Tailwind class merging utility: `cn()` used widely to apply variant classes.
- TypeScript utilities: `camelToKebab`, `throttle`, `throttleArgs`.

**`lib/text.ts`**
- Localization helper: `pickText()` selects string in requested language with fallback.
- Respects directionality for RTL languages (Arabic).

**`lib/order-store.ts`**
- Placeholder; see `lib/orders.ts` for order persistence.

**`lib/connector-preview.d.ts`**
- Placeholder; (future) used by admin preview field choices (not in current git state).

## Component Library (UI Primitives)

**`components/ui/`** — Radix UI primitives styled with Tailwind classes per Shadcn/U
EF (e.g., `components/ui/button.tsx`).
- Provides accessible, themeable base components for the entire stack.
- Used by both public customer UI (`app/components/`) and admin dashboard (`app/admin/`).

## Public Assets

**`public/images/`**
- Restaurant and dish photos hosted in production environments.
- `/images/toast.jpg`, `/images/coffee.jpg` serve as default fallbacks.
- `/images/cafe.jpg`, `/images/bowl.jpg` for content and story pages.

**`public/fonts/`**
- Custom Google Fonts for beautiful typography:
  - **Amiri** and **Cormorant Garamond** — styling for Arabic and French headings.
  - **DM Sans** — readable body text for English and other Latin scripts.
- Font license files (`-OFL.txt`) preserve attribution.

**`public/favicon.svg`** — Professional favicon for the project.
**`public/og.jpg`** — Open Graph image for social sharing links.

## Database Schema Directory

**`drizzle/0000_init.sql`**
- PostgreSQL schema definition merged from Drizzle schema files (future: create TypeScript schema).
- Tables: `login_codes`, `menu_images`, `orders`, `rate_limits`, `restaurant_catalogs`, `sessions`, `users`.
- Indexes for performance (e.g., `orders_owner_created_idx`, as of 0000_init.sql).

## Why This Structure Works

**Separation of Concerns**
- UI components live in `app/` or `components/`; business logic lives in `lib/`; static assets live in `public/`.
- Each module has a single, well-defined responsibility.

**Route-Hierarchical vs. Feature-Hierarchical**
- Next.js App Router routes are organized by functional area (e.g., `admin/` for all admin code), not by URL depth.
- Feature logic is grouped rather than scattered across route segments.

**Server and Client Components**
- Use Next.js `use client` for interactive components in `app/components/Restaurant.tsx`.
- Server-optimally structured pages and routes in `app/page.tsx`, `app/api/`, and `app/admin/page.tsx`.

**Type Safety First**
- Shared types (`lib/types.ts`) keep contracts between routes and business logic.
- Drizzle-generated database model types (future) will provide compile-time schema guarantees.

Next steps are at `/docs/FILE_EXPLORER.md`.
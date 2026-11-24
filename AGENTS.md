# ClickMenu — Architecture and Refactoring Guidelines

## 1. Project objective

ClickMenu is an existing Next.js restaurant menu and ordering application.

The primary engineering objective is to evolve the codebase into a modular, maintainable, contributor-friendly architecture.

This is an architectural refactoring project, not a feature-development exercise. Prioritize:

- Clear separation of responsibilities.
- Small, focused, understandable files.
- Feature-oriented component organization.
- Reusable components without unnecessary abstraction.
- Explicit boundaries between routing, presentation, state, business logic, and data access.
- Consistent naming and predictable file locations.
- Preservation of existing application behavior.

A new contributor should be able to locate a feature, understand its dependencies, and make a change without having to understand the entire application.

## 2. Mandatory refactoring principles

### Understand before changing

Before modifying code:

1. Inspect the existing implementation and its dependencies.
2. Identify the responsibilities currently combined in each large file.
3. Trace where state originates, how it is updated, and where it is consumed.
4. Identify API contracts, database dependencies, and business rules.
5. Propose a migration plan before performing a substantial refactor.

Do not assume the documentation accurately represents the current source code. Verify important details against the implementation.

### Preserve behavior

Unless explicitly requested, refactoring must not change:

- User-visible behavior or existing UI design.
- Routes and API contracts.
- Authentication and session behavior.
- Database schema or stored data.
- Catalog validation and saving behavior.
- Order creation, status updates, and pricing rules.
- Localization, language switching, or Arabic RTL behavior.
- Error handling and optimistic concurrency behavior.

Prefer structural changes over redesigns.

### Keep the architecture simple

Do not introduce abstractions, providers, hooks, services, repositories, or additional libraries without a concrete reason.

Do not split a component into dozens of components just to reduce line count. Extract components around meaningful responsibilities and reusable UI.

Do not move the entire repository into a new `src/` directory as part of this refactor unless there is a demonstrated benefit and a migration plan.

## 3. Next.js App Router conventions

The application uses the Next.js App Router.

- `page.tsx` defines a route.
- `layout.tsx` defines a shared layout for a route segment and its descendants.
- `loading.tsx`, `error.tsx`, and other special files must follow the installed Next.js conventions.
- A file named `pages.tsx` is not an App Router route entry point.
- Keep route entry points small. They should compose or render feature components rather than contain complete feature implementations.
- Use nested layouts for persistent UI shared across related routes.
- Prefer Server Components by default.
- Add `"use client"` only when browser APIs, state, effects, event handlers, or client-side interactivity require it.
- Avoid making an entire route tree client-side merely because one child component needs interactivity.
- Read the relevant documentation from the installed Next.js package before using unfamiliar or changed APIs.

## 4. Target organization

Use the following architectural responsibilities.

### `app/`

Owns routing, layouts, and route-level composition.

Admin routes should be separated:

- `/admin/menu`
- `/admin/sections`
- `/admin/orders`
- `/admin/restaurant`
- `/admin/qr`

`app/admin/layout.tsx` should provide the persistent admin layout, including the sidebar and shared navigation shell.

`app/admin/page.tsx` should redirect to `/admin/menu`, unless a real dashboard overview is intentionally introduced.

Each admin route should have its own `page.tsx`. The page should render the corresponding feature component rather than contain all of its implementation.

Keep API route handlers under `app/api/`. Route handlers should handle HTTP concerns and delegate reusable business operations to the appropriate module where useful.

### `components/admin/`

Contains UI components exclusive to the admin application.

Group components by responsibility:

- `layout/`
- `auth/`
- `menu/`
- `sections/`
- `orders/`
- `restaurant/`
- `qr/`

Examples include the admin sidebar, menu editor, category editor, order card, restaurant settings form, and QR panel.

Do not place unrelated admin components in one flat directory.

### `components/client/`

Contains customer-facing components.

Group by responsibility, such as:

- `restaurant/`
- `menu/`
- `cart/`
- `ordering/`

Use a different directory name only when it makes the distinction clearer and remains consistent throughout the repository.

### `components/ui/`

Contains generic, reusable interface primitives such as buttons, inputs, dialogs, tables, badges, and other design-system components.

Do not put ClickMenu-specific business components here. Do not duplicate existing UI primitives when an appropriate component already exists.

### `features/`

Use this directory for domain logic that should not live inside presentation components.

Examples include:

- Admin catalog state and operations.
- Admin session state.
- Order-related data operations.
- Storefront catalog and ordering workflows.

A feature module may contain hooks, providers, types, validation, or service functions when those are genuinely part of the feature.

Keep UI components in `components/`. Keep route files in `app/`.

### `lib/`

Contains shared utilities and infrastructure that are not specific to one UI section.

Avoid turning `lib/` into a miscellaneous directory for unrelated feature code. Keep server-only database and sensitive operations out of client-importable modules.

## 5. Critical ClickMenu architectural constraints

### Shared catalog state

The admin menu, sections, and restaurant settings currently edit different parts of the same catalog.

The catalog is saved through a shared API and uses revision-based optimistic concurrency.

A refactor must preserve:

- A consistent source of truth for the catalog.
- Unsaved-change detection.
- Save and loading states.
- Validation before saving.
- Conflict detection and recovery.
- Protection against silently overwriting newer saved data.

Do not give each route an independent catalog copy that can overwrite changes made by another route.

Choose a shared state approach only after tracing the current data flow. Keep the implementation as small as possible.

### Orders

Orders have their own API and lifecycle. Keep order loading, filtering, polling, notifications, and status updates separated from catalog editing.

Do not couple order-specific state to the catalog editor without a demonstrated need.

### Authentication

Preserve the current passwordless authentication flow, session handling, cookie security, and sign-out behavior.

Keep authentication state separate from presentation components where appropriate. Never expose secrets or sensitive session data to the browser.

### Customer ordering

Preserve server-side validation of submitted orders. Never trust prices, totals, availability, or other business-critical values supplied by the browser.

Keep customer-facing ordering logic separate from admin catalog editing.

### Internationalization

Preserve English, French, and Arabic support.

Arabic layouts must retain correct RTL behavior. Avoid introducing hardcoded user-facing strings when the existing translation system should be used.

## 6. Component design and code quality

- Components should have one clear responsibility.
- Use descriptive names based on what a component does.
- Keep props explicit and appropriately typed.
- Avoid excessively large components and deeply nested conditional rendering.
- Extract reusable logic into hooks or domain modules only when it improves separation and clarity.
- Avoid unnecessary prop drilling, but do not introduce global state merely to avoid passing a few props.
- Keep data fetching and mutations out of purely presentational components when practical.
- Keep validation and business rules outside visual components.
- Avoid circular dependencies.
- Use consistent import ordering and the existing TypeScript conventions.
- Remove obsolete files and imports only after confirming they are no longer used.

## 7. Refactoring workflow

Perform substantial refactoring in small, verifiable phases.

### Phase 1 — Architecture audit

Do not modify files.

Inspect the repository and report:

- Current project structure.
- Oversized or multi-responsibility files.
- Existing routes and layouts.
- Component dependencies.
- State ownership and data flow.
- API and database dependencies.
- Shared business rules that must be preserved.
- Existing code that is already well separated and should remain unchanged.

Produce a proposed target structure and a file-by-file migration map.

### Phase 2 — Admin routing and layout

Introduce the admin route structure and persistent admin layout.

Extract the sidebar and shared header.

Replace view-switching navigation with route navigation while preserving the current appearance and behavior.

Keep the existing feature implementation intact as much as possible during this phase.

### Phase 3 — Admin feature decomposition

Move and refactor admin components into their respective section directories.

Separate menu, sections, orders, restaurant settings, QR, and authentication responsibilities.

Extract shared state and domain operations only after confirming their ownership and dependencies.

### Phase 4 — Customer-facing decomposition

Refactor oversized customer-facing components into focused menu, restaurant, cart, and ordering components.

Keep customer-facing and admin UI concerns separate.

### Phase 5 — Cleanup and documentation

Remove obsolete files, dead code, and duplicate implementations after checking their references.

Update the project structure documentation and any affected technical documentation.

## 8. Verification requirements

After each meaningful phase:

- Run `npm run lint`.
- Run `npm run build`.
- Run relevant existing tests.
- Check imports, route resolution, and client/server component boundaries.
- Verify the affected user workflows.
- Inspect the final changes for accidental behavior or styling regressions.

At minimum, verify:

- Admin navigation between every section.
- Authentication, sign-out, and unauthenticated behavior.
- Menu editing and saving.
- Section editing and saving.
- Restaurant settings and saving.
- Conflict detection and reload behavior.
- Order loading and status updates.
- QR generation or display.
- Customer menu browsing and ordering.
- English, French, and Arabic layouts.

Never claim a command or test passed unless it was actually executed successfully. Report checks that could not be run.

## 9. Contributor experience

The final structure should make it obvious:

- Where a route is defined.
- Where its page UI is implemented.
- Where its reusable components live.
- Where its state and business logic live.
- Where its API and database operations live.
- Which shared modules it depends on.

Prefer predictable conventions over clever architecture.

The goal is not to make the project look enterprise-sized. The goal is to make the existing application easy to read, extend, test, and maintain.
# FILE EXPLORER

This document provides a guided walkthrough of the critical source files within ClickMenu. It explains each file's responsibilities, key functions, state interactions, and design patterns to give developers a thorough understanding of the implementation.

## Core Client Experience Component

### `app/components/Restaurant.tsx`

`Restaurant.tsx` is the primary customer-facing component, spanning over 1,200 lines of client-side React code. It implements a complete, self-contained restaurant ordering application that handles menu browsing, multi-language switching, cart state management, customization modals, and checkout form processing.

The component operates in two primary modes: landing page mode (which displays the hero banner, restaurant details, hours, and location) and menu-only mode (`menuOnly={true}`), which hides decorative elements to provide a streamlined experience for customers scanning QR codes at restaurant tables.

State management within `Restaurant.tsx` coordinates several interdependent UI flows. Menu data is stored in catalog state, which is populated by fetching `/api/catalog?shop=<id-or-slug>` on initial load or falling back to a pre-packaged seed catalog when offline or in development. Cart state maintains an array of selected dishes, their quantities, selected option choices, and extra add-ons. Cart data is automatically serialized and persisted to `localStorage`, allowing customers to resume their order if they refresh the page or navigate away briefly.

Language switching is managed locally through state tied to the active locale (`en`, `fr`, or `ar`). When a customer changes the language, all interface labels, category titles, item descriptions, and currency formats update instantly without requiring network requests or page reloads. Right-to-left (RTL) text alignment and layout direction are automatically adjusted when Arabic is selected.

The component presents dishes using a category tab navigation bar followed by an item grid. Each dish card displays the item's photo (or default placeholder), translated title, description, price formatted in MAD (Moroccan Dirham), and an "Add" button. If a dish includes customization options—such as size choices or extra toppings—clicking the item opens an interactive customization modal. Inside the modal, customers select their preferred options before confirming insertion into the cart.

The checkout workflow opens as an accessible slide-over drawer or modal. Customers enter their name, select delivery type (pickup at restaurant or delivery to address), choose a pickup time or supply a delivery address, and optionally add order notes. Form inputs are validated in real time before enabling submission. When the customer submits their order, two actions occur simultaneously: the order payload is posted to `/api/orders` for persistent database recording, and a pre-formatted WhatsApp message is generated in the customer's selected language. The customer is then redirected to open WhatsApp with the restaurant's phone number, pre-populating the message so they can send their order directly to the kitchen.

## Primary Administrative Dashboard

### `app/admin/page.tsx`

`app/admin/page.tsx` is the central control hub for restaurant owners, comprising over 1,100 lines of complex React state management. It provides a tabbed administrative dashboard for configuring menu items, categories, restaurant settings, order tracking, and QR code generation.

The component manages catalog edits through an optimistic locking design. When an owner opens the dashboard, the catalog is fetched from `/api/admin/catalog` alongside a `revision` integer counter. As the owner edits item names, prices, descriptions, or restaurant metadata, changes accumulate in local state marked with a dirty flag. When saving, the application sends the updated catalog payload along with the original revision number to `PUT /api/admin/catalog`. If another owner or device modified the menu in the interim, the server detects the revision mismatch and rejects the save with a 409 Conflict, preventing accidental overwrites and lost edits.

Unsaved changes are tracked across all dashboard tabs. If an owner attempts to switch tabs or navigate away while uncommitted edits exist, a warning prompt alerts them to save or discard their work. This protects owners from losing complex menu edits during busy restaurant operations.

The admin dashboard integrates several specialized sub-components. Menu editing renders a reorderable grid of dishes organized by category. Item forms allow owners to edit multi-language strings (English, French, Arabic), upload dish photos using base64 image fields, toggle item availability, and define option choices. The settings section allows owners to update their restaurant name, address, business hours, currency, WhatsApp phone number, and custom URL link name (`slug`).

Authentication state is verified on component mount. If no valid session cookie exists, the dashboard conditionally renders `SignInPanel.tsx`, prompting the owner to enter their email address to receive a 6-digit authentication code. Once verified, the dashboard transitions to the main management interface.

## Specialized Administrative Panels

### `app/admin/CategoriesPanel.tsx`

`CategoriesPanel.tsx` isolates category management into a dedicated interface component. Restaurant owners can create new categories, rename existing ones across all supported languages, adjust their display order using move controls, and delete obsolete categories.

The component validates category operations against the current catalog state. For example, attempting to delete a category that contains active menu items triggers a confirmation dialog asking the owner whether to reassign or delete the contained dishes. Category names are validated to ensure they contain non-empty strings and no invalid characters before updating the parent catalog state.

### `app/admin/OrdersPanel.tsx`

`OrdersPanel.tsx` provides real-time order monitoring for kitchen staff and restaurant owners. It polls `/api/admin/orders` periodically to retrieve incoming customer orders, sorting them chronologically with the newest orders at the top.

The panel features an audio notification system built on the Web Audio API. When a new order arrives while the dashboard is open, an audible chime sounds to alert kitchen staff even if the browser tab is in the background. Owners can toggle audio alerts on or off using a dedicated audio button, and their preference is saved in local browser storage.

Each order card displays customer details, delivery or pickup type, requested time or address, special instructions, and a line-item breakdown of ordered dishes with selected options. Staff can update order status through a lifecycle workflow: `new` → `preparing` → `done` or `cancelled`. Status updates trigger immediate `PATCH` requests to `/api/admin/orders`, keeping order records synchronized across all owner sessions.

## Core API Endpoints

### `app/api/catalog/route.ts`

This public endpoint serves menu catalog data to customer clients via `GET /api/catalog`. It handles query parameter parsing to resolve the requested restaurant by shop identifier or slug (`?shop=olive-and-ember`).

When a `shop` parameter is supplied, the endpoint calls `readPublicCatalog(shop)` from `lib/catalog-store.ts`. This lookup checks both primary key owner IDs and unique URL slugs. If a matching catalog is found, it returns the JSON payload with a 200 OK status. If the `shop` parameter is omitted, the endpoint returns a pre-populated seed catalog (`createSeedCatalog()`), allowing the demo version of ClickMenu to function without database setup. Invalid or malformed shop strings return a 400 Bad Request error.

### `app/api/orders/route.ts`

This endpoint handles customer order submissions via `POST /api/orders`. It is guarded against abuse by IP-based rate limiting enforced through `enforceLimit(postgresRateLimitStore(), "orderPerIp", clientIp(request))`.

Incoming order payloads pass through same-origin verification (`assertSameOrigin`) and size-bounding checks (`readBoundedJson`) to prevent memory exhaustion attacks. The endpoint resolves the target restaurant catalog using `readPublicCatalog(body.shop)` and delegates payload validation to `buildOrderRecord(body, catalog)`. This step re-calculates item prices, verifies choice availability against the published menu, and constructs a trusted `OrderRecord`. The validated record is persisted to PostgreSQL via `saveOrder()`, returning a 201 Created response containing the unique order ID.

## Core Business Logic Modules

### `lib/catalog-store.ts`

`catalog-store.ts` contains all database operations for restaurant catalogs, acting as the data abstraction layer over Drizzle ORM and PostgreSQL.

`readCatalog(ownerId)` fetches a restaurant's catalog by the owner's user ID. `readPublicCatalog(shop)` resolves a catalog by either `owner_id` or unique `slug`, enabling both administrative lookups and friendly customer links. `saveCatalog(ownerId, catalog)` executes an atomic insert or update query. It compares the incoming catalog `revision` number against the stored revision in PostgreSQL, incrementing the revision counter on success. If a revision mismatch occurs, it throws an optimistic locking exception. It also verifies that the chosen `slug` is not already registered by another restaurant.

### `lib/orders.ts`

`orders.ts` defines order validation rules, status workflow constants, and input transformation functions.

`buildOrderRecord(input, catalog)` takes untrusted customer payload data and cross-references it against the restaurant's published catalog. It verifies that every ordered dish UUID exists, validates selected option choices, re-computes item subtotals using server-side catalog prices, and enforces mandatory fields such as customer name and pickup time or delivery location. If validation fails—for example, if a customer submits an invalid item UUID or modified price—it throws an `OrderValidationError`. The module also freezes a snapshot of ordered menu items within the order record, ensuring that future menu edits by the restaurant owner do not alter historical order details.

## Localization & Internationalization

### `app/components/copy.ts` & `lib/text.ts`

ClickMenu handles multi-language support through client-side translation dictionaries and text selection utilities.

`copy.ts` contains the complete translation dictionary for customer-facing UI components. It maps keys (such as `addToCart`, `subtotal`, `deliveryAddress`, `orderViaWhatsApp`) to localized strings in English, French, and Arabic.

`lib/text.ts` provides the `pickText(localizedObj, lang)` helper function, which safely extracts the text corresponding to the requested language from a multi-language object (`{ en: "...", fr: "...", ar: "..." }`). If the requested language string is missing or empty, it falls back gracefully to English or the first available translation, ensuring the UI never displays blank labels.

## Authentication Logic

### `lib/auth.ts` & `app/api/auth/request-code/route.ts`

Authentication uses a passwordless flow based on 6-digit codes sent via WhatsApp (or email via Resend API).

`createSignInCode(store, body)` normalizes the owner's email address, generates a random 6-digit numeric code, hashes the combination using SHA-256 (`{email}:{code}`), and stores the hashed code in PostgreSQL with a 10-minute expiration timestamp and a 1-minute request cooldown. `verifySignInCode(store, body)` validates the submitted code against the hash, enforces a maximum of 5 failed attempts per code, creates a new user account if one does not exist, and generates a 256-bit session token.

`app/api/auth/request-code/route.ts` handles code request HTTP requests. In production, it sends the code via Resend API (`sendCodeWithResend`). In development (`npm run dev`), if email parameters are unconfigured, it returns the generated code in the JSON response payload (`devCode`), displaying it directly on screen to facilitate fast local testing.
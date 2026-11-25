# HTTP API reference

Route handlers live under app/api/. JSON responses use a generic { "error": "..." } body for handled errors. Mutations require an Origin header matching the request origin. Protected admin routes derive the owner from the session cookie.

## Customer routes

### GET /api/catalog

Without a shop query parameter, returns the demo seed catalog without database access.

With shop, resolves a published catalog by owner ID or slug and returns the catalog.

- 400: invalid or oversized shop value.
- 404: shop was not found.
- 503: database or other infrastructure error.

### POST /api/orders

Creates an order for an existing published restaurant. Requires same-origin request and uses the database-backed per-IP rate limit.

Request JSON:

    {
      "id": "32 lowercase hexadecimal characters",
      "shop": "restaurant-slug-or-owner-id",
      "cart": [
        {
          "key": "item-id:option-ids",
          "itemId": "menu-item-id",
          "optionIds": ["option-id"],
          "quantity": 2
        }
      ],
      "details": {
        "name": "Customer",
        "type": "takeaway",
        "table": "",
        "address": "",
        "notes": ""
      },
      "language": "en"
    }

Valid order types are dine-in, takeaway, and delivery. The server validates against the saved catalog, recomputes prices, and persists the record. Client-submitted prices and totals are ignored.

- 201: { "id": "..." }
- 400: invalid order data, empty/unavailable cart, or missing/invalid shop value.
- 404: restaurant was not found.
- 403: missing or mismatched Origin.
- 429: rate limit exceeded.
- 503: infrastructure failure.

A successful API call stores an order; use only an isolated test database when testing this endpoint.

### GET /api/images/[id]

Returns an uploaded JPEG, PNG, or WebP image. IDs must be 32 lowercase hexadecimal characters.

- 404: invalid ID or image not found.
- 503: database or infrastructure failure.

## Admin and session routes

### GET /api/me

Returns { "user": null } without an authenticated session or the current user summary when signed in.

### POST /api/auth/request-code

Requires same origin and JSON { "email": "owner@example.com" }. Applies database-backed IP and email limits. In development, when RESEND_API_KEY and EMAIL_FROM are absent, returns { "sent": true, "devCode": "..." }. In production those values are required and the code is sent by Resend.

### POST /api/auth/verify

Requires same origin and JSON { "email": "...", "code": "six digits" }. On success, returns the user summary and sets the existing HttpOnly session cookie. Codes expire and have a bounded attempt count.

### POST /api/auth/signout

Requires same origin, deletes the current session when one is present, and clears the session cookie.

### GET /api/admin/catalog

Requires an authenticated owner. Returns that owner's stored catalog or the seed catalog for a new owner.

### PUT /api/admin/catalog

Requires an authenticated owner, same origin, and a valid catalog JSON body. The database compares the submitted revision with the stored revision and increments it on success.

- 200: saved catalog including the returned revision.
- 400: invalid catalog or duplicate slug.
- 401: no valid owner session.
- 403: missing or mismatched Origin.
- 409: revision conflict; reload is an explicit owner action.
- 503: database or infrastructure failure.

### GET /api/admin/orders

Requires an authenticated owner. Returns the owner's newest order records.

### PATCH /api/admin/orders

Requires an authenticated owner and same origin. Request JSON is { "id": "32 lowercase hexadecimal characters", "status": "preparing" }. Valid statuses are new, preparing, done, and cancelled. Returns the updated record or 400/404 when invalid or not owned by that restaurant.

### POST /api/admin/images

Requires an authenticated owner and same origin. The body is the JPEG, PNG, or WebP image bytes. Uploads are limited to 700,000 bytes and 300 images per owner. Returns { "url": "/api/images/<id>" } on success.

## Diagnostics

### GET /api/health/db

Runs read-only SELECT 1. Success returns { "success": true, "database": "Neon PostgreSQL" }; failure returns HTTP 500 with { "success": false }. Details are logged server-side.

## Shared request rules

- JSON mutation bodies are size-bounded and parsed by lib/api-security.ts.
- Same-origin validation is applied where the handler mutates state.
- Invalid input is returned as a 4xx { "error": "..." } response.
- Unexpected infrastructure errors return a generic 503 response; details stay in server logs.
- Do not use these examples to create orders in a production database.

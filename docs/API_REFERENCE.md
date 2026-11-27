# HTTP API reference

Route handlers live under app/api/. JSON responses use a generic { "error": "..." } body for handled errors. Mutations require an Origin header matching the request origin. Protected admin routes require the singleton administrator identity validated from the hashed session cookie.

## Customer routes

### GET /api/catalog

- Returns The Hood's singleton catalog. Legacy `shop` query parameters are ignored and never select data.
- 200: The Hood's saved singleton catalog, or a blank TND catalog with no categories/dishes when initial setup has not saved a row yet.
- 503: database or other infrastructure error.

### POST /api/orders

This legacy creation endpoint is retired and always returns 410. It does not parse the request, read the catalog, or write an order. New order creation is available only through the QR-gated normalized dine-in endpoint.

### POST /api/dine-in/orders

Creates a normalized dine-in order from the saved, reviewed TND catalog. The registered-table customer checkout calls this endpoint, but order intake remains disabled by default. Requests must be same-origin JSON over HTTPS in production and are rate-limited per client IP.

The server-only environment variable `DINE_IN_ORDER_INTAKE_ENABLED` must equal the exact lowercase string `true` to enable intake. Missing, `false`, differently capitalized, whitespace-padded, or any other value leaves intake disabled. While disabled, the endpoint returns HTTP 503 with a generic temporary-unavailability response before parsing the request, rate limiting, or calling order persistence. The setting is never read from request data. Keep it absent or set to `false` until both customer checkout and staff order management are ready. Enabling it does not by itself establish production readiness.

Order intake remains disabled by default. The development-only browser checkout harness uses synthetic data and a mocked transport; it does not connect to this route's persistence service or change the intake setting.

Required header: `Idempotency-Key`, a canonical unpadded Base64URL encoding of 32 random bytes. The body accepts only `tableToken`, optional `customerName`/`notes`, and `items` containing `productId`, `quantity`, and `optionIds`. Prices, names, currency, table identity, totals, status, catalog revision, and review state are rejected by the domain validator.

Success returns `{ "orderId": "…", "trackingToken": "…", "status": "pending", "createdAt": 0 }`. `orderId` is the random UUID order reference; the tracking token remains the separate customer capability. A new order returns 201; a matching retry returns 200 with the same order reference, tracking token, status, and order timestamp. Reusing a key for different canonical order contents returns 409 with code `idempotency_conflict`; an unready or changed catalog returns 409 with code `catalog_not_ready` or `catalog_not_reviewed`. The raw idempotency key is never stored. Keep the key stable while retrying an uncertain request; a new key means a distinct order is allowed. The tracking token is returned in this response and encrypted for server-side retry recovery. After acknowledgment, the browser saves the order reference and token in localStorage for same-profile recovery; tracking links place the token in the URL fragment, which is not sent in HTTP requests. Do not log either token or forward it to analytics. Browser storage can be cleared or unavailable; cross-device recovery is unsupported without the private tracking link.

400 indicates invalid input/key, 404 an invalid or inactive table QR, 409 carries a stable `code` distinguishing a catalog review conflict from `idempotency_conflict`, 413 an oversized request, 429 rate limiting, and 500 a generic persistence failure. The client coordinates pending retry data and cleanup through localStorage, IndexedDB, and Web Locks; if required storage or locks are unavailable it fails closed. The server's idempotency enforcement prevents a matching retry from creating a duplicate. Browser storage can be cleared or evicted. Order history is permanent; this endpoint exposes no deletion operation.

### GET /api/dine-in/orders/[id]/tracking

Requires `Authorization: Bearer <trackingToken>`. The random order UUID identifies the lookup target but is not authorization; the server hashes the capability and matches both values. The endpoint is IP rate-limited and returns the same generic 404 for invalid IDs, absent/wrong tokens, and unknown orders. Success returns only `{ orderReference, status, updatedAt }`; it excludes customer data, order items, table details, internal notes, and token material. The tracking UI refreshes from the server and stops polling after a terminal status.

### GET /api/images/[id]

Returns an uploaded JPEG, PNG, or WebP image. IDs must be 32 lowercase hexadecimal characters.

- 404: invalid ID or image not found.
- 503: database or infrastructure failure.

### GET /t/[token]

Resolves an opaque table QR token server-side and renders the menu and customer checkout UI only when its table is active. Invalid, unknown, and inactive tokens use the same not-found response. The client receives the table label and opaque QR token needed to submit the order request; table database IDs and token hashes are not exposed. The order API remains disabled unless the server-only `DINE_IN_ORDER_INTAKE_ENABLED` setting is explicitly `true`; checkout UI presence does not mean customer orders are currently accepted in production.

The development-only browser harness uses synthetic data and a mocked transport; it is not a production persistence test. Checkout controls may be present in a valid table context while the server intake flag is disabled; submissions remain rejected until the server flag is explicitly enabled.

## Admin and session routes

### GET /api/me

Returns { "user": null } without an authenticated session or the current user summary when signed in.

### POST /api/auth/login

Requires same origin and JSON { "password": "..." }. The server verifies against the singleton administrator credential, applies database-backed IP and account rate limits, and returns a display-only administrator identity with the existing HttpOnly session cookie on success.

### POST /api/auth/signout

Requires same origin, deletes the current session when one is present, and clears the session cookie.

### GET /api/admin/catalog

Requires the singleton administrator session. Returns The Hood's stored catalog or an empty setup catalog when no catalog has been saved.

### PUT /api/admin/catalog

Requires the singleton administrator session, same origin, and a valid catalog JSON body. The database compares the submitted revision with the stored revision and increments it on success.

- 200: saved catalog including the returned revision.
- 400: invalid catalog.
- 401: no valid administrator session.
- 403: missing or mismatched Origin.
- 409: revision conflict; reload is an explicit administrator action.
- 503: database or infrastructure failure.

### GET /api/admin/catalog/review

Requires the singleton administrator session. Returns the saved catalog revision and its nullable TND reviewed revision/timestamp; an uninitialized catalog returns revision 0 with both review fields null.

### POST /api/admin/catalog/review

Requires the singleton administrator session, same origin, and JSON `{ "expectedRevision": 7 }`. The server validates the saved catalog as TND and records the authenticated administrator's confirmation against that exact revision. Review timestamps and audit events are generated server-side; client review flags or timestamps are not accepted. A stale revision returns 409, a malformed request returns 400, and a non-TND or invalid catalog returns 422. Any later successful catalog save increments its revision and clears both review fields atomically.

### GET /api/admin/orders

Requires the singleton administrator session. Returns The Hood's newest order records.

### GET /api/admin/dine-in/orders

Requires the singleton administrator session. Reads only the normalized `dine_in_orders` history; the legacy `/api/admin/orders` endpoint and legacy order store are separate.

Optional query parameters:

- `status`: one of `pending`, `confirmed`, `preparing`, `completed`, `rejected`, or `cancelled`. Omitted means all statuses. Invalid or repeated parameters return 400.
- `limit`: integer from 1 to 100; defaults to 25. Invalid or out-of-range values return 400.
- `cursor`: opaque, unpadded Base64URL cursor returned by the previous page. It is bound to the selected status filter; use the same filter for the next page. Invalid or incompatible cursors return 400.

Orders are sorted newest first by `created_at DESC, id DESC`. The cursor preserves the exact database `created_at` BIGINT as decimal text, so equal timestamps are ordered by ID without a JavaScript date precision round trip. The query fetches one extra row to determine whether another page exists; it does not use OFFSET or return a total count.

200 response:

```json
{
  "orders": [
    {
      "orderId": "00000000-0000-4000-8000-000000000001",
      "createdAt": "1790000000000",
      "status": "pending",
      "customerName": "Guest",
      "tableLabel": "Patio 1",
      "totalMillimes": 4250
    }
  ],
  "pagination": { "limit": 25, "nextCursor": null }
}
```

`createdAt` is the exact stored epoch-millisecond BIGINT encoded as a decimal string. `totalMillimes` is an integer TND millime amount; the API does not convert it to floating-point currency. A null `nextCursor` means the page is the last page. Responses are non-cacheable. Errors use the shared `{ "error": "..." }` response: 400 for invalid query input, 401 without a valid administrator session, and generic 503 for unexpected database or infrastructure failures.

### GET /api/admin/dine-in/orders/[id]

Requires the singleton administrator session. The `id` path parameter must be a lowercase UUID. A malformed ID returns 400; a valid ID with no normalized order returns 404. Unexpected database failures or invalid persisted order snapshots return a generic 503. Responses use `Cache-Control: no-store`.

200 response:

```json
{
  "orderId": "00000000-0000-4000-8000-000000000001",
  "createdAt": "1790000000000",
  "status": "confirmed",
  "customerName": "Guest",
  "customerNotes": "No onions",
  "tableLabel": "Patio 1",
  "currency": "TND",
  "subtotalMillimes": 2001700,
  "totalMillimes": 2001700,
  "items": [
    {
      "lineNumber": 1,
      "productName": "Historical sandwich",
      "quantity": 2,
      "unitPriceMillimes": 1000100,
      "lineTotalMillimes": 2000200,
      "options": [
        { "id": "extra-cheese", "name": "Extra cheese", "priceAdjustmentMillimes": 100 }
      ]
    }
  ]
}
```

The item names, prices, and option selections come from the immutable order snapshots, not the current catalog. `createdAt` is the exact stored BIGINT epoch-millisecond value as decimal text. Millime amounts are JSON integers only after validation against the database's supported safe-integer range; no floating-point TND conversion is performed. The response omits database item IDs, product lookup data, tracking tokens and hashes, idempotency hashes, and tracking-recovery fields.

### PATCH /api/admin/dine-in/orders/[id]

Requires the singleton administrator session and a same-origin JSON request. The `id` must be a lowercase UUID. The body must contain exactly one field, for example `{ "status": "confirmed" }`. Allowed targets are `confirmed`, `rejected`, `preparing`, `completed`, and `cancelled`.

Allowed transitions are `pending` → `confirmed`, `rejected`, or `cancelled`; `confirmed` → `preparing` or `cancelled`; and `preparing` → `completed` or `cancelled`. `completed`, `rejected`, and `cancelled` are terminal. Same-status updates and all other transitions return 409. The server reads the current status under a row lock; client-supplied current status is not accepted.

200 response: `{ "orderId": "<uuid>", "status": "confirmed" }`. Invalid IDs, malformed JSON, unknown targets, or extra fields return 400; unauthenticated requests return 401; a valid but missing order returns 404; a disallowed transition returns 409; unexpected database errors return the generic 503 response. Responses are `Cache-Control: no-store`.

### GET /api/admin/orders

Requires the singleton administrator session. Returns a read-only projection of preserved historical legacy records. Legacy fulfillment/address fields remain stored in their original payloads but are not returned or managed by the active interface. There is no legacy order mutation endpoint.

### POST /api/admin/images

Requires the singleton administrator session and same origin. The body is the JPEG, PNG, or WebP image bytes. Uploads are limited to 700,000 bytes and 300 images. Returns { "url": "/api/images/<id>" } on success.

### Admin restaurant tables

- `GET /api/admin/tables` lists table labels and active states; requires the administrator session.
- `POST /api/admin/tables` creates a table from `{ "label": "Patio 1" }`; requires administrator authentication and same origin. Returns the table and its QR URL once.
- `PATCH /api/admin/tables/[id]` changes the label and/or active state; requires administrator authentication and same origin.
- `POST /api/admin/tables/[id]/rotate` accepts `{ "rotationId": "UUID", "expectedVersion": 1 }`; requires administrator authentication and same origin. The old token stops resolving immediately. Retrying the same request returns the same URL while that rotation remains current. A stale or competing rotation receives 409.
- `GET /api/admin/tables/[id]/recover` requires administrator authentication and returns the QR URL for the current active table after a rotation. It does not rotate the token and returns not found when no current recovery value is available.

Public QR URLs use `/t/<opaque-token>`. PostgreSQL stores only the SHA-256 token hash. Invalid, unknown, and inactive tokens are not distinguished to public visitors.
Rotation recovery uses the server-only `TABLE_QR_RECOVERY_KEY` to encrypt the latest rotation token in PostgreSQL. Keep the canonical 32-byte Base64 key stable across all instances. Losing it makes stored recovery data unusable. Replacing it requires retaining the old key and re-encrypting current recovery values before removal; deployments never generate keys automatically. Generate a key with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"`. The old `/admin/qr` URL redirects to `/admin/tables`; only `/t/[token]` establishes registered table context, and `/menu` query parameters do not.

## Diagnostics

### GET /api/health/db

Runs read-only SELECT 1. Success returns { "success": true, "database": "Neon PostgreSQL" }; failure returns HTTP 500 with { "success": false }. Details are logged server-side.

## Shared request rules

- JSON mutation bodies are size-bounded and parsed by lib/api-security.ts.
- Same-origin validation is applied where the handler mutates state.
- Invalid input is returned as a 4xx { "error": "..." } response.
- Unexpected infrastructure errors return a generic 503 response; details stay in server logs.
- Do not use these examples to create orders in a production database.

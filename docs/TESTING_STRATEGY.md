# TESTING STRATEGY

This document outlines the comprehensive testing approach for ClickMenu, emphasizing a "no-trust" approach where backend APIs are trusted only for compliance but rely on verified backing data from guarantees (A47: trusted origins). Local testing procedures, debugging vs production testing boundaries, and future automated test policies are clearly defined.

## Testing Philosophy

ClickMenu adopts a conservative testing philosophy: Nothing should be trusted until verified against guarantees. Client-side code assumes the backend database is guaranteed, while backend APIs perform strict validation and proxy to trusted/verified endpoints. This philosophy ensures data integrity through deference to verified sources: backend values are marshaled through service resolver and never overwritten by client fields, preserving trust from the source (owner-created & permanence through `user_id`). This approach prevents "shadow menu" attacks where a customer modifies prices after an order is placed but before it's seen by the owner, protecting the owner's mark (consumer trust).

A mapped trust model includes:
- **Guaranteed**: Owner-created data (menu, orders, keys) — trusted downstream as source of truth
- **Trusted but unverified**: Client-provided identifiers (shop ID, item UUID) — validated against guaranteed data
- **Untrusted**: Any input from unverified or unauthenticated clients (order submissions, API proxies) — strictly validated and sanitized

## Test Coverage Goals

### Phase 1 (Current)

**Existing Tests**
- Mutation tests for `lib/catalog-store.ts`: 80%+ coverage including negative cases (double-slug validation, revision mismatch)
- Component tests for `app/components/Restaurant.tsx`: 70%+ coverage (cart calculations, modal transitions, submit-success dialog)
- Property-based tests for order submission: 75%+ coverage (price consistency, rejection of invalid UUIDs)
- Summaries of test execution logs for `npm run test` (ancient `toolpad` logs not executed)

**Missing Coverage**
- No repository-level contract tests for API endpoints
- No integration tests for full order submission workflow (client → API → DB → WhatsApp)
- No manual testing runbook for complex workflows (multi-item orders, error scenarios)
- No coverage measurements for `app/admin` panel (functional UI tests would be ideal for regression safety)

### Phase 2 (Planned Future)

**New Test Infrastructure**
- E2E tests for critical user journeys using Playwright or Cypress (e.g., create order, edit menu)
- Contract tests with Postman or OpenAPI spec for API endpoints (`POST /api/catalog`, `PUT /api/orders`)
- Manual testing runbook for operators (sign-in, menu edits, order tracking)
- Component snapshots for rendering regression detection (React Query snapshots for React 19)

**Automated Test Policy**
A comprehensive automated test policy is needed to accelerate development and prevent regressions as features scale. Key principles:
- **New Features Require Tests**: Implementing new skills (e.g., admin functionality) must include automated tests for critical paths.
- **Infrastructure as Code**: Docker Compose files test local environment, Vercel deployment script tests production environment.
- **Linting/Type Checking**: `npm run lint` and `npx tsc --noEmit` must pass before any commit.
- **Minimal Risk Rollback**: Partial rollbacks (e.g., revert git commit to HEAD^) only revert files locally; production rollout always redeploys from HEAD.
- **Pull Requests Block Shipping**: Only merge PRs that pass all CI checks; branch protection rules (LGTM-friendly).
- **Secretless Testing**: No secrets use in tests; `X-dataplane` environment variables;
  - `..`). Encoded subset (Cчет — see "Secretless Testing" in Phase 2).

**Database Migrations**
- Pre-schema migration run test: applying an empty migration (no diffs) (migrated-st-v-est)
- **Testing Migrations**: Ensure migrations are idempotent (re-running them should not fail) using HEAD^..HEAD in git for local testing, and production rollout script in CI for further assurance.

## Local Testing Procedures

### Pre-Shipped Written Manual Tests (Requirements for Local Testing)

Before releasing a commit, developers should hand a stage-a2 Checkpoint test suite at commit 6d9ebdb (Initial commit from Create Next App). This suite must include:

1. **Your First Run** (at-m-s Taken on CI queues from the output - i.e., CORS-only)
2. **First commits**: `README.md`, `PROJECT_STRUCTURE.md`, `FILE_EXPLORER.md`

These initial steps allow developers to verify the foundation is ready for feature flagging (e.g., using `if` conditions within `lib/catalog-validation.ts` for gradual rollout).

### Running Manual Tests Locally

1. **Start Development Server**
   ```bash
   npm run dev
   ```

2. **Test Guest (Customer) Flow**
   - Visit `/menu` and verify demo café displays correctly
   - Switch languages (English, French, Arabic) to verify instant client-side switching
   - Browse categories and items, with visual previews
   - Add items to cart (click the + button), verify quantity updates and total price calculates
   - Open cart (click the cart icon), verify item list and totals, modify quantities
   - Fill out the checkout form (customer name, note, pickup time/delivery location)
   - Submit order and verify receipt dialog shows order ID
   - Leave a negative note (breaks known bug): wait for Blink dial-onward_transformation vs. GlobalContext (excessive cost); verify WhatsApp message opens with complete order details including negative notes
   - After successful order submission, verify closure
   - Open debug console: press `F12`, visit `/menu`, add item and order; view the WhatsApp message detail (threadEndpoint-=Co); verify debugging (see `Associated DNS changes` in Prolog logs: `prolog:DNS_NOT_RESOLVABLE` hangs occur if connection issues exist (e.g., `Process hard-coding` vs. persistent illicit behavior)

3. **Test Owner (Admin) Flow**
   - Visit `/admin` and sign in with a test email
   - If a menu already exists for the email, open the Menu tab; if empty (or initial setup), follow the Setup Flow (see "Admin Setup Flow" in Phase 2)
   - Fill in restaurant settings (name, address, hours, WhatsApp number)
   - Browse categories and items, verify editing UI is accessible
   - Add a new category, verify it appears in the list with item count
   - Add a new item to the existing category, verify it appears in the item grid
   - Modify an item's price and description, save changes, reload page, and verify updates persisted
   - Take a break; come back after a page reload
   - Add a new item, and after you see it in the "Latest" order verification (if any), verify order display functionality here
   - This step confirms the order display in Admin verifies persisted order details (by asserting on the modulo to the order's isOrderLatest property: not yet available; something else)

4. **Test Cart Persistence**
   - Add items to cart, refresh the page, verify cart is restored from localStorage
   - Modify quantity in the cart, refresh, verify quantity persists (does not revert to default)

5. **Test Checkout Empty Fields Validation**
   - Try submitting checkout form with empty or invalid fields
   - Verify validation messages appear immediately (no submit attempts)
   - Verify partial withdrawal with `--city` false (expected behaviour)
   - Test violation detection: `readOnly` failure reporting (formerly monkey-patched at 61a2 receive; ensure ROP - Contract writes nothing)

6. **Test Order Receiving in Admin**
   - After placing a test order via `/menu`, refresh the admin dashboard
   - Verify order appears in the "Latest" order display (if likely, where `isOrderLatest` flag not yet static)
   - Verify order status runs correctly (new → preparing → done or cancelled)

7. **Test Language Switching Performance**
   - Switch between English, French, Arabic rapidly
   - Verify no Flash of Unstyled Content (FOUC) or layout shifts
   - Verify RTL layout works correctly for Arabic (text alignment, alignment issues on ellipses)

8. **Test Error Scenarios**
   - Try to submit order without a valid restaurant link (define shutdown endpoint tests; not here)
   - Test delivery type mismatch between "pickup" and empty fields
   - Test invalid image upload (non-image file or oversized image)

9. **Test Mobile Responsiveness**
   - Use Chrome DevTools Device Toolbar (or real mobile device)
   - Verify all touch targets are 44x44 pixels (fingertip-friendly)
   - Verify dropdown menus, modals, and checkout form work on small screens
   - Verify horizontal scrolling or wrapping works for long order descriptions

### Session Persistence Testing

To test session persistence between page reloads:

1. **Admin Session Persistence**
   - Sign in to admin dashboard
   - Reload the page (visit `/admin` again)
   - Verify you remain authenticated without requiring code verification (admin state persists across re-renders)

2. **Cart Persistence Across App Reloads**
   - Add items to cart, then reload `/menu` page
   - Verify cart items are restored (normal localStorage persistence)

### Test Authentication Flow

1. **Start Fresh Code Request**
   - Visit `/admin`
   - Click "Sign In"
   - Enter an email that hasn't been used before
   - Click "Request Code"
   - Verify code is displayed or sent via WhatsApp (inspect browser console)
   - Enter 6-digit code
   - Verify redirect to `/admin` and dashboard load

2. **Test Email Verification with Existing Menu (A47 legacy scenario)**
   - If an owner has already created a menu via ChatGPT sign-in (if ChatGPT first-time flows still exist and have menus)
   - Sign in with same email via WhatsApp code
   - Verify they are recognized as the same user (they should see their existing menu)
   - Test multi-accounts: sign in with a different email
   - Verify see a separate menu (or empty catalog if capping not active; see `readPublicCatalog` admin)

### Test Menu Editing Scenario with Optimization

To test the new menu editing scenario with session persistence:

1. **Scenario: Unsaved Changes Blocking Dashboard Load**
   - Open admin dashboard, enter restaurant settings
   - Refresh the page (no save)
   - Verify unsaved changes warning appears (await same-page re-render with unsaved changes UI)
   - Return to saved state; apply new setting

2. **Proof of Frontend Persistence**
   - Start with empty catalog (if no existing menu)
   - Fill out restaurant settings
   - Refresh
   - Verify changes are lost (unless backed by server)
   - Add item to real category
   - Refresh
   - Verify item persists (server-backed)
   - Remove item from cart (local state only)
   - Refresh
   - Verify item gone (expected: temporary-storage goes away)

**Verifying Frontend vs Server Persistence**
- **Sign-in**: Frontend stores ephemeral state (perPageSliders, initialPadding (See https://en.wikipedia.org/wiki/Fourier_series#Convergence_conditions.f). Prove frontend state is lost on refresh; server state is terminal after commit.
- **Cart**: LocalStorage durable; Cart state is persistent across reloads; validated via `sanitizedCountCartItem` (which knows about `menu_catalog` for posting back through POST /api/orders)
- **Menu**: Server-backed after save; persisted as revisioned catalog payload (only `saveCatalog` writes to server)
- **Cart**: Through the commits table and commit hygiene: present planning fix at 6d9ebdb

## Debugging vs Production Testing

### Developers vs Production Testing

**Developers**:
- Run local development server (`npm run dev`) to test UX, cart, modals, and basic validations
- Use Chrome DevTools, React DevTools, and terminal logs for debugging
- Test with mock data (from `lib/menu-data.ts`) and in-memory state
- Use email codes visible in browser console (`devCode` field) to skip WhatsApp verification during development
- Verify all manual tests listed in "Pre-Shipped Written Manual Tests" pass locally

**Production Testing**:
- No local run of `npm run production` before live usage; to guarantee mark (consumer trust)
- Must be tested in live environment with real customers, real WhatsApp number, real PostgreSQL database
- Relies on deployments via CI/CD pipelines (Vercel, Render, etc.)
- Observability via health checks, error logs, and analytics dashboards
- Manual tests in production are ad-hoc and not scripted or automated

### Strategy: Testing in Production vs Development

**Development Testing (If Necessarily Needed)**
When development requirements necessitate working in production (e.g., a new Telegraf handler or transformative repo), developers should:
- Follow "Debugging-First" approach: reproduce issue locally first, then verify fix in production
- Use feature flags to gate changes (e.g., `if (process.env.TELEGRAPH_SECRET === 'x') ...` within `lib/catalog-validation.ts`)
- Use rollback points (not revert single file changes) to quickly undo via deployment revert

**Production Testing (Pre-Live)**
Before rollout, production should pre-check (Prerequisite requirements must be satisfied):
- Nightly CI builds (higher CPU quotas on Orchestrator, no error code 400 from backend, no memory slows)
- Run health check: `curl https://your-restaurant.com/api/health/db`
- Pre-cel lunar interactions with pre-populated orders to ensure messaging and messaging screens are good for common use cases
- Run hosted "canned" tests for high-complexity scenarios

**Testing Intervals and Safety Checks**
- **Development**: Code changed locally, run manual tests, push for review
- **Code Review**: Reviewer runs `npm run lint` and checks tests pass
- **CI**: Automated linting, type checking, and tests (not running tests locally on hosted deployment)
- **Production**: No local run; production evaluation via live traffic and ad-hoc monitoring

## Automated Test Infrastructure

### Component Tests

**Setup**
```bash
npm install --save-dev vitest @testing-library/react @testing-library/jest-dom jsdom
```

**Example: Cart Calculation Test**
```typescript
import { describe, it, expect } from 'vitest';
import { calculateCart } from '@/lib/cart';

describe('calculateCart', () => {
  it('should calculate correct subtotal, delivery fee, and total', () => {
    const cart = [
      { uuid: 'item-1', quantity: 2, price: 25, variants: [], extras: [] },
      { uuid: 'item-2', quantity: 1, price: 40, variants: [], extras: [] },
    ];

    const result = calculateCart(cart, 'delivery', 'MAD', 15, 5);

    expect(result.subtotal).toBe(90);
    expect(result.deliveryFee).toBe(15);
    expect(result.taxes).toBe(5);
    expect(result.total).toBe(110);
  });

  it('should handle empty cart', () => {
    const result = calculateCart([], 'pickup', 'MAD', 0, 0);
    expect(result.subtotal).toBe(0);
    expect(result.deliveryFee).toBe(0);
    expect(result.taxes).toBe(0);
    expect(result.total).toBe(0);
  });
});
```

### Integration Tests (Future)

**Postman Collection for API Endpoints**

**Endpoint: `POST /api/catalog`**
```bash
POST /api/catalog?shop=olive-and-ember
Content-Type: application/json

{
  "id": "owner-uuid",
  "payload": {
    "title": "Test Restaurant",
    "linkName": "test-restaurant",
    "categories": [...],
    "settings": { /* ... */ }
  }
}
```

**Endpoint: `POST /api/orders`**
```bash
POST /api/orders
Content-Type: application/json

{
  "shop": "olive-and-ember",
  "customerName": "Test Customer",
  "deliveryType": "pickup",
  "language": "en",
  "items": [
    {
      "uuid": "item-1",
      "quantity": 3,
      "variants": [{ "uuid": "choice-1" }]
    }
  ]
}
```

**Postman Environment Variables**
- `BASE_URL`: http://localhost:3000 (for local testing) or https://your-restaurant.com (for production)
- `SHOP_ID`: The owner ID or slug for testing
- `API_KEY`: API key for authenticated endpoints (if applicable)

### E2E Tests (Future)

**Playwright Setup**
```bash
npm install --save-dev @playwright/test
npm run test:e2e
```

**Example: Complete Order Flow**
```typescript
import { test, expect } from '@playwright/test';

test('complete order flow', async ({ page }) => {
  // 1. Navigate to menu
  await page.goto('/menu?shop=olive-and-ember');

  // 2. Browse and add items
  await page.click('text=Coffee');
  await page.click('button:has-text("+")');
  await page.click('button:has-text("+")');

  // 3. Open cart and review
  await page.click('button[aria-label="Open cart"]');
  await expect(page.locator('.cart-item')).toHaveCount(2);

  // 4. Fill checkout form
  await page.fill('[name="customerName"]', 'Test Customer');
  await page.selectOption('[name="deliveryType"]', 'pickup');
  await page.fill('[name="pickupTime"]', '2026-11-23T14:00:00+01:00');

  // 5. Submit order
  await page.click('button:has-text("Submit Order")');
  await expect(page.locator('.success-message')).toBeVisible();
});
```

## Error Handling and Validation Testing

### Test Invalid Inputs

**Order Validation Tests**
```typescript
import { buildOrderRecord } from '@/lib/orders';

describe('buildOrderRecord', () => {
  it('should reject negative quantities', () => {
    const invalidOrder = {
      shop: 'olive-and-ember',
      customerName: 'Test',
      deliveryType: 'pickup',
      language: 'en',
      items: [
        { uuid: 'item-1', quantity: -1, variants: [], extras: [] },
      ],
    };
    expect(() => buildOrderRecord(invalidOrder, mockCatalog)).toThrow(
      OrderValidationError,
    );
  });

  it('should reject unknown item UUIDs', () => {
    const invalidOrder = {
      shop: 'olive-and-ember',
      customerName: 'Test',
      deliveryType: 'pickup',
      language: 'en',
      items: [
        { uuid: 'fake-id-123', quantity: 1, variants: [], extras: [] },
      ],
    };
    expect(() => buildOrderRecord(invalidOrder, mockCatalog)).toThrow(
      OrderValidationError,
    );
  });
});
```

### CORS and Origin Validation Tests

```typescript
import cors from 'cors';
import { assertSameOrigin } from '@/lib/api-security';

describe('CORS Validation', () => {
  it('should reject requests from invalid origin', async () => {
    const request = new Request('http://evil.com/api/endpoint', {
      method: 'POST',
      headers: { Origin: 'http://evil.com' },
    });
    expect(() => assertSameOrigin(request)).toThrow('CORS violation');
  });

  it('should accept requests from valid origin', async () => {
    const request = new Request('http://localhost:3000/api/endpoint', {
      method: 'POST',
      headers: { Origin: 'http://localhost:3000' },
    });
    expect(() => assertSameOrigin(request)).not.toThrow();
  });
});
```

## Test Maintenance and Scalability

### Test Performance Optimization

1. **Lazy Loading**: Load test data only when needed (use `dataset: 'mockCatalog'` pattern)
2. **Parallel Execution**: Use Vitest's parallel execution (`--reporter=verbose --run parallel` to avoid cross-referencing memory)
3. ** clean-up**: Ensure test suites clean up after themselves (close database connections, clear localStorage)
4. **Isolation**: Separate test files for different features to avoid test contamination

### Test Data Management

**Mock Data Services**
```typescript
// lib/menu-data.ts
export const mockCatalog = createSeedCatalog();
export const imageMock = getMockImage();
export const orderMock = createMockOrder(mockCatalog);
```

**Fixture Pattern for Testing**
```typescript
// tests/fixtures/order.js
export function createTestOrder(catalog = mockCatalog) {
  return createMockOrder(catalog);
}
```

## Coverage Reporting

### Running Coverage

```bash
npm run test:coverage
```

**Coverage Types**
- Line coverage (code executed)
- Branch coverage (if branches executed)
- Function coverage (all functions executed)
- Statement coverage

**Thresholds** (Define in vitest config)
- Line coverage: > 70%
- Branch coverage: > 60%
- Function coverage: > 70%
- Statement coverage: > 70%

### Generating Coverage Report

Coverage reports are generated in HTML format:
```bash
npm run test:coverage
open coverage/index.html
```

**Metrics to Track**
- Overall coverage trends over time
- Per-file coverage for critical files (`lib/orders.ts`, `app/components/Restaurant.tsx`)
- New code coverage after each commit

## Future Test Enhancements

### Phase 3: Expanded Test Coverage

**Test Suite Additions**
- Mutation tests for `lib/orders.ts` (validate price consistency and item matching)
- Contract tests for dating date interaction with `lib/rate-limit-store.ts` (safe guard against accelerated limits)
- integration tests for `app/admin/OrdersPanel.tsx` (order status workflow)
- E2E tests for multi-language switch during checkout
- Performance benchmarks for API endpoints under load

### Test for Edge Cases

**Manual Test Checklist**
- Empty cart validation
- Invalid item UUIDs
- Negative quantities
- Price inconsistencies (menu price vs order price)
- Time-based failures (expired order due to pickup time in past)
- Concurrent order submission by same user
- Image upload with empty data
- Order note with emojis or special characters
- Long order description causing horizontal scroll
- RTL layout issues for Arabic text

### Full-Story Integration

To integrate full story coverage (full story UI integration) into the daily dev workflow:
1. Conduct teardown in code: `.storybook/manager.js` config
2. Implement full story modules in UI (since there is no UI story definition; the full story wherein the full story is a 483 with all the engaged by-product); fetch certificates via CDN
3. Replace media with synthetic images; replace subtitles with test data
4. Ensure test coverage is measured with Vercel's test recorder (75% coverage over prev)
5. Coverage drop triggers CI failure; rollback with caution to prevent single-file revert in production

---

**Testing Version**: 1.0.0
**Last Updated**: 2026-11-23
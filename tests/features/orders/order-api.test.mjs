import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import "../../support/register-types.mjs";

const requireTs = createRequire(import.meta.url);
const { createDineInOrderPostHandler } = requireTs("../../../features/orders/order-api.ts");
const { DineInOrderDomainError } = requireTs("../../../features/orders/order-domain.ts");
const { canonicalizeDineInOrderRequest } = requireTs("../../../features/orders/order-domain.ts");
const { DineInOrderServiceError } = requireTs("../../../features/orders/order-service.ts");
const { isDineInOrderIntakeEnabled } = requireTs("../../../features/orders/order-intake.ts");
const { ApiError } = requireTs("../../../lib/api-security.ts");

function request(body, headers = {}) {
  return new Request("https://clickmenu.example/api/dine-in/orders", {
    method: "POST",
    headers: { origin: "https://clickmenu.example", "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function handler(submit, hit = async () => 1, isIntakeEnabled = () => true, getRateLimitStore) {
  return createDineInOrderPostHandler({
    submit,
    isIntakeEnabled,
    getRateLimitStore: getRateLimitStore ?? (() => ({ hit })),
    getClientIp: () => "127.0.0.1",
  });
}

async function withIntakeSetting(value, callback) {
  const name = "DINE_IN_ORDER_INTAKE_ENABLED";
  const previous = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  try {
    return await callback();
  } finally {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  }
}

describe("dine-in order API", () => {
  it("enables intake only for the exact server setting", async () => {
    for (const value of [undefined, "false", "TRUE", "True", " true", "true ", "enabled", "1"]) {
      await withIntakeSetting(value, async () => assert.equal(isDineInOrderIntakeEnabled(), false));
    }
    await withIntakeSetting("true", async () => assert.equal(isDineInOrderIntakeEnabled(), true));
  });

  it("fails closed before parsing, rate limiting, or calling order persistence", async () => {
    await withIntakeSetting(undefined, async () => {
      let submits = 0;
      let storeReads = 0;
      let rateLimitCalls = 0;
      const post = handler(
        async () => { submits += 1; throw new Error("must not submit"); },
        async () => { rateLimitCalls += 1; return 1; },
        isDineInOrderIntakeEnabled,
        () => { storeReads += 1; return { hit: async () => { rateLimitCalls += 1; return 1; } }; },
      );
      const response = await post(new Request(
        "https://clickmenu.example/api/dine-in/orders?DINE_IN_ORDER_INTAKE_ENABLED=true",
        {
          method: "POST",
          headers: {
            origin: "https://clickmenu.example",
            "content-type": "application/json",
            "x-dine-in-order-intake-enabled": "true",
            cookie: "DINE_IN_ORDER_INTAKE_ENABLED=true",
          },
          body: "not-json",
        },
      ));
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { error: "Ordering is temporarily unavailable." });
      assert.equal(submits, 0);
      assert.equal(storeReads, 0);
      assert.equal(rateLimitCalls, 0);
    });
  });

  it("does not allow client-controlled fields to override the server gate", async () => {
    await withIntakeSetting("false", async () => {
      let submits = 0;
      const post = handler(
        async () => { submits += 1; return {}; },
        async () => 1,
        isDineInOrderIntakeEnabled,
      );
      const response = await post(request({
        tableToken: "opaque",
        DINE_IN_ORDER_INTAKE_ENABLED: "true",
        enabled: true,
        items: [],
      }, { "x-dine-in-order-intake-enabled": "true" }));
      assert.equal(response.status, 503);
      assert.equal(submits, 0);
    });
  });

  it("uses the idempotency header and returns only tracking details after submit resolves", async () => {
    let receivedKey;
    let calls = 0;
    const post = handler(async (_body, key) => {
      receivedKey = key;
      calls += 1;
      return { orderId: "00000000-0000-4000-8000-000000000001", trackingToken: "A".repeat(43), status: "pending", createdAt: 123, replayed: calls > 1 };
    });
    const first = await post(request({ tableToken: "opaque", items: [] }, { "idempotency-key": "k" }));
    assert.equal(first.status, 201);
    assert.deepEqual(await first.json(), { orderId: "00000000-0000-4000-8000-000000000001", trackingToken: "A".repeat(43), status: "pending", createdAt: 123 });
    assert.equal(receivedKey, "k");
    const retry = await post(request({ tableToken: "opaque", items: [] }, { "idempotency-key": "k" }));
    assert.equal(retry.status, 200);
  });

  it("rejects direct API submissions without a QR token or with a browser table ID", async () => {
    let persisted = 0;
    const post = handler(async (body) => {
      canonicalizeDineInOrderRequest(body);
      persisted += 1;
      return { orderId: "order", trackingToken: "A".repeat(43), status: "pending", createdAt: 1, replayed: false };
    });
    const line = [{ productId: "dish-1", quantity: 1, optionIds: [] }];

    const missing = await post(request({ items: line }));
    const overridden = await post(request({
      tableToken: "A".repeat(43),
      tableId: "another-table",
      items: line,
    }));

    assert.equal(missing.status, 400);
    assert.equal(overridden.status, 400);
    assert.equal(persisted, 0);
  });

  it("preserves 201 creation and 200 replay responses when the server explicitly enables intake", async () => {
    await withIntakeSetting("true", async () => {
      let calls = 0;
      const post = handler(async () => ({
        orderId: "00000000-0000-4000-8000-000000000001",
        trackingToken: "A".repeat(43),
        status: "pending",
        createdAt: 123,
        replayed: calls++ > 0,
      }), async () => 1, isDineInOrderIntakeEnabled);
      assert.equal((await post(request({}))).status, 201);
      assert.equal((await post(request({}))).status, 200);
    });
  });

  it("maps typed domain and idempotency errors without exposing internals", async () => {
    const invalid = await handler(async () => { throw new DineInOrderDomainError("invalid_request", "Invalid order."); })(request({}));
    assert.equal(invalid.status, 400);
    const unavailable = await handler(async () => { throw new DineInOrderDomainError("catalog_not_reviewed", "internal"); })(request({}));
    assert.equal(unavailable.status, 409);
    assert.deepEqual(await unavailable.json(), { code: "catalog_not_reviewed", error: "Ordering is temporarily unavailable for this menu." });
    const conflict = await handler(async () => { throw new DineInOrderServiceError("idempotency_conflict", "Conflict"); })(request({}));
    assert.equal(conflict.status, 409);
    assert.deepEqual(await conflict.json(), { code: "idempotency_conflict", error: "Conflict" });
  });

  it("returns generic errors for database failures and does not expose the error text", async () => {
    const post = handler(async () => { throw new Error("secret database url and SQL parameters"); });
    const result = await post(request({}));
    assert.equal(result.status, 500);
    assert.doesNotMatch(await result.text(), /secret database|SQL parameters/);
  });

  it("enforces origin, secure transport, and rate limiting before persistence", async () => {
    let submitted = false;
    const post = handler(async () => { submitted = true; return {}; }, async () => { throw new ApiError("rate limited", 429); });
    const limited = await post(request({}));
    assert.equal(limited.status, 429);
    assert.equal(submitted, false);

    const crossOrigin = await handler(async () => { submitted = true; return {}; })(
      request({}, { origin: "https://attacker.example" }),
    );
    assert.equal(crossOrigin.status, 403);
    assert.equal(submitted, false);
  });
});

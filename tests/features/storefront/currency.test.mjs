import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import "../../support/register-types.mjs";
import { createTestCatalog } from "../../support/catalog-fixture.mjs";

const requireTs = createRequire(import.meta.url);
const { createEmptyCatalog } = requireTs("../../../lib/menu-data.ts");
const { addToCart, calculateCart, formatPrice } = requireTs("../../../lib/cart.ts");
const { CatalogValidationError, validateCatalog } = requireTs("../../../lib/catalog-validation.ts");
const { createCatalogOperations } = requireTs("../../../lib/catalog-operations.ts");
const { formatMajorUnitsInput, formatMinorUnits, parseMajorUnits } = requireTs("../../../lib/money.ts");

describe("currency-free fixed-scale prices", () => {
  it("parses whole and fractional input as integer thousandths", () => {
    assert.equal(parseMajorUnits("75"), 75_000);
    assert.equal(parseMajorUnits("15"), 15_000);
    assert.equal(parseMajorUnits("7.5"), 7_500);
    assert.equal(parseMajorUnits("12.345"), 12_345);
    assert.equal(parseMajorUnits("1.0001"), null);
    assert.equal(parseMajorUnits("-1"), null);
  });

  it("formats item and option inputs and displays three decimal places", () => {
    assert.equal(formatMajorUnitsInput(75_000), "75");
    assert.equal(formatMajorUnitsInput(15_000), "15");
    assert.equal(formatMajorUnitsInput(7_500), "7.500");
    assert.equal(formatMinorUnits(75_000, "en"), "75.000");
    assert.equal(formatMinorUnits(15_000, "en"), "15.000");
    assert.equal(formatMinorUnits(7_500, "en"), "7.500");
    assert.equal(formatPrice(75_000, "en"), "75.000");

    const item = createTestCatalog().items[0];
    item.price = parseMajorUnits("75");
    item.options[0].price = parseMajorUnits("7.5");
    assert.equal(item.price, 75_000);
    assert.equal(item.options[0].price, 7_500);
  });

  it("calculates cart totals using integer item and option amounts", () => {
    const catalog = createTestCatalog();
    const item = { ...catalog.items[0], price: 75_000, options: [{ ...catalog.items[0].options[0], price: 7_500 }] };
    const cart = addToCart([], item, [item.options[0].id], 2);
    const result = calculateCart(cart, [item]);
    assert.equal(result.lines[0].unitPrice, 82_500);
    assert.equal(result.lines[0].total, 165_000);
    assert.equal(result.subtotal, 165_000);
  });

  it("accepts catalogues without a currency field and omits legacy labels", () => {
    const catalog = createEmptyCatalog();
    assert.equal(Object.hasOwn(catalog.settings, "currency"), false);

    const legacy = createTestCatalog();
    legacy.settings.currency = "MAD";
    const validated = validateCatalog(legacy);
    assert.equal(Object.hasOwn(validated.settings, "currency"), false);
  });

  it("persists and returns catalog payloads without a currency code", async () => {
    let row = null;
    const store = createCatalogOperations({
      async read() { return row; },
      async create(payload, revision) { row = { payload, revision }; return true; },
      async update() { return false; },
      async review() { return true; },
    });
    const catalog = createEmptyCatalog();
    catalog.items = createTestCatalog().items;
    catalog.categories = createTestCatalog().categories;
    catalog.items[0].price = 75_000;
    catalog.items[0].options[0].price = 7_500;
    const saved = await store.save(catalog);
    const storedPayload = JSON.parse(row.payload);

    assert.equal(storedPayload.items[0].price, 75_000);
    assert.equal(storedPayload.items[0].options[0].price, 7_500);
    assert.equal(Object.hasOwn(storedPayload.settings, "currency"), false);
    assert.equal(Object.hasOwn(saved.settings, "currency"), false);
  });

  it("returns safe 422 errors for invalid stored catalogue data", async () => {
    const store = createCatalogOperations({
      async read() { return { payload: "{", revision: 1 }; },
      async create() { return false; },
      async update() { return false; },
      async review() { return false; },
    });
    await assert.rejects(store.read(), (error) => {
      assert.equal(error.status, 422);
      assert.match(error.message, /valid JSON/u);
      assert.doesNotMatch(error.message, /database|sql|password|secret/iu);
      return true;
    });

    const { createPublicCatalogHandler } = requireTs("../../../lib/public-catalog.ts");
    const response = await createPublicCatalogHandler(() => store.read())(
      new Request("https://clickmenu.test/api/catalog"),
    );
    assert.equal(response.status, 422);
    assert.match((await response.json()).error, /valid JSON/u);

    const invalid = createTestCatalog();
    invalid.items[0].price = 1.5;
    assert.throws(() => validateCatalog(invalid), CatalogValidationError);
  });
});

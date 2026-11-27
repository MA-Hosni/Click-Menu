import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import "../../support/register-types.mjs";
import { createTestCatalog } from "../../support/catalog-fixture.mjs";

const requireTs = createRequire(import.meta.url);
const { createEmptyCatalog } = requireTs("../../../lib/menu-data.ts");
const { formatPrice } = requireTs("../../../lib/cart.ts");
const {
  CatalogValidationError,
  validateCatalog,
  validateTndCatalog,
} = requireTs("../../../lib/catalog-validation.ts");
const {
  formatMajorUnitsInput,
  formatMinorUnits,
  minorUnitsPerMajorUnit,
  parseMajorUnits,
} = requireTs("../../../lib/money.ts");

describe("TND-only catalog prices", () => {
  it("starts with a valid empty The Hood catalog using TND", () => {
    const catalog = createEmptyCatalog();
    assert.equal(catalog.settings.name, "The Hood");
    assert.equal(catalog.settings.currency, "TND");
    assert.deepEqual(catalog.categories, []);
    assert.deepEqual(catalog.items, []);
    assert.deepEqual(validateTndCatalog(catalog), catalog);
  });

  it("uses integer millimes and formats TND only", () => {
    assert.equal(minorUnitsPerMajorUnit("TND"), 1000);
    assert.equal(parseMajorUnits("12.345", "TND"), 12345);
    assert.equal(formatMajorUnitsInput(12345, "TND"), "12.345");
    assert.match(formatMinorUnits(12345, "TND", "en"), /12\.345 TND/);
    assert.equal(formatPrice(12345, "en"), "12.345 TND");
    assert.match(formatMinorUnits(1234, "TND", "fr"), /1,234 TND/);
    assert.match(formatMinorUnits(1234, "TND", "ar"), /TND/u);
    assert.doesNotMatch(formatMinorUnits(1234, "TND", "ar"), /DH|درهم/u);
  });

  it("rejects missing, unsupported, and invalid TND catalog amounts", () => {
    const missingCurrency = createTestCatalog();
    delete missingCurrency.settings.currency;
    assert.throws(() => validateCatalog(missingCurrency), CatalogValidationError);

    const unsupportedCurrency = createTestCatalog();
    unsupportedCurrency.settings.currency = "EUR";
    assert.throws(() => validateCatalog(unsupportedCurrency), CatalogValidationError);

    for (const price of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      const invalid = createTestCatalog();
      invalid.items[0].price = price;
      assert.throws(() => validateCatalog(invalid), CatalogValidationError);
    }
    assert.equal(parseMajorUnits("1.0001", "TND"), null);
    assert.equal(parseMajorUnits("-1", "TND"), null);
  });

  it("loads an empty public catalog instead of substituting demo content", async () => {
    const { createPublicCatalogHandler } = requireTs("../../../lib/public-catalog.ts");
    const response = await createPublicCatalogHandler(async () => createEmptyCatalog())(
      new Request("https://clickmenu.test/api/catalog"),
    );
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.settings.currency, "TND");
    assert.deepEqual(body.categories, []);
    assert.deepEqual(body.items, []);
  });

  it("has no legacy currency formatting or removed checkout modules", () => {
    const sources = [
      "../../../lib/money.ts",
      "../../../lib/types.ts",
      "../../../lib/menu-data.ts",
      "../../../lib/catalog-validation.ts",
      "../../../components/client/restaurant/RestaurantPage.tsx",
      "../../../app/api/orders/route.ts",
    ].map((path) => readFileSync(new URL(path, import.meta.url), "utf8").toLowerCase());
    const activeSource = sources.join("\n");
    assert.doesNotMatch(activeSource, /\bmad\b|\bdh\b|moroccan|morocco|ar-ma/u);
    assert.doesNotMatch(activeSource, /islegacymadcurrency/u);
  });
});

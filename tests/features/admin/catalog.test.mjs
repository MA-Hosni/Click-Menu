import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import "../../support/register-types.mjs";

const requireTs = createRequire(import.meta.url);
const { createSeedCatalog } = requireTs("../../../lib/menu-data.ts");
const {
  CatalogValidationError,
  SLUG_PATTERN,
  slugify,
  validateCatalog,
} = requireTs("../../../lib/catalog-validation.ts");
const { reconcileCatalogSave } = requireTs("../../../features/admin/reconcileCatalogSave.ts");

describe("admin catalog", () => {
  it("validates the current catalog and normalized restaurant slug", () => {
    const catalog = createSeedCatalog();
    catalog.settings.slug = slugify(catalog.settings.name);

    assert.equal(validateCatalog(catalog).settings.slug, "olive-and-ember");
    assert.equal(SLUG_PATTERN.test("olive-and-ember"), true);
    assert.equal(SLUG_PATTERN.test("Bad Slug"), false);
  });

  it("rejects invalid fields and slugs", () => {
    const catalog = createSeedCatalog();
    assert.throws(
      () => validateCatalog({ ...catalog, settings: { ...catalog.settings, name: "" } }),
      CatalogValidationError,
    );
    assert.throws(
      () => validateCatalog({ ...catalog, settings: { ...catalog.settings, slug: "not a slug" } }),
      CatalogValidationError,
    );
  });

  it("uses the server snapshot when the draft did not change during save", () => {
    const submitted = createSeedCatalog();
    const saved = { ...structuredClone(submitted), revision: 1 };

    assert.deepEqual(reconcileCatalogSave(structuredClone(submitted), submitted, saved), saved);
  });

  it("preserves edits made during save while adopting the returned revision", () => {
    const submitted = createSeedCatalog();
    const current = structuredClone(submitted);
    current.settings.tagline = "Edited while save was pending";
    const saved = { ...structuredClone(submitted), revision: 4 };
    const reconciled = reconcileCatalogSave(current, submitted, saved);

    assert.equal(reconciled.settings.tagline, "Edited while save was pending");
    assert.equal(reconciled.revision, 4);
    assert.notDeepEqual(reconciled, saved);
  });
});

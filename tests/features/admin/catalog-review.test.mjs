import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import "../../support/register-types.mjs";

const requireTs = createRequire(import.meta.url);
const { createCatalogOperations } = requireTs("../../../lib/catalog-operations.ts");

function makeCatalog() {
  return {
    settings: {
      name: "Test restaurant",
      tagline: "Review fixture",
      description: "Test catalog only",
      address: "Test location",
      hours: "Test hours",
      publicUrl: "",
    },
    categories: [{
      id: "main",
      name: { en: "Main", fr: "Principal", ar: "رئيسي" },
    }],
    items: [{
      id: "dish",
      category: "main",
      name: { en: "Test dish", fr: "Plat test", ar: "طبق تجريبي" },
      description: { en: "", fr: "", ar: "" },
      price: 4_250,
      image: null,
      tags: [],
      available: true,
      options: [{
        id: "extra",
        label: { en: "Extra", fr: "Supplément", ar: "إضافة" },
        price: 750,
      }],
    }],
    revision: 7,
  };
}

function makeStore(catalog, { beforeReview } = {}) {
  let row = catalog
    ? {
        payload: JSON.stringify(catalog),
        revision: catalog.revision,
        priceReviewedRevision: null,
        priceReviewedAt: null,
      }
    : null;
  const audit = [];
  const store = createCatalogOperations({
    async read() { return row ? structuredClone(row) : null; },
    async create(payload, revision, updatedAt) {
      if (row) return false;
      row = { payload, revision, updatedAt, priceReviewedRevision: null, priceReviewedAt: null };
      return true;
    },
    async update(expectedRevision, payload, revision, updatedAt) {
      if (!row || row.revision !== expectedRevision) return false;
      row = { payload, revision, updatedAt, priceReviewedRevision: null, priceReviewedAt: null };
      return true;
    },
    async review(expectedRevision, reviewedAt, expectedPayload, eventId, actor) {
      if (beforeReview) await beforeReview({ get row() { return row; }, set row(value) { row = value; } });
      if (!row || row.revision !== expectedRevision || row.payload !== expectedPayload)
        return false;
      row = { ...row, priceReviewedRevision: expectedRevision, priceReviewedAt: reviewedAt };
      audit.push({ eventId, action: "catalog_prices_reviewed", actor, createdAt: reviewedAt });
      return true;
    },
  });
  return {
    store,
    audit,
    get row() { return row; },
  };
}

describe("TND catalog price review", () => {
  it("records an administrator review for the exact saved TND revision", async () => {
    const fixture = makeStore(makeCatalog());
    const result = await fixture.store.review(7, "The Hood admin");

    assert.deepEqual(result, {
      revision: 7,
      reviewedRevision: 7,
      reviewedAt: fixture.row.priceReviewedAt,
    });
    assert.ok(Number.isSafeInteger(result.reviewedAt));
    assert.equal(fixture.row.priceReviewedRevision, 7);
    assert.equal(fixture.audit.length, 1);
    assert.equal(fixture.audit[0].actor, "The Hood admin");
  });

  it("leaves new and existing catalogs unreviewed until an explicit review", async () => {
    const empty = makeStore(null);
    assert.deepEqual(await empty.store.readReviewState(), {
      revision: 0,
      reviewedRevision: null,
      reviewedAt: null,
    });

    const fixture = makeStore(makeCatalog());
    assert.deepEqual(await fixture.store.readReviewState(), {
      revision: 7,
      reviewedRevision: null,
      reviewedAt: null,
    });
    assert.equal(fixture.audit.length, 0);
  });

  it("ignores legacy catalog currency labels when reviewing a saved revision", async () => {
    const legacy = makeCatalog();
    legacy.settings.currency = "EUR";
    const fixture = makeStore(legacy);
    await fixture.store.review(7, "The Hood admin");
    assert.equal(fixture.row.priceReviewedRevision, 7);
  });

  it("rejects stale or invalid expected revisions before recording a review", async () => {
    const fixture = makeStore(makeCatalog());
    await assert.rejects(fixture.store.review(6, "The Hood admin"), { status: 409 });
    await assert.rejects(fixture.store.review("7", "The Hood admin"), { status: 400 });
    assert.equal(fixture.row.priceReviewedRevision, null);
    assert.equal(fixture.audit.length, 0);
  });

  it("rejects invalid product and option prices", async () => {
    const badProduct = makeCatalog();
    badProduct.items[0].price = -1;
    const productStore = makeStore(badProduct);
    await assert.rejects(productStore.store.review(7, "The Hood admin"), { status: 422 });
    assert.equal(productStore.row.priceReviewedRevision, null);

    const badOption = makeCatalog();
    badOption.items[0].options[0].price = Number.MAX_SAFE_INTEGER + 1;
    const optionStore = makeStore(badOption);
    await assert.rejects(optionStore.store.review(7, "The Hood admin"), { status: 422 });
    assert.equal(optionStore.row.priceReviewedRevision, null);
    assert.equal(productStore.audit.length + optionStore.audit.length, 0);
  });

  it("rejects missing product prices and negative option prices", async () => {
    const missingProductPrice = makeCatalog();
    delete missingProductPrice.items[0].price;
    const missingProductStore = makeStore(missingProductPrice);
    await assert.rejects(missingProductStore.store.review(7, "The Hood admin"), { status: 422 });

    const negativeOption = makeCatalog();
    negativeOption.items[0].options[0].price = -1;
    const negativeOptionStore = makeStore(negativeOption);
    await assert.rejects(negativeOptionStore.store.review(7, "The Hood admin"), { status: 422 });
    assert.equal(missingProductStore.row.priceReviewedRevision, null);
    assert.equal(negativeOptionStore.row.priceReviewedRevision, null);
  });

  it("preserves the stored prices without currency conversion", async () => {
    const catalog = makeCatalog();
    const before = JSON.stringify(catalog);
    const fixture = makeStore(catalog);
    await fixture.store.review(7, "The Hood admin");
    assert.equal(fixture.row.payload, before);
    assert.equal(JSON.parse(fixture.row.payload).items[0].price, 4_250);
    assert.equal(JSON.parse(fixture.row.payload).items[0].options[0].price, 750);
  });

  it("clears both review fields in the same save that advances the revision", async () => {
    const fixture = makeStore(makeCatalog());
    await fixture.store.review(7, "The Hood admin");
    const changed = makeCatalog();
    changed.revision = 7;
    changed.items[0].price += 1;
    const saved = await fixture.store.save(changed);

    assert.equal(saved.revision, 8);
    assert.equal(fixture.row.revision, 8);
    assert.equal(fixture.row.priceReviewedRevision, null);
    assert.equal(fixture.row.priceReviewedAt, null);
  });

  it("cannot mark a revision reviewed if it changes between validation and conditional update", async () => {
    const fixture = makeStore(makeCatalog(), {
      async beforeReview(state) {
        state.row = {
          ...state.row,
          revision: 8,
          payload: JSON.stringify({ ...makeCatalog(), revision: 8 }),
          priceReviewedRevision: null,
          priceReviewedAt: null,
        };
      },
    });

    await assert.rejects(fixture.store.review(7, "The Hood admin"), { status: 409 });
    assert.equal(fixture.row.revision, 8);
    assert.equal(fixture.row.priceReviewedRevision, null);
    assert.equal(fixture.row.priceReviewedAt, null);
    assert.equal(fixture.audit.length, 0);
  });
});

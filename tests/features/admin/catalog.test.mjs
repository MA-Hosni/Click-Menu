import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import "../../support/register-types.mjs";

const requireTs = createRequire(import.meta.url);
import { createTestCatalog } from "../../support/catalog-fixture.mjs";
const {
  CatalogValidationError,
  validateCatalog,
} = requireTs("../../../lib/catalog-validation.ts");
const { reconcileCatalogSave } = requireTs("../../../features/admin/reconcileCatalogSave.ts");
const { createCatalogOperations } = requireTs("../../../lib/catalog-operations.ts");
const { createEmptyCatalog } = requireTs("../../../lib/menu-data.ts");
const { createPublicCatalogHandler } = requireTs("../../../lib/public-catalog.ts");

describe("admin catalog", () => {
  it("validates a singleton catalog and strips legacy tenant-slug data", () => {
    const catalog = createTestCatalog();
    const withLegacySlug = { ...catalog, settings: { ...catalog.settings, slug: "another-restaurant" } };
    const validated = validateCatalog(withLegacySlug);
    assert.equal(validated.settings.name, catalog.settings.name);
    assert.equal(Object.hasOwn(validated.settings, "slug"), false);
  });

  it("normalizes absent and empty dish images to null while preserving real references", () => {
    const catalog = createTestCatalog();
    delete catalog.items[0].image;
    catalog.items[1].image = "";
    const normalized = validateCatalog(catalog);
    assert.equal(normalized.items[0].image, null);
    assert.equal(normalized.items[1].image, null);
    normalized.items[0].image = "/api/images/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    assert.equal(validateCatalog(normalized).items[0].image, normalized.items[0].image);
  });

  it("rejects invalid catalog fields", () => {
    const catalog = createTestCatalog();
    assert.throws(
      () => validateCatalog({ ...catalog, settings: { ...catalog.settings, name: "" } }),
      CatalogValidationError,
    );
  });

  it("uses the server snapshot when the draft did not change during save", () => {
    const submitted = createTestCatalog();
    const saved = { ...structuredClone(submitted), revision: 1 };

    assert.deepEqual(reconcileCatalogSave(structuredClone(submitted), submitted, saved), saved);
  });

  it("preserves edits made during save while adopting the returned revision", () => {
    const submitted = createTestCatalog();
    const current = structuredClone(submitted);
    current.settings.tagline = "Edited while save was pending";
    const saved = { ...structuredClone(submitted), revision: 4 };
    const reconciled = reconcileCatalogSave(current, submitted, saved);

    assert.equal(reconciled.settings.tagline, "Edited while save was pending");
    assert.equal(reconciled.revision, 4);
    assert.notDeepEqual(reconciled, saved);
  });

  it("creates and retrieves one catalog through the singleton persistence adapter", async () => {
    let row = null;
    const store = createCatalogOperations({
      async read() { return row; },
      async create(payload, revision) {
        if (row) return false;
        row = { payload, revision };
        return true;
      },
      async update(expectedRevision, payload, revision) {
        if (!row || row.revision !== expectedRevision) return false;
        row = { payload, revision };
        return true;
      },
    });
    const initial = createEmptyCatalog();
    const submitted = { ...initial, revision: 0, categories: [{
      id: "main",
      name: { en: "Main", fr: "Principal", ar: "رئيسي" },
    }], items: [{
      id: "dish",
      category: "main",
      name: { en: "Dish", fr: "Plat", ar: "طبق" },
      description: { en: "", fr: "", ar: "" },
      price: 1000,
      image: null,
      tags: [],
      available: true,
      options: [],
    }] };
    const saved = await store.save(submitted);
    assert.equal(saved.revision, 1);
    assert.equal(saved.items[0].image, null);
    assert.equal(JSON.parse(row.payload).items[0].image, null);
    assert.deepEqual(await store.read(), saved);
  });

  it("returns null image data without substituting a placeholder URL", async () => {
    const catalog = createTestCatalog();
    const get = createPublicCatalogHandler(async () => catalog);
    const response = await get(new Request("https://clickmenu.test/api/catalog"));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.items[0].image, null);
    assert.doesNotMatch(JSON.stringify(body), /\/images\/(?:toast|test|burger|food)/iu);
  });

  it("uses null for newly created dishes and a UI-only neutral placeholder", () => {
    const newDishSource = readFileSync(new URL("../../../components/admin/menu/AdminMenuPage.tsx", import.meta.url), "utf8");
    const adminListSource = readFileSync(new URL("../../../components/admin/menu/MenuItemList.tsx", import.meta.url), "utf8");
    const adminEditorSource = readFileSync(new URL("../../../components/admin/menu/MenuItemEditor.tsx", import.meta.url), "utf8");
    const placeholderSource = readFileSync(new URL("../../../components/ui/DishPhoto.tsx", import.meta.url), "utf8");
    const photoFieldSource = readFileSync(new URL("../../../components/admin/menu/PhotoField.tsx", import.meta.url), "utf8");
    assert.match(newDishSource, /image: null/u);
    assert.match(adminListSource, /<DishPhoto[\s\S]*?src=\{item\.image\}/u);
    assert.match(adminEditorSource, /<DishPhoto[\s\S]*?src=\{item\.image\}/u);
    assert.match(placeholderSource, /if \(!src \|\| failed\)/u);
    assert.doesNotMatch(placeholderSource, /src\s*=\s*["'][^"']+\.jpg/u);
    assert.match(photoFieldSource, /onChange\(null\)/u);
    const render = spawnSync(process.execPath, ["-e", `
      const fs = require("node:fs");
      const ts = require("typescript");
      require.extensions[".tsx"] = (module, filename) => {
        const source = fs.readFileSync(filename, "utf8");
        const { outputText } = ts.transpileModule(source, {
          compilerOptions: { esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
          fileName: filename,
        });
        module._compile(outputText, filename);
      };
      const React = require("react");
      const { renderToStaticMarkup } = require("react-dom/server");
      const DishPhoto = require("./components/ui/DishPhoto.tsx").default;
      process.stdout.write(renderToStaticMarkup(React.createElement(DishPhoto, { src: null, alt: "Image-less dish" })));
    `], { cwd: process.cwd(), encoding: "utf8" });
    assert.equal(render.status, 0, render.stderr);
    const markup = render.stdout;
    assert.match(markup, /class="photo-fallback\s"/u);
    assert.match(markup, /aria-label="Image-less dish"/u);
    assert.doesNotMatch(markup, /<img\b|\/images\//u);
  });

  it("preserves existing uploaded image references when replacing or removing a dish image", async () => {
    const uploadedObjects = new Map([
      ["/api/images/11111111111111111111111111111111", Buffer.from("old")],
      ["/api/images/22222222222222222222222222222222", Buffer.from("new")],
    ]);
    let row = null;
    const store = createCatalogOperations({
      async read() { return row; },
      async create(payload, revision) { row = { payload, revision }; return true; },
      async update(expectedRevision, payload, revision) {
        if (!row || row.revision !== expectedRevision) return false;
        row = { payload, revision };
        return true;
      },
    });
    const draft = createTestCatalog();
    draft.revision = 0;
    draft.items[0].image = [...uploadedObjects.keys()][0];
    const withOldImage = await store.save(draft);
    const replaced = await store.save({
      ...withOldImage,
      items: withOldImage.items.map((item, index) => index === 0
        ? { ...item, image: [...uploadedObjects.keys()][1] }
        : item),
    });
    assert.equal(replaced.items[0].image, [...uploadedObjects.keys()][1]);
    const removed = await store.save({
      ...replaced,
      items: replaced.items.map((item, index) => index === 0 ? { ...item, image: null } : item),
    });
    assert.equal(removed.items[0].image, null);
    assert.equal(uploadedObjects.size, 2);
    assert.deepEqual([...uploadedObjects.values()], [Buffer.from("old"), Buffer.from("new")]);
  });

  it("rejects a stale catalog revision with the conflict response", async () => {
    const store = createCatalogOperations({
      async read() { return null; },
      async create() { return false; },
      async update() { return false; },
    });
    const catalog = createTestCatalog();
    catalog.revision = 1;
    await assert.rejects(store.save(catalog), { status: 409 });
  });

  it("serves a blank currency-free catalog before setup and never substitutes demo data", async () => {
    let reads = 0;
    const catalog = createPublicCatalogHandler(async () => {
      reads += 1;
      return null;
    });
    const responses = await Promise.all([
      catalog(new Request("https://clickmenu.test/api/catalog")),
      catalog(new Request("https://clickmenu.test/api/catalog?shop=another-name")),
    ]);
    assert.deepEqual(responses.map((response) => response.status), [200, 200]);
    assert.equal(reads, 2);
    for (const response of responses) {
      const body = await response.json();
      assert.equal(body.settings.name, "The Hood");
      assert.equal(Object.hasOwn(body.settings, "currency"), false);
      assert.deepEqual(body.categories, []);
      assert.deepEqual(body.items, []);
    }
  });
});

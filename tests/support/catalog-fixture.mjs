/** Synthetic data used only by isolated automated tests. */
export function createTestCatalog() {
  return {
    settings: {
      name: "Test restaurant",
      tagline: "Test tagline",
      description: "Test description",
      address: "Test location",
      hours: "Test hours",
      currency: "TND",
      publicUrl: "",
    },
    categories: [{
      id: "test-category",
      name: { en: "Test category", fr: "Rubrique test", ar: "قسم تجريبي" },
    }],
    items: [
      {
        id: "test-dish",
        category: "test-category",
        name: { en: "Test dish", fr: "Plat test", ar: "طبق تجريبي" },
        description: { en: "", fr: "", ar: "" },
        price: 6800,
        image: null,
        tags: [],
        available: true,
        options: [{
          id: "test-option",
          label: { en: "Test option", fr: "Option test", ar: "خيار تجريبي" },
          price: 600,
        }, {
          id: "second-test-option",
          label: { en: "Second test option", fr: "Deuxième option test", ar: "خيار تجريبي ثان" },
          price: 300,
        }],
      },
      {
        id: "second-test-dish",
        category: "test-category",
        name: { en: "Second test dish", fr: "Deuxième plat test", ar: "طبق تجريبي ثان" },
        description: { en: "", fr: "", ar: "" },
        price: 4200,
        image: null,
        tags: [],
        available: true,
        options: [],
      },
    ],
    revision: 0,
  };
}

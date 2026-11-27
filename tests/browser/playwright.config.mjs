import { defineConfig } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const baseURL = process.env.CLICKMENU_CHECKOUT_BROWSER_BASE_URL;
const resultsDirectory = process.env.CLICKMENU_CHECKOUT_BROWSER_RESULTS_DIR;
if (!/^http:\/\/127\.0\.0\.1:\d+$/u.test(baseURL ?? ""))
  throw new Error("Run checkout browser tests through tests/browser/run-checkout.mjs.");
if (!resultsDirectory || !path.isAbsolute(resultsDirectory) || !path.basename(resultsDirectory).startsWith("clickmenu-playwright-results-"))
  throw new Error("Run checkout browser tests through tests/browser/run-checkout.mjs.");

export default defineConfig({
  testDir: path.dirname(fileURLToPath(import.meta.url)),
  testMatch: "checkout-recovery.spec.mjs",
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 8_000 },
  reporter: "list",
  outputDir: resultsDirectory,
  use: {
    baseURL,
    browserName: "chromium",
    channel: "chrome",
    headless: true,
    serviceWorkers: "block",
    trace: "retain-on-failure",
  },
});

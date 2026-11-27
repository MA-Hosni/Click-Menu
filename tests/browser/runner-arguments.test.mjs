import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { createPlaywrightInvocation } from "./runner-arguments.mjs";

test("Playwright execution uses only the temporary workspace for config and cwd", () => {
  const workspace = path.join(path.parse(process.cwd()).root, "isolated-checkout-workspace");
  const invocation = createPlaywrightInvocation(workspace);
  assert.equal(invocation.cwd, path.resolve(workspace));
  assert.deepEqual(invocation.args, [
    "test",
    `--config=${path.join(path.resolve(workspace), "tests", "browser", "playwright.config.mjs")}`,
  ]);
  assert.equal(invocation.args.some((arg) => arg.includes(process.cwd())), false);
});

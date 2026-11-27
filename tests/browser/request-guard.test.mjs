import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);
require("../../tests/support/register-types.mjs");
const { isLoopbackBrowserTestRequest } = require("../../app/browser-test/request-guard.ts");

test("test routes accept only plain loopback host headers", () => {
  for (const host of ["127.0.0.1", "127.0.0.1:41321", "localhost", "localhost:3000"])
    assert.equal(isLoopbackBrowserTestRequest(new Headers({ host })), true, host);
  for (const host of ["example.test", "127.0.0.1.evil.test", "127.0.0.1:0", "127.0.0.1:65536", "127.0.0.1, evil.test"])
    assert.equal(isLoopbackBrowserTestRequest(new Headers({ host })), false, host);
  for (const forwarded of ["forwarded", "x-forwarded-host", "x-original-host"])
    assert.equal(isLoopbackBrowserTestRequest(new Headers({ host: "127.0.0.1:3000", [forwarded]: "localhost" })), false, forwarded);
});

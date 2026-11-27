import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  assertCopyPathWithinRoot,
  assertCopyPlatformSafe,
  classifyBrowserCopyEntry,
  copyBrowserWorkspace,
} from "./copy-policy.mjs";

test("copy policy keeps the explicit source allowlist and excludes unrelated or sensitive fixtures", () => {
  assert.equal(classifyBrowserCopyEntry("app/layout.tsx", "file"), "copy");
  assert.equal(classifyBrowserCopyEntry("lib/types.ts", "file"), "copy");
  assert.equal(classifyBrowserCopyEntry("tests/browser/checkout-recovery.spec.mjs", "file"), "copy");
  assert.equal(classifyBrowserCopyEntry("app/api/dine-in/orders/route.ts", "file"), "exclude");
  assert.equal(classifyBrowserCopyEntry("components/admin/SignIn.tsx", "file"), "exclude");

  for (const relative of [
    "app/nested/.ENV.production",
    "lib/service-account.json",
    "lib/unrelated-secret.ts",
    "lib/client-cert.pem",
    "tests/browser/other.test.mjs",
    ".env",
  ]) assert.equal(classifyBrowserCopyEntry(relative, "file"), "exclude", relative);
  assert.equal(classifyBrowserCopyEntry("lib/disguised.ts", "file", "-----BEGIN RSA PRIVATE KEY----- synthetic-only"), "exclude");
  assert.equal(classifyBrowserCopyEntry("lib/ssh.ts", "file", "ssh-ed25519 AAAA synthetic-only"), "exclude");
  assert.throws(() => classifyBrowserCopyEntry("app/nested/link", "symlink"), /symbolic link/u);
  assert.throws(() => classifyBrowserCopyEntry("app/nested/other", "fifo"), /unsupported filesystem entry/u);
});

test("copy policy rejects lexical paths outside its supplied root", () => {
  const root = path.join(path.parse(process.cwd()).root, "synthetic-repository-root");
  assert.equal(assertCopyPathWithinRoot(root, path.join(root, "app", "layout.tsx")), "app/layout.tsx");
  assert.throws(() => assertCopyPathWithinRoot(root, path.join(path.dirname(root), "outside.ts")), /outside the repository/u);
});

test("workspace copying fails before touching source or creating the destination on every platform", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clickmenu-copy-policy-"));
  const source = path.join(root, "source");
  const destination = path.join(root, "workspace");
  try {
    await mkdir(source);
    await writeFile(path.join(source, "synthetic.ts"), "synthetic fixture only");
    assert.throws(() => assertCopyPlatformSafe("win32"), /disabled on all platforms/u);
    assert.throws(() => assertCopyPlatformSafe("linux"), /descriptor-relative traversal/u);
    await assert.rejects(copyBrowserWorkspace(source, destination), /disabled on all platforms/u);
    await assert.rejects(access(destination), { code: "ENOENT" });
    assert.equal(await access(path.join(source, "synthetic.ts")).then(() => true), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

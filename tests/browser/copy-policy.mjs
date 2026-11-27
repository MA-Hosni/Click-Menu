import path from "node:path";

const ROOT_FILES = new Set([
  "next.config.ts",
  "next-env.d.ts",
  "package.json",
  "postcss.config.mjs",
  "tsconfig.json",
]);
const SPECIAL_FILES = new Set([
  "tests/browser/CheckoutBrowserHarness.tsx",
  "tests/browser/checkout-recovery.spec.mjs",
  "tests/browser/playwright.config.mjs",
  "tests/browser/checkout-test-transport.ts",
]);
const SOURCE_FILES = new Set([
  "app/browser-test/checkout/[token]/page.tsx",
  "app/browser-test/health/route.ts",
  "app/browser-test/request-guard.ts",
  "app/globals.css",
  "app/layout.tsx",
  "app/track/[orderId]/page.tsx",
  "components/client/ordering/CustomerOrderTracking.tsx",
  "components/client/ordering/DineInCheckout.tsx",
  "components/client/shared/Modal.tsx",
  "features/storefront/dine-in-order.ts",
  "features/storefront/i18n/copy.ts",
  "features/storefront/order-tracking.ts",
  "features/storefront/useDineInCheckout.ts",
  "lib/cart.ts",
  "lib/money.ts",
  "lib/text.ts",
  "lib/types.ts",
]);
const SECRET_NAME = /(^|[._-])(credential|credentials|creds|secret|secrets|private[-_]?key|id_rsa|id_ed25519|service[-_]?account|cert|certs|certificate|certificates)([._-]|$)/iu;
const SECRET_EXTENSIONS = new Set([
  ".cer", ".crt", ".der", ".jks", ".key", ".keystore", ".p12", ".pfx", ".pem", ".ppk",
]);
const SECRET_CONTENT = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
  /-----BEGIN (?:X\.509 )?CERTIFICATE-----/u,
  /\bssh-(?:rsa|ed25519) AAAA/u,
  /\bAKIA[0-9A-Z]{16}\b/u,
  /(?:aws_secret_access_key|client_secret|private_key)\s*["']?\s*[:=]\s*["'][^"'\s]{12,}/iu,
];

function isExcludedName(name) {
  const lower = name.toLowerCase();
  return lower.startsWith(".env") || lower === ".aws" || lower === ".vercel" ||
    lower === ".git" || lower === ".next" || lower === "node_modules" ||
    lower === ".npmrc" || lower === "coverage" || lower.startsWith(".checkout-browser-runtime-") ||
    SECRET_NAME.test(name) || SECRET_EXTENSIONS.has(path.extname(lower));
}

export function assertCopyPlatformSafe(platform = process.platform) {
  const platformDetail = platform === "win32"
    ? "Windows also has reparse-point types that Node cannot reliably identify."
    : "Node does not expose a supported descriptor-relative traversal API that prevents parent-directory substitution.";
  throw new Error(`Browser workspace copying is disabled on all platforms because race-safe no-follow traversal cannot be established. ${platformDetail}`);
}

export function classifyBrowserCopyEntry(relative, kind, content = "") {
  const normalized = relative.split(path.sep).join("/");
  const parts = normalized.split("/");
  if (kind === "symlink") throw new Error(`Copy policy rejected symbolic link: ${normalized}`);
  if (kind !== "file" && kind !== "directory") throw new Error(`Copy policy rejected unsupported filesystem entry: ${normalized}`);
  if (parts.some(isExcludedName)) return "exclude";

  if (kind === "directory") {
    if (parts.length === 1) return ["app", "components", "features", "lib", "tests"].includes(parts[0]) ? "traverse" : "exclude";
    if (parts[0] === "tests") return normalized === "tests/browser" ? "traverse" : "exclude";
    return [...SOURCE_FILES].some((file) => file.startsWith(`${normalized}/`)) ? "traverse" : "exclude";
  }

  const allowed = parts.length === 1
    ? ROOT_FILES.has(parts[0])
    : parts[0] === "tests"
      ? SPECIAL_FILES.has(normalized)
      : SOURCE_FILES.has(normalized);
  if (!allowed) return "exclude";
  if (SECRET_CONTENT.some((pattern) => pattern.test(String(content)))) return "exclude";
  return "copy";
}

export function assertCopyPathWithinRoot(root, candidate) {
  const relative = path.relative(root, candidate);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
    throw new Error("Copy policy rejected a path outside the repository root.");
  return relative.split(path.sep).join("/");
}

export async function copyBrowserWorkspace() {
  assertCopyPlatformSafe();
}

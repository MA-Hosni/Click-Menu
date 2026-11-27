const ALLOWED_HOST = /^(?:127\.0\.0\.1|localhost)(?::([0-9]{1,5}))?$/u;

/** Host-header gate for the development-only browser-test routes. */
export function isLoopbackBrowserTestRequest(headers: Headers): boolean {
  let ambiguous = false;
  headers.forEach((_value, name) => {
    const normalized = name.toLowerCase();
    if (normalized === "forwarded" || normalized.startsWith("x-forwarded-") || normalized === "x-original-host")
      ambiguous = true;
  });
  if (ambiguous) return false;

  const host = headers.get("host");
  if (!host) return false;
  const match = ALLOWED_HOST.exec(host);
  if (!match) return false;
  return !match[1] || (Number(match[1]) > 0 && Number(match[1]) <= 65_535);
}

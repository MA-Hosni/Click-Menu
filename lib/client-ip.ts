/** Extract the address supplied by the hosting proxy for rate-limit keys. */
export function clientIp(request: Request): string {
  const realIp = request.headers.get("x-real-ip");
  if (realIp?.trim()) return realIp.trim();
  const forwardedFor = request.headers.get("x-forwarded-for");
  return forwardedFor?.split(",")[0]?.trim() || "unknown";
}

import { isLoopbackBrowserTestRequest } from "../request-guard";

export function GET(request: Request) {
  if (process.env.NODE_ENV !== "development" || process.env.CLICKMENU_CHECKOUT_BROWSER_TEST !== "1")
    return new Response(null, { status: 404 });
  if (!isLoopbackBrowserTestRequest(request.headers)) return new Response(null, { status: 404 });
  const nonce = process.env.CLICKMENU_CHECKOUT_BROWSER_HEALTH_TOKEN;
  if (!nonce || request.headers.get("x-clickmenu-browser-health") !== nonce)
    return new Response(null, { status: 404 });
  return Response.json({ ready: true });
}

import {
  assertSameOrigin,
  jsonResponse,
  requestIsSecure,
  routeError,
} from "../../../../lib/api-security";
import { clearedSessionCookie, endSession } from "../../../../lib/auth";
import { postgresAuthStore } from "../../../../lib/auth-store";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await endSession(postgresAuthStore(), request.headers.get("cookie"));
    const secure = requestIsSecure(request);
    return jsonResponse({ signedOut: true }, 200, {
      "Set-Cookie": clearedSessionCookie(secure),
    });
  } catch (error) {
    return routeError(error);
  }
}

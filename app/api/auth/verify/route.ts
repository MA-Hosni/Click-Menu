import {
  assertSameOrigin,
  jsonResponse,
  readBoundedJson,
  routeError,
} from "../../../../lib/api-security";
import {
  sessionCookie,
  verifySignInCode,
} from "../../../../lib/auth";
import { enforceLimit } from "../../../../lib/rate-limit";
import { postgresAuthStore } from "../../../../lib/auth-store";
import {
  clientIp,
  postgresRateLimitStore,
} from "../../../../lib/rate-limit-store";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await enforceLimit(postgresRateLimitStore(), "verifyPerIp", clientIp(request));
    const body = await readBoundedJson(request, 1_000);
    const { user, token } = await verifySignInCode(postgresAuthStore(), body);
    const secure = new URL(request.url).protocol === "https:";
    return jsonResponse(
      { user: { id: user.id, name: user.email, email: user.email } },
      200,
      { "Set-Cookie": sessionCookie(token, secure) },
    );
  } catch (error) {
    return routeError(error);
  }
}

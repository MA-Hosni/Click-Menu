import {
  assertSameOrigin,
  jsonResponse,
  readBoundedJson,
  requestIsSecure,
  routeError,
} from "../../../../lib/api-security";
import { sessionCookie } from "../../../../lib/auth";
import { postgresAuthStore } from "../../../../lib/auth-store";
import { enforceLimit } from "../../../../lib/rate-limit";
import {
  clientIp,
  postgresRateLimitStore,
} from "../../../../lib/rate-limit-store";
import { loginAdminWithPassword } from "../../../../features/admin/auth/password-auth";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const limits = postgresRateLimitStore();
    await enforceLimit(limits, "adminLoginPerIp", clientIp(request));
    await enforceLimit(limits, "adminLoginPerAccount", "the-hood-admin");
    const body = await readBoundedJson(request, 2_000);
    const { user, token } = await loginAdminWithPassword(postgresAuthStore(), body);
    const secure = requestIsSecure(request);
    return jsonResponse(
      { user },
      200,
      { "Set-Cookie": sessionCookie(token, secure) },
    );
  } catch (error) {
    return routeError(error);
  }
}

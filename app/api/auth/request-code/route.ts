import {
  ApiError,
  assertSameOrigin,
  jsonResponse,
  readBoundedJson,
  routeError,
} from "../../../../lib/api-security";

import {
  createSignInCode,
  normalizeEmail,
  sendCodeWithResend,
} from "../../../../lib/auth";

import { postgresAuthStore } from "../../../../lib/auth-store";
import { enforceLimit } from "../../../../lib/rate-limit";

import {
  clientIp,
  postgresRateLimitStore,
} from "../../../../lib/rate-limit-store";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const resendApiKey = process.env.RESEND_API_KEY;
    const emailFrom = process.env.EMAIL_FROM;

    const configured = Boolean(resendApiKey && emailFrom);
    // `npm run dev` shows the code on screen; production must send real email.
    if (!configured && process.env.NODE_ENV === "production")
      throw new ApiError(
        "Email sign-in isn't set up yet. The site owner needs to add RESEND_API_KEY and EMAIL_FROM.",
        503,
      );
    const limits = postgresRateLimitStore();
    await enforceLimit(limits, "codePerIp", clientIp(request));
    const body = await readBoundedJson(request, 1_000);
    await enforceLimit(
      limits,
      "codePerEmail",
      normalizeEmail((body as { email?: unknown } | null)?.email),
    );
    const store = postgresAuthStore();
    const { email, code } = await createSignInCode(store, body);
    if (!configured) return jsonResponse({ sent: true, devCode: code });
    try {
      await sendCodeWithResend(
        {
          apiKey: resendApiKey!,
          from: emailFrom!,
        },
        email,
        code,
      );
    } catch (error) {
      // Let the owner ask again straight away instead of waiting out the cooldown.
      await store.deleteCode(email);
      throw error;
    }
    return jsonResponse({ sent: true });
  } catch (error) {
    return routeError(error);
  }
}

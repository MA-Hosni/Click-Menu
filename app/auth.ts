import { headers } from "next/headers";
import { getSessionUser } from "../lib/auth";
import { postgresAuthStore } from "../lib/auth-store";

/** Singleton administrator identity from a server-validated session. */
export async function getCurrentUser(cookieHeader?: string | null) {
  const sessionCookie =
    cookieHeader === undefined ? (await headers()).get("cookie") : cookieHeader;
  return getSessionUser(postgresAuthStore(), sessionCookie);
}

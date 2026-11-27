import { createHash, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "tabletap_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60_000;

export interface AdminIdentity {
  name: string;
}

export interface StoredAdminCredential {
  passwordHash: string | null;
  credentialVersion: number;
}

/** Persistence operations used by singleton administrator auth and sessions. */
export interface AuthStore {
  getAdminCredential(): Promise<StoredAdminCredential | null>;
  initializePassword(passwordHash: string, eventId: string, now: number): Promise<boolean>;
  resetPassword(passwordHash: string, eventId: string, now: number): Promise<boolean>;
  createSession(session: {
    tokenHash: string;
    credentialVersion: number;
    expiresAt: number;
    createdAt: number;
  }): Promise<void>;
  getSessionUser(tokenHash: string, now: number): Promise<AdminIdentity | null>;
  deleteSession(tokenHash: string): Promise<void>;
  deleteExpiredSessions(now: number): Promise<void>;
}

export async function sha256(value: string): Promise<string> {
  return createHash("sha256").update(value).digest("hex");
}

export function readSessionToken(cookieHeader: string | null): string | null {
  for (const part of (cookieHeader ?? "").split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE) {
      const token = rest.join("=");
      return /^[a-f0-9]{64}$/.test(token) ? token : null;
    }
  }
  return null;
}

export function sessionCookie(token: string, secure: boolean): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}${secure ? "; Secure" : ""}`;
}

export function clearedSessionCookie(secure: boolean): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
}

export async function getSessionUser(
  store: AuthStore,
  cookieHeader: string | null,
  now = Date.now(),
): Promise<AdminIdentity | null> {
  const token = readSessionToken(cookieHeader);
  return token ? store.getSessionUser(await sha256(token), now) : null;
}

export async function endSession(
  store: AuthStore,
  cookieHeader: string | null,
): Promise<void> {
  const token = readSessionToken(cookieHeader);
  if (token) await store.deleteSession(await sha256(token));
}

export function sameSecret(left: string, right: string): boolean {
  const leftHash = createHash("sha256").update(left).digest();
  const rightHash = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}

import { NextResponse } from "next/server";

export const ACCESS_COOKIE_NAME = "reaigen_access";
export const REFRESH_COOKIE_NAME = "reaigen_refresh";

const DEFAULT_ACCESS_COOKIE_MAX_AGE = 60 * 60;         // 1 hour
const DEFAULT_REFRESH_COOKIE_MAX_AGE = 60 * 60 * 24 * 90; // 90 days

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  };
}

function decodeJwtPayload(token: string): { exp?: number } | null {
  try {
    const [, payload] = token.split(".");
    if (!payload) return null;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4 || 4)) % 4), "=");
    const json = Buffer.from(padded, "base64").toString("utf8");
    return JSON.parse(json) as { exp?: number };
  } catch {
    return null;
  }
}

function tokenMaxAgeSeconds(token: string, fallback: number): number {
  const exp = decodeJwtPayload(token)?.exp;
  if (!exp) return fallback;
  const seconds = Math.max(1, exp - Math.floor(Date.now() / 1000));
  return Number.isFinite(seconds) ? seconds : fallback;
}

export function setAuthCookies(
  response: NextResponse,
  payload: { access?: string | null; refresh?: string | null },
  currentRefresh?: string | null,
) {
  if (payload.access) {
    response.cookies.set(
      ACCESS_COOKIE_NAME,
      payload.access,
      cookieOptions(tokenMaxAgeSeconds(payload.access, DEFAULT_ACCESS_COOKIE_MAX_AGE)),
    );
  }

  const refreshToken = payload.refresh ?? currentRefresh ?? null;
  if (refreshToken) {
    response.cookies.set(
      REFRESH_COOKIE_NAME,
      refreshToken,
      cookieOptions(tokenMaxAgeSeconds(refreshToken, DEFAULT_REFRESH_COOKIE_MAX_AGE)),
    );
  }
}

export function clearAuthCookies(response: NextResponse) {
  response.cookies.set(ACCESS_COOKIE_NAME, "", {
    ...cookieOptions(0),
    expires: new Date(0),
  });
  response.cookies.set(REFRESH_COOKIE_NAME, "", {
    ...cookieOptions(0),
    expires: new Date(0),
  });
}

/**
 * The server's verdict that a session cannot be recovered, and the only thing
 * the app treats as grounds for signing someone out.
 *
 * A bare 401 is not that verdict. It is also what an endpoint returns when the
 * proxy forgot to attach the token, when one resource is refused while the
 * identity is perfectly good, or when the backend blips mid-deploy — and the
 * client used to sign the user out for every one of them. Only the proxies know
 * whether renewal was tried and failed, so only they get to say so.
 */
export const SESSION_STATUS_HEADER = "X-Reaigen-Session";
export const SESSION_EXPIRED = "expired";

/** Clear the session and mark the response as the reason it ended. */
export function expireSession(response: NextResponse) {
  clearAuthCookies(response);
  response.headers.set(SESSION_STATUS_HEADER, SESSION_EXPIRED);
  return response;
}

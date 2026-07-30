import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import {
  ACCESS_COOKIE_NAME,
  REFRESH_COOKIE_NAME,
  setAuthCookies,
  clearAuthCookies,
} from "../../../lib/server/auth-cookies";
import { fetchBackend } from "../../../lib/server/backend-fetch";

const BACKEND_URL =
  process.env.REAIGEN_BACKEND_URL ?? "http://localhost:8000";
const SHARE_PIN_COOKIE_PREFIX = "reaigen_share_pin_";
const SHARE_SESSION_COOKIE_PREFIX = "reaigen_share_session_";
const DJANGO_SESSION_COOKIE_NAME = "sessionid";
const SHARE_PIN_COOKIE_MAX_AGE = 60 * 60 * 12; // 12 hours

function backendCandidates(): string[] {
  const configured = BACKEND_URL.replace(/\/+$/, "");
  const candidates = [configured];

  try {
    const url = new URL(configured);
    const isLocalhost = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (isLocalhost) {
      const alternates = [80, 8000]
        .filter((port) => String(port) !== (url.port || (url.protocol === "https:" ? "443" : "80")))
        .map((port) => `${url.protocol}//${url.hostname}:${port}`);
      candidates.push(...alternates);
    }
  } catch {
    // Keep configured URL only if it's not parseable.
  }

  return [...new Set(candidates)];
}

function noStoreHeaders(contentType: string) {
  return {
    "Content-Type": contentType,
    "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate",
    Pragma: "no-cache",
    Expires: "0",
    Vary: "Cookie, Authorization",
  };
}

function sharePinCookieName(token: string): string {
  return `${SHARE_PIN_COOKIE_PREFIX}${createHash("sha256").update(token).digest("hex").slice(0, 24)}`;
}

function shareSessionCookieName(token: string): string {
  return `${SHARE_SESSION_COOKIE_PREFIX}${createHash("sha256").update(token).digest("hex").slice(0, 24)}`;
}

function sharePinCookieOptions(token: string) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: `/api/reaigen/shared/${encodeURIComponent(token)}/`,
    maxAge: SHARE_PIN_COOKIE_MAX_AGE,
  };
}

function shareSessionCookieOptions(token: string) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: `/api/reaigen/shared/${encodeURIComponent(token)}/`,
    maxAge: SHARE_PIN_COOKIE_MAX_AGE,
  };
}

function backendSessionCookieValue(response: Response): string | null {
  const setCookie = response.headers.get("set-cookie");
  if (!setCookie) return null;
  const match = setCookie.match(
    new RegExp(`(?:^|[,;]\\s*)${DJANGO_SESSION_COOKIE_NAME}=([^;,\\s]+)`),
  );
  return match?.[1] ?? null;
}

function preserveSharedVisitSession(
  response: NextResponse,
  backendResponse: Response,
  token: string | null,
): void {
  if (!token) return;
  const sessionValue = backendSessionCookieValue(backendResponse);
  if (!sessionValue) return;
  response.cookies.set(
    shareSessionCookieName(token),
    sessionValue,
    shareSessionCookieOptions(token),
  );
}

function getSharedTokenForPath(joined: string, suffix: string): string | null {
  const parts = joined.split("/");
  if (parts.length >= 3 && parts[0] === "shared" && parts[2] === suffix) {
    return parts[1] || null;
  }
  return null;
}

/**
 * Public share content is split across the draft payload and the optional tour
 * payload. A successful PIN verification must unlock both requests; otherwise
 * a protected tour can load while its property page remains a blank 403.
 */
function getSharedContentToken(joined: string): string | null {
  const parts = joined.split("/");
  if (parts[0] !== "shared" || !parts[1]) return null;
  if (parts.length === 2 || parts[2] === "tour-viewer") return parts[1];
  return null;
}

// Map frontend proxy paths to Django API paths
function resolveTarget(baseUrl: string, joined: string): string {
  // Reai creator agent is a separate Django app and privacy boundary.
  if (joined === "reai-agent" || joined.startsWith("reai-agent/")) {
    return `${baseUrl}/api/v1/${joined}`;
  }
  // Lookup tables live beside the product apps in Django, not under /reaigen.
  // Keeping them behind the authenticated same-origin proxy lets browser upload
  // flows resolve canonical asset type IDs without hard-coded database PKs.
  if (joined === "lookups" || joined.startsWith("lookups/")) {
    return `${baseUrl}/api/v1/${joined}`;
  }
  // Core app endpoints → /api/v1/core/*
  const coreRoutes = [
    "users",
    "profiles",
    "personalized-data",
    "billing",
    "activities",
    "contact-links",
    "auth",
    "content",
    "notification-devices",
    "notifications",
  ];
  for (const prefix of coreRoutes) {
    if (joined.startsWith(prefix)) {
      return `${baseUrl}/api/v1/core/${joined}`;
    }
  }
  // /api/reaigen/* → /api/v1/reaigen/*
  return `${baseUrl}/api/v1/reaigen/${joined}`;
}

async function refreshAccessToken(refreshToken: string): Promise<string | null> {
  for (const baseUrl of backendCandidates()) {
    try {
      const res = await fetchBackend(`${baseUrl}/api/v1/core/auth/refresh/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh: refreshToken }),
        cache: "no-store",
      }, 5_000);
      if (!res.ok) continue;
      const data = (await res.json()) as { access?: string };
      return data.access ?? null;
    } catch {
      continue;
    }
  }
  return null;
}

async function proxy(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  const joined = path.join("/");
  const slash = joined.endsWith("/") ? "" : "/";
  const targetUrlSearchParams = new URLSearchParams(req.nextUrl.searchParams);
  const sharedContentToken = getSharedContentToken(joined);
  if (sharedContentToken && !targetUrlSearchParams.has("pin_token")) {
    const pinToken = req.cookies.get(sharePinCookieName(sharedContentToken))?.value ?? null;
    if (pinToken) targetUrlSearchParams.set("pin_token", pinToken);
  }
  const qs = targetUrlSearchParams.size > 0 ? `?${targetUrlSearchParams.toString()}` : "";
  let accessToken = req.cookies.get(ACCESS_COOKIE_NAME)?.value ?? null;
  const refreshToken = req.cookies.get(REFRESH_COOKIE_NAME)?.value ?? null;

  const headers: Record<string, string> = {
    "X-Reaigen-Client": "web",
  };
  const ct = req.headers.get("Content-Type");
  if (ct) headers["Content-Type"] = ct;
  if (accessToken) headers["Authorization"] = `Bearer ${accessToken}`;
  if (sharedContentToken) {
    const sharedSession = req.cookies.get(
      shareSessionCookieName(sharedContentToken),
    )?.value;
    if (sharedSession) {
      headers.Cookie = `${DJANGO_SESSION_COOKIE_NAME}=${sharedSession}`;
    }
  }

  const init: RequestInit = { method: req.method, headers };
  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = await req.text();
  }

  for (const baseUrl of backendCandidates()) {
    const target = `${resolveTarget(baseUrl, joined)}${slash}${qs}`;
    const timeoutMs = joined === "users/me" ? 5_000 : undefined;
    try {
      let res = await fetchBackend(target, { ...init, cache: "no-store" }, timeoutMs);

      if (res.status === 401 && refreshToken) {
        const newAccess = await refreshAccessToken(refreshToken);
        if (newAccess) {
          accessToken = newAccess;
          headers["Authorization"] = `Bearer ${newAccess}`;
          res = await fetchBackend(target, { ...init, headers, cache: "no-store" }, timeoutMs);

          const data = await res.text();
          const contentType = res.headers.get("Content-Type") ?? "application/json";
          const response = new NextResponse(data, {
            status: res.status,
            headers: noStoreHeaders(contentType),
          });
          preserveSharedVisitSession(
            response,
            res,
            sharedContentToken,
          );
          setAuthCookies(response, { access: newAccess }, refreshToken);
          return response;
        } else {
          const response = NextResponse.json(
            { error: "Session expired" },
            { status: 401, headers: noStoreHeaders("application/json") },
          );
          clearAuthCookies(response);
          return response;
        }
      }

      const data = await res.text();
      const contentType = res.headers.get("Content-Type") ?? "application/json";
      const response = new NextResponse(data, {
        status: res.status,
        // Authenticated responses must never enter the browser HTTP cache:
        // private cache entries are keyed by URL, not by the identity stored
        // in HttpOnly cookies, and can otherwise cross a logout/login boundary.
        headers: noStoreHeaders(contentType),
      });
      preserveSharedVisitSession(
        response,
        res,
        sharedContentToken,
      );

      const verifiedShareToken = getSharedTokenForPath(joined, "verify-pin");
      if (res.ok && verifiedShareToken && contentType.includes("application/json")) {
        try {
          const payload = JSON.parse(data) as { pin_token?: string; verified?: boolean };
          if (payload.pin_token) {
            const sanitized = NextResponse.json(
              { verified: payload.verified ?? true },
              { status: res.status, headers: noStoreHeaders("application/json") },
            );
            sanitized.cookies.set(
              sharePinCookieName(verifiedShareToken),
              payload.pin_token,
              sharePinCookieOptions(verifiedShareToken),
            );
            return sanitized;
          }
        } catch {
          return response;
        }
      }

      return response;
    } catch {
      // Try the next configured local/backend candidate.
    }
  }

  return NextResponse.json(
    { error: "Backend unreachable" },
    { status: 502, headers: noStoreHeaders("application/json") },
  );
}

export const GET = proxy;
export const POST = proxy;
export const PATCH = proxy;
export const PUT = proxy;
export const DELETE = proxy;

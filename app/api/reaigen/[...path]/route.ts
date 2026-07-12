import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import {
  ACCESS_COOKIE_NAME,
  REFRESH_COOKIE_NAME,
  setAuthCookies,
  clearAuthCookies,
} from "../../../lib/server/auth-cookies";

const BACKEND_URL =
  process.env.REAIGEN_BACKEND_URL ?? "http://localhost:8000";
const SHARE_PIN_COOKIE_PREFIX = "reaigen_share_pin_";
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
  };
}

/** Allow caching for read-only list/detail endpoints (splats list, viewer data). */
function cacheableHeaders(contentType: string, maxAge = 60) {
  return {
    "Content-Type": contentType,
    "Cache-Control": `private, max-age=${maxAge}, stale-while-revalidate=${maxAge * 4}`,
  };
}

/** Paths where GET responses can be briefly cached (private, short TTL). */
const CACHEABLE_GET_PREFIXES = ["splats", "drafts", "shares"];

function isCacheableGet(method: string, joined: string): boolean {
  if (method !== "GET") return false;
  // Only cache list / detail reads, not auth or mutation-like endpoints
  return CACHEABLE_GET_PREFIXES.some((p) => joined.startsWith(p));
}

function sharePinCookieName(token: string): string {
  return `${SHARE_PIN_COOKIE_PREFIX}${createHash("sha256").update(token).digest("hex").slice(0, 24)}`;
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

function getSharedTokenForPath(joined: string, suffix: string): string | null {
  const parts = joined.split("/");
  if (parts.length >= 3 && parts[0] === "shared" && parts[2] === suffix) {
    return parts[1] || null;
  }
  return null;
}

// Map frontend proxy paths to Django API paths
function resolveTarget(baseUrl: string, joined: string): string {
  // Core app endpoints → /api/v1/core/*
  const coreRoutes = ["users", "profiles", "personalized-data", "billing", "activities", "contact-links", "auth", "content"];
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
      const res = await fetch(`${baseUrl}/api/v1/core/auth/refresh/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh: refreshToken }),
        cache: "no-store",
      });
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
  const sharedTourToken = getSharedTokenForPath(joined, "tour-viewer");
  if (sharedTourToken && !targetUrlSearchParams.has("pin_token")) {
    const pinToken = req.cookies.get(sharePinCookieName(sharedTourToken))?.value ?? null;
    if (pinToken) targetUrlSearchParams.set("pin_token", pinToken);
  }
  const qs = targetUrlSearchParams.size > 0 ? `?${targetUrlSearchParams.toString()}` : "";
  let accessToken = req.cookies.get(ACCESS_COOKIE_NAME)?.value ?? null;
  const refreshToken = req.cookies.get(REFRESH_COOKIE_NAME)?.value ?? null;

  const headers: Record<string, string> = {};
  const ct = req.headers.get("Content-Type");
  if (ct) headers["Content-Type"] = ct;
  if (accessToken) headers["Authorization"] = `Bearer ${accessToken}`;

  const init: RequestInit = { method: req.method, headers };
  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = await req.text();
  }

  let lastError: unknown = null;

  for (const baseUrl of backendCandidates()) {
    const target = `${resolveTarget(baseUrl, joined)}${slash}${qs}`;
    try {
      let res = await fetch(target, { ...init, cache: "no-store" });

      if (res.status === 401 && refreshToken) {
        const newAccess = await refreshAccessToken(refreshToken);
        if (newAccess) {
          accessToken = newAccess;
          headers["Authorization"] = `Bearer ${newAccess}`;
          res = await fetch(target, { ...init, headers, cache: "no-store" });

          const data = await res.text();
          const contentType = res.headers.get("Content-Type") ?? "application/json";
          const response = new NextResponse(data, {
            status: res.status,
            headers: noStoreHeaders(contentType),
          });
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
      const useCache = res.ok && isCacheableGet(req.method, joined);
      const response = new NextResponse(data, {
        status: res.status,
        headers: useCache ? cacheableHeaders(contentType) : noStoreHeaders(contentType),
      });

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
    } catch (err) {
      lastError = err;
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

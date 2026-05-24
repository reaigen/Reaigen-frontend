import { NextRequest, NextResponse } from "next/server";
import {
  ACCESS_COOKIE_NAME,
  REFRESH_COOKIE_NAME,
  setAuthCookies,
  clearAuthCookies,
} from "../../../lib/server/auth-cookies";

const BACKEND_URL =
  process.env.REAIGEN_BACKEND_URL ?? "http://localhost:8000";

function noStoreHeaders(contentType: string) {
  return {
    "Content-Type": contentType,
    "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate",
    Pragma: "no-cache",
    Expires: "0",
  };
}

// Map frontend proxy paths to Django API paths
function resolveTarget(joined: string): string {
  // /api/reaigen/users/* → /api/v1/core/users/*
  if (joined.startsWith("users")) {
    return `${BACKEND_URL}/api/v1/core/${joined}`;
  }
  // /api/reaigen/* → /api/v1/reaigen/*
  return `${BACKEND_URL}/api/v1/reaigen/${joined}`;
}

async function refreshAccessToken(refreshToken: string): Promise<string | null> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/v1/core/auth/token/refresh/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh: refreshToken }),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { access?: string };
    return data.access ?? null;
  } catch {
    return null;
  }
}

async function proxy(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  const joined = path.join("/");
  const slash = joined.endsWith("/") ? "" : "/";
  const qs = req.nextUrl.search ?? "";
  const target = `${resolveTarget(joined)}${slash}${qs}`;

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

  try {
    let res = await fetch(target, { ...init, cache: "no-store" });

    // If 401 and we have a refresh token, try to refresh
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
        // Refresh failed — clear cookies
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
    return new NextResponse(data, {
      status: res.status,
      headers: noStoreHeaders(contentType),
    });
  } catch (err) {
    return NextResponse.json(
      { error: "Backend unreachable", detail: String(err) },
      { status: 502, headers: noStoreHeaders("application/json") },
    );
  }
}

export const GET = proxy;
export const POST = proxy;
export const PATCH = proxy;
export const PUT = proxy;
export const DELETE = proxy;

import { NextRequest, NextResponse } from "next/server";
import {
  REFRESH_COOKIE_NAME,
  clearAuthCookies,
  setAuthCookies,
} from "../../../lib/server/auth-cookies";
import { fetchBackend } from "../../../lib/server/backend-fetch";
import { isSafeProxyPath } from "../../../lib/server/proxy-path";

const BACKEND_URL =
  process.env.REAIGEN_BACKEND_URL ?? "http://localhost:8000";

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

async function proxy(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;

  // Same guard as the reaigen proxy: a dot-segment would escape the
  // /api/v1/core/auth/ prefix once fetch normalizes the target URL.
  if (!isSafeProxyPath(path)) {
    return NextResponse.json(
      { error: "Invalid request path" },
      { status: 400, headers: noStoreHeaders("application/json") },
    );
  }

  const joined = path.join("/");

  if (joined === "logout") {
    const response = NextResponse.json(
      { ok: true },
      { status: 200, headers: noStoreHeaders("application/json") },
    );
    response.headers.set("Clear-Site-Data", "\"cache\", \"storage\"");
    clearAuthCookies(response);
    return response;
  }

  const slash = joined.endsWith("/") ? "" : "/";
  const headers: Record<string, string> = {};
  const ct = req.headers.get("Content-Type");
  if (ct) headers["Content-Type"] = ct;

  const init: RequestInit = { method: req.method, headers };

  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = await req.text();
  }

  for (const baseUrl of backendCandidates()) {
    const target = `${baseUrl}/api/v1/core/auth/${joined}${slash}${req.nextUrl.search}`;
    try {
      const res = await fetchBackend(target, { ...init, cache: "no-store" }, 5_000);
      const data = await res.text();
      const contentType = res.headers.get("Content-Type") ?? "application/json";
      const response = new NextResponse(data, {
        status: res.status,
        headers: noStoreHeaders(contentType),
      });

      if (res.ok && contentType.includes("application/json")) {
        try {
          const payload = JSON.parse(data) as {
            access?: string;
            refresh?: string;
            tokens?: { access?: string; refresh?: string };
            user?: unknown;
            message?: string;
          };
          const tokenPayload = payload.tokens ?? payload;
          if (tokenPayload.access || tokenPayload.refresh) {
            const body: Record<string, unknown> = { ok: true, message: payload.message };
            if (payload.user) body.user = payload.user;
            const sanitized = NextResponse.json(
              body,
              { status: res.status, headers: noStoreHeaders("application/json") },
            );
            // Flush responses cached by older web builds before establishing
            // the new identity. Current builds mark every private response
            // no-store, so this is primarily a migration safety boundary.
            sanitized.headers.set("Clear-Site-Data", "\"cache\"");
            setAuthCookies(
              sanitized,
              tokenPayload,
              req.cookies.get(REFRESH_COOKIE_NAME)?.value ?? null,
            );
            return sanitized;
          }
        } catch {
          // Non-token responses pass through
        }
      }

      if (!res.ok && joined === "token/refresh") {
        clearAuthCookies(response);
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

export const POST = proxy;
export const GET = proxy;

import { NextRequest, NextResponse } from "next/server";
import {
  ACCESS_COOKIE_NAME,
  REFRESH_COOKIE_NAME,
  setAuthCookies,
} from "@/app/lib/server/auth-cookies";
import { fetchBackend } from "@/app/lib/server/backend-fetch";
import { refreshSession, type RefreshedTokens } from "@/app/lib/server/token-refresh";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BACKEND_URL = process.env.REAIGEN_BACKEND_URL ?? "http://localhost:8000";
const FORWARDED_RESPONSE_HEADERS = [
  "accept-ranges",
  "cache-control",
  "content-length",
  "content-range",
  "content-type",
  "etag",
  "last-modified",
] as const;

function backendCandidates(): string[] {
  const configured = BACKEND_URL.replace(/\/+$/, "");
  const candidates = [configured];
  try {
    const url = new URL(configured);
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
      const current = url.port || (url.protocol === "https:" ? "443" : "80");
      for (const port of [80, 8000]) {
        if (String(port) !== current) {
          candidates.push(`${url.protocol}//${url.hostname}:${port}`);
        }
      }
    }
  } catch {
    // A configured non-URL will fail below with a controlled 502.
  }
  return [...new Set(candidates)];
}

function errorResponse(status: number, detail: string) {
  return NextResponse.json(
    { detail },
    {
      status,
      headers: {
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}

function deliveryHeaders(source: Response): Headers {
  const headers = new Headers({
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=3600",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Vary": "Cookie",
    "X-Content-Type-Options": "nosniff",
  });
  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = source.headers.get(name);
    if (value) headers.set(name, value);
  }
  return headers;
}

async function streamSog(
  req: NextRequest,
  context: { params: Promise<{ tourId: string; splatId: string }> },
) {
  const { tourId, splatId } = await context.params;
  if (!/^\d{1,18}$/.test(tourId) || !/^\d{1,18}$/.test(splatId)) {
    return errorResponse(400, "Numeric tour and splat ids are required.");
  }

  let accessToken = req.cookies.get(ACCESS_COOKIE_NAME)?.value ?? null;
  const refreshToken = req.cookies.get(REFRESH_COOKIE_NAME)?.value ?? null;
  if (!accessToken && !refreshToken) {
    return errorResponse(401, "Authentication required.");
  }

  const forwarded: Record<string, string> = {
    "X-Reaigen-Client": "web",
  };
  for (const name of ["range", "if-range", "if-none-match", "if-modified-since"]) {
    const value = req.headers.get(name);
    if (value) forwarded[name] = value;
  }

  const requestBackend = async (bearer: string | null): Promise<Response | null> => {
    if (bearer) forwarded.Authorization = `Bearer ${bearer}`;
    else delete forwarded.Authorization;
    for (const baseUrl of backendCandidates()) {
      try {
        return await fetchBackend(
          `${baseUrl}/api/v1/reaigen/web-creation/tours/${tourId}/assets/${splatId}/content/`,
          {
            method: req.method,
            headers: forwarded,
            cache: "no-store",
          },
          30_000,
        );
      } catch {
        // Try the next configured local backend origin.
      }
    }
    return null;
  };

  let rotated: RefreshedTokens | null = null;
  let upstream = await requestBackend(accessToken);
  if ((!upstream || upstream.status === 401) && refreshToken) {
    rotated = await refreshSession(refreshToken, backendCandidates());
    if (rotated) {
      accessToken = rotated.access;
      upstream = await requestBackend(accessToken);
    }
  }
  if (!upstream) return errorResponse(502, "SOG storage did not respond.");

  const response = new NextResponse(
    req.method === "HEAD" ? null : upstream.body,
    {
      status: upstream.status,
      headers: deliveryHeaders(upstream),
    },
  );
  if (rotated) setAuthCookies(response, rotated, refreshToken);
  return response;
}

export const GET = streamSog;
export const HEAD = streamSog;

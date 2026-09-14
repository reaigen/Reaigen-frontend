import { NextRequest, NextResponse } from "next/server";
import {
  ACCESS_COOKIE_NAME,
  REFRESH_COOKIE_NAME,
  expireSession,
  setAuthCookies,
} from "../../../lib/server/auth-cookies";
import { verifyCreatorSession } from "../../../lib/server/creator-session";

export const runtime = "nodejs";

const PRIVATE_RESPONSE_HEADERS = {
  "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate",
  "X-Content-Type-Options": "nosniff",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Referrer-Policy": "same-origin",
  "Vary": "Cookie",
};

function finiteCoordinate(value: unknown, min: number, max: number) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

function sameOriginRequest(request: NextRequest) {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") return false;

  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) return false;

  const referer = request.headers.get("referer");
  if (!referer) return true;
  try {
    return new URL(referer).origin === request.nextUrl.origin;
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  if (!sameOriginRequest(request)) {
    return new Response(null, { status: 403, headers: PRIVATE_RESPONSE_HEADERS });
  }

  const accessToken = request.cookies.get(ACCESS_COOKIE_NAME)?.value ?? null;
  const refreshToken = request.cookies.get(REFRESH_COOKIE_NAME)?.value ?? null;
  if (!accessToken && !refreshToken) {
    return new Response(null, { status: 401, headers: PRIVATE_RESPONSE_HEADERS });
  }

  const session = await verifyCreatorSession(accessToken, refreshToken);
  if (!session.ok) {
    if (session.refused) {
      return expireSession(new NextResponse(null, {
        status: 401,
        headers: PRIVATE_RESPONSE_HEADERS,
      }), session.reason);
    }
    return new Response(null, { status: 502, headers: PRIVATE_RESPONSE_HEADERS });
  }

  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return new Response(null, { status: 415, headers: PRIVATE_RESPONSE_HEADERS });
  }

  let payload: { latitude?: unknown; longitude?: unknown };
  try {
    payload = await request.json();
  } catch {
    return new Response(null, { status: 400, headers: PRIVATE_RESPONSE_HEADERS });
  }

  const apiKey = process.env.GOOGLE_MAPS_KEY?.trim();
  if (!apiKey?.startsWith("AIza") || apiKey.length < 30) {
    return new Response(null, { status: 503, headers: PRIVATE_RESPONSE_HEADERS });
  }

  const latitude = finiteCoordinate(payload.latitude, -90, 90);
  const longitude = finiteCoordinate(payload.longitude, -180, 180);
  if (latitude == null || longitude == null) {
    return new Response(null, { status: 422, headers: PRIVATE_RESPONSE_HEADERS });
  }

  const response = NextResponse.json(
    { apiKey, latitude, longitude },
    { headers: PRIVATE_RESPONSE_HEADERS },
  );
  if (session.refreshed) {
    setAuthCookies(response, session, refreshToken);
  }
  return response;
}

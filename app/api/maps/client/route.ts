import { NextRequest } from "next/server";
import {
  ACCESS_COOKIE_NAME,
  REFRESH_COOKIE_NAME,
} from "../../../lib/server/auth-cookies";

export const runtime = "nodejs";

const PRIVATE_RESPONSE_HEADERS = {
  "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate",
  "X-Content-Type-Options": "nosniff",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Referrer-Policy": "same-origin",
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

  const hasCreatorSession = Boolean(
    request.cookies.get(ACCESS_COOKIE_NAME)?.value
    || request.cookies.get(REFRESH_COOKIE_NAME)?.value,
  );
  if (!hasCreatorSession) {
    return new Response(null, { status: 401, headers: PRIVATE_RESPONSE_HEADERS });
  }

  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return new Response(null, { status: 415, headers: PRIVATE_RESPONSE_HEADERS });
  }

  let payload: { latitude?: unknown; longitude?: unknown; address?: unknown };
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
  const address = typeof payload.address === "string"
    ? payload.address.replace(/\s+/g, " ").trim().slice(0, 300)
    : "";
  const hasCoordinates = latitude != null && longitude != null;
  if (!hasCoordinates && address.length < 3) {
    return new Response(null, { status: 422, headers: PRIVATE_RESPONSE_HEADERS });
  }

  return Response.json(
    hasCoordinates
      ? { apiKey, latitude, longitude }
      : { apiKey, address },
    { headers: PRIVATE_RESPONSE_HEADERS },
  );
}

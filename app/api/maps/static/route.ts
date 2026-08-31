import { NextRequest } from "next/server";
import {
  ACCESS_COOKIE_NAME,
  REFRESH_COOKIE_NAME,
} from "../../../lib/server/auth-cookies";

export const runtime = "nodejs";

const GOOGLE_STATIC_MAPS_URL = "https://maps.googleapis.com/maps/api/staticmap";
const SUPPORTED_LANGUAGES = new Set(["en", "sk", "cs", "de"]);

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
    return new Response(null, { status: 403 });
  }

  // Exact addresses and coordinates belong to the authenticated creator
  // workspace. A public/shared browser must never be able to resolve them via
  // this server-side Google Maps key.
  const hasCreatorSession = Boolean(
    request.cookies.get(ACCESS_COOKIE_NAME)?.value
    || request.cookies.get(REFRESH_COOKIE_NAME)?.value,
  );
  if (!hasCreatorSession) {
    return new Response(null, { status: 401 });
  }

  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return new Response(null, { status: 415 });
  }

  const apiKey = process.env.GOOGLE_MAPS_KEY?.trim();
  if (!apiKey) {
    return new Response(null, { status: 503 });
  }

  let payload: { latitude?: unknown; longitude?: unknown; address?: unknown; lang?: unknown };
  try {
    payload = await request.json();
  } catch {
    return new Response(null, { status: 400 });
  }

  const latitude = finiteCoordinate(payload.latitude, -90, 90);
  const longitude = finiteCoordinate(payload.longitude, -180, 180);
  const address = typeof payload.address === "string" ? payload.address.trim().slice(0, 300) : "";
  const hasPoint = latitude != null && longitude != null;
  if (!hasPoint && address.length < 3) {
    return new Response(null, { status: 400 });
  }

  const requestedLanguage = typeof payload.lang === "string" ? payload.lang.slice(0, 2).toLowerCase() : "en";
  const language = SUPPORTED_LANGUAGES.has(requestedLanguage) ? requestedLanguage : "en";
  const target = hasPoint ? `${latitude},${longitude}` : address;
  const googleUrl = new URL(GOOGLE_STATIC_MAPS_URL);
  googleUrl.searchParams.set("center", target);
  googleUrl.searchParams.set("zoom", hasPoint ? "15" : "14");
  googleUrl.searchParams.set("size", "640x480");
  googleUrl.searchParams.set("scale", "2");
  googleUrl.searchParams.set("format", "png32");
  googleUrl.searchParams.set("maptype", "roadmap");
  googleUrl.searchParams.set("language", language);
  googleUrl.searchParams.set("markers", `size:mid|color:0x171717|${target}`);
  googleUrl.searchParams.append("style", "feature:all|element:geometry|color:0xf3f3f0");
  googleUrl.searchParams.append("style", "feature:road|element:geometry|color:0xffffff");
  googleUrl.searchParams.append("style", "feature:road|element:labels.text.fill|color:0x595959");
  googleUrl.searchParams.append("style", "feature:poi|element:geometry|color:0xe7e8e4");
  googleUrl.searchParams.append("style", "feature:poi|element:labels.text.fill|color:0x686868");
  googleUrl.searchParams.append("style", "feature:transit|element:geometry|color:0xe2e3e0");
  googleUrl.searchParams.append("style", "feature:water|element:geometry|color:0xd6d9d7");
  googleUrl.searchParams.append("style", "element:labels.icon|visibility:off");
  googleUrl.searchParams.set("key", apiKey);

  try {
    const response = await fetch(googleUrl, {
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    const contentType = response.headers.get("content-type") ?? "";
    if (!response.ok || !contentType.startsWith("image/")) {
      return new Response(null, { status: 502 });
    }

    return new Response(response.body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        // A private location must not be stored by a shared CDN cache.
        "Cache-Control": "private, max-age=900, no-transform",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "same-origin",
      },
    });
  } catch {
    return new Response(null, { status: 504 });
  }
}

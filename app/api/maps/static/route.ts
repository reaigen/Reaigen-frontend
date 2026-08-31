import { NextRequest } from "next/server";
import {
  ACCESS_COOKIE_NAME,
  REFRESH_COOKIE_NAME,
} from "../../../lib/server/auth-cookies";

export const runtime = "nodejs";

const GOOGLE_STATIC_MAPS_URL = "https://maps.googleapis.com/maps/api/staticmap";
const SUPPORTED_LANGUAGES = new Set(["en", "sk", "cs", "de"]);
const OSM_GEOCODER_URL = "https://nominatim.openstreetmap.org/search";
const OSM_TILE_SIZE = 256;
const FALLBACK_WIDTH = 960;
const FALLBACK_HEIGHT = 720;

function webMercatorPixel(latitude: number, longitude: number, zoom: number) {
  const scale = 2 ** zoom * OSM_TILE_SIZE;
  const boundedLatitude = Math.max(-85.05112878, Math.min(85.05112878, latitude));
  const radians = boundedLatitude * Math.PI / 180;
  return {
    x: (longitude + 180) / 360 * scale,
    y: (1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2 * scale,
  };
}

/**
 * Coordinate-only fallback used when the deployment's Google key is missing
 * or unavailable. Tiles are fetched server-side and composed into one image,
 * so the creator's coordinates never become a browser-visible tile URL.
 */
async function coordinateFallbackMap(latitude: number, longitude: number) {
  const zoom = 15;
  const center = webMercatorPixel(latitude, longitude, zoom);
  const left = Math.round(center.x - FALLBACK_WIDTH / 2);
  const top = Math.round(center.y - FALLBACK_HEIGHT / 2);
  const firstTileX = Math.floor(left / OSM_TILE_SIZE);
  const lastTileX = Math.floor((left + FALLBACK_WIDTH - 1) / OSM_TILE_SIZE);
  const firstTileY = Math.floor(top / OSM_TILE_SIZE);
  const lastTileY = Math.floor((top + FALLBACK_HEIGHT - 1) / OSM_TILE_SIZE);
  const tileCount = 2 ** zoom;

  const tiles = await Promise.all(
    Array.from({ length: lastTileY - firstTileY + 1 }, (_, yOffset) => firstTileY + yOffset)
      .flatMap((tileY) => Array.from(
        { length: lastTileX - firstTileX + 1 },
        (_, xOffset) => ({ tileX: firstTileX + xOffset, tileY }),
      ))
      .map(async ({ tileX, tileY }) => {
        const wrappedX = ((tileX % tileCount) + tileCount) % tileCount;
        if (tileY < 0 || tileY >= tileCount) return null;
        const response = await fetch(`https://tile.openstreetmap.org/${zoom}/${wrappedX}/${tileY}.png`, {
          headers: { "User-Agent": "Reaigen/1.0 (https://reaigen.io)" },
          next: { revalidate: 86_400 },
          signal: AbortSignal.timeout(5_000),
        });
        if (!response.ok) return null;
        return {
          input: Buffer.from(await response.arrayBuffer()),
          left: tileX * OSM_TILE_SIZE - left,
          top: tileY * OSM_TILE_SIZE - top,
        };
      }),
  );

  const availableTiles = tiles.filter((tile): tile is NonNullable<typeof tile> => Boolean(tile));
  if (availableTiles.length === 0) return null;

  const marker = Buffer.from(`
    <svg width="${FALLBACK_WIDTH}" height="${FALLBACK_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <g transform="translate(${FALLBACK_WIDTH / 2} ${FALLBACK_HEIGHT / 2 - 13})">
        <circle r="24" fill="white" fill-opacity=".94" stroke="#171717" stroke-opacity=".14"/>
        <path d="M0-12c-7 0-12 5.4-12 12 0 9 12 23 12 23S12 9 12 0C12-6.6 7-12 0-12Z" fill="#171717"/>
        <circle cy="0" r="4" fill="white"/>
      </g>
      <g transform="translate(${FALLBACK_WIDTH - 212} ${FALLBACK_HEIGHT - 30})">
        <rect width="200" height="20" rx="10" fill="white" fill-opacity=".88"/>
        <text x="100" y="14" text-anchor="middle" font-family="Arial, sans-serif" font-size="11" fill="#3f3f3f">© OpenStreetMap contributors</text>
      </g>
    </svg>
  `);
  const { default: sharp } = await import("sharp");
  return sharp({
    create: {
      width: FALLBACK_WIDTH,
      height: FALLBACK_HEIGHT,
      channels: 4,
      background: "#eceeea",
    },
  })
    .composite([...availableTiles, { input: marker, left: 0, top: 0 }])
    .png()
    .toBuffer();
}

async function fallbackMapResponse(latitude: number, longitude: number) {
  const fallback = await coordinateFallbackMap(latitude, longitude);
  if (!fallback) return null;
  return new Response(new Uint8Array(fallback), {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "private, max-age=900, no-transform",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "same-origin",
      "X-Reaigen-Map-Provider": "openstreetmap-fallback",
    },
  });
}

async function geocodePrivateAddress(address: string, language: string) {
  const geocoderUrl = new URL(OSM_GEOCODER_URL);
  geocoderUrl.searchParams.set("q", address);
  geocoderUrl.searchParams.set("format", "jsonv2");
  geocoderUrl.searchParams.set("limit", "1");
  geocoderUrl.searchParams.set("addressdetails", "0");
  geocoderUrl.searchParams.set("accept-language", language);

  const response = await fetch(geocoderUrl, {
    headers: {
      "User-Agent": "Reaigen/1.0 (https://reaigen.io)",
      Accept: "application/json",
    },
    // This request is made only from the authenticated map route. Cache the
    // resolved point on the server so reopening a concept does not repeatedly
    // disclose or geocode the same creator-owned address.
    next: { revalidate: 604_800 },
    signal: AbortSignal.timeout(6_000),
  });
  if (!response.ok) return null;

  const results: unknown = await response.json();
  if (!Array.isArray(results) || results.length === 0) return null;
  const first = results[0] as { lat?: unknown; lon?: unknown };
  const latitude = finiteCoordinate(first.lat, -90, 90);
  const longitude = finiteCoordinate(first.lon, -180, 180);
  return latitude != null && longitude != null ? { latitude, longitude } : null;
}

async function addressFallbackMapResponse(address: string, language: string) {
  const point = await geocodePrivateAddress(address, language);
  return point ? fallbackMapResponse(point.latitude, point.longitude) : null;
}

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
  const apiKey = process.env.GOOGLE_MAPS_KEY?.trim();
  const hasGoogleKey = Boolean(apiKey?.startsWith("AIza") && apiKey.length >= 30);

  if (!hasGoogleKey) {
    try {
      const fallback = hasPoint
        ? await fallbackMapResponse(latitude, longitude)
        : await addressFallbackMapResponse(address, language);
      if (fallback) return fallback;
    } catch {
      // Continue into the explicit unavailable response below.
    }
  }

  if (!hasGoogleKey) {
    return new Response(null, {
      status: 503,
      headers: { "X-Reaigen-Map-State": "configuration-unavailable" },
    });
  }

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
  googleUrl.searchParams.set("key", apiKey!);

  try {
    const response = await fetch(googleUrl, {
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    const contentType = response.headers.get("content-type") ?? "";
    if (!response.ok || !contentType.startsWith("image/")) {
      const fallback = hasPoint
        ? await fallbackMapResponse(latitude, longitude)
        : await addressFallbackMapResponse(address, language);
      if (fallback) return fallback;
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
        "X-Reaigen-Map-Provider": "google-static",
      },
    });
  } catch {
    try {
      const fallback = hasPoint
        ? await fallbackMapResponse(latitude, longitude)
        : await addressFallbackMapResponse(address, language);
      if (fallback) return fallback;
    } catch {
      // Return the explicit upstream timeout below.
    }
    return new Response(null, { status: 504 });
  }
}

/**
 * Mapbox GL — the primary provider for the property location map.
 *
 * Operator (2026-09-26): "use mapbox as maps because google is not loading …
 * we keep also google but now we have primary mapbox". The listing detail and
 * editor map render with Mapbox; Google Maps stays as the fallback when Mapbox
 * has no token or fails. Agent (Reai panel) map blocks stay on Google: Mapbox's
 * Product Terms §1.5(ii) bar using the service to operate AI technologies.
 *
 * The public `pk.` token is URL-restricted in the Mapbox account and reaches
 * the browser only through the authenticated `/api/maps/client` route, like
 * the Google key.
 */

export const MAPBOX_STYLE = "mapbox://styles/mapbox/streets-v12";
export const MAPBOX_READY_TIMEOUT_MS = 12_000;

type MapboxModule = typeof import("mapbox-gl");
export type MapboxGl = MapboxModule["default"];

export function isMapboxToken(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("pk.") && value.length >= 60 && !/\s/.test(value);
}

let modulePromise: Promise<MapboxGl> | null = null;

/** The bundled library, loaded once and only when a map is about to render. */
export function loadMapbox(token: string): Promise<MapboxGl> {
  if (!isMapboxToken(token)) return Promise.reject(new Error("mapbox-token-invalid"));
  modulePromise ??= import("mapbox-gl").then((module) => module.default);
  return modulePromise.then((mapboxgl) => {
    mapboxgl.accessToken = token;
    return mapboxgl;
  }).catch((error: unknown) => {
    modulePromise = null;
    throw error instanceof Error ? error : new Error("mapbox-load-failed");
  });
}

function mapboxLanguage(lang: string) {
  const code = String(lang || "").slice(0, 2).toLowerCase();
  return /^[a-z]{2}$/.test(code) ? code : "en";
}

/**
 * "bou 6373, 06004, sk" → the query without a trailing country code, and that
 * code as a country filter: Mapbox reads "sk" as a word, not as Slovakia.
 */
export function splitCountry(address: string): { query: string; country: string | null } {
  const parts = address.replace(/\s+/g, " ").split(",").map((part) => part.trim()).filter(Boolean);
  const last = parts[parts.length - 1] ?? "";
  if (parts.length > 1 && /^[a-z]{2}$/i.test(last)) {
    return { query: parts.slice(0, -1).join(", "), country: last.toLowerCase() };
  }
  return { query: parts.join(", "), country: null };
}

/** Forward-geocoding URL for one address (Geocoding v6, temporary results, best match only). */
export function mapboxGeocodeUrl(address: string, lang: string, token: string, country: string | null = null): string | null {
  const query = address.replace(/\s+/g, " ").trim();
  if (query.length < 3 || !isMapboxToken(token)) return null;
  const url = new URL("https://api.mapbox.com/search/geocode/v6/forward");
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "1");
  url.searchParams.set("language", mapboxLanguage(lang));
  if (country && /^[a-z]{2}$/.test(country)) url.searchParams.set("country", country);
  url.searchParams.set("access_token", token);
  return url.toString();
}

/**
 * The coordinates of an address-only draft, asked for only after the creator
 * chose "Show map". Results are shown on the Mapbox map and never stored.
 */
export async function geocodeAddress(
  address: string,
  lang: string,
  token: string,
  signal?: AbortSignal,
): Promise<{ lat: number; lng: number } | null> {
  const { query, country } = splitCountry(address);
  // The whole address first; then, when the street is not known to the map,
  // what follows it (postal code, town) — near the place beats no map.
  const parts = query.split(",").map((part) => part.trim()).filter(Boolean);
  const attempts = [query, parts.length > 1 ? parts.slice(1).join(", ") : null];
  for (const attempt of attempts) {
    if (!attempt) continue;
    const url = mapboxGeocodeUrl(attempt, lang, token, country);
    if (!url) continue;
    const response = await fetch(url, { signal, credentials: "omit", referrerPolicy: "strict-origin-when-cross-origin" });
    if (!response.ok) throw new Error("mapbox-geocode-failed");
    const payload: unknown = await response.json();
    const feature = (payload as { features?: Array<{ geometry?: { coordinates?: unknown } }> })?.features?.[0];
    const coordinates = feature?.geometry?.coordinates;
    if (!Array.isArray(coordinates) || coordinates.length < 2) continue;
    const [lng, lat] = coordinates.map(Number);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
    return { lat, lng };
  }
  return null;
}

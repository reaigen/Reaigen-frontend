import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { MAPBOX_STYLE, geocodeAddress, isMapboxToken, mapboxGeocodeUrl } from "./mapbox-client.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (path) => readFileSync(`${root}/${path}`, "utf8");
// A token-shaped fixture, not a real token.
const TOKEN = `pk.${"a".repeat(60)}.fixture`;

test("only a public pk. token is accepted", () => {
  assert.equal(isMapboxToken(TOKEN), true);
  for (const value of ["sk.secret-token-value-that-is-long-enough-to-pass-the-length-check-xx", "pk.short", "", null, `pk.${"a".repeat(60)} x`]) {
    assert.equal(isMapboxToken(value), false, String(value));
  }
  assert.equal(MAPBOX_STYLE.startsWith("mapbox://styles/"), true);
});

test("an address is geocoded with one best match in the creator's language", () => {
  const url = new URL(mapboxGeocodeUrl("  Vajnorská   65, Bratislava ", "sk-SK", TOKEN));
  assert.equal(url.origin, "https://api.mapbox.com");
  assert.equal(url.pathname, "/search/geocode/v6/forward");
  assert.equal(url.searchParams.get("q"), "Vajnorská 65, Bratislava");
  assert.equal(url.searchParams.get("limit"), "1");
  assert.equal(url.searchParams.get("language"), "sk");
  assert.equal(url.searchParams.get("access_token"), TOKEN);
  assert.equal(url.searchParams.has("permanent"), false, "temporary results only: nothing is stored");
  assert.equal(mapboxGeocodeUrl("ab", "en", TOKEN), null);
  assert.equal(mapboxGeocodeUrl("Bratislava", "en", "pk.short"), null);
});

test("the geocoding answer is read as longitude, latitude and checked", async () => {
  const previousFetch = globalThis.fetch;
  const answer = (body, ok = true) => async () => ({ ok, json: async () => body });
  try {
    globalThis.fetch = answer({ features: [{ geometry: { coordinates: [17.1325, 48.1604] } }] });
    assert.deepEqual(await geocodeAddress("Vajnorská 65", "sk", TOKEN), { lat: 48.1604, lng: 17.1325 });
    globalThis.fetch = answer({ features: [] });
    assert.equal(await geocodeAddress("Nowhere 1", "sk", TOKEN), null);
    globalThis.fetch = answer({ features: [{ geometry: { coordinates: [17.1, 123] } }] });
    assert.equal(await geocodeAddress("Out of range", "sk", TOKEN), null);
    globalThis.fetch = answer({}, false);
    await assert.rejects(geocodeAddress("Vajnorská 65", "sk", TOKEN), /mapbox-geocode-failed/);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("the property map draws Mapbox first and falls back to Google", () => {
  const card = read("app/components/property-map-card.tsx");
  assert.match(card, /import "mapbox-gl\/dist\/mapbox-gl\.css"/);
  assert.match(card, /setProvider\(config\.mapboxToken \? "mapbox" : "google"\)/);
  assert.match(card, /provider === "mapbox" && mapConfig\.mapboxToken/);
  assert.match(card, /provider === "google" && mapConfig\.apiKey/);
  assert.match(card, /if \(mapConfig\?\.apiKey\) \{[^}]*setProvider\("google"\)/s);
  assert.match(card, /MAPBOX_READY_TIMEOUT_MS/, "a map that never loads falls back instead of spinning");
  assert.match(card, /scrollZoom: false/, "the page scrolls; zoom is our buttons, pinch or double-click");
  // Parent callbacks are read through refs, so inline handlers cannot
  // rebuild the map on every render.
  assert.match(card, /onReadyRef\.current\?\.\(\)/);
  assert.match(card, /\}, \[token, center, interactive, language, zoom\]\);/);
  // The Google fallback is intact.
  assert.match(card, /<GoogleMapCanvas/);
  assert.match(card, /<GoogleAddressMapFrame/);
});

test("an address-only draft is geocoded only after Show map, and the address never reaches our route", () => {
  const card = read("app/components/property-map-card.tsx");
  const effect = card.slice(card.indexOf("After \"Show map\" only"));
  assert.match(effect, /!addressMapRequested/);
  assert.match(effect, /body: JSON\.stringify\(\{ purpose: "geocode" \}\)/);
  assert.match(effect, /geocodeAddress\(target\.address, lang, mapboxToken/);
  assert.match(effect, /addressFallbackToGoogle\(\)/);
});

test("the route authenticates before reading either key and hands out the Mapbox token", () => {
  const route = read("app/api/maps/client/route.ts");
  const verified = route.indexOf("verifyCreatorSession(accessToken, refreshToken)");
  assert.ok(verified > 0);
  assert.ok(verified < route.indexOf("process.env.MAPBOX_ACCESS_TOKEN"));
  assert.ok(verified < route.indexOf("process.env.GOOGLE_MAPS_KEY"));
  assert.match(route, /mapboxCandidate\?\.startsWith\("pk\."\)/);
  assert.match(route, /payload\.purpose === "geocode"/);
  assert.match(route, /NextResponse\.json\(\{ mapboxToken \}/);
  assert.match(route, /\{ apiKey, mapboxToken, latitude, longitude \}/);
  assert.doesNotMatch(route, /NEXT_PUBLIC_MAPBOX/);
});

test("every app page carries the map policy; the public viewer stays strict", () => {
  const config = read("next.config.ts");
  assert.match(config, /"https:\/\/api\.mapbox\.com", "https:\/\/\*\.tiles\.mapbox\.com", "https:\/\/events\.mapbox\.com"/);
  const catchAll = config.slice(config.indexOf('source: "/:path(('), config.indexOf('source: "/shared/:path*"'));
  assert.match(catchAll, /shared\|api/);
  assert.match(catchAll, /headers: googleMapsSecurityHeaders/);
  assert.match(config, /source: "\/shared\/:path\*",\s*headers: defaultSecurityHeaders/);
  const signIn = config.slice(config.indexOf('"/forgot-password"'), config.indexOf('"/dashboard/:path*"'));
  assert.match(signIn, /\.\.\.googleMapsSecurityHeaders/);
  assert.doesNotMatch(signIn, /\.\.\.defaultSecurityHeaders/);
});

test("agent map blocks stay on Google (Mapbox terms bar operating AI with it)", () => {
  const agent = read("app/components/agent-tiny-ui.tsx").toLowerCase();
  assert.equal(agent.includes("mapbox"), false);
});

test("the map shows only our controls, in the creator's language, inside the rounded card", () => {
  const card = read("app/components/property-map-card.tsx");
  const css = read("app/components/property-map.css");
  // No Mapbox chrome but the wordmark its terms require.
  assert.match(card, /attributionControl: false/);
  assert.doesNotMatch(card, /NavigationControl|cooperativeGestures: interactive/);
  assert.match(card, /logoPosition: "bottom-left"/);
  assert.match(card, /<MapZoomControls map=\{inlineMap\}/);
  assert.match(card, /<MapboxAttribution lang=\{lang\}/);
  // The attribution text Mapbox requires is still there.
  for (const required of ["https://www.mapbox.com/about/maps/", "https://www.openstreetmap.org/copyright", "https://www.mapbox.com/map-feedback/"]) {
    assert.ok(card.includes(required), required);
  }
  // Slovak, Czech and German words, not English, for those preferences.
  assert.match(card, /sk: \{ zoomIn: "Priblížiť", zoomOut: "Oddialiť", attribution: "Zdroje mapových údajov", improve: "Vylepšiť túto mapu" \}/);
  assert.match(card, /cs: \{ zoomIn: "Přiblížit"/);
  assert.match(card, /de: \{ zoomIn: "Vergrößern"/);
  // Rounding: the card clips the WebGL canvas, and mapbox-gl.css's
  // position: relative no longer overrides the absolute fill.
  assert.match(card, /\[clip-path:inset\(0_round_1\.6rem\)\]/);
  assert.match(card, /import "\.\/property-map\.css"/);
  assert.match(css, /\.reaigen-mapbox\.mapboxgl-map \{\s*position: absolute;\s*inset: 0;\s*border-radius: inherit;\s*overflow: hidden;/);
});

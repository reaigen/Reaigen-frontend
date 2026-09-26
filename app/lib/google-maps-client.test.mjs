import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  REAIGEN_GOOGLE_MAP_STYLES,
  REAIGEN_GOOGLE_MAPS_VERSION,
  googleMapsAddressEmbedUrl,
  googleMapsScriptUrl,
  loadGoogleMaps,
  resetGoogleMapsFailure,
} from "./google-maps-client.ts";

test("the Maps loader preserves path-compatible website authorization", () => {
  const url = new URL(googleMapsScriptUrl(
    "maps-test-key",
    "sk",
    "__reaigenGoogleMapsReady",
  ));

  assert.equal(url.origin, "https://maps.googleapis.com");
  assert.equal(url.pathname, "/maps/api/js");
  assert.equal(url.searchParams.get("key"), "maps-test-key");
  assert.equal(url.searchParams.get("language"), "sk");
  assert.equal(url.searchParams.get("callback"), "__reaigenGoogleMapsReady");
  assert.equal(url.searchParams.get("loading"), "async");
  assert.equal(REAIGEN_GOOGLE_MAPS_VERSION, "3.65");
  assert.equal(url.searchParams.get("v"), REAIGEN_GOOGLE_MAPS_VERSION);
  assert.equal(url.searchParams.has("auth_referrer_policy"), false);
});

test("an address-only map uses a keyless Google embed with a normalized locale", () => {
  const url = new URL(googleMapsAddressEmbedUrl(
    "  Bratislava   Castle, Slovakia  ",
    "sk-SK",
  ));

  assert.equal(url.origin, "https://www.google.com");
  assert.equal(url.pathname, "/maps");
  assert.equal(url.searchParams.get("q"), "Bratislava Castle, Slovakia");
  assert.equal(url.searchParams.get("output"), "embed");
  assert.equal(url.searchParams.get("hl"), "sk");
  assert.equal(url.searchParams.has("key"), false);
  assert.equal(googleMapsAddressEmbedUrl("  ", "en"), null);
});

test("the map runtimes are Mapbox and Google only: no OpenStreetMap tiles or Nominatim", () => {
  const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
  const runtimeFiles = [
    "app/components/property-map-card.tsx",
    "app/components/agent-tiny-ui.tsx",
    "app/api/maps/client/route.ts",
  ];
  // The OpenStreetMap copyright link is required attribution for Mapbox
  // data; OSM tiles, Nominatim and Leaflet stay out.
  const disallowedProviders = ["nominatim", "tile.openstreetmap", "leaflet"];

  for (const relativePath of runtimeFiles) {
    const source = readFileSync(`${repositoryRoot}/${relativePath}`, "utf8").toLowerCase();
    for (const provider of disallowedProviders) {
      assert.equal(source.includes(provider), false, `${relativePath} references ${provider}`);
    }
  }

  assert.equal(existsSync(`${repositoryRoot}/app/api/maps/static/route.ts`), false);
});

test("the Parameters map keeps saved coordinates while the address is edited", () => {
  const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
  const editor = readFileSync(`${repositoryRoot}/app/components/draft-editor.tsx`, "utf8");
  const mapCard = readFileSync(`${repositoryRoot}/app/components/property-map-card.tsx`, "utf8");

  assert.match(editor, /latitude=\{draft\.latitude\}/);
  assert.match(editor, /longitude=\{draft\.longitude\}/);
  assert.doesNotMatch(editor, /locationStillMatchesSavedDraft/);
  assert.match(mapCard, /targetKeyRef\.current === nextKey/);
  assert.match(mapCard, /if \(targetKeyRef\.current === nextKey\) return/);
});

test("address-only drafts wait for an explicit in-app Google map request", () => {
  const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
  const mapCard = readFileSync(`${repositoryRoot}/app/components/property-map-card.tsx`, "utf8");
  const coordinateGuard = mapCard.indexOf("if (target.lat == null || target.lng == null)");
  const clientRequest = mapCard.indexOf('fetch("/api/maps/client"');

  assert.notEqual(coordinateGuard, -1);
  assert.notEqual(clientRequest, -1);
  assert.ok(coordinateGuard < clientRequest, "missing coordinates must be rejected before fetch");
  assert.match(mapCard, /addressMapRequested/);
  // The Google-hosted frame is gone (2026-09-26): Google's own buttons, and
  // a world map for an address it could not place. A miss is our own state.
  assert.doesNotMatch(mapCard, /GoogleAddressMapFrame|<iframe/);
  assert.match(mapCard, /addressNotFoundText\(lang\)/);
  // No link carries the draft's address out of the card.
  assert.doesNotMatch(mapCard, /href=\{[^}]*address/);
  assert.doesNotMatch(mapCard, /href=\{[^}]*target\./);
  assert.doesNotMatch(mapCard, /maps\/search\/\?api=1/);
  assert.doesNotMatch(mapCard, /body: JSON\.stringify\(\{[^}]*address/s);
});

test("the browser-key route validates cookie tokens against Django", () => {
  const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
  const route = readFileSync(`${repositoryRoot}/app/api/maps/client/route.ts`, "utf8");
  const verifier = readFileSync(`${repositoryRoot}/app/lib/server/creator-session.ts`, "utf8");

  assert.match(route, /verifyCreatorSession\(accessToken, refreshToken\)/);
  assert.match(route, /if \(!session\.ok\)/);
  assert.match(verifier, /\/api\/v1\/core\/users\/me\//);
  assert.match(verifier, /refreshSession\(refreshToken, candidates\)/);
  assert.doesNotMatch(route, /const hasCreatorSession = Boolean/);
  assert.ok(
    route.indexOf("verifyCreatorSession(accessToken, refreshToken)")
      < route.indexOf("process.env.GOOGLE_MAPS_KEY"),
    "authentication must run before exposing browser-key configuration state",
  );
});

test("the property map renders interactively without tearing down a slow Google canvas", () => {
  const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
  const mapCard = readFileSync(`${repositoryRoot}/app/components/property-map-card.tsx`, "utf8");
  const loader = readFileSync(`${repositoryRoot}/app/lib/google-maps-client.ts`, "utf8");

  assert.match(mapCard, /renderingType: "RASTER"/);
  assert.match(mapCard, /interactive\s+onReady=/);
  assert.match(mapCard, /addListener\?\.\("tilesloaded", markReady\)/);
  assert.match(mapCard, /setTimeout\(markReady, 8_000\)/);
  assert.doesNotMatch(mapCard, /onError\?\.\("google-maps-timeout"\)/);
  assert.match(mapCard, /resetGoogleMapsFailure\(\)/);
  assert.match(loader, /script\.referrerPolicy = "strict-origin-when-cross-origin"/);
  assert.doesNotMatch(mapCard, /Geocoder|geocodeGoogleMapsAddress/);
});

test("an open tab cannot reuse a Google namespace from an older deployment", () => {
  const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
  const mapCard = readFileSync(`${repositoryRoot}/app/components/property-map-card.tsx`, "utf8");
  const loader = readFileSync(`${repositoryRoot}/app/lib/google-maps-client.ts`, "utf8");

  assert.match(loader, /__reaigenGoogleMapsRuntime/);
  assert.match(loader, /runtime\?\.apiKey === apiKey && runtime\.version === REAIGEN_GOOGLE_MAPS_VERSION/);
  assert.match(loader, /new Error\("google-maps-stale-runtime"\)/);
  assert.match(mapCard, /MAPS_RUNTIME_RELOAD_GUARD/);
  assert.match(mapCard, /reason === "google-maps-stale-runtime"/);
  assert.match(mapCard, /window\.location\.reload\(\)/);
});

test("a stale in-document namespace requests one clean reload", async () => {
  const previousWindow = globalThis.window;
  globalThis.window = {
    google: { maps: { Map: class {} } },
  };

  try {
    await assert.rejects(
      loadGoogleMaps("maps-current-test-key", "en"),
      /google-maps-stale-runtime/,
    );
    assert.equal(resetGoogleMapsFailure(), true);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test("the map palette keeps distinct Apple-like land, park, road, and water colours", () => {
  const styleFor = (featureType, elementType) => REAIGEN_GOOGLE_MAP_STYLES.find((style) => (
    style.featureType === featureType && style.elementType === elementType
  ));
  const colourFor = (featureType, elementType) => styleFor(featureType, elementType)?.stylers[0]?.color;

  const land = colourFor("landscape", "geometry");
  const park = colourFor("poi.park", "geometry");
  const road = colourFor("road", "geometry");
  const highway = colourFor("road.highway", "geometry");
  const water = colourFor("water", "geometry");

  assert.deepEqual(new Set([land, park, road, highway, water]).size, 5);
  assert.equal(water, "#b9dff2");
  assert.equal(park, "#cfe6c8");
  assert.equal(highway, "#f5cf8d");
});

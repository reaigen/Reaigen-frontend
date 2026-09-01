import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  REAIGEN_GOOGLE_MAP_STYLES,
  REAIGEN_GOOGLE_MAPS_VERSION,
  googleMapsScriptUrl,
  loadGoogleMaps,
  resetGoogleMapsFailure,
} from "./google-maps-client.ts";

test("the Maps loader preserves path-compatible website authorization", () => {
  const url = new URL(googleMapsScriptUrl(
    "AIzaSyExampleMapsJavaScriptKey123456789",
    "sk",
    "__reaigenGoogleMapsReady",
  ));

  assert.equal(url.origin, "https://maps.googleapis.com");
  assert.equal(url.pathname, "/maps/api/js");
  assert.equal(url.searchParams.get("key"), "AIzaSyExampleMapsJavaScriptKey123456789");
  assert.equal(url.searchParams.get("language"), "sk");
  assert.equal(url.searchParams.get("callback"), "__reaigenGoogleMapsReady");
  assert.equal(url.searchParams.get("loading"), "async");
  assert.equal(REAIGEN_GOOGLE_MAPS_VERSION, "3.65");
  assert.equal(url.searchParams.get("v"), REAIGEN_GOOGLE_MAPS_VERSION);
  assert.equal(url.searchParams.has("auth_referrer_policy"), false);
});

test("the production map runtime is Google Maps JavaScript only", () => {
  const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
  const runtimeFiles = [
    "app/components/property-map-card.tsx",
    "app/components/agent-tiny-ui.tsx",
    "app/api/maps/client/route.ts",
  ];
  const disallowedProviders = ["openstreetmap", "nominatim", "tile.openstreetmap"];

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
      loadGoogleMaps("AIzaSyCurrentProductionKey123456789", "en"),
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

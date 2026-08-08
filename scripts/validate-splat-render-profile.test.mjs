import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  GAUSSIAN_ANTIALIASED_VARIANCE,
  GAUSSIAN_MIP_VARIANCE,
  eyeFromSogViewer,
  isAntialiasedReconstruction,
  parseRenderTuning,
  parseSogViewerHint,
  sogCameraIsInterior,
  resolveSplatRenderProfile,
} from "../app/lib/splat-render-profile.ts";

/**
 * Fixtures are the real meta.json from two production reconstructions, so
 * these assertions describe files that actually exist rather than a synthetic
 * ideal:
 *
 *   legacy-room-scale       32.6 m flat, no antialias flag, no authored camera
 *                           — representative of the published library
 *   antialiased-object-scale 3.8 m capture, antialias: true, authored camera
 *                           — the import that rendered blank then washed out
 */
const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) =>
  JSON.parse(readFileSync(join(here, "..", "fixtures", "sog", name), "utf8"));

const LEGACY = fixture("legacy-room-scale.meta.json");
const ANTIALIASED = fixture("antialiased-object-scale.meta.json");

const extent = (meta) =>
  Math.max(...meta.means.maxs.map((v, i) => v - meta.means.mins[i]));

const inside = (p, meta) =>
  p.every((v, i) => v >= meta.means.mins[i] && v <= meta.means.maxs[i]);

// ---------------------------------------------------------------------------
// Fixture sanity — if these drift, every assertion below is measuring nothing
// ---------------------------------------------------------------------------

test("fixtures are the two distinct cases they claim to be", () => {
  assert.equal(isAntialiasedReconstruction(LEGACY), false);
  assert.equal(isAntialiasedReconstruction(ANTIALIASED), true);
  assert.equal(parseSogViewerHint(LEGACY), null, "legacy has no authored camera");
  assert.ok(parseSogViewerHint(ANTIALIASED), "antialiased ships an authored camera");
  assert.ok(extent(LEGACY) > 25, `legacy is room-scale (${extent(LEGACY).toFixed(1)} m)`);
  assert.ok(extent(ANTIALIASED) < 6, `antialiased is object-scale (${extent(ANTIALIASED).toFixed(1)} m)`);
});

// ---------------------------------------------------------------------------
// Rasterisation profile
// ---------------------------------------------------------------------------

test("the published library keeps its historic kernel", () => {
  const p = resolveSplatRenderProfile(LEGACY);
  assert.equal(p.kernelSize, GAUSSIAN_MIP_VARIANCE);
  assert.equal(p.kernelSize, 0.09);
  assert.equal(p.compensation, true);
  assert.equal(p.useSphericalHarmonics, true);
});

test("every file gets the same kernel unless explicitly overridden", () => {
  // A controlled CPU render of the same scene showed 0.09 vs 0.30 changes mean
  // luminance by 0.00005 and clipped highlights by 0.001pp, while costing ~9%
  // sharpness. The kernel is not what washes a render out, so nothing is keyed
  // off the antialias flag and the published library cannot shift.
  assert.equal(resolveSplatRenderProfile(ANTIALIASED).kernelSize, GAUSSIAN_MIP_VARIANCE);
  assert.equal(resolveSplatRenderProfile(LEGACY).kernelSize, GAUSSIAN_MIP_VARIANCE);
});

test("the 3DGS kernel remains available as an override", () => {
  assert.equal(GAUSSIAN_ANTIALIASED_VARIANCE, 0.3);
  assert.equal(
    resolveSplatRenderProfile(ANTIALIASED, parseRenderTuning("?kernel=0.3")).kernelSize,
    0.3,
  );
});

test("no metadata shape changes the kernel", () => {
  for (const meta of [null, undefined, {}, { antialias: false }, { antialias: true }, { antialias: "true" }]) {
    assert.equal(
      resolveSplatRenderProfile(meta).kernelSize,
      GAUSSIAN_MIP_VARIANCE,
      `unexpected profile for ${JSON.stringify(meta)}`,
    );
  }
});

// ---------------------------------------------------------------------------
// Authored camera — the blank-viewport fix
// ---------------------------------------------------------------------------

test("the exporter's camera is an exterior orbit, so it must not frame an interior scan", () => {
  const hint = parseSogViewerHint(ANTIALIASED);
  const eye = eyeFromSogViewer(hint);

  // Eye sits above the ceiling: y 3.79 against a cloud top of 1.82. That is a
  // dollhouse view of the outside of the room, not a walkthrough.
  assert.ok(
    eye[1] > ANTIALIASED.means.maxs[1],
    `authored eye should be above the ceiling (${eye[1].toFixed(2)} vs ${ANTIALIASED.means.maxs[1].toFixed(2)})`,
  );
  assert.equal(
    sogCameraIsInterior(ANTIALIASED),
    false,
    "authored camera is exterior, so framing must stay with the point cloud",
  );
});

test("eyeFromSogViewer stays exact, since metrics report it", () => {
  const hint = parseSogViewerHint(ANTIALIASED);
  const eye = eyeFromSogViewer(hint);
  const dist = Math.hypot(...eye.map((v, i) => v - hint.target[i]));
  assert.ok(Math.abs(dist - hint.distance) < 1e-6, "eye must be the authored distance from target");
});

test("a partial or malformed viewer block is refused rather than half-applied", () => {
  const cases = [
    {},
    { viewer: null },
    { viewer: {} },
    { viewer: { target: [1, 2, 3] } },                    // no distance
    { viewer: { distance: 3 } },                          // no target
    { viewer: { target: [1, 2], distance: 3 } },          // short target
    { viewer: { target: [1, 2, 3], distance: 0 } },       // zero distance
    { viewer: { target: [1, 2, 3], distance: -4 } },      // negative
    { viewer: { target: [1, 2, 3], distance: "3.5" } },   // wrong type
    { viewer: { target: [1, "x", 3], distance: 3 } },     // NaN coord
    { viewer: { target: [1, 2, 3], distance: Infinity } },
  ];
  for (const meta of cases) {
    assert.equal(parseSogViewerHint(meta), null, `should reject ${JSON.stringify(meta)}`);
  }
});

test("missing yaw/pitch default to zero instead of producing NaN", () => {
  const hint = parseSogViewerHint({ viewer: { target: [0, 0, 0], distance: 5 } });
  assert.deepEqual(hint.target, [0, 0, 0]);
  assert.equal(hint.yawRadians, 0);
  assert.equal(hint.pitchRadians, 0);
  const eye = eyeFromSogViewer(hint);
  assert.ok(eye.every(Number.isFinite), "eye must be finite");
  assert.equal(Math.round(Math.hypot(...eye) * 1e6) / 1e6, 5);
});

// ---------------------------------------------------------------------------
// URL overrides — the escape hatch must win, and must not fire by accident
// ---------------------------------------------------------------------------

test("overrides win over the file's own flag", () => {
  assert.equal(resolveSplatRenderProfile(ANTIALIASED, parseRenderTuning("?kernel=0.09")).kernelSize, 0.09);
  assert.equal(resolveSplatRenderProfile(LEGACY, parseRenderTuning("?kernel=0.3")).kernelSize, 0.3);
  assert.equal(resolveSplatRenderProfile(ANTIALIASED, parseRenderTuning("?comp=0")).compensation, false);
  assert.equal(resolveSplatRenderProfile(ANTIALIASED, parseRenderTuning("?sh=0")).useSphericalHarmonics, false);
});

test("an empty or unrelated query string changes nothing", () => {
  for (const search of ["", "?", "?foo=bar", "?page=2"]) {
    const p = resolveSplatRenderProfile(ANTIALIASED, parseRenderTuning(search));
    assert.equal(p.kernelSize, GAUSSIAN_MIP_VARIANCE, `search=${search}`);
    assert.equal(p.compensation, true);
    assert.equal(p.useSphericalHarmonics, true);
  }
});

test("a nonsensical kernel override is ignored rather than rendering nothing", () => {
  for (const search of ["?kernel=abc", "?kernel=-1", "?kernel=", "?kernel=NaN"]) {
    assert.equal(
      resolveSplatRenderProfile(ANTIALIASED, parseRenderTuning(search)).kernelSize,
      GAUSSIAN_MIP_VARIANCE,
      `search=${search}`,
    );
  }
  // Zero is a legitimate request: no dilation at all.
  assert.equal(resolveSplatRenderProfile(ANTIALIASED, parseRenderTuning("?kernel=0")).kernelSize, 0);
});

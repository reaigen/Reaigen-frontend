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

test("an antialias-trained file gets the full 3DGS dilation", () => {
  const p = resolveSplatRenderProfile(ANTIALIASED);
  assert.equal(p.kernelSize, GAUSSIAN_ANTIALIASED_VARIANCE);
  assert.equal(p.kernelSize, 0.3);
  assert.equal(p.compensation, true);
});

test("the antialiased kernel is materially larger, not a rounding difference", () => {
  const legacy = resolveSplatRenderProfile(LEGACY).kernelSize;
  const aa = resolveSplatRenderProfile(ANTIALIASED).kernelSize;
  // 0.09 is 0.3 squared — the bug was squaring a value that is already a
  // variance. The corrected kernel must therefore be ~3.33x the old one.
  assert.ok(aa / legacy > 3, `expected >3x dilation, got ${(aa / legacy).toFixed(2)}x`);
  assert.equal(Math.round((aa / legacy) * 100) / 100, 3.33);
});

test("a file with no antialias flag is never given the antialiased profile", () => {
  for (const meta of [null, undefined, {}, { antialias: false }, { antialias: "true" }, { antialias: 1 }]) {
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

test("the authored camera sits outside the point cloud, looking at it", () => {
  const hint = parseSogViewerHint(ANTIALIASED);
  const eye = eyeFromSogViewer(hint);

  assert.equal(inside(eye, ANTIALIASED), false, "camera must not sit inside the cloud");

  // The target aims slightly above the cloud's top (y 1.87 against 1.82) so
  // the view looks down into the room. It should still be *near* the subject,
  // not off in space — measured against the scene's own size.
  const size = extent(ANTIALIASED);
  const centre = ANTIALIASED.means.maxs.map((v, i) => (v + ANTIALIASED.means.mins[i]) / 2);
  const targetOffset = Math.hypot(...hint.target.map((v, i) => v - centre[i]));
  assert.ok(
    targetOffset < size,
    `target should sit within one scene-extent of centre (${targetOffset.toFixed(2)} m vs ${size.toFixed(2)} m)`,
  );

  const dist = Math.hypot(...eye.map((v, i) => v - hint.target[i]));
  assert.ok(
    Math.abs(dist - hint.distance) < 1e-6,
    `eye must be exactly the authored distance away (${dist} vs ${hint.distance})`,
  );
});

test("the authored distance is proportionate to the scene, unlike the room-scale floor", () => {
  const hint = parseSogViewerHint(ANTIALIASED);
  const size = extent(ANTIALIASED);
  const ratio = hint.distance / size;
  assert.ok(ratio > 0.5 && ratio < 2, `distance/extent = ${ratio.toFixed(2)} should frame the scene`);

  // The derived framing clamps radius to a 1.5 m floor and 5 m ceiling, tuned
  // for room-scale scans. On this scene that range brackets the whole subject,
  // which is how the camera ended up inside it.
  assert.ok(size < 5, "object-scale scene is smaller than the heuristic's max radius");
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
    assert.equal(p.kernelSize, GAUSSIAN_ANTIALIASED_VARIANCE, `search=${search}`);
    assert.equal(p.compensation, true);
    assert.equal(p.useSphericalHarmonics, true);
  }
});

test("a nonsensical kernel override is ignored rather than rendering nothing", () => {
  for (const search of ["?kernel=abc", "?kernel=-1", "?kernel=", "?kernel=NaN"]) {
    assert.equal(
      resolveSplatRenderProfile(ANTIALIASED, parseRenderTuning(search)).kernelSize,
      GAUSSIAN_ANTIALIASED_VARIANCE,
      `search=${search}`,
    );
  }
  // Zero is a legitimate request: no dilation at all.
  assert.equal(resolveSplatRenderProfile(ANTIALIASED, parseRenderTuning("?kernel=0")).kernelSize, 0);
});

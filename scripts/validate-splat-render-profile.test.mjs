import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  GAUSSIAN_ANTIALIASED_VARIANCE,
  GAUSSIAN_MIP_VARIANCE,
  eyeFromSogViewer,
  fallbackOverviewCamera,
  isAntialiasedReconstruction,
  parseRenderTuning,
  parseSogViewerHint,
  sogCameraIsInterior,
  chooseClearAzimuth,
  resolveSplatRenderProfile,
  SPINOFF_DEFAULT_VERTICAL_FOV,
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

// ---------------------------------------------------------------------------
// Orbit clearance — the camera-inside-the-sofa fix
// ---------------------------------------------------------------------------

/** A ring of wall points with one quadrant packed solid, like a sofa. */
function roomWithObstacle() {
  const pts = [];
  for (let i = 0; i < 360; i += 2) {                  // walls at r = 3
    const a = (i * Math.PI) / 180;
    pts.push(3 * Math.cos(a), 1.0, 3 * Math.sin(a));
  }
  for (let i = 0; i < 500; i += 1) {                  // dense blob at azimuth 270 deg
    pts.push(0 + (i % 10) * 0.02, 1.0 + ((i / 10) % 5) * 0.02, -2 + ((i / 50) % 5) * 0.02);
  }
  return pts;
}

test("an azimuth buried in geometry is rejected for a clear one", () => {
  const pts = roomWithObstacle();
  const buried = chooseClearAzimuth(pts, [0, 1, 0], 2, 1.0, {
    preferred: -Math.PI / 2, samples: 16,
  });
  assert.equal(buried.blocked, 0, "must find a clear azimuth rather than sit in the blob");

  // Sanity: the preferred angle really was blocked, so the test has teeth.
  // Counted directly, because `samples` is floored at 4 and cannot be forced to
  // evaluate a single azimuth.
  const ex = 2 * Math.cos(-Math.PI / 2);
  const ez = 2 * Math.sin(-Math.PI / 2);
  let blockedAtPreferred = 0;
  for (let i = 0; i < pts.length / 3; i += 1) {
    const dx = pts[i * 3] - ex, dy = pts[i * 3 + 1] - 1.0, dz = pts[i * 3 + 2] - ez;
    if (dx * dx + dy * dy + dz * dz < 0.35 * 0.35) blockedAtPreferred += 1;
  }
  assert.ok(blockedAtPreferred > 0, `preferred azimuth should be blocked, got ${blockedAtPreferred}`);
  assert.ok(buried.azimuth !== -Math.PI / 2, "should have moved away from the blocked azimuth");
});

test("a scene that is already clear keeps its preferred azimuth", () => {
  const pts = [];
  for (let i = 0; i < 360; i += 2) {
    const a = (i * Math.PI) / 180;
    pts.push(8 * Math.cos(a), 1.0, 8 * Math.sin(a));   // far walls, nothing near the ring
  }
  const chosen = chooseClearAzimuth(pts, [0, 1, 0], 2, 1.0, { preferred: 0.7, samples: 16 });
  assert.equal(chosen.blocked, 0);
  assert.equal(chosen.azimuth, 0.7, "should not move a camera that is already clear");
});

test("a lone obstruction is escaped rather than tolerated", () => {
  // One point sitting exactly where azimuth 0 would place the eye. Any
  // clearance radius should reject that angle and find an empty one.
  const pts = [2.0, 1.0, 0.0];
  for (const clearance of [0.1, 0.35, 1.0]) {
    const chosen = chooseClearAzimuth(pts, [0, 1, 0], 2, 1.0, { preferred: 0, clearance });
    assert.equal(chosen.blocked, 0, `clearance=${clearance} should find a clear azimuth`);
    assert.notEqual(chosen.azimuth, 0, `clearance=${clearance} should move off the obstructed angle`);
  }
});

// ---------------------------------------------------------------------------
// Source-matched fallback framing
// ---------------------------------------------------------------------------

test("fallback overview preserves the clear ray and retreats to a room frame", () => {
  const frame = {
    radius: 2.836655895168706,
    safePosition: [1.960787486676928, 1.0307753705978393, 0.046193325298956034],
    safeTarget: [-0.8732836339698324, 1.0307753705978393, 0.1672616973512389],
  };
  const overview = fallbackOverviewCamera(frame);
  const originalDirection = frame.safePosition.map((value, index) => value - frame.safeTarget[index]);
  const overviewDirection = overview.position.map((value, index) => value - overview.target[index]);
  const originalLength = Math.hypot(...originalDirection);
  const overviewLength = Math.hypot(...overviewDirection);

  assert.ok(Math.abs(overviewLength - frame.radius * 1.7) < 1e-9);
  assert.deepEqual(overview.target, frame.safeTarget);
  assert.ok(originalDirection.every((value, index) => (
    Math.abs(value / originalLength - overviewDirection[index] / overviewLength) < 1e-9
  )));
  assert.equal(overview.fov, SPINOFF_DEFAULT_VERTICAL_FOV);
  assert.equal(overview.fov, 68 * Math.PI / 180);
});

test("fallback overview never moves an already-wider safe camera closer", () => {
  const frame = {
    radius: 1,
    safePosition: [0, 0, 5],
    safeTarget: [0, 0, 0],
  };
  assert.deepEqual(fallbackOverviewCamera(frame).position, frame.safePosition);
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { resolveSpinoffSogQuaternionOrder } from "@reaigen/spinoff";

import {
  GAUSSIAN_ANTIALIASED_VARIANCE,
  GAUSSIAN_MIP_VARIANCE,
  SPINOFF_NATIVE_MIP_SIGMA,
  eyeFromSogViewer,
  fallbackOverviewCamera,
  isAntialiasedReconstruction,
  parseRenderTuning,
  parseSogViewerHint,
  sceneFrameFromSogMetadata,
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
const SPLATFICTION_10122 = fixture("splatfiction-web-10122.meta.json");

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
  assert.equal(SPINOFF_NATIVE_MIP_SIGMA, Math.sqrt(0.3));
  assert.equal(
    resolveSplatRenderProfile(ANTIALIASED, parseRenderTuning("?kernel=0.3")).kernelSize,
    0.3,
  );
});

test("the imported Splatfiction-web scene keeps the public WXYZ SOG contract", () => {
  assert.equal(SPLATFICTION_10122.count, 288_444);
  assert.equal(SPLATFICTION_10122.antialias, true);
  assert.equal(SPLATFICTION_10122.asset.generator, "Splatfiction WebGPU");
  assert.equal(resolveSpinoffSogQuaternionOrder(SPLATFICTION_10122), "wxyz");
  assert.equal(resolveSpinoffSogQuaternionOrder({}), "wxyz");
  assert.equal(
    resolveSpinoffSogQuaternionOrder({ asset: { quaternionOrder: "xyzw" } }),
    "xyzw",
  );
});

test("the Splatfiction viewport camera retains its complete physical lens", () => {
  const hint = parseSogViewerHint(SPLATFICTION_10122);
  assert.ok(hint);
  assert.deepEqual(hint.target, SPLATFICTION_10122.viewer.target);
  assert.equal(hint.distance, SPLATFICTION_10122.viewer.distance);
  assert.equal(hint.verticalFovRadians, SPLATFICTION_10122.viewer.verticalFovRadians);
  assert.equal(hint.near, SPLATFICTION_10122.viewer.near);
  assert.equal(hint.far, SPLATFICTION_10122.viewer.far);
});

test("vendored Spinoff uses Splatfiction's finite normalized Gaussian support", () => {
  const packageRoot = join(here, "..", "node_modules", "@reaigen", "spinoff");
  const packageJson = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
  const webGpu = readFileSync(join(packageRoot, "dist", "gpu", "shaders.js"), "utf8");
  const webGl = readFileSync(
    join(packageRoot, "dist", "renderer", "SpinoffWebGlBackend.js"),
    "utf8",
  );

  assert.equal(packageJson.version, "0.1.44");
  for (const shader of [webGpu, webGl]) {
    assert.match(shader, /radiusSquared > 8\.0/);
    assert.match(shader, /0\.01831563888873418/);
    assert.match(shader, /0\.9816843611112658/);
    assert.doesNotMatch(shader, /radiusSquared > 9\.0/);
  }
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

test("tour 33 vkgs SOG frames from its real signed-log metadata without a viewer", () => {
  const tour33 = {
    version: 2,
    asset: { generator: "vkgs_trainer" },
    count: 251_328,
    antialias: true,
    means: {
      mins: [-2.1410603523254395, -1.7319598197937012, -2.4355626106262207],
      maxs: [2.127394437789917, 1.447962760925293, 1.8802263736724854],
      files: ["means_l.webp", "means_u.webp"],
    },
  };
  assert.equal(parseSogViewerHint(tour33), null, "the failing SOG has no viewer pose");

  const frame = sceneFrameFromSogMetadata(tour33);
  assert.ok(frame, "its means quantization domain must still produce a frame");
  assert.ok(frame.radius > 10 && frame.radius < 13, `unexpected radius ${frame.radius}`);
  assert.ok(frame.floorY < -4.5 && frame.ceilingY > 3.2);
  assert.ok(frame.footprint.minZ < -10 && frame.footprint.maxZ > 5.5);

  const overview = fallbackOverviewCamera(frame);
  assert.ok([...overview.position, ...overview.target].every(Number.isFinite));
  assert.ok(Math.hypot(...overview.position) > 10, "camera must not remain at the origin");
  assert.ok(
    Math.hypot(...overview.position.map((value, index) => value - overview.target[index]))
      >= frame.radius * 1.7 - 1e-9,
    "camera must retreat far enough to see the complete SOG bounds",
  );
});

test("metadata framing rejects malformed and degenerate means domains", () => {
  for (const meta of [
    null,
    {},
    { means: {} },
    { means: { mins: [0, 0], maxs: [1, 1] } },
    { means: { mins: [0, 0, 0], maxs: [0, 0, 0] } },
    { means: { mins: [0, 0, Number.NaN], maxs: [1, 1, 1] } },
  ]) {
    assert.equal(sceneFrameFromSogMetadata(meta), null);
  }
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

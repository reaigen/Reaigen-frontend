import type { Vec3 } from "./tour-types";

/**
 * How a Gaussian reconstruction should be framed and rasterised.
 *
 * Extracted from the viewer so it can be asserted against real .sog files
 * rather than eyeballed against screenshots. Everything here is pure: given a
 * parsed meta.json it returns the camera and material parameters, with no
 * Babylon, DOM or WebGL involvement.
 */

/**
 * Screen-space dilation for reconstructions trained *without* antialiasing.
 *
 * Historic value, kept so that the existing library does not shift appearance.
 * It is 0.3 squared, which is a mistake (see below) — but it is the mistake
 * every already-published scan was authored against.
 */
export const GAUSSIAN_MIP_VARIANCE = 0.09;

/**
 * Screen-space dilation for reconstructions trained *with* antialiasing.
 *
 * 3DGS adds 0.3 to the 2D covariance diagonal, and that 0.3 is already a
 * variance in pixel², not a sigma to be squared. Squaring it a second time
 * leaves roughly a third of the intended dilation. Because the Mip-Splatting
 * opacity compensation is derived from the same kernel, an undersized kernel
 * also under-compensates, so splats render brighter than the exporter
 * intended — the hazy, blown-out highlights.
 */
export const GAUSSIAN_ANTIALIASED_VARIANCE = 0.3;

/**
 * Spinoff accepts a pixel sigma while the SOG/3DGS contract specifies a
 * variance. Keep the conversion at this boundary so callers cannot
 * accidentally square 0.30 twice or pass it through unchanged.
 */
export const SPINOFF_NATIVE_MIP_SIGMA = Math.sqrt(
  GAUSSIAN_ANTIALIASED_VARIANCE,
);

/**
 * The dilation Splatfiction's settled viewport actually ships: a crisp
 * 0.075px² covariance floor with Mip-Splatting opacity compensation OFF —
 * their source calls compensation "a faint full-frame softness layer" and
 * matches SuperSplat's ordinary-3DGS look instead. This is the accepted
 * image reference for delivery, measured from Splatfiction-web
 * `lib/viewport-quality.ts` + `app/page.tsx`, not from the engine defaults
 * (sigma 0.3, compensation on), which Splatfiction itself overrides.
 */
export const SPLATFICTION_VIEWPORT_VARIANCE = 0.075;
export const SPLATFICTION_VIEWPORT_SIGMA = Math.sqrt(
  SPLATFICTION_VIEWPORT_VARIANCE,
);

/** Spinoff Web's authored default vertical field of view. */
export const SPINOFF_DEFAULT_VERTICAL_FOV = 68 * Math.PI / 180;

interface FallbackSceneFrame {
  radius: number;
  safePosition: Vec3;
  safeTarget: Vec3;
}

/**
 * Conservative scene bounds reconstructed from the quantization domain in a
 * SOG's meta.json. SOG stores means in signed-log space; the renderer applies
 * signed expm1 after texture decoding, so camera framing must do the same.
 */
export interface SogMetadataSceneFrame extends FallbackSceneFrame {
  center: Vec3;
  floorY: number;
  ceilingY: number;
  footprint: { minX: number; maxX: number; minZ: number; maxZ: number };
}

/**
 * Produce a usable first camera without downloading or decoding the Gaussian
 * textures. This is the fallback for valid SOGs that omit an authored viewer
 * block (including vkgs_trainer exports).
 */
export function sceneFrameFromSogMetadata(
  meta: unknown,
): SogMetadataSceneFrame | null {
  const means = (meta as {
    means?: { mins?: unknown; maxs?: unknown };
  } | null)?.means;
  if (!Array.isArray(means?.mins) || !Array.isArray(means?.maxs)) return null;
  if (means.mins.length < 3 || means.maxs.length < 3) return null;

  const signedExpm1 = (value: unknown) => {
    if (!finite(value)) return Number.NaN;
    return Math.sign(value) * Math.expm1(Math.abs(value));
  };
  const low = means.mins.slice(0, 3).map(signedExpm1);
  const high = means.maxs.slice(0, 3).map(signedExpm1);
  if (![...low, ...high].every(Number.isFinite)) return null;

  const mins: Vec3 = [
    Math.min(low[0], high[0]),
    Math.min(low[1], high[1]),
    Math.min(low[2], high[2]),
  ];
  const maxs: Vec3 = [
    Math.max(low[0], high[0]),
    Math.max(low[1], high[1]),
    Math.max(low[2], high[2]),
  ];
  const center: Vec3 = [
    (mins[0] + maxs[0]) * 0.5,
    (mins[1] + maxs[1]) * 0.5,
    (mins[2] + maxs[2]) * 0.5,
  ];
  const diagonal = Math.hypot(
    maxs[0] - mins[0],
    maxs[1] - mins[1],
    maxs[2] - mins[2],
  );
  if (!Number.isFinite(diagonal) || diagonal <= 1e-6) return null;

  const radius = Math.max(0.1, diagonal * 0.5);
  const eyeY = Math.max(
    mins[1] + Math.min(1.55, (maxs[1] - mins[1]) * 0.5),
    center[1],
  );
  const safeTarget: Vec3 = [center[0], eyeY, center[2]];
  const safeDistance = Math.max(0.5, radius * 1.7);
  const safePosition: Vec3 = [
    center[0] + safeDistance * Math.SQRT1_2,
    eyeY,
    center[2] + safeDistance * Math.SQRT1_2,
  ];

  return {
    center,
    radius,
    safePosition,
    safeTarget,
    floorY: mins[1],
    ceilingY: maxs[1],
    footprint: {
      minX: mins[0],
      maxX: maxs[0],
      minZ: mins[2],
      maxZ: maxs[2],
    },
  };
}

/**
 * Turn the collision-safe interior direction into a useful room overview.
 *
 * The point-cloud frame already finds a clear eye and a meaningful look
 * direction. Its distance is intentionally close enough for navigation,
 * though, which can open a room with the camera seated against furniture.
 * Retreat on the same ray to Spinoff's overview distance and keep the target
 * untouched, so no scene-specific axis or mirror is introduced.
 */
export function fallbackOverviewCamera(frame: FallbackSceneFrame): {
  position: Vec3;
  target: Vec3;
  fov: number;
} {
  const backward: Vec3 = [
    frame.safePosition[0] - frame.safeTarget[0],
    frame.safePosition[1] - frame.safeTarget[1],
    frame.safePosition[2] - frame.safeTarget[2],
  ];
  const currentDistance = Math.hypot(...backward);
  const direction: Vec3 = currentDistance > 1e-6
    ? backward.map((value) => value / currentDistance) as Vec3
    : [0, 0, 1];
  const distance = Math.max(currentDistance, Math.max(0.1, frame.radius) * 1.7);
  return {
    position: [
      frame.safeTarget[0] + direction[0] * distance,
      frame.safeTarget[1] + direction[1] * distance,
      frame.safeTarget[2] + direction[2] * distance,
    ],
    target: [...frame.safeTarget],
    fov: SPINOFF_DEFAULT_VERTICAL_FOV,
  };
}

/** Camera authored by the exporter inside a SOG's meta.json. */
export interface SogViewerHint {
  target: Vec3;
  distance: number;
  yawRadians: number;
  pitchRadians: number;
  verticalFovRadians?: number;
  near?: number;
  far?: number;
}

export interface SplatRenderProfile {
  /** Value added to the 2D covariance diagonal. */
  kernelSize: number;
  /** Mip-Splatting opacity compensation. */
  compensation: boolean;
  /** Whether spherical harmonics should be uploaded at all. */
  useSphericalHarmonics: boolean;
}

/** Per-URL overrides, for dialling one scene against a reference render. */
export interface RenderTuningOverrides {
  kernel?: number | null;
  compensation?: boolean | null;
  sh?: boolean;
}

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/**
 * Read the authored camera from a SOG meta.json.
 *
 * Returns null unless the block carries both a usable target and a positive
 * distance — a partial camera is worse than none, because it would silently
 * override framing derived from the actual point cloud.
 */
export function parseSogViewerHint(meta: unknown): SogViewerHint | null {
  const viewer = (meta as { viewer?: Record<string, unknown> } | null)?.viewer;
  if (!viewer || typeof viewer !== "object") return null;

  const { target, distance } = viewer;
  if (!Array.isArray(target) || target.length < 3) return null;
  if (!finite(distance) || distance <= 0) return null;

  const coords = target.slice(0, 3).map(Number);
  if (!coords.every(finite)) return null;

  const angle = (value: unknown) => (finite(value) ? value : 0);
  return {
    target: [coords[0], coords[1], coords[2]],
    distance,
    yawRadians: angle(viewer.yawRadians),
    pitchRadians: angle(viewer.pitchRadians),
    ...(finite(viewer.verticalFovRadians) && viewer.verticalFovRadians > 0
      ? { verticalFovRadians: viewer.verticalFovRadians }
      : {}),
    ...(finite(viewer.near) && viewer.near > 0 ? { near: viewer.near } : {}),
    ...(finite(viewer.far) && viewer.far > 0 ? { far: viewer.far } : {}),
  };
}

/**
 * Eye position for a camera authored inside a SOG.
 *
 * Kept for inspection and metrics, NOT used to frame the viewer. Exporters
 * author an exterior orbit: for the living-room capture this returns an eye at
 * y 3.79 against a ceiling at 1.82 — a dollhouse view of the outside of the
 * room. These are interior scans, so the viewer belongs inside the room at
 * eye height, which is what the point-cloud framing produces.
 *
 * `sogCameraIsInterior` below is the check that distinguishes the two.
 */
export function eyeFromSogViewer(hint: SogViewerHint): Vec3 {
  const { target, distance, yawRadians, pitchRadians } = hint;
  const cosPitch = Math.cos(pitchRadians);
  return [
    target[0] - distance * cosPitch * Math.sin(yawRadians),
    target[1] - distance * Math.sin(pitchRadians),
    target[2] - distance * cosPitch * Math.cos(yawRadians),
  ];
}

/** True when the file was trained expecting Mip-Splatting compensation. */
export function isAntialiasedReconstruction(meta: unknown): boolean {
  return (meta as { antialias?: unknown } | null)?.antialias === true;
}

/**
 * Resolve the material parameters for one reconstruction.
 *
 * The kernel is deliberately NOT keyed off the file's `antialias` flag. A
 * controlled CPU render of the same scene under both values showed 0.09 vs
 * 0.30 moves mean luminance by 0.00005 and clipped highlights by 0.001
 * percentage points, while costing about 9% sharpness. The kernel is a small
 * additive screen-space term next to the splat footprints, so it is not what
 * washes a render out, and varying it per file would only risk shifting the
 * published library for no measured gain.
 *
 * Overrides still win, so a scene can be dialled against a reference render.
 */
export function resolveSplatRenderProfile(
  _meta: unknown,
  overrides: RenderTuningOverrides = {},
): SplatRenderProfile {
  return {
    kernelSize:
      finite(overrides.kernel) && overrides.kernel! >= 0
        ? overrides.kernel!
        : GAUSSIAN_MIP_VARIANCE,
    compensation:
      typeof overrides.compensation === "boolean" ? overrides.compensation : true,
    useSphericalHarmonics: overrides.sh !== false,
  };
}

/**
 * Squared radius at which Spinoff stops drawing a Gaussian.
 *
 * Its fragment shader discards past `radiusSquared > 8.0` and, at that radius,
 * rescales alpha by `(exp(-0.5 * r2) - exp(-4)) / (1 - exp(-4))` so the value
 * reaches exactly zero as the edge is reached — finite support with a
 * continuous falloff, no rim.
 */
export const SPINOFF_SUPPORT_RADIUS_SQUARED = 8;

/**
 * Where a splat's edge falls, in standard deviations.
 *
 * Spark cannot renormalise the way Spinoff does; it hard-discards past
 * `maxStdDev`. So the cutoff has to sit where the Gaussian is already
 * negligible, or every splat ends in a visible rim once it is large on screen.
 * Matching Spinoff's radius puts it at exp(-4) — 1.8% of peak — where 2.0 would
 * leave 13.5%.
 */
export const SPLAT_MAX_STD_DEV = Math.sqrt(SPINOFF_SUPPORT_RADIUS_SQUARED);

/**
 * Fixed VKGS-tier kernel the /view policy applies to the existing library
 * (Reaigen-splatviewer-02/RENDERING.md), for reconstructions trained without
 * antialiasing.
 */
export const VIEW_KERNEL_VARIANCE = 0.15;

/**
 * Screen-space dilation for the external delivery engines, in px² of variance.
 *
 * Spark adds `blurAmount` straight onto the projected covariance diagonal and
 * Spinoff squares its `mipSigmaPixels` before doing the same, so both land on a
 * variance and both must be handed the same number for one file — otherwise the
 * scene changes exposure depending on which engine the device could run, which
 * is exactly what happened: WebGPU machines got 0.30 while everything on the
 * WebGL2 fallback got 0.15.
 *
 * Unlike `resolveSplatRenderProfile`, this *does* key off the file's own
 * `antialias` flag. That flag records that the trainer already added the 0.30
 * to its 2D covariance, and the Mip-Splatting opacity compensation is derived
 * from the same kernel — so rendering such a file at a smaller value
 * under-compensates and the splats come out brighter than the exporter
 * intended. Splatfiction's exports all set it.
 */
export function deliveryKernelVariance(
  antialiased: boolean,
  overrides: RenderTuningOverrides = {},
): number {
  if (finite(overrides.kernel) && overrides.kernel! >= 0) return overrides.kernel!;
  return antialiased ? GAUSSIAN_ANTIALIASED_VARIANCE : VIEW_KERNEL_VARIANCE;
}

/** Parse the tuning overrides out of a URL query string. */
export function parseRenderTuning(search: string): RenderTuningOverrides {
  const q = new URLSearchParams(search);
  const rawKernel = q.get("kernel");
  // `Number("")` is 0, so a bare `?kernel=` would silently disable dilation
  // entirely rather than being ignored. Treat blank as absent; an explicit
  // `?kernel=0` still means no dilation, which is a legitimate thing to ask.
  const parsedKernel =
    rawKernel === null || rawKernel.trim() === "" ? null : Number(rawKernel);
  const rawComp = q.get("comp");
  return {
    kernel: finite(parsedKernel) && parsedKernel >= 0 ? parsedKernel : null,
    compensation: rawComp === null ? null : rawComp !== "0",
    sh: q.get("sh") !== "0",
  };
}

/**
 * Whether an authored camera actually stands inside the captured volume.
 *
 * An exterior orbit is the normal case for an exporter preview and is wrong
 * for an interior walkthrough, so this is the test that decides whether an
 * authored camera could ever be used for framing.
 */
export function sogCameraIsInterior(meta: unknown): boolean {
  const hint = parseSogViewerHint(meta);
  const means = (meta as { means?: { mins?: number[]; maxs?: number[] } } | null)?.means;
  if (!hint || !Array.isArray(means?.mins) || !Array.isArray(means?.maxs)) return false;
  const eye = eyeFromSogViewer(hint);
  return eye.every((v, i) => v >= means!.mins![i] && v <= means!.maxs![i]);
}

/**
 * Pick an orbit azimuth whose camera position is not buried in geometry.
 *
 * The viewer places its camera on a ring around the scene centre and never
 * checks whether that spot is occupied. On a 32 m flat the ring clears the
 * furniture at every angle, so this went unnoticed; on a 3.8 m room capture
 * one quadrant put the camera inside a sofa with 956 splats within 0.35 m,
 * which renders as a wall of blurred fabric.
 *
 * Samples azimuths and returns the clearest, preferring the caller's existing
 * choice when nothing is meaningfully better so that scenes which already
 * frame well do not move.
 */
export function chooseClearAzimuth(
  points: ArrayLike<number>,
  centre: Vec3,
  radius: number,
  eyeY: number,
  options: { clearance?: number; samples?: number; preferred?: number } = {},
): { azimuth: number; blocked: number } {
  const clearance = options.clearance ?? 0.35;
  const samples = Math.max(4, options.samples ?? 16);
  const preferred = options.preferred ?? 0;
  const c2 = clearance * clearance;
  const n = Math.floor(points.length / 3);

  let best = { azimuth: preferred, blocked: Number.POSITIVE_INFINITY };
  for (let s = 0; s < samples; s += 1) {
    const azimuth = preferred + (s / samples) * Math.PI * 2;
    const ex = centre[0] + radius * Math.cos(azimuth);
    const ez = centre[2] + radius * Math.sin(azimuth);
    let blocked = 0;
    for (let i = 0; i < n; i += 1) {
      const dx = points[i * 3] - ex;
      const dy = points[i * 3 + 1] - eyeY;
      const dz = points[i * 3 + 2] - ez;
      if (dx * dx + dy * dy + dz * dz < c2) {
        blocked += 1;
        if (blocked >= best.blocked) break;   // cannot win; stop early
      }
    }
    if (blocked < best.blocked) best = { azimuth, blocked };
    if (blocked === 0) break;                 // clear enough, keep the earliest
  }
  return best;
}

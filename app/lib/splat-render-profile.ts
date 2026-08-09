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
 * Babylon's packed-splat path multiplies each decoded linear scale by two
 * before constructing the 3D covariance. SOG stores the Gaussian sigma
 * directly (the convention used by SuperSplat/PlayCanvas), so compensate once
 * after decoding. Babylon's internal x2 then reconstructs the authored sigma.
 */
export const BABYLON_SOG_SCALE_COMPENSATION = 0.5;

const PACKED_SPLAT_STRIDE_BYTES = 32;
const PACKED_SPLAT_STRIDE_FLOATS = PACKED_SPLAT_STRIDE_BYTES / Float32Array.BYTES_PER_ELEMENT;

/**
 * Normalize a transient decoded SOG buffer for Babylon's scale convention.
 *
 * The packed layout is position xyz, scale xyz, RGBA, quaternion. This mutates
 * only the three scale floats to avoid copying very large reconstructions.
 * Compressed source buffers in the cache are never passed here, so the
 * correction cannot accumulate between loads.
 */
export function normalizeDecodedSogScalesForBabylon(buffer: ArrayBuffer): ArrayBuffer {
  if (buffer.byteLength % PACKED_SPLAT_STRIDE_BYTES !== 0) {
    throw new Error(
      `Decoded SOG buffer has invalid byte length ${buffer.byteLength}; expected 32 bytes per splat`,
    );
  }

  const floats = new Float32Array(buffer);
  const splatCount = buffer.byteLength / PACKED_SPLAT_STRIDE_BYTES;
  for (let index = 0; index < splatCount; index += 1) {
    const scaleOffset = index * PACKED_SPLAT_STRIDE_FLOATS + 3;
    floats[scaleOffset] *= BABYLON_SOG_SCALE_COMPENSATION;
    floats[scaleOffset + 1] *= BABYLON_SOG_SCALE_COMPENSATION;
    floats[scaleOffset + 2] *= BABYLON_SOG_SCALE_COMPENSATION;
  }
  return buffer;
}

/** Camera authored by the exporter inside a SOG's meta.json. */
export interface SogViewerHint {
  target: Vec3;
  distance: number;
  yawRadians: number;
  pitchRadians: number;
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

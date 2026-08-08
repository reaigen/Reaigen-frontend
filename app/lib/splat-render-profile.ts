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
 * Eye position for an authored camera.
 *
 * Spherical offset from the target using the exporter's yaw and pitch, so the
 * scene is seen from where it was framed. The viewer's own framing derives
 * this from the point cloud with constants tuned for indoor room-scale
 * property scans — a 1.55 m standing eye height and a 1.5 m minimum orbit
 * radius — which seats the camera inside the cloud on an object-scale capture.
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
 * Overrides always win so a scene can be dialled against a reference; absent
 * those, the file's own `antialias` flag decides. Files predating that flag
 * keep the historic kernel, so nothing already published moves.
 */
export function resolveSplatRenderProfile(
  meta: unknown,
  overrides: RenderTuningOverrides = {},
): SplatRenderProfile {
  const antialiased = isAntialiasedReconstruction(meta);
  const defaultKernel = antialiased
    ? GAUSSIAN_ANTIALIASED_VARIANCE
    : GAUSSIAN_MIP_VARIANCE;
  return {
    kernelSize:
      finite(overrides.kernel) && overrides.kernel! >= 0
        ? overrides.kernel!
        : defaultKernel,
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

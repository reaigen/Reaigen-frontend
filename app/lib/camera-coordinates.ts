import type { CameraData, SavedCamera, Vec3 } from "./tour-types";

/** Backend splats and current web/iOS cameras share one Y-up identity space. */
export const CAMERA_COORDINATE_SPACE = "y-up-identity";

/** Camera payloads use radians for per-camera/FOV-Y values, while scene FOV
 * is exposed to editors in degrees. Accept either representation at read time. */
export function cameraFovRadians(value: unknown, fallback = 0.66): number {
  let numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  // Older workspace delivery code applied radians -> degrees to values that
  // were already degrees (85 became ~4870). Undo that legacy extra conversion
  // before accepting the normal radians-or-degrees transport contract.
  if (numeric > 180) numeric = numeric * Math.PI / 180;
  return numeric > Math.PI ? numeric * Math.PI / 180 : numeric;
}

export function cameraFovDegrees(value: unknown, fallback = 65): number {
  let numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  if (numeric > 180) numeric = numeric * Math.PI / 180;
  return numeric <= Math.PI ? numeric * 180 / Math.PI : numeric;
}

function mirrorX(vector: Vec3): Vec3 {
  return [-vector[0], vector[1], vector[2]];
}

function isLegacyEditedCamera(camera: SavedCamera, source?: string): boolean {
  if (camera.coordinate_space === CAMERA_COORDINATE_SPACE) return false;
  if (source === "training") return false;
  // Edited cameras are the only historical payloads with an explicit up vector.
  // Public share payloads do not always carry the top-level source marker.
  return source === "edited" || camera.up != null;
}

/**
 * Convert cameras saved while the web mesh used scaling(-1, 1, 1) into the
 * current identity scene space. New and training cameras pass through unchanged.
 */
export function normalizeCameraData(data: CameraData): CameraData {
  return {
    ...data,
    cameras: (data.cameras ?? []).map((camera) => {
      if (!isLegacyEditedCamera(camera, data.source)) {
        return {
          ...camera,
          position: [...camera.position] as Vec3,
          forward: [...camera.forward] as Vec3,
          up: camera.up ? [...camera.up] as Vec3 : undefined,
        };
      }
      return {
        ...camera,
        position: mirrorX(camera.position),
        forward: mirrorX(camera.forward),
        up: camera.up ? mirrorX(camera.up) : undefined,
        coordinate_space: CAMERA_COORDINATE_SPACE,
      };
    }),
  };
}

/** Mark a camera captured by the current identity-space viewer. */
export function markIdentityCamera(camera: Omit<SavedCamera, "coordinate_space">): SavedCamera {
  return { ...camera, coordinate_space: CAMERA_COORDINATE_SPACE };
}

import type { SavedCamera, Vec3 } from "./tour-types";

export interface TourThumbnailCamera {
  camera: SavedCamera;
  cameraId: string;
}

function isFiniteVec3(value: unknown): value is Vec3 {
  return Array.isArray(value)
    && value.length === 3
    && value.every((component) => (
      typeof component === "number" && Number.isFinite(component)
    ));
}

function isRenderableCamera(value: unknown): value is SavedCamera {
  if (!value || typeof value !== "object") return false;
  const camera = value as Partial<SavedCamera>;
  return isFiniteVec3(camera.position)
    && isFiniteVec3(camera.forward)
    && (!camera.up || isFiniteVec3(camera.up));
}

function renderableTourCameras(
  cameras: Array<Record<string, unknown>> | SavedCamera[] | null | undefined,
) {
  return (cameras ?? [])
    .map((camera, index) => ({ camera, index }))
    .filter((entry): entry is { camera: SavedCamera; index: number } => (
      isRenderableCamera(entry.camera)
    ));
}

function cameraSelection(camera: SavedCamera, index: number): TourThumbnailCamera {
  const cameraId = (
    typeof camera.id === "string" && camera.id.trim()
  ) || `saved-camera-${index + 1}`;
  return { camera, cameraId };
}

export function selectTourThumbnailCamera(
  cameras: Array<Record<string, unknown>> | SavedCamera[] | null | undefined,
): TourThumbnailCamera | null {
  const valid = renderableTourCameras(cameras);
  if (valid.length === 0) return null;

  const selected = valid.find(({ camera }) => camera.role === "hero")
    ?? valid.find(({ camera }) => camera.role === "tour")
    ?? valid[0];
  return cameraSelection(selected.camera, selected.index);
}

/** Resolve the exact server-proposed saved camera; never guess another one. */
export function findTourThumbnailCamera(
  cameras: Array<Record<string, unknown>> | SavedCamera[] | null | undefined,
  cameraId: string,
): TourThumbnailCamera | null {
  const selected = renderableTourCameras(cameras).find(({ camera, index }) => (
    cameraSelection(camera, index).cameraId === cameraId
  ));
  return selected ? cameraSelection(selected.camera, selected.index) : null;
}

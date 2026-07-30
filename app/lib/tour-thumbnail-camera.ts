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

export function selectTourThumbnailCamera(
  cameras: Array<Record<string, unknown>> | SavedCamera[] | null | undefined,
): TourThumbnailCamera | null {
  const valid = (cameras ?? [])
    .map((camera, index) => ({ camera, index }))
    .filter((entry): entry is { camera: SavedCamera; index: number } => (
      isRenderableCamera(entry.camera)
    ));
  if (valid.length === 0) return null;

  const selected = valid.find(({ camera }) => camera.role === "hero")
    ?? valid.find(({ camera }) => camera.role === "tour")
    ?? valid[0];
  const cameraId = (
    typeof selected.camera.id === "string" && selected.camera.id.trim()
  ) || `saved-camera-${selected.index + 1}`;
  return { camera: selected.camera, cameraId };
}

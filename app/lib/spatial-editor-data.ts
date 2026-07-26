import type {
  RoomKitCageWall,
  SpatialCameraSample,
  SpatialTrajectory,
  TourData,
  Vec3,
} from "./tour-types";

const DEFAULT_FOV = 0.66;
const MAX_TRAJECTORY_SAMPLES = 360;

function finiteVec3(value: unknown): Vec3 | null {
  if (!Array.isArray(value) || value.length < 3) return null;
  const vector: Vec3 = [Number(value[0]), Number(value[1]), Number(value[2])];
  return vector.every(Number.isFinite) ? vector : null;
}

function normalize(vector: Vec3, fallback: Vec3): Vec3 {
  const length = Math.hypot(vector[0], vector[1], vector[2]);
  if (!Number.isFinite(length) || length < 1e-6) return fallback;
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

/** CapturedRoom encodes its simd matrices as flat, column-major arrays. */
export function parseRoomKitCage(value: unknown): RoomKitCageWall[] {
  const room = value as { walls?: unknown[] } | null;
  if (!room || !Array.isArray(room.walls)) return [];

  return room.walls.flatMap((rawWall, index) => {
    const wall = rawWall as {
      identifier?: unknown;
      dimensions?: unknown;
      transform?: unknown;
    };
    if (!Array.isArray(wall.dimensions) || !Array.isArray(wall.transform)) return [];

    const dimensions = wall.dimensions.map(Number);
    const transform = wall.transform.map(Number);
    if (
      dimensions.length < 2
      || transform.length < 16
      || !dimensions.slice(0, 2).every(Number.isFinite)
      || ![transform[0], transform[2], transform[12], transform[13], transform[14]].every(Number.isFinite)
    ) {
      return [];
    }

    const width = Math.abs(dimensions[0]);
    const height = Math.abs(dimensions[1]);
    if (width < 0.02 || height < 0.02) return [];

    return [{
      id: String(wall.identifier ?? `wall-${index}`).toLowerCase(),
      center: [transform[12], transform[13], transform[14]] as Vec3,
      width,
      height,
      thickness: Math.max(0.025, Math.abs(dimensions[2] ?? 0.035)),
      yaw: -Math.atan2(transform[2], transform[0]),
    }];
  });
}

function intersectsRoomKitWall(
  point: Vec3,
  wall: RoomKitCageWall,
  radius: number,
): boolean {
  const dx = point[0] - wall.center[0];
  const dy = point[1] - wall.center[1];
  const dz = point[2] - wall.center[2];
  if (Math.abs(dy) > wall.height * 0.5 + radius) return false;
  const cosine = Math.cos(wall.yaw);
  const sine = Math.sin(wall.yaw);
  const localX = cosine * dx - sine * dz;
  const localZ = sine * dx + cosine * dz;
  return (
    Math.abs(localX) <= wall.width * 0.5 + radius
    && Math.abs(localZ) <= wall.thickness * 0.5 + radius
  );
}

/**
 * Sweep a first-person camera through canonical RoomKit wall volumes.
 *
 * Collision is intentionally evaluated in capture space. The accepted point
 * is transformed back through the USD root afterwards, so arbitrary global
 * translation/rotation/scale never separates collision geometry from cameras.
 */
export function resolveRoomKitMovement(
  start: Vec3,
  target: Vec3,
  walls: RoomKitCageWall[],
  radius = 0.18,
): Vec3 {
  if (!walls.length) return [...target] as Vec3;
  const distance = Math.hypot(
    target[0] - start[0],
    target[1] - start[1],
    target[2] - start[2],
  );
  const steps = Math.max(1, Math.min(96, Math.ceil(distance / 0.04)));
  let accepted = [...start] as Vec3;
  for (let step = 1; step <= steps; step += 1) {
    const amount = step / steps;
    const candidate: Vec3 = [
      start[0] + (target[0] - start[0]) * amount,
      start[1] + (target[1] - start[1]) * amount,
      start[2] + (target[2] - start[2]) * amount,
    ];
    if (walls.some((wall) => intersectsRoomKitWall(candidate, wall, radius))) {
      return accepted;
    }
    accepted = candidate;
  }
  return accepted;
}

interface CameraMatrix {
  values: number[];
  /** Flat matrices can be row-major (current ARSerialize) or column-major. */
  ambiguousLayout: boolean;
}

function encodedMatrix(value: unknown): CameraMatrix | null {
  if (Array.isArray(value) && value.length === 16) {
    const matrix = value.map(Number);
    return matrix.every(Number.isFinite)
      ? { values: matrix, ambiguousLayout: true }
      : null;
  }
  if (Array.isArray(value) && value.length === 4 && value.every(Array.isArray)) {
    const rows = value as unknown[][];
    const matrix = rows.flatMap((row) => row.slice(0, 4).map(Number));
    return matrix.length === 16 && matrix.every(Number.isFinite)
      ? { values: matrix, ambiguousLayout: false }
      : null;
  }
  if (value && typeof value === "object") {
    const columns = (value as { columns?: unknown }).columns;
    if (
      Array.isArray(columns)
      && columns.length === 4
      && columns.every((column) => Array.isArray(column) && column.length >= 4)
    ) {
      const typedColumns = columns as unknown[][];
      const matrix = Array.from({ length: 4 }, (_, row) => (
        Array.from({ length: 4 }, (_, column) => Number(typedColumns[column][row]))
      )).flat();
      return matrix.every(Number.isFinite)
        ? { values: matrix, ambiguousLayout: false }
        : null;
    }
  }
  return null;
}

function cameraMatrix(frame: Record<string, unknown>): CameraMatrix | null {
  const camera = (
    frame.camera && typeof frame.camera === "object"
      ? frame.camera
      : frame
  ) as Record<string, unknown>;
  for (const key of [
    "transform_wc",
    "transform",
    "transform_matrix",
    "transformMatrix",
    "cameraPoseARFrame",
    "pose",
    "worldTransform",
    "world_transform",
  ]) {
    const matrix = encodedMatrix(camera[key] ?? frame[key]);
    if (matrix) return matrix;
  }
  const columns = encodedMatrix(camera.columns ? { columns: camera.columns } : frame.columns ? { columns: frame.columns } : null);
  if (columns) return columns;
  return null;
}

function cameraSample(
  frame: Record<string, unknown>,
  ambiguousLayout: "row" | "column",
): SpatialCameraSample | null {
  const encoded = cameraMatrix(frame);
  if (!encoded) return null;
  const matrix = encoded.values;
  const layout = encoded.ambiguousLayout ? ambiguousLayout : "row";

  const camera = (
    frame.camera && typeof frame.camera === "object"
      ? frame.camera
      : frame
  ) as Record<string, unknown>;
  const position: Vec3 = layout === "row"
    ? [matrix[3], matrix[7], matrix[11]]
    : [matrix[12], matrix[13], matrix[14]];
  const forward = layout === "row"
    ? normalize([-matrix[2], -matrix[6], -matrix[10]], [0, 0, -1])
    : normalize([-matrix[8], -matrix[9], -matrix[10]], [0, 0, -1]);
  const up = layout === "row"
    ? normalize([matrix[1], matrix[5], matrix[9]], [0, 1, 0])
    : normalize([matrix[4], matrix[5], matrix[6]], [0, 1, 0]);
  if (!position.every(Number.isFinite)) return null;

  const intrinsics = Array.isArray(camera.intrinsics_fx_fy_cx_cy)
    ? camera.intrinsics_fx_fy_cx_cy.map(Number)
    : [];
  const resolution = Array.isArray(camera.image_resolution)
    ? camera.image_resolution.map(Number)
    : [];
  const fy = intrinsics[1];
  const height = resolution[1];
  const fov = Number.isFinite(fy) && fy > 0 && Number.isFinite(height) && height > 0
    ? 2 * Math.atan(height / (2 * fy))
    : DEFAULT_FOV;

  return { position, forward, up, fov };
}

function trajectoryExtent(samples: SpatialCameraSample[]): number {
  if (!samples.length) return 0;
  let minX = samples[0].position[0];
  let minY = samples[0].position[1];
  let minZ = samples[0].position[2];
  let maxX = minX;
  let maxY = minY;
  let maxZ = minZ;
  for (const sample of samples.slice(1)) {
    const [x, y, z] = sample.position;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    maxZ = Math.max(maxZ, z);
  }
  return Math.hypot(maxX - minX, maxY - minY, maxZ - minZ);
}

function normalizeIndices(value: unknown, frameCount: number): number[] | null {
  const raw = Array.isArray(value)
    ? value
    : value && typeof value === "object" && Array.isArray((value as { indices?: unknown }).indices)
      ? (value as { indices: unknown[] }).indices
      : null;
  if (!raw) return null;
  const indices = raw
    .map(Number)
    .filter((index) => Number.isInteger(index) && index >= 0 && index < frameCount);
  return indices.length ? indices : null;
}

function sampleEvenly<T>(items: T[], maximum = MAX_TRAJECTORY_SAMPLES): T[] {
  if (items.length <= maximum) return items;
  const sampled: T[] = [];
  const denominator = maximum - 1;
  for (let index = 0; index < maximum; index += 1) {
    sampled.push(items[Math.round((index / denominator) * (items.length - 1))]);
  }
  return sampled;
}

export function parseScanTrajectory(
  jsonl: string,
  frameIndices: unknown,
  id: string,
  label: string,
): SpatialTrajectory | null {
  const frames = jsonl
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const value = JSON.parse(line);
        return value && typeof value === "object" ? [value as Record<string, unknown>] : [];
      } catch {
        return [];
      }
    });
  if (!frames.length) return null;

  const indices = normalizeIndices(frameIndices, frames.length);
  const selectedFrames = indices ? indices.map((index) => frames[index]) : frames;
  const rowSamples = selectedFrames.flatMap((frame) => {
    const sample = cameraSample(frame, "row");
    return sample ? [sample] : [];
  });
  const columnSamples = selectedFrames.flatMap((frame) => {
    const sample = cameraSample(frame, "column");
    return sample ? [sample] : [];
  });
  const rowExtent = trajectoryExtent(rowSamples);
  const columnExtent = trajectoryExtent(columnSamples);
  const resolvedSamples = columnExtent > Math.max(0.03, rowExtent * 1.5)
    ? columnSamples
    : rowSamples;
  // Orientation-only photo bundles do not contain a spatial path. Falling
  // back to the published TourData is more honest than drawing all cameras at
  // the origin and presenting that as captured movement.
  if (trajectoryExtent(resolvedSamples) < 0.03) return null;
  const samples = sampleEvenly(resolvedSamples);
  if (samples.length < 2) return null;
  return { id, label, source: "scan", samples };
}

export function trajectoryFromTour(tour: TourData, label: string): SpatialTrajectory | null {
  if (!tour.positions?.length || tour.positions.length !== tour.forwards?.length) return null;
  const firstFov = tour.shots?.[0]?.fov ?? DEFAULT_FOV;
  const samples = sampleEvenly(tour.positions.flatMap((position, index) => {
    const safePosition = finiteVec3(position);
    const safeForward = finiteVec3(tour.forwards[index]);
    if (!safePosition || !safeForward) return [];
    return [{
      position: safePosition,
      forward: normalize(safeForward, [0, 0, -1]),
      up: [0, 1, 0] as Vec3,
      fov: firstFov,
    }];
  }));
  if (samples.length < 2) return null;
  return {
    id: "published-tour",
    label,
    source: tour.sceneType === "saved-cameras" ? "saved" : "tour",
    samples,
  };
}

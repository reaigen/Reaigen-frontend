/**
 * Keep the camera inside the reconstruction.
 *
 * The viewer flies a `FreeCamera` with no limits, so pulling back far enough
 * leaves the captured volume entirely and looks at the splat cloud from the
 * outside: floaters, background gaussians and no room. That is not a rendering
 * fault — nothing coherent exists out there to render. A reconstruction is only
 * defined where cameras actually looked.
 *
 * The bounds come from the same robust percentiles the viewer already frames
 * from (2nd/98th per axis). Percentiles matter here: the literal extents of a
 * splat file are set by its worst floaters, so a box built from raw min/max
 * would be the size of the artefacts rather than the size of the room.
 */

export interface CameraBoundsVolume {
  footprint: { minX: number; maxX: number; minZ: number; maxZ: number };
  floorY: number;
  ceilingY: number;
  /** Robust scene radius; sets how much slack is allowed outside the box. */
  radius: number;
}

/**
 * Slack outside the reconstruction, as a fraction of scene radius.
 *
 * Not zero: a camera pinned exactly to the point cloud's edge cannot frame the
 * wall it is standing against, and every room reads as cramped. This is enough
 * to back up against a wall and see it, and far too little to escape.
 */
const LATERAL_SLACK = 0.35;
/** Headroom above the ceiling plane and below the floor plane, in metres. */
const VERTICAL_SLACK = 0.6;
/** Rooms are never smaller than this, whatever the percentiles say. */
const MINIMUM_HALF_EXTENT = 0.75;

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

function clamp(value: number, low: number, high: number): number {
  if (low > high) return (low + high) / 2;
  return value < low ? low : value > high ? high : value;
}

/**
 * The box a camera may occupy. Exported so the limits can be asserted directly
 * rather than inferred from a clamped position.
 */
export function cameraBoundsFor(volume: CameraBoundsVolume) {
  const slack = Math.max(0.4, (volume.radius || 2) * LATERAL_SLACK);
  const { minX, maxX, minZ, maxZ } = volume.footprint;

  // A degenerate footprint — a single room captured from one spot, or a
  // half-failed reconstruction — must not collapse into a box the camera
  // cannot move inside at all.
  const centreX = (minX + maxX) / 2;
  const centreZ = (minZ + maxZ) / 2;
  const halfX = Math.max(MINIMUM_HALF_EXTENT, (maxX - minX) / 2);
  const halfZ = Math.max(MINIMUM_HALF_EXTENT, (maxZ - minZ) / 2);

  const floor = Math.min(volume.floorY, volume.ceilingY);
  const ceiling = Math.max(volume.floorY, volume.ceilingY);

  return {
    minX: centreX - halfX - slack,
    maxX: centreX + halfX + slack,
    minZ: centreZ - halfZ - slack,
    maxZ: centreZ + halfZ + slack,
    minY: floor - VERTICAL_SLACK,
    maxY: ceiling + VERTICAL_SLACK,
  };
}

/**
 * Position clamped into the volume, or the same values when already inside.
 *
 * Returns plain numbers rather than mutating, so the caller decides whether a
 * frame's movement is applied — and so this is testable without a scene.
 */
export function clampCameraPosition(
  position: Vec3Like,
  volume: CameraBoundsVolume | null,
): { x: number; y: number; z: number; clamped: boolean } {
  const { x, y, z } = position;
  if (!volume) return { x, y, z, clamped: false };

  const bounds = cameraBoundsFor(volume);
  const nextX = clamp(x, bounds.minX, bounds.maxX);
  const nextY = clamp(y, bounds.minY, bounds.maxY);
  const nextZ = clamp(z, bounds.minZ, bounds.maxZ);

  return {
    x: nextX,
    y: nextY,
    z: nextZ,
    // A float that survives the comparison unchanged has not been clamped;
    // the caller uses this to avoid writing to the camera every frame.
    clamped: nextX !== x || nextY !== y || nextZ !== z,
  };
}

/**
 * Clamp a presentation/world-space camera against canonical reconstruction
 * bounds. The OpenUSD root can translate, rotate, or scale the entire scene;
 * comparing its world camera directly with canonical bounds makes the clamp
 * fight the camera every frame and presents as shake near an invented wall.
 */
export function clampCameraPositionInCoordinateSpace(
  position: Vec3Like,
  volume: CameraBoundsVolume | null,
  toBoundsSpace: (point: [number, number, number]) => [number, number, number],
  fromBoundsSpace: (point: [number, number, number]) => [number, number, number],
): { x: number; y: number; z: number; clamped: boolean } {
  if (!volume) return { ...position, clamped: false };
  const canonical = toBoundsSpace([position.x, position.y, position.z]);
  const held = clampCameraPosition(
    { x: canonical[0], y: canonical[1], z: canonical[2] },
    volume,
  );
  if (!held.clamped) return { ...position, clamped: false };
  const world = fromBoundsSpace([held.x, held.y, held.z]);
  return { x: world[0], y: world[1], z: world[2], clamped: true };
}

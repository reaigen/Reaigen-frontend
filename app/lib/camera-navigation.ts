import type { Vec3 } from "./tour-types";

export type CameraMovementKey = "w" | "a" | "s" | "d" | "q" | "e";

const MOVEMENT_KEYS = new Set<CameraMovementKey>(["w", "a", "s", "d", "q", "e"]);
const PHYSICAL_MOVEMENT_KEYS: Record<string, CameraMovementKey> = {
  KeyW: "w",
  KeyA: "a",
  KeyS: "s",
  KeyD: "d",
  KeyQ: "q",
  KeyE: "e",
};

function normalized(value: Vec3, fallback: Vec3): Vec3 {
  const length = Math.hypot(...value);
  return Number.isFinite(length) && length > 1e-6
    ? [value[0] / length, value[1] / length, value[2] / length]
    : fallback;
}

function dot(left: Vec3, right: Vec3) {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function cross(left: Vec3, right: Vec3): Vec3 {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function projectedForward(rawForward: Vec3, up: Vec3, fallbackForward: Vec3): Vec3 {
  const project = (value: Vec3): Vec3 => {
    const vertical = dot(value, up);
    return [
      value[0] - up[0] * vertical,
      value[1] - up[1] * vertical,
      value[2] - up[2] * vertical,
    ];
  };
  const projected = project(rawForward);
  if (Math.hypot(...projected) > 1e-6) return normalized(projected, [0, 0, 1]);
  const fallback = project(fallbackForward);
  if (Math.hypot(...fallback) > 1e-6) return normalized(fallback, [0, 0, 1]);
  const axis: Vec3 = Math.abs(up[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  return normalized(project(axis), [0, 0, 1]);
}

/** Resolve physical WASD/QE keys even when the active keyboard layout differs. */
export function cameraMovementKey(event: Pick<KeyboardEvent, "code" | "key">): CameraMovementKey | null {
  const physical = PHYSICAL_MOVEMENT_KEYS[event.code];
  if (physical) return physical;
  const logical = event.key.toLowerCase() as CameraMovementKey;
  return MOVEMENT_KEYS.has(logical) ? logical : null;
}

/**
 * Unit movement direction in the camera's authored ground plane.
 * Forward/back never inherits pitch, while Q/E follows the scene-relative up
 * axis, preventing roll or a transformed USD stage from changing key meaning.
 */
export function cameraWalkDirection(
  rawForward: Vec3,
  rawUp: Vec3,
  pressed: ReadonlySet<string>,
  fallbackForward: Vec3 = [0, 0, 1],
): Vec3 {
  const up = normalized(rawUp, [0, 1, 0]);
  const forward = projectedForward(rawForward, up, fallbackForward);
  const right = normalized(cross(up, forward), [1, 0, 0]);
  const movement: Vec3 = [0, 0, 0];
  const add = (direction: Vec3, factor: number) => {
    movement[0] += direction[0] * factor;
    movement[1] += direction[1] * factor;
    movement[2] += direction[2] * factor;
  };

  if (pressed.has("w")) add(forward, 1);
  if (pressed.has("s")) add(forward, -1);
  if (pressed.has("d")) add(right, 1);
  if (pressed.has("a")) add(right, -1);
  if (pressed.has("e")) add(up, 1);
  if (pressed.has("q")) add(up, -1);

  const length = Math.hypot(...movement);
  return length > 1e-6
    ? [movement[0] / length, movement[1] / length, movement[2] / length]
    : [0, 0, 0];
}

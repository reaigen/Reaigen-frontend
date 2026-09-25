import type { SpinoffOrbitCamera } from "@reaigen/spinoff";
import type { Vec3 } from "./tour-types";

/** The parts of a Babylon target camera the Gaussian engines read every frame. */
export interface CameraPoseSource {
  position: { x: number; y: number; z: number };
  upVector: { x: number; y: number; z: number };
  fov: number;
  minZ?: number;
  maxZ?: number;
  getTarget(): { x: number; y: number; z: number };
  getViewMatrix?(force?: boolean): unknown;
}

/**
 * The look-at point of a Babylon target camera for the pose it holds *now*.
 *
 * `getTarget()` returns the point Babylon computed with its last view matrix.
 * A pose set earlier in the frame — a flight step, a WASD move, an inertial
 * drag — has already moved `position` and `rotation`, but that cached target
 * still belongs to the previous frame. An engine that aims this frame's
 * position at last frame's target is off by one frame of travel on a
 * five-metre lever: a fraction of a degree that changes with every frame
 * time, which the eye reads as the camera compensating its aim every frame,
 * and as an up-and-down wobble whenever the travel has a vertical component.
 * Asking for the view matrix first folds the pending pose into the target;
 * Babylon skips the recompute when nothing changed.
 */
export function currentCameraTarget<
  Source extends { getTarget(): unknown; getViewMatrix?(force?: boolean): unknown },
>(source: Source): ReturnType<Source["getTarget"]> {
  source.getViewMatrix?.();
  return source.getTarget() as ReturnType<Source["getTarget"]>;
}

function normalizeVec3(value: Vec3, fallback: Vec3 = [0, 0, 1]): Vec3 {
  const length = Math.hypot(value[0], value[1], value[2]);
  if (!Number.isFinite(length) || length < 1e-6) return fallback;
  return [value[0] / length, value[1] / length, value[2] / length];
}

/**
 * Push the Babylon camera's pose into Spinoff's orbit camera.
 *
 * Spinoff expresses a pose as target, distance, yaw, pitch and roll; the
 * conversion below is exact for any pose, and `setTarget` is the one call
 * that publishes it, so the renderer sees a complete pose or nothing. A pose
 * that did not change is not re-published, or the renderer would treat a
 * still camera as moving.
 */
export function synchronizeSpinoffCamera(
  target: SpinoffOrbitCamera,
  source: CameraPoseSource | null | undefined,
): void {
  if (!source) return;
  const sourceTarget = currentCameraTarget(source);
  const position: Vec3 = [source.position.x, source.position.y, source.position.z];
  const forward = normalizeVec3([
    sourceTarget.x - source.position.x,
    sourceTarget.y - source.position.y,
    sourceTarget.z - source.position.z,
  ]);
  const distance = Math.max(0.08, Math.hypot(
    sourceTarget.x - source.position.x,
    sourceTarget.y - source.position.y,
    sourceTarget.z - source.position.z,
  ));
  const pitch = -Math.asin(Math.max(-1, Math.min(1, forward[1])));
  const yaw = Math.atan2(forward[2], -forward[0]);

  const backward: Vec3 = [-forward[0], -forward[1], -forward[2]];
  const right = normalizeVec3([
    backward[2],
    0,
    -backward[0],
  ], [1, 0, 0]);
  const referenceUp = normalizeVec3([
    backward[1] * right[2] - backward[2] * right[1],
    backward[2] * right[0] - backward[0] * right[2],
    backward[0] * right[1] - backward[1] * right[0],
  ], [0, 1, 0]);
  const authoredUp = normalizeVec3([
    source.upVector.x,
    source.upVector.y,
    source.upVector.z,
  ], referenceUp);
  const roll = Math.atan2(
    authoredUp[0] * right[0] + authoredUp[1] * right[1] + authoredUp[2] * right[2],
    authoredUp[0] * referenceUp[0] + authoredUp[1] * referenceUp[1] + authoredUp[2] * referenceUp[2],
  );

  const nextTarget: Vec3 = [
    position[0] + forward[0] * distance,
    position[1] + forward[1] * distance,
    position[2] + forward[2] * distance,
  ];
  const close = (left: number, rightValue: number) => (
    Math.abs(left - rightValue) <= 1e-6 * Math.max(1, Math.abs(left), Math.abs(rightValue))
  );
  const nextNear = Math.max(0.001, source.minZ ?? 0.02);
  const nextFar = Math.max(nextNear + 1, source.maxZ ?? 500);
  const changed = (
    !close(target.distance, distance)
    || !close(target.yawRadians, yaw)
    || !close(target.pitchRadians, pitch)
    || !close(target.rollRadians, roll)
    || !close(target.verticalFovRadians, source.fov)
    || !close(target.near, nextNear)
    || !close(target.far, nextFar)
    || nextTarget.some((value, index) => !close(target.target[index], value))
  );
  if (!changed) return;

  target.distance = distance;
  target.yawRadians = yaw;
  target.pitchRadians = pitch;
  target.rollRadians = roll;
  target.verticalFovRadians = source.fov;
  target.near = nextNear;
  target.far = nextFar;
  // setTarget publishes the one renderer invalidation for the complete pose.
  target.setTarget(nextTarget);
}

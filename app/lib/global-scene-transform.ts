import type {
  GlobalSceneTransform,
  UniversalSceneDescription,
  Vec3,
} from "./tour-types";

export const IDENTITY_GLOBAL_SCENE_TRANSFORM: GlobalSceneTransform = {
  version: 1,
  coordinateSpace: "reaigen_y_up",
  rotationDeg: [0, 0, 0],
  translation: [0, 0, 0],
  scale: 1,
};

function finiteVec3(value: unknown, fallback: Vec3): Vec3 {
  if (
    !Array.isArray(value)
    || value.length !== 3
    || !value.every((item) => typeof item === "number" && Number.isFinite(item))
  ) {
    return [...fallback] as Vec3;
  }
  return [value[0], value[1], value[2]];
}

export function normalizeGlobalSceneTransform(value: unknown): GlobalSceneTransform {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return cloneGlobalSceneTransform(IDENTITY_GLOBAL_SCENE_TRANSFORM);
  }
  const raw = value as Record<string, unknown>;
  const rawScale = typeof raw.scale === "number" && Number.isFinite(raw.scale)
    ? raw.scale
    : 1;
  return {
    version: 1,
    coordinateSpace: "reaigen_y_up",
    rotationDeg: finiteVec3(raw.rotationDeg ?? raw.rotation_deg, [0, 0, 0]),
    translation: finiteVec3(raw.translation, [0, 0, 0]),
    scale: rawScale > 0 ? rawScale : 1,
  };
}

/**
 * Prefer the universal scene contract and fall back to the migration-era
 * globalTransform object. The editor Euler hint is only used to populate the
 * controls; runtime renderers receive the same transform semantics.
 */
export function globalSceneTransformFromDescription(
  sceneDescription: unknown,
  legacyTransform?: unknown,
): GlobalSceneTransform {
  if (
    sceneDescription
    && typeof sceneDescription === "object"
    && !Array.isArray(sceneDescription)
  ) {
    const scene = sceneDescription as Partial<UniversalSceneDescription>;
    const root = scene.rootTransform;
    const editor = scene.editor;
    if (
      scene.schema === "com.reaigen.scene"
      && (scene.version === 1 || scene.version === 2)
      && root
      && root.operationOrder === "scale-rotate-translate"
      && Array.isArray(root.scale)
    ) {
      const scale = root.scale[0];
      return normalizeGlobalSceneTransform({
        version: 1,
        coordinateSpace: "reaigen_y_up",
        rotationDeg: editor?.rotationEulerDegrees,
        translation: root.translation,
        scale,
      });
    }
  }
  return normalizeGlobalSceneTransform(legacyTransform);
}

export function cloneGlobalSceneTransform(
  transform: GlobalSceneTransform,
): GlobalSceneTransform {
  return {
    ...transform,
    rotationDeg: [...transform.rotationDeg] as Vec3,
    translation: [...transform.translation] as Vec3,
  };
}

export function globalSceneTransformsEqual(
  left: GlobalSceneTransform,
  right: GlobalSceneTransform,
  epsilon = 0.00001,
): boolean {
  return (
    Math.abs(left.scale - right.scale) <= epsilon
    && left.rotationDeg.every((value, index) => (
      Math.abs(value - right.rotationDeg[index]) <= epsilon
    ))
    && left.translation.every((value, index) => (
      Math.abs(value - right.translation[index]) <= epsilon
    ))
  );
}

type QuaternionXYZW = [number, number, number, number];

/**
 * Match the backend/OpenUSD authoring quaternion exactly.
 *
 * Euler controls are an editing convenience only. Spatial content is composed
 * as one root quaternion so splats, RoomKit, cameras and trajectories cannot
 * develop platform-specific transform orders.
 */
export function globalSceneQuaternion(
  transform: GlobalSceneTransform,
): QuaternionXYZW {
  const [pitchDeg, yawDeg, rollDeg] = transform.rotationDeg;
  const pitch = pitchDeg * Math.PI / 180;
  const yaw = yawDeg * Math.PI / 180;
  const roll = rollDeg * Math.PI / 180;
  const halfRoll = roll * 0.5;
  const halfPitch = pitch * 0.5;
  const halfYaw = yaw * 0.5;
  const sinRoll = Math.sin(halfRoll);
  const cosRoll = Math.cos(halfRoll);
  const sinPitch = Math.sin(halfPitch);
  const cosPitch = Math.cos(halfPitch);
  const sinYaw = Math.sin(halfYaw);
  const cosYaw = Math.cos(halfYaw);
  const quaternion: QuaternionXYZW = [
    cosYaw * sinPitch * cosRoll + sinYaw * cosPitch * sinRoll,
    sinYaw * cosPitch * cosRoll - cosYaw * sinPitch * sinRoll,
    cosYaw * cosPitch * sinRoll - sinYaw * sinPitch * cosRoll,
    cosYaw * cosPitch * cosRoll + sinYaw * sinPitch * sinRoll,
  ];
  const length = Math.hypot(...quaternion) || 1;
  return quaternion.map((value) => value / length) as QuaternionXYZW;
}

function rotateByQuaternion(vector: Vec3, quaternion: QuaternionXYZW): Vec3 {
  const [x, y, z, w] = quaternion;
  const tx = 2 * (y * vector[2] - z * vector[1]);
  const ty = 2 * (z * vector[0] - x * vector[2]);
  const tz = 2 * (x * vector[1] - y * vector[0]);
  return [
    vector[0] + w * tx + (y * tz - z * ty),
    vector[1] + w * ty + (z * tx - x * tz),
    vector[2] + w * tz + (x * ty - y * tx),
  ];
}

function normalizeDirection(vector: Vec3, fallback: Vec3): Vec3 {
  const length = Math.hypot(...vector);
  if (!Number.isFinite(length) || length < 1e-9) return fallback;
  return vector.map((value) => value / length) as Vec3;
}

/** Canonical Y-up metres → composed presentation-world point. */
export function transformCanonicalPoint(
  point: Vec3,
  transform: GlobalSceneTransform,
): Vec3 {
  const scaled = point.map((value) => value * transform.scale) as Vec3;
  const rotated = rotateByQuaternion(scaled, globalSceneQuaternion(transform));
  return rotated.map(
    (value, index) => value + transform.translation[index],
  ) as Vec3;
}

/** Canonical direction → composed presentation-world direction (`w = 0`). */
export function transformCanonicalDirection(
  direction: Vec3,
  transform: GlobalSceneTransform,
): Vec3 {
  return normalizeDirection(
    rotateByQuaternion(direction, globalSceneQuaternion(transform)),
    [0, 0, -1],
  );
}

/** Presentation-world point → canonical Y-up metres. */
export function inversePresentationPoint(
  point: Vec3,
  transform: GlobalSceneTransform,
): Vec3 {
  const translated = point.map(
    (value, index) => value - transform.translation[index],
  ) as Vec3;
  const [x, y, z, w] = globalSceneQuaternion(transform);
  const unrotated = rotateByQuaternion(translated, [-x, -y, -z, w]);
  return unrotated.map((value) => value / transform.scale) as Vec3;
}

/** Presentation-world direction → canonical direction (`w = 0`). */
export function inversePresentationDirection(
  direction: Vec3,
  transform: GlobalSceneTransform,
): Vec3 {
  const [x, y, z, w] = globalSceneQuaternion(transform);
  return normalizeDirection(
    rotateByQuaternion(direction, [-x, -y, -z, w]),
    [0, 0, -1],
  );
}

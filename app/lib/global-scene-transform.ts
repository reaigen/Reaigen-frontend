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
  scale3: [1, 1, 1],
  scale: 1,
};

export const MIN_ABSOLUTE_SCENE_SCALE = 0.001;
export const MAX_ABSOLUTE_SCENE_SCALE = 1000;

/**
 * Scale components may be negative to mirror content, but never zero because
 * the presentation/canonical coordinate conversion must remain invertible.
 */
export function clampSceneScaleComponent(value: number, fallback = 1): number {
  if (!Number.isFinite(value)) return fallback;
  const clipped = Math.max(-MAX_ABSOLUTE_SCENE_SCALE, Math.min(MAX_ABSOLUTE_SCENE_SCALE, value));
  if (Math.abs(clipped) >= MIN_ABSOLUTE_SCENE_SCALE) return clipped;
  return clipped < 0 ? -MIN_ABSOLUTE_SCENE_SCALE : MIN_ABSOLUTE_SCENE_SCALE;
}

/**
 * Clamp a dragged scale component to the sign the scene already had.
 *
 * Mirroring is a supported authored state, so the sign is preserved rather
 * than dropped. What a drag must never do is *change* it: Babylon's per-axis
 * scale gizmo has no sign clamp, so pulling a handle through the origin
 * silently flips that axis and mirrors the whole scene.
 */
export function scaleComponentWithAuthoredSign(
  value: number,
  authored: number,
  fallback = 1,
): number {
  if (!Number.isFinite(value)) return fallback;
  const magnitude = Math.abs(clampSceneScaleComponent(value, fallback));
  return authored < 0 ? -magnitude : magnitude;
}

/** Positive legacy scalar retained for older API consumers. */
export function sceneScaleMagnitude(scale3: Vec3): number {
  return Math.cbrt(Math.abs(scale3[0] * scale3[1] * scale3[2]));
}

export function globalSceneScale3(transform: GlobalSceneTransform): Vec3 {
  return transform.scale3
    ? [...transform.scale3] as Vec3
    : [transform.scale, transform.scale, transform.scale];
}

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

function isFiniteNumberArray(value: unknown, length: number): value is number[] {
  return (
    Array.isArray(value)
    && value.length === length
    && value.every((item) => typeof item === "number" && Number.isFinite(item))
  );
}

/**
 * Validate the shared backend/web/iOS projection before it is allowed to
 * influence rendering.
 *
 * Schema v2 is the materialized view of the immutable OpenUSD stage. Keeping
 * these checks beside the transform reader prevents a partially decoded or
 * platform-specific payload from silently becoming a different scene.
 */
export function isSupportedUniversalSceneDescription(
  value: unknown,
): value is UniversalSceneDescription {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const scene = value as Partial<UniversalSceneDescription>;
  const coordinateSystem = scene.coordinateSystem;
  const root = scene.rootTransform;
  const contentSpace = scene.contentSpace;
  const cameraPolicy = scene.cameraPolicy;
  if (
    scene.schema !== "com.reaigen.scene"
    || (scene.version !== 1 && scene.version !== 2)
    || coordinateSystem?.handedness !== "right"
    || coordinateSystem.upAxis !== "+Y"
    || coordinateSystem.forwardAxis !== "+Z"
    || coordinateSystem.linearUnit !== "meter"
    || root?.operationOrder !== "scale-rotate-translate"
    || !isFiniteNumberArray(root.translation, 3)
    || !isFiniteNumberArray(root.rotationQuaternion, 4)
    || !isFiniteNumberArray(root.scale, 3)
    || root.scale.some((item) => Math.abs(item) < MIN_ABSOLUTE_SCENE_SCALE)
    || Math.hypot(...root.rotationQuaternion) <= 0.000001
    || contentSpace?.splats !== "canonical"
    || contentSpace.cameras !== "canonical"
    || contentSpace.roomKit !== "canonical"
    || contentSpace.trajectories !== "canonical"
    || !isFiniteNumberArray(cameraPolicy?.worldUp, 3)
    || cameraPolicy.worldUp.some((item, index) => item !== [0, 1, 0][index])
    || cameraPolicy.horizon !== "world-up"
  ) {
    return false;
  }

  if (scene.version === 2) {
    const stage = scene.stage;
    const policy = scene.spatialPolicy;
    const composition = scene.composition;
    const compositionRoles = Array.isArray(composition?.layers)
      ? composition.layers.map((layer) => layer.role)
      : [];
    const requiredAffectedPrims = [
      "/Reaigen/World/GaussianSplat",
      "/Reaigen/Architecture/RoomKit",
      "/Reaigen/Cameras",
      "/Reaigen/Trajectories",
    ];
    if (
      !stage
      || typeof stage.identifier !== "string"
      || stage.identifier.length === 0
      || !Number.isInteger(stage.revision)
      || stage.revision < 0
      || stage.defaultPrim !== "Reaigen"
      || stage.upAxis !== "Y"
      || Math.abs(stage.metersPerUnit - 1) > 0.000001
      || Math.abs(stage.timeCodesPerSecond - 24) > 0.000001
      || !policy
      || policy.canonicalSpace !== "right-handed-y-up-meters"
      || policy.presentationSpace !== "world"
      || policy.rootPrimPath !== "/Reaigen"
      || policy.pointTransform !== "T*R*S"
      || policy.directionTransform !== "normalize(R*S)"
      || policy.collisionQuerySpace !== "canonical"
      || !Array.isArray(policy.rootTransformAffects)
      || !requiredAffectedPrims.every((primPath) => (
        policy.rootTransformAffects.includes(primPath)
      ))
      || cameraPolicy.storedBasis !== "position-forward-up"
      || cameraPolicy.rootTransformApplication !== "full-camera-basis"
      || !composition
      || composition.strengthOrder !== "weak-to-strong"
      || !Array.isArray(composition.layers)
      || composition.layers.length < 4
      || composition.layers.some((layer) => !layer.immutable)
      || compositionRoles[0] !== "capture"
      || compositionRoles[1] !== "reconstruction"
      || compositionRoles.at(-2) !== "authoring"
      || compositionRoles.at(-1) !== "presentation"
      || compositionRoles.slice(2, -2).some((role) => role !== "architecture")
    ) {
      return false;
    }
    const usdStage = scene.usdStage;
    const expectedUsdLayers = [
      ["capture", "capture.usda", 0],
      ["reconstruction", "reconstruction.usda", 1],
      ["architecture", "architecture.usda", 2],
      ["authoring", "authoring.usda", 3],
      ["presentation", "presentation.usda", 4],
      ["root", "scene.usda", 5],
    ] as const;
    if (
      !usdStage
      || usdStage.schema !== "com.reaigen.usd.scene"
        || usdStage.schemaVersion !== 1
        || usdStage.format !== "usda"
        || usdStage.rootLayer !== "scene.usda"
        || usdStage.sceneRevision !== stage.revision
        || typeof usdStage.stageSha256 !== "string"
        || usdStage.stageSha256.length !== 64
        || !Array.isArray(usdStage.layers)
        || usdStage.layers.length !== expectedUsdLayers.length
        || usdStage.layers.some((layer, index) => (
          layer.role !== expectedUsdLayers[index][0]
          || layer.identifier !== expectedUsdLayers[index][1]
          || layer.strengthOrder !== expectedUsdLayers[index][2]
          || typeof layer.sha256 !== "string"
          || layer.sha256.length !== 64
        ))
        || !usdStage.validation
        || !usdStage.validation.valid
    ) {
      return false;
    }
  }
  return true;
}

export function normalizeGlobalSceneTransform(value: unknown): GlobalSceneTransform {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return cloneGlobalSceneTransform(IDENTITY_GLOBAL_SCENE_TRANSFORM);
  }
  const raw = value as Record<string, unknown>;
  const rawScale = typeof raw.scale === "number" && Number.isFinite(raw.scale)
    ? raw.scale
    : 1;
  const scale3 = finiteVec3(
    raw.scale3 ?? (Array.isArray(raw.scale) ? raw.scale : null),
    [rawScale, rawScale, rawScale],
  ).map((item) => clampSceneScaleComponent(item)) as Vec3;
  return {
    version: 1,
    coordinateSpace: "reaigen_y_up",
    rotationDeg: finiteVec3(raw.rotationDeg ?? raw.rotation_deg, [0, 0, 0]),
    translation: finiteVec3(raw.translation, [0, 0, 0]),
    scale3,
    scale: sceneScaleMagnitude(scale3),
  };
}

/**
 * Read the composed `/Reaigen` root from the resolved USD stage projection.
 *
 * There is intentionally no secondary web transform fallback. If the stage
 * does not provide a supported root opinion, the canonical identity stage is
 * used.
 */
export function composedRootTransformFromScene(
  sceneDescription: unknown,
): GlobalSceneTransform {
  if (isSupportedUniversalSceneDescription(sceneDescription)) {
    const scene = sceneDescription;
    const root = scene.rootTransform;
    return normalizeGlobalSceneTransform({
      version: 1,
      coordinateSpace: "reaigen_y_up",
      // The OpenUSD root quaternion is authoritative. Editor Euler metadata is
      // a display hint and must never become a second transform source.
      rotationDeg: quaternionToEditorDegrees(root.rotationQuaternion),
      translation: root.translation,
      scale3: [...root.scale] as Vec3,
      scale: root.scale[0],
    });
  }
  return cloneGlobalSceneTransform(IDENTITY_GLOBAL_SCENE_TRANSFORM);
}

export function cloneGlobalSceneTransform(
  transform: GlobalSceneTransform,
): GlobalSceneTransform {
  return {
    ...transform,
    rotationDeg: [...transform.rotationDeg] as Vec3,
    translation: [...transform.translation] as Vec3,
    scale3: globalSceneScale3(transform),
  };
}

export function globalSceneTransformsEqual(
  left: GlobalSceneTransform,
  right: GlobalSceneTransform,
  epsilon = 0.00001,
): boolean {
  return (
    globalSceneScale3(left).every((value, index) => (
      Math.abs(value - globalSceneScale3(right)[index]) <= epsilon
    ))
    && left.rotationDeg.every((value, index) => (
      Math.abs(value - right.rotationDeg[index]) <= epsilon
    ))
    && left.translation.every((value, index) => (
      Math.abs(value - right.translation[index]) <= epsilon
    ))
  );
}

type QuaternionXYZW = [number, number, number, number];

function normalizeDegrees(value: number): number {
  const normalized = ((value + 180) % 360 + 360) % 360 - 180;
  return Math.abs(normalized) < 0.00001 ? 0 : normalized;
}

function multiplyQuaternions(
  left: QuaternionXYZW,
  right: QuaternionXYZW,
): QuaternionXYZW {
  const [lx, ly, lz, lw] = left;
  const [rx, ry, rz, rw] = right;
  const result: QuaternionXYZW = [
    lw * rx + lx * rw + ly * rz - lz * ry,
    lw * ry - lx * rz + ly * rw + lz * rx,
    lw * rz + lx * ry - ly * rx + lz * rw,
    lw * rw - lx * rx - ly * ry - lz * rz,
  ];
  const length = Math.hypot(...result) || 1;
  return result.map((value) => value / length) as QuaternionXYZW;
}

function inverseQuaternion(
  quaternion: QuaternionXYZW,
): QuaternionXYZW {
  return [-quaternion[0], -quaternion[1], -quaternion[2], quaternion[3]];
}

/**
 * Convert a normalized quaternion into the editor's Y-X-Z Euler order.
 * Runtime composition remains quaternion based; this exists only so the
 * rebased precision controls can display an identity-relative delta.
 */
function quaternionToEditorDegrees(
  quaternion: QuaternionXYZW,
): Vec3 {
  const [x, y, z, w] = quaternion;
  const m00 = 1 - 2 * (y * y + z * z);
  const m02 = 2 * (x * z + y * w);
  const m10 = 2 * (x * y + z * w);
  const m11 = 1 - 2 * (x * x + z * z);
  const m12 = 2 * (y * z - x * w);
  const m20 = 2 * (x * z - y * w);
  const m22 = 1 - 2 * (x * x + y * y);
  const pitch = Math.asin(Math.max(-1, Math.min(1, -m12)));
  const cosPitch = Math.cos(pitch);
  const yaw = Math.abs(cosPitch) > 1e-7
    ? Math.atan2(m02, m22)
    : Math.atan2(-m20, m00);
  const roll = Math.abs(cosPitch) > 1e-7
    ? Math.atan2(m10, m11)
    : 0;
  return [pitch, yaw, roll].map(
    (value) => normalizeDegrees(value * 180 / Math.PI),
  ) as Vec3;
}

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

/**
 * Compose an identity-relative editor delta over an authored USD root.
 *
 * Translation remains in presentation/world axes, rotation is pre-multiplied
 * in world space, and scale stays uniform. The result is still one legal
 * `/Reaigen` T·R·S root transform.
 */
export function composeGlobalSceneTransform(
  authored: GlobalSceneTransform,
  delta: GlobalSceneTransform,
): GlobalSceneTransform {
  const scale3 = globalSceneScale3(authored).map((value, index) => (
    clampSceneScaleComponent(value * globalSceneScale3(delta)[index])
  )) as Vec3;
  return {
    version: 1,
    coordinateSpace: "reaigen_y_up",
    translation: authored.translation.map(
      (value, index) => value + delta.translation[index],
    ) as Vec3,
    rotationDeg: quaternionToEditorDegrees(multiplyQuaternions(
      globalSceneQuaternion(delta),
      globalSceneQuaternion(authored),
    )),
    scale3,
    scale: sceneScaleMagnitude(scale3),
  };
}

/**
 * Resolve the editor delta from the immutable authored USD root to the current
 * preview. Applying the preview makes it the next authored root, so this value
 * naturally returns to identity without moving the rendered scene.
 */
export function relativeGlobalSceneTransform(
  authored: GlobalSceneTransform,
  preview: GlobalSceneTransform,
): GlobalSceneTransform {
  const scale3 = globalSceneScale3(preview).map((value, index) => (
    clampSceneScaleComponent(value / globalSceneScale3(authored)[index])
  )) as Vec3;
  return {
    version: 1,
    coordinateSpace: "reaigen_y_up",
    translation: preview.translation.map(
      (value, index) => value - authored.translation[index],
    ) as Vec3,
    rotationDeg: quaternionToEditorDegrees(multiplyQuaternions(
      globalSceneQuaternion(preview),
      inverseQuaternion(globalSceneQuaternion(authored)),
    )),
    scale3,
    scale: sceneScaleMagnitude(scale3),
  };
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
  const scale3 = globalSceneScale3(transform);
  const scaled = point.map((value, index) => value * scale3[index]) as Vec3;
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
    rotateByQuaternion(
      direction.map(
        (value, index) => value * globalSceneScale3(transform)[index],
      ) as Vec3,
      globalSceneQuaternion(transform),
    ),
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
  const scale3 = globalSceneScale3(transform);
  return unrotated.map((value, index) => value / scale3[index]) as Vec3;
}

/** Presentation-world direction → canonical direction (`w = 0`). */
export function inversePresentationDirection(
  direction: Vec3,
  transform: GlobalSceneTransform,
): Vec3 {
  const [x, y, z, w] = globalSceneQuaternion(transform);
  const unrotated = rotateByQuaternion(direction, [-x, -y, -z, w]);
  const scale3 = globalSceneScale3(transform);
  return normalizeDirection(
    unrotated.map((value, index) => value / scale3[index]) as Vec3,
    [0, 0, -1],
  );
}

"use client";

import { useEffect, useRef, useState, useCallback, forwardRef, useImperativeHandle } from "react";
import { AllocateShBuffers } from "@babylonjs/core/Meshes/GaussianSplatting/gaussianSplattingMeshBase.js";
import type {
  SpinoffOrbitCamera,
  SpinoffRenderer,
  SpinoffSogSource,
} from "@reaigen/spinoff";
import { cameraFovRadians, normalizeCameraData } from "@/app/lib/camera-coordinates";
import { clampCameraPosition } from "@/app/lib/camera-bounds";
import { getCache, putCache } from "@/app/lib/splat-cache";
import { t } from "@/app/lib/i18n";
import { ReaigenLoadingMark } from "@/app/components/reaigen-loading-mark";
import type {
  CameraData,
  GlobalSceneTransform,
  RoomKitCageWall,
  SavedCamera,
  SpatialCameraMode,
  SpatialCameraSample,
  SpatialTransformTool,
  SpatialTrajectory,
  SpatialViewMode,
  SplatInspectionStats,
  Vec3,
  TourData,
  TourShot,
} from "@/app/lib/tour-types";
import {
  SPLATFICTION_VIEWPORT_SIGMA,
  SPLATFICTION_VIEWPORT_VARIANCE,
  SPLAT_MAX_STD_DEV,
  chooseClearAzimuth,
  eyeFromSogViewer,
  fallbackOverviewCamera,
  parseRenderTuning,
  parseSogViewerHint,
  resolveSplatRenderProfile,
  sceneFrameFromSogMetadata,
  type RenderTuningOverrides,
  type SogViewerHint,
} from "@/app/lib/splat-render-profile";
import {
  IDENTITY_GLOBAL_SCENE_TRANSFORM,
  globalSceneScale3,
  globalSceneQuaternion,
  inversePresentationPoint,
  scaleComponentWithAuthoredSign,
  sceneScaleMagnitude,
  transformCanonicalDirection,
  transformCanonicalPoint,
} from "@/app/lib/global-scene-transform";
import { resolveRoomKitMovement } from "@/app/lib/spatial-editor-data";
import {
  boundedAngularVelocity,
  cameraMovementFrameSeconds,
  cameraMovementKey,
  cameraMovementTargetIsEditable,
  cameraNavigationShouldRestorePointerControls,
  cameraRenderIsActive,
  cameraTouchPanDelta,
  cameraWalkDirection,
  stableCameraPreviewPose,
  stableCameraReferenceUp,
} from "@/app/lib/camera-navigation";
import {
  nextViewerMotionFrameTimestamp,
  viewerRenderDpr,
  viewerSortUpdateThreshold,
  type ViewerPerformanceProfile,
} from "@/app/lib/viewer-performance";
import {
  countMask,
  decodeSplatPruneMask,
  distanceToPolyline,
  encodeSplatPruneMask,
  filterPackedSplats,
  packedSplatsToPly,
  pointInsidePolygon,
  splatMasksEqual,
  type PackedSplatData,
  type SplatPruneMask,
  type SplatSelectionOperation,
  type SplatSelectionStats,
  type SplatSelectionTool,
} from "@/app/lib/splat-editing";

/**
 * SplatViewer — Spinoff delivery renderer with BabylonJS authoring controls.
 *
 * Modes:
 *   Tour    — arrow keys / buttons navigate shots with quintic easing.
 *   Explore — WASD + mouse free-fly when Escape pressed or no tour data.
 *
 * Coordinate system: Backend PLY output is already Y-up.
 * Scene pretransform is identity (no flip needed).
 * Camera positions from tour.json/cameras API are in viewer space directly.
 */

// ── Helpers ──────────────────────────────────────────────────────────────────

function quintic(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c * c * c * (c * (c * 6 - 15) + 10);
}

function slerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

function normalizeVec3(value: Vec3, fallback: Vec3 = [0, 0, 1]): Vec3 {
  const length = Math.hypot(value[0], value[1], value[2]);
  if (!Number.isFinite(length) || length < 1e-6) return fallback;
  return [value[0] / length, value[1] / length, value[2] / length];
}

/**
 * Orbit rotation per pixel of drag, in radians.
 *
 * Babylon expresses this inverted, as `angularSensibility` in pixels per
 * radian, and the authoring viewer this editor is meant to match
 * (Reaigen-splatviewer-02) runs its edit mode at 540 over a 220% navigation
 * multiplier — about 245 px/rad — against 850 for playback. This orbit is
 * hand-rolled on a FreeCamera rather than an ArcRotateCamera, so it has to
 * restate the number instead of inheriting it, and it had drifted to 0.006
 * rad/px: roughly 167 px/rad, half again as fast as the editor it mirrors and
 * five times Babylon's own default. A drag that crosses a quarter of the canvas
 * swung the camera most of the way around the scene, which is what made
 * orbiting feel unusable rather than merely quick.
 */
const ORBIT_RADIANS_PER_PIXEL = 1 / 245;

/**
 * Depth range for authoring, taken from the reference viewer.
 *
 * Reaigen-splatviewer-02 opens its camera at `minZ = 0.001` / `maxZ = 10_000`
 * and leaves it there, narrowing only for a saved shot that carries its own
 * authored clip planes. A static range that simply contains everything is what
 * lets that camera go wherever the author sends it.
 *
 * This viewer instead derived its planes from whatever it last framed —
 * `maxZ = max(100, radius * 40)`, so about 160 for a room-scale scan — while
 * the orbit dolly allows a radius of 250. Backing off far enough therefore
 * pushed the scene through its own far plane and it vanished; the external
 * Gaussian engines copy `minZ`/`maxZ` off this camera, so they clipped with it.
 *
 * The wide range is safe here because Babylon draws only the grid and gizmos —
 * the Gaussians are rasterised by Spark or Spinoff, which order splats by
 * distance on the CPU rather than through this depth buffer.
 */
const EDITOR_NEAR_PLANE = 0.001;
const EDITOR_FAR_PLANE = 10_000;
/** Reference viewer's `lowerRadiusLimit`; how close the orbit may close in. */
const ORBIT_MIN_RADIUS = 0.02;

/**
 * How far outside the frustum a splat's centre may sit and still be drawn.
 *
 * Spark culls per splat *centre*: `abs(clipCenter.xy) > clipXY * clipCenter.w`
 * discards it outright, whatever its footprint. At 1.4 — the library default —
 * that is a sound optimisation while splats are small on screen, and wrong the
 * moment the camera is nearer to a surface than the splats composing it are
 * wide. Then most of what should cover the frame has a centre just outside it
 * and is thrown away, leaving only the sparse few whose centres are still
 * inside: a continuous surface disintegrates into isolated blobs on the
 * backdrop.
 *
 * 4.0 keeps a splat until its centre is two frames' width out, which covers the
 * near-field case at the cost of transforming a few more splats per frame —
 * they are rejected later by the same test against their real footprint, so
 * nothing is drawn that should not be.
 */
const SPLAT_CLIP_XY = 4.0;

/**
 * Set a camera's clip planes for one framing.
 *
 * Every framing path used to compute its own pair from the radius it had just
 * framed, which is right for delivery — the camera is held inside the
 * reconstruction there, so planes fitted to the room give the best depth
 * precision. In the editor the camera is free, so a range fitted to the scene
 * is a range the author can fly out of, and each of those sites was an
 * independent chance to re-narrow it after the fact.
 */
function setCameraDepthRange(
  camera: { minZ: number; maxZ: number },
  authoring: boolean,
  deliveryNear: number,
  deliveryFar: number,
): void {
  camera.minZ = authoring ? EDITOR_NEAR_PLANE : deliveryNear;
  camera.maxZ = authoring ? EDITOR_FAR_PLANE : deliveryFar;
}

/**
 * /view resolution follows Spinoff's budget policy (1M physical px on
 * mobile, 2.5M on desktop, floored at 1.0 DPR) — see resolveSparkPixelRatio
 * in the Spark setup. The old flat 1.5 DPR cap lived here.
 */

/**
 * Backdrop the Gaussians composite against.
 *
 * This is not a theme choice, it is part of the image. A splat only reaches
 * full coverage where enough Gaussians overlap, and in room_3.sog the median
 * splat opacity is 0.29 — so wherever coverage falls short, the backdrop is
 * mixed into the result in proportion. Against the app's near-white page that
 * lifted every thin or distant region toward white, which is what made these
 * scans read as milky and blown-out next to SuperSplat and Splatfiction, both
 * of which composite against near-black.
 *
 * Deliberately not pure black: a true 0 makes the canvas edge disappear against
 * dark UI chrome and hides whether the renderer has painted at all.
 */
const SPLAT_BACKDROP: [number, number, number, number] = [0.07, 0.07, 0.078, 1];
/** The same colour for the DOM layers the Gaussian canvases sit on. */
const SPLAT_BACKDROP_CSS = "#121214";

function spinoffModelTransform(transform: GlobalSceneTransform): {
  compatible: boolean;
  scale: number;
  rotationRadians: Vec3;
  translation: Vec3;
} {
  const [sx, sy, sz] = globalSceneScale3(transform);
  const scale = (Math.abs(sx) + Math.abs(sy) + Math.abs(sz)) / 3;
  const compatible = sx > 0
    && Math.abs(sx - sy) < 1e-5
    && Math.abs(sx - sz) < 1e-5;

  // Spinoff accepts an XYZ Euler model rotation (Rz * Ry * Rx), while the
  // OpenUSD root is a quaternion. Extract the equivalent angles so geometry
  // and authored cameras still receive the root exactly once.
  const [qx, qy, qz, qw] = globalSceneQuaternion(transform);
  const m00 = 1 - 2 * (qy * qy + qz * qz);
  const m10 = 2 * (qx * qy + qz * qw);
  const m20 = 2 * (qx * qz - qy * qw);
  const m21 = 2 * (qy * qz + qx * qw);
  const m22 = 1 - 2 * (qx * qx + qy * qy);
  const y = Math.asin(Math.max(-1, Math.min(1, -m20)));
  const cosY = Math.cos(y);
  const x = Math.abs(cosY) > 1e-7 ? Math.atan2(m21, m22) : 0;
  const z = Math.abs(cosY) > 1e-7
    ? Math.atan2(m10, m00)
    : Math.atan2(-2 * (qx * qy - qz * qw), 1 - 2 * (qx * qx + qz * qz));
  return {
    compatible,
    scale,
    rotationRadians: [x, y, z],
    translation: [...transform.translation] as Vec3,
  };
}

function synchronizeSpinoffCamera(
  target: SpinoffOrbitCamera,
  source: any,
): void {
  if (!source) return;
  const sourceTarget = source.getTarget();
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

function normalizedEditorDegrees(radians: number): number {
  if (!Number.isFinite(radians)) return 0;
  const degrees = radians * 180 / Math.PI;
  const normalized = ((degrees + 180) % 360 + 360) % 360 - 180;
  return Math.abs(normalized) < 0.005 ? 0 : Math.round(normalized * 100) / 100;
}

function editorAngleDistance(a: number, b: number): number {
  return Math.abs(((a - b + 180) % 360 + 360) % 360 - 180);
}

const LOOK = 5;
const TILT_Y = LOOK * Math.tan(5 * Math.PI / 180);
const SH_C0 = 0.28209479177387814;
// SOG/3DGS adds 0.30 px² to the projected covariance. Spinoff accepts sigma,
// while Babylon accepts the variance directly; the shared profile keeps that
// unit conversion explicit.
// Mip kernel constants and the render profile live in
// lib/splat-render-profile so they can be asserted against real .sog files.


/**
 * Render-tuning overrides, read from the URL.
 *
 * The Mip kernel and opacity compensation are the two knobs that decide
 * whether a reconstruction reads crisp or hazy, and the correct values depend
 * on how the file was trained -- a SOG carrying `antialias: true` was trained
 * expecting compensation, one without it was not. We currently hardcode both,
 * which is right for the room-scale scans that make up the existing library
 * and demonstrably wrong for at least one antialiased export.
 *
 * Rather than guess, these let a specific scene be dialled against a reference
 * render in one pass:
 *
 *   ?kernel=0.3   Mip variance added to the 2D covariance (default 0.09)
 *   ?comp=0       disable opacity compensation (default on)
 *   ?sh=0         drop spherical harmonics, render SH0-only
 *
 * Absent from the URL, behaviour is exactly as before.
 */
function renderTuning(): RenderTuningOverrides {
  if (typeof window === "undefined") return {};
  return parseRenderTuning(window.location.search);
}

function buildFallbackShots(data: TourData, lang: string): TourShot[] {
  const n = data.positions?.length ?? 0;
  if (n < 2) return [];
  const count = Math.max(3, Math.min(10, Math.floor(n / 250)));
  const shots: TourShot[] = [];
  for (let i = 0; i < count; i++) {
    const progress = count === 1 ? 0 : i / (count - 1);
    const idx = Math.max(0, Math.min(n - 1, Math.round(progress * (n - 1))));
    shots.push({
      storyBeat: "auto",
      label: `${t("tour.controls.shot", lang)} ${i + 1}`,
      startIdx: idx,
      fov: 0.66,
      holdAfter: 3.5,
      moveDuration: 2.0,
      compositionScore: 0.5,
    });
  }
  return shots;
}

function isSavedCameraTour(data: TourData | null): boolean {
  return data?.sceneType === "saved-cameras";
}

interface SceneFrame {
  center: Vec3;
  radius: number;
  safePosition: Vec3;
  safeTarget: Vec3;
  floorY: number;
  ceilingY: number;
  footprint: { minX: number; maxX: number; minZ: number; maxZ: number };
}

interface SplatSample {
  positions: Float32Array;
  colors: Float32Array;
  structure: Float32Array;
  stats: SplatInspectionStats;
}

interface EditorOrbitPose {
  enabled: boolean;
  target: Vec3;
  radius: number;
  yaw: number;
  pitch: number;
}

const EMPTY_ROOM_KIT_CAGE: RoomKitCageWall[] = [];
const EMPTY_SPATIAL_TRAJECTORIES: SpatialTrajectory[] = [];
function percentile(sorted: number[], fraction: number): number {
  if (sorted.length === 1) return sorted[0];
  const index = Math.max(0, Math.min(sorted.length - 1, fraction * (sorted.length - 1)));
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const amount = index - lower;
  return sorted[lower] + (sorted[upper] - sorted[lower]) * amount;
}

function sampleSplatBuffer(buffer: ArrayBuffer, maximum = 24_000): SplatSample | null {
  if (buffer.byteLength < 32) return null;
  const floats = new Float32Array(buffer);
  const stride = 8;
  const gaussianCount = Math.floor(floats.length / stride);
  if (!gaussianCount) return null;

  const step = Math.max(1, Math.ceil(gaussianCount / maximum));
  const positions: number[] = [];
  const colors: number[] = [];
  const scaleMeasures: number[] = [];
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < gaussianCount; index += step) {
    const offset = index * stride;
    const x = floats[offset];
    const y = floats[offset + 1];
    const z = floats[offset + 2];
    if (![x, y, z].every(Number.isFinite)) continue;
    const scaleX = Math.abs(floats[offset + 3]);
    const scaleY = Math.abs(floats[offset + 4]);
    const scaleZ = Math.abs(floats[offset + 5]);
    const scaleMeasure = Math.max(scaleX, scaleY, scaleZ);
    positions.push(x, y, z);
    scaleMeasures.push(Number.isFinite(scaleMeasure) ? Math.max(1e-6, scaleMeasure) : 1e-6);
    const colorOffset = index * stride * 4 + 24;
    colors.push(
      (bytes[colorOffset] ?? 128) / 255,
      (bytes[colorOffset + 1] ?? 128) / 255,
      (bytes[colorOffset + 2] ?? 128) / 255,
      (bytes[colorOffset + 3] ?? 255) / 255,
    );
  }
  if (positions.length < 24) return null;

  const sampleCount = positions.length / 3;
  const xValues: number[] = [];
  const yValues: number[] = [];
  const zValues: number[] = [];
  for (let index = 0; index < sampleCount; index += 1) {
    xValues.push(positions[index * 3]);
    yValues.push(positions[index * 3 + 1]);
    zValues.push(positions[index * 3 + 2]);
  }
  xValues.sort((a, b) => a - b);
  yValues.sort((a, b) => a - b);
  zValues.sort((a, b) => a - b);

  const minX = percentile(xValues, 0.02);
  const maxX = percentile(xValues, 0.98);
  const minY = percentile(yValues, 0.02);
  const maxY = percentile(yValues, 0.98);
  const minZ = percentile(zValues, 0.02);
  const maxZ = percentile(zValues, 0.98);
  const robustDiagonal = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ);
  const voxelSize = Math.max(0.08, Math.min(0.36, robustDiagonal / 34));
  const voxelKeys: string[] = [];
  const voxelCounts = new Map<string, number>();
  for (let index = 0; index < sampleCount; index += 1) {
    const x = positions[index * 3];
    const y = positions[index * 3 + 1];
    const z = positions[index * 3 + 2];
    const key = [
      Math.floor((x - minX) / voxelSize),
      Math.floor((y - minY) / voxelSize),
      Math.floor((z - minZ) / voxelSize),
    ].join(":");
    voxelKeys.push(key);
    voxelCounts.set(key, (voxelCounts.get(key) ?? 0) + 1);
  }

  const logScales = scaleMeasures
    .map((scale) => Math.log(scale))
    .sort((a, b) => a - b);
  const scaleLow = percentile(logScales, 0.18);
  const scaleHigh = percentile(logScales, 0.9);
  const scaleRange = Math.max(1e-5, scaleHigh - scaleLow);
  const densityLogs = voxelKeys
    .map((key) => Math.log1p(voxelCounts.get(key) ?? 1))
    .sort((a, b) => a - b);
  const densityLow = percentile(densityLogs, 0.12);
  const densityHigh = percentile(densityLogs, 0.9);
  const densityRange = Math.max(1e-5, densityHigh - densityLow);
  const structure: number[] = [];
  let largeOrSparseCount = 0;
  for (let index = 0; index < sampleCount; index += 1) {
    const normalizedScale = Math.max(
      0,
      Math.min(1, (Math.log(scaleMeasures[index]) - scaleLow) / scaleRange),
    );
    const normalizedDensity = Math.max(
      0,
      Math.min(
        1,
        (Math.log1p(voxelCounts.get(voxelKeys[index]) ?? 1) - densityLow) / densityRange,
      ),
    );
    const diagnosticRisk = Math.max(
      0,
      Math.min(1, normalizedScale * 0.72 + (1 - normalizedDensity) * 0.28),
    );
    if (diagnosticRisk >= 0.68) largeOrSparseCount += 1;
    structure.push(normalizedScale, normalizedDensity, diagnosticRisk);
  }

  return {
    positions: new Float32Array(positions),
    colors: new Float32Array(colors),
    structure: new Float32Array(structure),
    stats: {
      gaussianCount,
      sampledCount: sampleCount,
      medianScale: Math.exp(percentile(logScales, 0.5)),
      p90Scale: Math.exp(scaleHigh),
      largeOrSparsePercent: (largeOrSparseCount / sampleCount) * 100,
    },
  };
}

/**
 * Build a robust room-scale frame directly from splat centres.
 *
 * Raw Gaussian bounds commonly contain sparse reconstruction outliers, so an
 * outside orbit around min/max bounds is a poor mobile starting view. Instead,
 * use clipped bounds and find a central open cell with floor and ceiling cover.
 * This follows the native viewer principle of starting from a safe interior
 * anchor when no captured camera is available.
 */
function computeSceneFrameFromSplatBuffer(buffer: ArrayBuffer): SceneFrame | null {
  if (buffer.byteLength < 32) return null;
  const floats = new Float32Array(buffer);
  const bytes = new Uint8Array(buffer);
  const stride = 8;
  const count = Math.floor(floats.length / stride);
  if (!count) return null;

  // Keep the startup calculation bounded on large phone captures while still
  // sampling the complete ordered splat buffer.
  const sampleStep = Math.max(1, Math.ceil(count / 30_000));
  const xs: number[] = [];
  const ys: number[] = [];
  const zs: number[] = [];
  for (let i = 0; i < count; i += sampleStep) {
    const base = i * stride;
    const x = floats[base];
    const y = floats[base + 1];
    const z = floats[base + 2];
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    // Reconstruction exports often retain a very large low-opacity scaffold
    // around the actual scan. Those points are useful to a trainer but are not
    // visible content and must never determine the editor floor or framing.
    // Babylon's packed splat row stores opacity in byte 27.
    const alpha = bytes[i * 32 + 27] ?? 255;
    if (alpha < 32) continue;
    xs.push(x);
    ys.push(y);
    zs.push(z);
  }

  if (xs.length < 8) return null;
  const sortedX = [...xs].sort((a, b) => a - b);
  const sortedY = [...ys].sort((a, b) => a - b);
  const sortedZ = [...zs].sort((a, b) => a - b);

  // The opacity pass has already removed the training scaffold. A p2/p98
  // envelope now retains the authored room while rejecting isolated flyaways.
  const minX = percentile(sortedX, 0.02);
  const maxX = percentile(sortedX, 0.98);
  const floorY = percentile(sortedY, 0.02);
  const ceilingY = percentile(sortedY, 0.98);
  const minZ = percentile(sortedZ, 0.02);
  const maxZ = percentile(sortedZ, 0.98);
  const width = Math.max(0.2, maxX - minX);
  const height = Math.max(0.2, ceilingY - floorY);
  const depth = Math.max(0.2, maxZ - minZ);
  const center: Vec3 = [
    (minX + maxX) * 0.5,
    (floorY + ceilingY) * 0.5,
    (minZ + maxZ) * 0.5,
  ];
  const distances = xs.map((x, index) => Math.hypot(
    x - center[0],
    ys[index] - center[1],
    zs[index] - center[2],
  )).sort((a, b) => a - b);
  const radius = Math.max(1.5, Math.min(5, percentile(distances, 0.75)));

  const eyeY = Math.max(
    floorY + height * 0.12,
    Math.min(ceilingY - Math.min(0.3, height * 0.12), floorY + 1.55),
  );
  const eyeBand = Math.max(0.25, Math.min(0.5, height * 0.2));
  const ceilingBandLow = ceilingY - Math.max(0.2, Math.min(0.4, height * 0.2));
  const floorBandHigh = floorY + Math.max(0.15, Math.min(0.3, height * 0.15));

  const gridSize = 16;
  const ceilingGrid = new Uint16Array(gridSize * gridSize);
  const eyeGrid = new Uint16Array(gridSize * gridSize);
  const toCell = (x: number, z: number): [number, number] | null => {
    if (x < minX || x > maxX || z < minZ || z > maxZ) return null;
    const gx = Math.min(gridSize - 1, Math.max(0, Math.floor((x - minX) / width * gridSize)));
    const gz = Math.min(gridSize - 1, Math.max(0, Math.floor((z - minZ) / depth * gridSize)));
    return [gx, gz];
  };
  const increment = (cells: Uint16Array, gx: number, gz: number) => {
    const index = gz * gridSize + gx;
    if (cells[index] < 65_535) cells[index] += 1;
  };

  // Ceiling coverage is the strongest signal that a footprint cell is indoors.
  for (let i = 0; i < xs.length; i += 1) {
    const cell = toCell(xs[i], zs[i]);
    if (!cell) continue;
    const [gx, gz] = cell;
    if (ys[i] >= ceilingBandLow && ys[i] <= ceilingY) increment(ceilingGrid, gx, gz);
  }

  const ceilingMax = Math.max(...ceilingGrid);
  const ceilingMinimum = Math.max(2, Math.floor(ceilingMax / 6));
  let floorXSum = 0;
  let floorZSum = 0;
  let floorCount = 0;
  let eyeXSum = 0;
  let eyeZSum = 0;
  let eyeCount = 0;
  for (let i = 0; i < xs.length; i += 1) {
    const cell = toCell(xs[i], zs[i]);
    if (!cell) continue;
    const [gx, gz] = cell;
    const index = gz * gridSize + gx;
    if (ceilingGrid[index] < ceilingMinimum) continue;
    if (ys[i] >= floorY && ys[i] <= floorBandHigh) {
      floorXSum += xs[i];
      floorZSum += zs[i];
      floorCount += 1;
    } else if (Math.abs(ys[i] - eyeY) <= eyeBand) {
      eyeXSum += xs[i];
      eyeZSum += zs[i];
      eyeCount += 1;
      increment(eyeGrid, gx, gz);
    }
  }

  let safeXRaw = center[0];
  let safeZRaw = center[2];
  const eyeMaximum = Math.max(...eyeGrid);
  const openThreshold = Math.max(1, eyeMaximum * 0.2);
  const gridMiddle = gridSize * 0.5;
  const maxCentreDistance = Math.hypot(gridMiddle, gridMiddle);
  let bestCell = -1;
  let bestScore = Infinity;
  for (let index = 0; index < gridSize * gridSize; index += 1) {
    if (ceilingGrid[index] < ceilingMinimum) continue;
    const gx = index % gridSize + 0.5;
    const gz = Math.floor(index / gridSize) + 0.5;
    const distanceFromCentre = Math.hypot(gx - gridMiddle, gz - gridMiddle) / maxCentreDistance;
    const occupiedPenalty = eyeGrid[index] > openThreshold ? 10 : 0;
    const score = distanceFromCentre + occupiedPenalty;
    if (score < bestScore) {
      bestScore = score;
      bestCell = index;
    }
  }
  if (bestCell >= 0) {
    const gx = bestCell % gridSize;
    const gz = Math.floor(bestCell / gridSize);
    safeXRaw = minX + ((gx + 0.5) / gridSize) * width;
    safeZRaw = minZ + ((gz + 0.5) / gridSize) * depth;
  } else if (floorCount >= 10) {
    safeXRaw = floorXSum / floorCount;
    safeZRaw = floorZSum / floorCount;
  } else if (eyeCount >= 5) {
    safeXRaw = eyeXSum / eyeCount;
    safeZRaw = eyeZSum / eyeCount;
  }
  // The grid above finds an open *footprint* cell, but never checks whether the
  // resulting eye point is actually clear in 3D. On a 32 m flat it always is;
  // on a 3.8 m room capture it put the camera inside a sofa, with 956 splats
  // within 0.35 m, rendering as a wall of blurred fabric. Re-seat the eye on a
  // clear orbit angle when that happens, and leave it alone when it does not.
  let safeX = safeXRaw;
  let safeZ = safeZRaw;
  {
    const cleared = chooseClearAzimuth(
      xs.flatMap((x, i) => [x, ys[i], zs[i]]),
      center,
      Math.max(0.35, Math.hypot(safeXRaw - center[0], safeZRaw - center[2]) || radius * 0.5),
      eyeY,
      { preferred: Math.atan2(safeZRaw - center[2], safeXRaw - center[0]) },
    );
    if (cleared.blocked === 0) {
      const r = Math.max(0.35, Math.hypot(safeXRaw - center[0], safeZRaw - center[2]) || radius * 0.5);
      safeX = center[0] + r * Math.cos(cleared.azimuth);
      safeZ = center[2] + r * Math.sin(cleared.azimuth);
    }
  }
  const safePosition: Vec3 = [safeX, eyeY, safeZ];

  const denseX = eyeCount >= 5 ? eyeXSum / eyeCount : center[0];
  const denseZ = eyeCount >= 5 ? eyeZSum / eyeCount : center[2];
  let lookX = denseX - safeX;
  let lookZ = denseZ - safeZ;
  if (Math.hypot(lookX, lookZ) <= 0.2) {
    lookX = 0;
    lookZ = 1;
  }
  const lookLength = Math.hypot(lookX, lookZ) || 1;
  const lookDistance = Math.max(2, Math.min(LOOK, radius));
  const safeTarget: Vec3 = [
    safeX + lookX / lookLength * lookDistance,
    eyeY,
    safeZ + lookZ / lookLength * lookDistance,
  ];

  return {
    center,
    radius,
    safePosition,
    safeTarget,
    floorY,
    ceilingY,
    footprint: { minX, maxX, minZ, maxZ },
  };
}

function editorFramePose(
  frame: SceneFrame,
  transform: GlobalSceneTransform,
): { target: Vec3; position: Vec3; radius: number; yaw: number; pitch: number } {
  const corners: Vec3[] = [];
  for (const x of [frame.footprint.minX, frame.footprint.maxX]) {
    for (const y of [frame.floorY, frame.ceilingY]) {
      for (const z of [frame.footprint.minZ, frame.footprint.maxZ]) {
        corners.push(transformCanonicalPoint([x, y, z], transform));
      }
    }
  }
  const minX = Math.min(...corners.map((point) => point[0]));
  const maxX = Math.max(...corners.map((point) => point[0]));
  const minY = Math.min(...corners.map((point) => point[1]));
  const maxY = Math.max(...corners.map((point) => point[1]));
  const minZ = Math.min(...corners.map((point) => point[2]));
  const maxZ = Math.max(...corners.map((point) => point[2]));
  const target: Vec3 = [
    (minX + maxX) * 0.5,
    (minY + maxY) * 0.5,
    (minZ + maxZ) * 0.5,
  ];
  const diagonal = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ);
  const radius = Math.max(2.2, diagonal * 0.72);
  const yaw = Math.PI / 4;
  const pitch = 22 * Math.PI / 180;
  const cosPitch = Math.cos(pitch);
  const position: Vec3 = [
    target[0] + radius * cosPitch * Math.cos(yaw),
    target[1] + radius * Math.sin(pitch),
    target[2] + radius * cosPitch * Math.sin(yaw),
  ];
  // The authoring grid is the world floor. A malformed prior pose or a scene
  // whose transform is still below ground may never start the operator below
  // that floor; keep the target truthful and raise only the editor eye.
  position[1] = Math.max(0.35, minY + 0.35, position[1]);
  return { target, position, radius, yaw, pitch };
}

function shouldUseCameraPose(
  position: Vec3,
  fallback: SceneFrame | null,
): boolean {
  if (!position.every((value) => Number.isFinite(value))) return false;
  if (!fallback) return true;
  const [cx, cy, cz] = fallback.center;
  const dx = position[0] - cx;
  const dy = position[1] - cy;
  const dz = position[2] - cz;
  const distance = Math.hypot(dx, dy, dz);
  return distance <= Math.max(6, fallback.radius * 8);
}

function extractSplatIdFromAssetUrl(url: string): number | null {
  const match = url.match(/\/splats\/(\d+)\//);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

interface VkgsMetaBlock {
  files: string[];
}

interface VkgsSogMeta {
  version: number;
  count?: number;
  means: VkgsMetaBlock & { mins: number[]; maxs: number[] };
  scales: VkgsMetaBlock & { codebook: number[][] };
  quats: VkgsMetaBlock;
  sh0: VkgsMetaBlock & { codebook: number[][] };
  shN?: VkgsMetaBlock & { mins: number[][]; maxs: number[][] };
}

interface SogBoundsMeta {
  count?: number;
  means: VkgsMetaBlock & {
    shape?: number[];
    mins: number[];
    maxs: number[];
  };
  sh0: VkgsMetaBlock;
}

interface DecodedImageData {
  bits: Uint8Array;
  width: number;
}

interface ParsedSogData {
  data: ArrayBuffer;
  sh?: Uint8Array[];
  shDegree?: number;
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function lerp(min: number, max: number, t: number): number {
  return min + (max - min) * t;
}

async function decodeWebpImage(fileData: Uint8Array): Promise<DecodedImageData> {
  const bytes = new Uint8Array(fileData.byteLength);
  bytes.set(fileData);
  const blob = new Blob([bytes], { type: "image/webp" });
  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Failed to decode SOG webp image"));
      img.src = objectUrl;
    });

    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Failed to decode SOG image context");
    ctx.drawImage(image, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return {
      bits: new Uint8Array(imageData.data.buffer.slice(0)),
      width: imageData.width,
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/**
 * What the cheap range probe learned about a remote .sog.
 *
 * `meta` is the parsed meta.json when the probe could reach it. The stored fast
 * path below hands the URL straight to the delivery renderer and never unzips
 * the archive, so this is the only opportunity to read the file's own
 * description of itself. Without it every stored SOG rendered as though it
 * carried `antialias: false` and no authored camera — and Splatfiction's
 * exports, which are exactly the ones that qualify for the fast path, set both.
 */
interface StoredSogProbe {
  stored: boolean;
  meta: unknown | null;
}

// Spinoff reads SOG members over independent HTTP ranges, so every member has
// to be ZIP-stored (method 0); a deflated member is only decodable from the
// start of its stream. Splatfiction's own exports satisfy this, but archives
// produced elsewhere in the pipeline still deflate, and handing one of those to
// Spinoff fails the whole tour. Read just the central directory to find out
// which kind we have, and let the caller repackage when it is the wrong kind.
async function probeStoredSog(url: string): Promise<StoredSogProbe> {
  const readRange = async (start: number, end: number): Promise<Uint8Array | null> => {
    const resp = await fetch(url, {
      headers: { Range: `bytes=${start}-${end}` },
      cache: "force-cache",
    });
    // A server that ignores Range answers 200 with the whole file; that is
    // still usable, just wasteful, and only happens on the probe path.
    if (!resp.ok) return null;
    return new Uint8Array(await resp.arrayBuffer());
  };

  const NOT_STORED: StoredSogProbe = { stored: false, meta: null };

  try {
    // Ask for the archive tail with a suffix range rather than sizing it with a
    // HEAD first: signed object URLs are commonly signed for GET only and answer
    // HEAD with 403, and this needs one request instead of two. The
    // end-of-central-directory record lives in the last 64 KiB at most.
    const tailResp = await fetch(url, {
      headers: { Range: "bytes=-65557" },
      cache: "force-cache",
    });
    if (!tailResp.ok) return NOT_STORED;
    const tail = new Uint8Array(await tailResp.arrayBuffer());
    if (tail.length < 22) return NOT_STORED;

    // A server that honours the range reports the total in Content-Range; one
    // that ignores it answers 200 with the whole file, which is still usable.
    const total = tailResp.headers.get("content-range")?.match(/\/(\d+)\s*$/);
    const size = total ? Number(total[1]) : tail.length;
    if (!Number.isFinite(size) || size <= 0) return NOT_STORED;
    const tailStart = total ? Math.max(0, size - tail.length) : 0;
    const tailView = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);

    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i -= 1) {
      if (tailView.getUint32(i, true) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) return NOT_STORED;

    const entries = tailView.getUint16(eocd + 10, true);
    const dirSize = tailView.getUint32(eocd + 12, true);
    const dirOffset = tailView.getUint32(eocd + 16, true);
    // ZIP64 needs a different directory walk; treat it as "repackage" rather
    // than guessing, which keeps the safe path safe.
    if (entries === 0xffff || dirSize === 0xffffffff || dirOffset === 0xffffffff) {
      return NOT_STORED;
    }
    if (entries === 0 || dirSize === 0) return NOT_STORED;

    const dir =
      dirOffset >= tailStart
        ? tail.subarray(dirOffset - tailStart, dirOffset - tailStart + dirSize)
        : await readRange(dirOffset, dirOffset + dirSize - 1);
    if (!dir || dir.length < dirSize) return NOT_STORED;
    const dirView = new DataView(dir.buffer, dir.byteOffset, dir.byteLength);

    const names = new TextDecoder();
    // Where meta.json's *local* header starts, captured on the way past. The
    // central directory records the member's compressed size but not where its
    // payload begins, because the local header repeats the name and extra
    // fields at its own lengths — so the payload offset can only be resolved by
    // reading that header.
    let metaHeaderOffset = -1;
    let metaSize = 0;

    let cursor = 0;
    for (let i = 0; i < entries; i += 1) {
      if (cursor + 46 > dir.length) return NOT_STORED;
      if (dirView.getUint32(cursor, true) !== 0x02014b50) return NOT_STORED;
      if (dirView.getUint16(cursor + 10, true) !== 0) return NOT_STORED; // not stored
      const nameLen = dirView.getUint16(cursor + 28, true);
      const extraLen = dirView.getUint16(cursor + 30, true);
      const commentLen = dirView.getUint16(cursor + 32, true);
      if (
        metaHeaderOffset < 0
        && names.decode(dir.subarray(cursor + 46, cursor + 46 + nameLen)) === "meta.json"
      ) {
        metaHeaderOffset = dirView.getUint32(cursor + 42, true);
        metaSize = dirView.getUint32(cursor + 24, true);
      }
      cursor += 46 + nameLen + extraLen + commentLen;
    }

    return { stored: true, meta: await readStoredMeta(readRange, metaHeaderOffset, metaSize) };
  } catch {
    // Probe failures must not decide rendering; repackaging always works.
    return NOT_STORED;
  }
}

/**
 * Pull meta.json out of an already-verified stored archive.
 *
 * Two more ranges over ~16 KB, against saving the whole multi-megabyte download
 * the fast path exists to avoid. A failure here is not fatal: the caller keeps
 * the URL delivery path and simply falls back to the conservative defaults it
 * used before this was read at all.
 */
async function readStoredMeta(
  readRange: (start: number, end: number) => Promise<Uint8Array | null>,
  headerOffset: number,
  size: number,
): Promise<unknown | null> {
  // 16 MB is far past any real meta.json and stops a corrupt directory entry
  // from turning the probe into a large download.
  if (headerOffset < 0 || size <= 0 || size > 16 << 20) return null;

  const header = await readRange(headerOffset, headerOffset + 29);
  if (!header || header.length < 30) return null;
  const headerView = new DataView(header.buffer, header.byteOffset, header.byteLength);
  if (headerView.getUint32(0, true) !== 0x04034b50) return null;

  // The local header's own name and extra lengths, which are allowed to differ
  // from the central directory's — the extra field in particular is routinely a
  // different size in the two records.
  const start = headerOffset + 30
    + headerView.getUint16(26, true)
    + headerView.getUint16(28, true);
  const body = await readRange(start, start + size - 1);
  if (!body || body.length < size) return null;

  try {
    return JSON.parse(new TextDecoder().decode(body.subarray(0, size)));
  } catch {
    return null;
  }
}

async function computeSceneFrameFromSogTextures(
  zipData: Record<string, Uint8Array>,
  meta: SogBoundsMeta,
): Promise<SceneFrame | null> {
  const meansLowData = zipData[meta.means.files[0]];
  const meansHighData = zipData[meta.means.files[1]];
  const sh0Data = zipData[meta.sh0.files[0]];
  const splatCount = meta.count ?? meta.means.shape?.[0] ?? 0;
  if (
    !meansLowData
    || !meansHighData
    || !sh0Data
    || !Number.isFinite(splatCount)
    || splatCount <= 0
    || meta.means.mins.length < 3
    || meta.means.maxs.length < 3
  ) {
    return null;
  }

  // Delivery mode needs bounds for camera constraints, not a second Gaussian
  // scene. Decode only means and opacity, sample the complete ordered cloud,
  // and feed the existing robust frame estimator a compact packed buffer.
  const [meansLow, meansHigh, sh0] = await Promise.all([
    decodeWebpImage(meansLowData),
    decodeWebpImage(meansHighData),
    decodeWebpImage(sh0Data),
  ]);
  const sampleStep = Math.max(1, Math.ceil(splatCount / 30_000));
  const sampleCount = Math.ceil(splatCount / sampleStep);
  const sampleBuffer = new ArrayBuffer(sampleCount * 32);
  const floats = new Float32Array(sampleBuffer);
  const bytes = new Uint8Array(sampleBuffer);
  const unlog = (value: number) => (
    Math.sign(value) * (Math.exp(Math.abs(value)) - 1)
  );

  let outputIndex = 0;
  for (let sourceIndex = 0; sourceIndex < splatCount; sourceIndex += sampleStep) {
    const pixelOffset = sourceIndex * 4;
    for (let axis = 0; axis < 3; axis += 1) {
      const quantized = (
        (meansHigh.bits[pixelOffset + axis] << 8)
        | meansLow.bits[pixelOffset + axis]
      );
      const encoded = lerp(
        meta.means.mins[axis],
        meta.means.maxs[axis],
        quantized / 65535,
      );
      floats[outputIndex * 8 + axis] = unlog(encoded);
    }
    bytes[outputIndex * 32 + 27] = sh0.bits[pixelOffset + 3];
    outputIndex += 1;
  }

  return computeSceneFrameFromSplatBuffer(sampleBuffer);
}

function isVkgsSogMeta(meta: unknown): meta is VkgsSogMeta {
  if (!meta || typeof meta !== "object") return false;
  const candidate = meta as Partial<VkgsSogMeta>;
  return candidate.version === 2 &&
    Array.isArray(candidate.scales?.codebook?.[0]) &&
    Array.isArray(candidate.sh0?.codebook?.[0]) &&
    Array.isArray(candidate.shN?.mins?.[0]) &&
    Array.isArray(candidate.shN?.maxs?.[0]) &&
    Array.isArray(candidate.shN?.files) &&
    candidate.shN.files.length >= 2 &&
    candidate.shN.files.length % 2 === 0;
}

async function parseVkgsSogMeta(
  zipData: Record<string, Uint8Array>,
  meta: VkgsSogMeta,
  scene: any,
): Promise<ParsedSogData> {
  const requiredFiles = [
    ...meta.means.files,
    ...meta.scales.files,
    ...meta.quats.files,
    ...meta.sh0.files,
    ...(meta.shN?.files ?? []),
  ];
  const imageEntries = await Promise.all(requiredFiles.map(async (fileName) => {
    const fileData = zipData[fileName];
    if (!fileData) throw new Error(`SOG archive is missing ${fileName}`);
    return [fileName, await decodeWebpImage(fileData)] as const;
  }));
  const images = new Map<string, DecodedImageData>(imageEntries);

  const splatCount = meta.count ?? 0;
  if (!Number.isFinite(splatCount) || splatCount <= 0) {
    throw new Error("SOG metadata is missing a valid splat count");
  }

  const rowOutputLength = 3 * 4 + 3 * 4 + 4 + 4;
  const buffer = new ArrayBuffer(rowOutputLength * splatCount);
  const position = new Float32Array(buffer);
  const scale = new Float32Array(buffer);
  const rgba = new Uint8ClampedArray(buffer);
  const rot = new Uint8ClampedArray(buffer);
  const unlog = (n: number) => Math.sign(n) * (Math.exp(Math.abs(n)) - 1);

  const meansLow = images.get(meta.means.files[0])?.bits;
  const meansHigh = images.get(meta.means.files[1])?.bits;
  const scalesImage = images.get(meta.scales.files[0])?.bits;
  const quatsImage = images.get(meta.quats.files[0])?.bits;
  const sh0Image = images.get(meta.sh0.files[0])?.bits;
  if (!meansLow || !meansHigh || !scalesImage || !quatsImage || !sh0Image) {
    throw new Error("SOG archive is missing required core textures");
  }

  for (let i = 0; i < splatCount; i += 1) {
    const pixelOffset = i * 4;
    for (let j = 0; j < 3; j += 1) {
      const q = (meansHigh[pixelOffset + j] << 8) | meansLow[pixelOffset + j];
      const n = lerp(meta.means.mins[j], meta.means.maxs[j], q / 65535);
      position[i * 8 + j] = unlog(n);
    }
  }

  for (let i = 0; i < splatCount; i += 1) {
    const pixelOffset = i * 4;
    for (let axis = 0; axis < 3; axis += 1) {
      const axisCodebook = meta.scales.codebook[axis];
      if (!axisCodebook) throw new Error(`SOG scales codebook is missing axis ${axis}`);
      scale[i * 8 + 3 + axis] = Math.exp(axisCodebook[scalesImage[pixelOffset + axis]]);
    }
  }

  for (let i = 0; i < splatCount; i += 1) {
    const pixelOffset = i * 4;
    for (let channel = 0; channel < 3; channel += 1) {
      const channelCodebook = meta.sh0.codebook[channel];
      if (!channelCodebook) throw new Error(`SOG sh0 codebook is missing channel ${channel}`);
      const component = 0.5 + channelCodebook[sh0Image[pixelOffset + channel]] * SH_C0;
      rgba[i * 32 + 24 + channel] = clampByte(255 * component);
    }
    rgba[i * 32 + 24 + 3] = sh0Image[pixelOffset + 3];
  }

  const toComp = (c: number) => ((c / 255 - 0.5) * 2.0) / Math.SQRT2;
  for (let i = 0; i < splatCount; i += 1) {
    const quatsr = quatsImage[i * 4];
    const quatsg = quatsImage[i * 4 + 1];
    const quatsb = quatsImage[i * 4 + 2];
    const quatsa = quatsImage[i * 4 + 3];
    const a = toComp(quatsr);
    const b = toComp(quatsg);
    const c = toComp(quatsb);
    const mode = quatsa - 252;
    const t = a * a + b * b + c * c;
    const d = Math.sqrt(Math.max(0, 1 - t));
    let q: number[];
    switch (mode) {
      case 0:
        q = [d, a, b, c];
        break;
      case 1:
        q = [a, d, b, c];
        break;
      case 2:
        q = [a, b, d, c];
        break;
      case 3:
        q = [a, b, c, d];
        break;
      default:
        throw new Error("Invalid quaternion mode in SOG");
    }
    rot[i * 32 + 28] = q[0] * 127.5 + 127.5;
    rot[i * 32 + 28 + 1] = q[1] * 127.5 + 127.5;
    rot[i * 32 + 28 + 2] = q[2] * 127.5 + 127.5;
    rot[i * 32 + 28 + 3] = q[3] * 127.5 + 127.5;
  }

  if (!meta.shN) {
    return { data: buffer };
  }

  const coeffs = Math.floor(meta.shN.files.length / 2);
  const shComponentCount = coeffs * 3;
  const textureCount = Math.ceil(shComponentCount / 16);
  const width = scene.getEngine().getCaps().maxTextureSize;
  const height = Math.ceil(splatCount / width);
  const sh = AllocateShBuffers(textureCount, height * width * 4 * 4);

  for (let coeff = 0; coeff < coeffs; coeff += 1) {
    const lowFile = meta.shN.files[coeff * 2];
    const highFile = meta.shN.files[coeff * 2 + 1];
    const lowBits = images.get(lowFile)?.bits;
    const highBits = images.get(highFile)?.bits;
    const mins = meta.shN.mins[coeff];
    const maxs = meta.shN.maxs[coeff];
    if (!lowBits || !highBits || !mins || !maxs) {
      throw new Error(`SOG SH coefficient ${coeff} is incomplete`);
    }

    for (let i = 0; i < splatCount; i += 1) {
      const pixelOffset = i * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        const q = (highBits[pixelOffset + channel] << 8) | lowBits[pixelOffset + channel];
        const value = lerp(mins[channel], maxs[channel], q / 65535);
        const shIndexWrite = coeff * 3 + channel;
        const textureIndex = Math.floor(shIndexWrite / 16);
        const byteIndexInTexture = shIndexWrite % 16;
        sh[textureIndex][byteIndexInTexture + i * 16] = clampByte(value * 127.5 + 127.5);
      }
    }
  }

  return {
    data: buffer,
    sh,
    shDegree: Math.max(0, Math.round(Math.sqrt(coeffs + 1) - 1)),
  };
}

// ── Animation state ──────────────────────────────────────────────────────────

interface Anim {
  active: boolean;
  elapsed: number;
  duration: number;
  fromPos: Vec3;
  toPos: Vec3;
  fromForward: Vec3;
  toForward: Vec3;
  fromAngle: number;
  toAngle: number;
  fromPitch: number;
  toPitch: number;
  fromUp: Vec3;
  toUp: Vec3;
  fromFov: number;
  toFov: number;
  holdActive: boolean;
  holdElapsed: number;
  holdDuration: number;
  holdPos: Vec3;
  holdAngle: number;
  holdPanAmt: number;
  holdBaseFov: number;
}

const defaultAnim = (): Anim => ({
  active: false, elapsed: 0, duration: 1.5,
  fromPos: [0, 0, 0], toPos: [0, 0, 0],
  fromForward: [0, 0, 1], toForward: [0, 0, 1],
  fromAngle: 0, toAngle: 0,
  fromPitch: 0, toPitch: 0,
  fromUp: [0, 1, 0], toUp: [0, 1, 0],
  fromFov: 0.66, toFov: 0.66,
  holdActive: false, holdElapsed: 0, holdDuration: 4.5,
  holdPos: [0, 0, 0], holdAngle: 0, holdPanAmt: 0, holdBaseFov: 0.66,
});

interface ImmersivePose {
  enabled: boolean;
  basePosition: Vec3;
  walkOffset: Vec3;
  baseForward: Vec3;
  baseUp: Vec3;
  yawOffset: number;
  pitchOffset: number;
  dolly: number;
  maxDolly: number;
  fov: number;
}

const defaultImmersivePose = (): ImmersivePose => ({
  enabled: false,
  basePosition: [0, 0, 0],
  walkOffset: [0, 0, 0],
  baseForward: [0, 0, 1],
  baseUp: [0, 1, 0],
  yawOffset: 0,
  pitchOffset: 0,
  dolly: 0,
  maxDolly: 0.75,
  fov: 0.66,
});

function applyGaussianRootTransform(
  BABYLON: any,
  root: any,
  transform: GlobalSceneTransform,
) {
  const [x, y, z] = transform.rotationDeg;
  const [tx, ty, tz] = transform.translation;
  root.position.set(tx, ty, tz);
  root.scaling.set(...globalSceneScale3(transform));
  root.rotationQuaternion = BABYLON.Quaternion.RotationYawPitchRoll(
    y * Math.PI / 180,
    x * Math.PI / 180,
    z * Math.PI / 180,
  );
  root.computeWorldMatrix(true);
}

async function settleHiddenGaussian(
  scene: any,
  mesh: any,
  cancelled: () => boolean,
) {
  // Babylon intentionally excludes camera drift from its pre-first-render
  // readiness check. The mesh may therefore be "ready" for the bootstrap
  // camera even though the editor has just restored the saved camera. Force
  // one final worker sort for the actual world matrix and active camera.
  mesh.computeWorldMatrix?.(true);
  mesh._postToWorker?.(true);
  let readyForReveal = false;
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (cancelled()) return false;
    if (mesh.isReady?.()) {
      readyForReveal = true;
      break;
    }
    await new Promise<void>((resolve) => window.setTimeout(resolve, 100));
  }
  if (!readyForReveal) {
    throw new Error("Splat did not settle for the active camera");
  }

  if (cancelled()) return false;
  await new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
  if (cancelled()) return false;
  mesh.visibility = 1;
  scene.render();
  return true;
}

async function loadCompositionGaussian(
  BABYLON: any,
  scene: any,
  url: string,
  name: string,
  parent: any,
  pruneMask?: SplatPruneMask | null,
  sortUpdateThreshold = 0.0001,
): Promise<any> {
  const response = await fetch(url, { cache: "force-cache" });
  if (!response.ok) throw new Error(`Download ${response.status}`);
  const rawBuffer = await response.arrayBuffer();
  const bytes = new Uint8Array(rawBuffer);
  const normalizedUrl = url.split("?")[0].toLowerCase();
  const isSog = normalizedUrl.endsWith(".sog")
    || (bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b);
  const { GaussianSplattingMesh } = BABYLON;
  const mesh = new GaussianSplattingMesh(name, null, scene);
  mesh.viewUpdateThreshold = sortUpdateThreshold;
  // Gaussian data and its sort textures can become renderable before the
  // upload has completed. Attach the USD transform root immediately and keep
  // every intermediate frame fully transparent.
  mesh.parent = parent;
  mesh.visibility = 0;
  mesh.alwaysSelectAsActiveMesh = true;

  if (isSog) {
    const { ParseSogMeta } = await import("@babylonjs/loaders/SPLAT/sog");
    const fflate = await import("fflate");
    const zipData = await new Promise<Record<string, Uint8Array>>((resolve, reject) => {
      fflate.unzip(bytes, (error, data) => error ? reject(error) : resolve(data));
    });
    let vkgsMeta: VkgsSogMeta | null = null;
    const metaEntry = zipData["meta.json"];
    if (metaEntry) {
      try {
        const meta = JSON.parse(new TextDecoder().decode(metaEntry)) as VkgsSogMeta & {
          shN?: { shape?: number[]; files?: string[]; bands?: number };
        };
        if (isVkgsSogMeta(meta)) {
          vkgsMeta = meta;
        }
        const shN = (
          meta as unknown as {
            shN?: { shape?: number[]; files?: string[]; bands?: number };
          }
        ).shN;
        if (
          !vkgsMeta
          && shN
          && (
            !Array.isArray(shN.files)
            || !shN.files.length
            || (
              typeof shN.bands !== "number"
              && !(Array.isArray(shN.shape) && typeof shN.shape[1] === "number")
            )
          )
        ) {
          delete (
            meta as unknown as {
              shN?: { shape?: number[]; files?: string[]; bands?: number };
            }
          ).shN;
          zipData["meta.json"] = new TextEncoder().encode(JSON.stringify(meta));
        }
      } catch {
        // Babylon will report malformed SOG metadata below.
      }
    }
    let parsed: ParsedSogData;
    if (vkgsMeta) {
      parsed = await parseVkgsSogMeta(zipData, vkgsMeta, scene);
    } else {
      parsed = await ParseSogMeta(new Map(Object.entries(zipData)), "", scene);
    }
    const sh = parsed.sh?.length ? parsed.sh : undefined;
    const alive = decodeSplatPruneMask(
      pruneMask,
      Math.floor(parsed.data.byteLength / 32),
    );
    const renderData = alive
      ? filterPackedSplats(
          { buffer: parsed.data, sh, shDegree: parsed.shDegree ?? 0 },
          alive,
        )
      : { buffer: parsed.data, sh, shDegree: parsed.shDegree ?? 0 };
    mesh.updateData(
      renderData.buffer,
      renderData.sh,
      { flipY: false },
      undefined,
      renderData.sh?.length ? (renderData.shDegree ?? 0) : 0,
    );
  } else {
    const converted = (
      await GaussianSplattingMesh.ConvertPLYWithSHToSplatAsync(rawBuffer)
    ) as { buffer: ArrayBuffer; sh?: Uint8Array[]; shDegree?: number };
    const alive = decodeSplatPruneMask(
      pruneMask,
      Math.floor(converted.buffer.byteLength / 32),
    );
    const renderData = alive
      ? filterPackedSplats(
          {
            buffer: converted.buffer,
            sh: converted.sh,
            shDegree: converted.shDegree ?? 0,
          },
          alive,
        )
      : converted;
    if (renderData.sh?.length) {
      mesh.updateData(
        renderData.buffer,
        renderData.sh,
        { flipY: false },
        undefined,
        renderData.shDegree ?? 0,
      );
    } else {
      await mesh.updateDataAsync(renderData.buffer);
    }
  }
  mesh.alwaysSelectAsActiveMesh = true;
  if (mesh.material) mesh.material.backFaceCulling = false;
  return mesh;
}

function deferSplatCacheWrite(
  splatId: number,
  kind: "source" | "full",
  buffer: ArrayBuffer,
  outputsVersion?: string | null,
) {
  // IndexedDB cloning and compression can briefly compete with SOG parsing and
  // the first Gaussian sort. Cache after the browser has presented the scene
  // instead of adding storage work to the critical startup path.
  const write = () => { void putCache(splatId, kind, buffer, outputsVersion); };
  const idleWindow = window as Window & {
    requestIdleCallback?: (
      callback: () => void,
      options?: { timeout: number },
    ) => number;
  };
  if (idleWindow.requestIdleCallback) {
    idleWindow.requestIdleCallback(write, { timeout: 8_000 });
  } else {
    window.setTimeout(write, 1_500);
  }
}

// ── Props & Handle ───────────────────────────────────────────────────────────

export interface SplatCompositionAsset {
  id: string;
  url: string;
  visible: boolean;
  transform: GlobalSceneTransform;
  pruneMask?: SplatPruneMask | null;
}

interface Props {
  splatUrl: string;
  splatId?: number;
  tourUrl?: string;
  camerasUrl?: string;
  /** Camera data passed directly (avoids fetch). Takes priority over camerasUrl. */
  initialCameras?: CameraData | null;
  preferSavedCameras?: boolean;
  readOnly?: boolean;
  /** Stable WebGL budget/cadence; public shared tours use balanced. */
  performanceProfile?: ViewerPerformanceProfile;
  /** outputs_updated_at from backend — used as cache version key */
  outputsVersion?: string | null;
  initialPruneMask?: SplatPruneMask | null;
  className?: string;
  onShotChange?: (idx: number, shot: TourShot | null) => void;
  onReady?: () => void;
  onError?: (msg: string) => void;
  onRetry?: () => void;
  onCancel?: () => void;
  onTourLoaded?: (tour: TourData) => void;
  spatialViewMode?: SpatialViewMode;
  roomKitCage?: RoomKitCageWall[];
  showRoomKitCage?: boolean;
  showSpatialGrid?: boolean;
  spatialTrajectories?: SpatialTrajectory[];
  showSpatialTrajectory?: boolean;
  selectedSpatialCamera?: SpatialCameraSample | null;
  globalSceneTransform?: GlobalSceneTransform;
  spatialTransformTool?: SpatialTransformTool;
  spatialTransformSpace?: "world" | "local";
  spatialTransformSnap?: boolean;
  spatialGizmoResetKey?: string | number | null;
  onSpatialTransformStart?: () => void;
  onSpatialTransformEnd?: () => void;
  onSpatialTransformChange?: (transform: GlobalSceneTransform) => void;
  /**
   * Called as soon as canonical bounds are available. Returning a transform
   * applies it synchronously before the first splat sort and visible frame.
   */
  onSceneFrame?: (frame: SceneFrame) => GlobalSceneTransform | void;
  onInspectionStats?: (stats: SplatInspectionStats | null) => void;
  spatialNavigation?: boolean;
  spatialCameraMode?: SpatialCameraMode;
  onSpatialCameraModeChange?: (mode: SpatialCameraMode) => void;
  splatSelectionTool?: SplatSelectionTool;
  splatSelectionOperation?: SplatSelectionOperation;
  splatBrushRadius?: number;
  onSplatSelectionChange?: (stats: SplatSelectionStats) => void;
  /** Additional OpenUSD workspace nodes rendered around the editable node. */
  compositionAssets?: SplatCompositionAsset[];
  lang?: string;
  /**
   * Which engine draws the Gaussians. Spinoff is the default; "spark" swaps in
   * the WebGL2 SparkJS renderer, which is what phones and insecure dev origins
   * can actually run. Babylon keeps the camera, grid, gizmo and selection layer
   * either way.
   */
  gaussianRenderer?: "spinoff" | "spark";
}

export interface SplatViewerHandle {
  goToShot: (idx: number, instant?: boolean) => void;
  goToPrev: () => void;
  goToNext: () => void;
  getCurrentCamera: () => { position: Vec3; forward: Vec3; up: Vec3; fov: number } | null;
  getTourData: () => TourData | null;
  navigateToCamera: (pos: Vec3, fwd: Vec3, instant?: boolean, fov?: number, up?: Vec3) => void;
  navigateToSpatialCamera: (camera: SpatialCameraSample, instant?: boolean) => void;
  stopCameraNavigation: () => void;
  enableFreeCamera: () => void;
  frameScene: (instant?: boolean) => void;
  /** Set camera FOV in degrees (applies immediately to the live BabylonJS camera). */
  setFov: (degrees: number) => void;
  clearSplatSelection: () => void;
  invertSplatSelection: () => void;
  pruneSelectedSplats: () => void;
  pruneUnselectedSplats: () => void;
  undoSplatPrune: () => void;
  resetSplatPrune: () => void;
  exportPruneMask: (baseAssetFingerprint: string) => SplatPruneMask | null;
  markSplatPruneSaved: () => void;
  exportPrunedPly: (filename?: string) => Promise<File | null>;
  captureThumbnail: (camera?: SavedCamera | null) => Promise<string | null>;
}

// ── Component ────────────────────────────────────────────────────────────────

const SplatViewer = forwardRef<SplatViewerHandle, Props>(function SplatViewer(
  {
    splatUrl,
    splatId,
    tourUrl,
    camerasUrl,
    initialCameras,
    preferSavedCameras,
    readOnly,
    performanceProfile = "quality",
    outputsVersion,
    initialPruneMask,
    className,
    onShotChange,
    onReady,
    onError,
    onRetry,
    onCancel,
    onTourLoaded,
    spatialViewMode = "surface",
    roomKitCage = EMPTY_ROOM_KIT_CAGE,
    showRoomKitCage = false,
    showSpatialGrid = false,
    spatialTrajectories = EMPTY_SPATIAL_TRAJECTORIES,
    showSpatialTrajectory = false,
    selectedSpatialCamera = null,
    globalSceneTransform = IDENTITY_GLOBAL_SCENE_TRANSFORM,
    spatialTransformTool = "select",
    spatialTransformSpace = "world",
    spatialTransformSnap = false,
    spatialGizmoResetKey,
    onSpatialTransformStart,
    onSpatialTransformEnd,
    onSpatialTransformChange,
    onSceneFrame,
    onInspectionStats,
    spatialNavigation = false,
    spatialCameraMode = "orbit",
    onSpatialCameraModeChange,
    splatSelectionTool = "none",
    splatSelectionOperation = "replace",
    splatBrushRadius = 28,
    onSplatSelectionChange,
    compositionAssets = [],
    lang = "en",
    gaussianRenderer = "spinoff",
  },
  ref,
) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const spinoffCanvasRef = useRef<HTMLCanvasElement>(null);
  const sparkCanvasRef = useRef<HTMLCanvasElement>(null);
  const sparkModelTransformRef = useRef<(() => void) | null>(null);
  // Set from the callback below. Held separately so the gizmo's drag observer,
  // which is registered once per gizmo, can reach the current applier without
  // depending on it.
  const applyEngineModelTransformRef = useRef<(() => void) | null>(null);
  const spinoffRendererRef = useRef<SpinoffRenderer | null>(null);
  const spinoffSourceRef = useRef<SpinoffSogSource | null>(null);
  const engineRef = useRef<any>(null);
  const cameraRef = useRef<any>(null);
  const babylonRef = useRef<any>(null);
  const sceneRef = useRef<any>(null);
  const gsRef = useRef<any>(null);
  const spatialRootRef = useRef<any>(null);
  const spatialGizmoManagerRef = useRef<any>(null);
  const compositionMeshesRef = useRef<any[]>([]);
  const globalSceneTransformRef = useRef(globalSceneTransform);
  const onSpatialTransformStartRef = useRef(onSpatialTransformStart);
  const onSpatialTransformEndRef = useRef(onSpatialTransformEnd);
  const onSpatialTransformChangeRef = useRef(onSpatialTransformChange);
  const onSceneFrameRef = useRef(onSceneFrame);
  const splatBufferRef = useRef<ArrayBuffer | null>(null);
  const originalSplatDataRef = useRef<PackedSplatData | null>(null);
  const aliveSplatMaskRef = useRef<Uint8Array | null>(null);
  const savedSplatMaskRef = useRef<Uint8Array | null>(null);
  const selectedSplatMaskRef = useRef<Uint8Array | null>(null);
  const splatPruneHistoryRef = useRef<Uint8Array[]>([]);
  const selectionOverlayRef = useRef<any>(null);
  const onSplatSelectionChangeRef = useRef(onSplatSelectionChange);
  const inspectionSampleRef = useRef<SplatSample | null>(null);
  const resizeRef = useRef<(() => void) | null>(null);
  const renderLoopRef = useRef<(() => void) | null>(null);
  const animRef = useRef<Anim>(defaultAnim());
  const shotIdxRef = useRef(0);
  const pathDataRef = useRef<{
    positions: Vec3[]; forwards: Vec3[]; ups: Vec3[]; arcLens: number[];
    totalArc: number; shots: TourShot[];
  } | null>(null);
  const cameraUpRef = useRef<Vec3>([0, 1, 0]);
  const canonicalTourDataRef = useRef<TourData | null>(null);
  const loadedTourSourceRef = useRef<string | null>(null);
  const scrollVelocityRef = useRef(0);
  const progressRef = useRef(0);
  const pathScrubRef = useRef<{ active: boolean } | null>(null);
  const freeModeRef = useRef(false);
  const immersivePoseRef = useRef<ImmersivePose>(defaultImmersivePose());
  const immersiveCoastRef = useRef({ yaw: 0, pitch: 0 });
  const immersivePointersActiveRef = useRef(false);
  const immersiveRenderBurstUntilRef = useRef(0);
  const spatialNavigationRef = useRef(spatialNavigation);
  const spatialCameraModeRef = useRef<SpatialCameraMode>(spatialCameraMode);
  const spatialOrbitRef = useRef<EditorOrbitPose>({
    enabled: false,
    target: [0, 0, 0],
    radius: 4,
    yaw: Math.PI / 4,
    pitch: 22 * Math.PI / 180,
  });

  useEffect(() => {
    globalSceneTransformRef.current = globalSceneTransform;
  }, [globalSceneTransform]);

  useEffect(() => {
    onSpatialTransformChangeRef.current = onSpatialTransformChange;
  }, [onSpatialTransformChange]);

  useEffect(() => {
    onSpatialTransformStartRef.current = onSpatialTransformStart;
    onSpatialTransformEndRef.current = onSpatialTransformEnd;
  }, [onSpatialTransformEnd, onSpatialTransformStart]);

  useEffect(() => {
    onSceneFrameRef.current = onSceneFrame;
  }, [onSceneFrame]);

  useEffect(() => {
    onSplatSelectionChangeRef.current = onSplatSelectionChange;
  }, [onSplatSelectionChange]);

  const [status, setStatus] = useState(() => t("viewer.status.loading", lang));
  const [splatSelectionRevision, setSplatSelectionRevision] = useState(0);
  const [selectionGesture, setSelectionGesture] = useState<{
    tool: Exclude<SplatSelectionTool, "none">;
    points: Array<{ x: number; y: number }>;
    pointer: { x: number; y: number };
  } | null>(null);
  const [ready, setReady] = useState(false);
  const [spinoffStatus, setSpinoffStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [tourData, setTourData] = useState<TourData | null>(null);
  const [immersiveAdjusted, setImmersiveAdjusted] = useState(false);
  const [showGestureHint, setShowGestureHint] = useState(false);
  const [canFullscreen, setCanFullscreen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [compactTouch, setCompactTouch] = useState(() => (
    typeof window !== "undefined" && window.matchMedia("(max-width: 767px), (pointer: coarse)").matches
  ));
  const fallbackSceneRef = useRef<SceneFrame | null>(null);
  const sogViewerHintRef = useRef<SogViewerHint | null>(null);
  const sogAntialiasRef = useRef(false);
  const immersiveControls = Boolean(readOnly || compactTouch);
  const isSogSource = splatUrl.split("?")[0].toLowerCase().endsWith(".sog");
  const spinoffTransform = spinoffModelTransform(globalSceneTransform);
  // SOG renders through Splatfiction/Spinoff wherever Spinoff can represent the
  // scene, so delivery keeps the exact renderer and never pulls the private
  // tensors. But Spinoff takes a single uniform modelScale and draws the
  // archive as authored: it cannot express a mirrored or non-uniform root, a
  // prune mask, or composed assets. Forcing those through it silently drops the
  // very geometry the workspace is editing and renders an empty viewport, so
  // they keep Babylon's mutable decode. Babylon otherwise stays mounted only as
  // Reaigen's camera, grid, gizmo and selection-control layer.
  const spinoffEligible = isSogSource
    && !initialPruneMask
    && !compositionAssets.length
    && spinoffTransform.compatible;
  // Delivery mode is shared: the loader prepares one SOG source and exactly one
  // external engine consumes it. Only the engine differs.
  const useSparkEngine = spinoffEligible && gaussianRenderer === "spark";
  const visibleReady = ready && (!spinoffEligible || spinoffStatus === "ready");

  useEffect(() => {
    const query = window.matchMedia("(max-width: 767px), (pointer: coarse)");
    const sync = () => setCompactTouch(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  const transformSpatialDirection = useCallback((direction: Vec3): Vec3 => {
    const B = babylonRef.current;
    const root = spatialRootRef.current;
    if (!B || !root) return [...direction] as Vec3;
    root.computeWorldMatrix(true);
    const value = B.Vector3.TransformNormal(
      new B.Vector3(direction[0], direction[1], direction[2]),
      root.getWorldMatrix(),
    ).normalize();
    return [value.x, value.y, value.z];
  }, []);

  const setImmersiveBase = useCallback((
    pos: Vec3,
    fwd: Vec3,
    fov?: number,
    authoredUp: Vec3 = cameraUpRef.current,
  ) => {
    // iOS parity (VirtualTourSheet keeps cameras as world yaw/pitch and lets
    // gravity own the axes): the look-around base up is the SCENE's up,
    // full stop — not the saved camera's up, and not that up projected
    // perpendicular to the shot's forward. The projection was the phone-tour
    // bug: saved shots pitch downward, so the projected axis leaned with
    // them, a horizontal slide yawed around a tilted axis ("offsets in a
    // weird axis"), apparent roll grew with the turn, and the walk plane
    // derived from the same vector tilted too. Yawing around the scene up is
    // gravity-locked and roll-free by construction; a globally rotated scene
    // still tilts with its transform because this is the transformed
    // canonical up. Degenerate look-straight-down poses are handled where
    // the basis is derived, matching iOS's ±85° pitch clamp.
    void authoredUp;
    const up = transformSpatialDirection([0, 1, 0]);
    const length = Math.hypot(fwd[0], fwd[1], fwd[2]) || 1;
    const forward: Vec3 = [fwd[0] / length, fwd[1] / length, fwd[2] / length];
    const sceneRadius = fallbackSceneRef.current?.radius ?? 8;
    immersivePoseRef.current = {
      enabled: true,
      basePosition: [pos[0], pos[1], pos[2]],
      walkOffset: [0, 0, 0],
      baseForward: forward,
      baseUp: up,
      yawOffset: 0,
      pitchOffset: 0,
      dolly: 0,
      // Until wall collision is shared with the production renderer, keep
      // translation intentionally conservative while still exposing parallax.
      maxDolly: Math.min(
        1.25 * globalSceneTransform.scale,
        Math.max(0.35 * globalSceneTransform.scale, sceneRadius * globalSceneTransform.scale * 0.08),
      ),
      fov: typeof fov === "number" && Number.isFinite(fov) ? fov : 0.66,
    };
    immersiveCoastRef.current = { yaw: 0, pitch: 0 };
    immersiveRenderBurstUntilRef.current = performance.now() + 350;
    setImmersiveAdjusted(false);
  }, [globalSceneTransform.scale, transformSpatialDirection]);

  const applyImmersivePose = useCallback(() => {
    const cam = cameraRef.current;
    const B = babylonRef.current;
    const pose = immersivePoseRef.current;
    if (!cam || !B || !pose.enabled) return;

    const normalize = (value: Vec3, fallback: Vec3): Vec3 => {
      const length = Math.hypot(...value);
      return length > 1e-6
        ? [value[0] / length, value[1] / length, value[2] / length]
        : fallback;
    };
    const cross = (a: Vec3, b: Vec3): Vec3 => [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0],
    ];
    const rotateAround = (value: Vec3, rawAxis: Vec3, angle: number): Vec3 => {
      const axis = normalize(rawAxis, [0, 1, 0]);
      const cosine = Math.cos(angle);
      const sine = Math.sin(angle);
      const dot = value[0] * axis[0] + value[1] * axis[1] + value[2] * axis[2];
      const perpendicular = cross(axis, value);
      return [
        value[0] * cosine + perpendicular[0] * sine + axis[0] * dot * (1 - cosine),
        value[1] * cosine + perpendicular[1] * sine + axis[1] * dot * (1 - cosine),
        value[2] * cosine + perpendicular[2] * sine + axis[2] * dot * (1 - cosine),
      ];
    };

    // Preserve the complete authored camera basis. A global X/Z rotation must
    // rotate camera +Y along with the splat; reducing this to world yaw/pitch
    // is what previously made saved transforms appear different in preview.
    const yawedForward = normalize(
      rotateAround(pose.baseForward, pose.baseUp, pose.yawOffset),
      pose.baseForward,
    );
    const right = normalize(cross(pose.baseUp, yawedForward), [1, 0, 0]);
    const forward = normalize(
      rotateAround(yawedForward, right, pose.pitchOffset),
      yawedForward,
    );
    const up = normalize(cross(forward, right), pose.baseUp);

    // Move in the camera's scene-relative ground plane and preserve its height
    // along the transformed canonical up axis.
    const vertical = forward[0] * pose.baseUp[0]
      + forward[1] * pose.baseUp[1]
      + forward[2] * pose.baseUp[2];
    const planarForward = normalize([
      forward[0] - pose.baseUp[0] * vertical,
      forward[1] - pose.baseUp[1] * vertical,
      forward[2] - pose.baseUp[2] * vertical,
    ], pose.baseForward);
    let px = pose.basePosition[0] + pose.walkOffset[0] + planarForward[0] * pose.dolly;
    let py = pose.basePosition[1] + pose.walkOffset[1] + planarForward[1] * pose.dolly;
    let pz = pose.basePosition[2] + pose.walkOffset[2] + planarForward[2] * pose.dolly;

    // Collision is authored in canonical capture space. Resolve the world-space
    // movement through the inverse USD root, then compose the accepted point
    // back to presentation space. This keeps RoomKit, cameras and Gaussians
    // coincident after any global translation/rotation/scale.
    const frame = fallbackSceneRef.current;
    const requestedMovement = Math.hypot(
      px - cam.position.x,
      py - cam.position.y,
      pz - cam.position.z,
    );
    if ((roomKitCage.length || frame) && requestedMovement > 1e-5) {
      const canonicalStart = inversePresentationPoint(
        [cam.position.x, cam.position.y, cam.position.z],
        globalSceneTransform,
      );
      let canonicalTarget = inversePresentationPoint(
        [px, py, pz],
        globalSceneTransform,
      );
      if (roomKitCage.length) {
        canonicalTarget = resolveRoomKitMovement(
          canonicalStart,
          canonicalTarget,
          roomKitCage,
        );
      } else if (frame) {
        // Reconstruction footprint is only a fallback when capture geometry is
        // unavailable. It is also canonical, so never compare it with a
        // translated presentation-space camera.
        const { minX, maxX, minZ, maxZ } = frame.footprint;
        const baseInside = canonicalStart[0] >= minX && canonicalStart[0] <= maxX
          && canonicalStart[2] >= minZ && canonicalStart[2] <= maxZ;
        if (baseInside) {
          const marginX = Math.min(0.3, Math.max(0, (maxX - minX) * 0.08));
          const marginZ = Math.min(0.3, Math.max(0, (maxZ - minZ) * 0.08));
          const lowerX = minX + marginX;
          const upperX = maxX - marginX;
          const lowerZ = minZ + marginZ;
          const upperZ = maxZ - marginZ;
          canonicalTarget[0] = lowerX <= upperX
            ? Math.max(lowerX, Math.min(upperX, canonicalTarget[0]))
            : (minX + maxX) * 0.5;
          canonicalTarget[2] = lowerZ <= upperZ
            ? Math.max(lowerZ, Math.min(upperZ, canonicalTarget[2]))
            : (minZ + maxZ) * 0.5;
        }
      }
      const resolved = transformCanonicalPoint(canonicalTarget, globalSceneTransform);
      [px, py, pz] = resolved;
      // Keep the walk origin at the accepted collision-safe position. Without
      // this, every subsequent frame retries the rejected point and produces a
      // visible vibration while a movement key is held against a wall.
      pose.walkOffset = [
        px - pose.basePosition[0] - planarForward[0] * pose.dolly,
        py - pose.basePosition[1] - planarForward[1] * pose.dolly,
        pz - pose.basePosition[2] - planarForward[2] * pose.dolly,
      ];
    }

    cam.position.set(px, py, pz);
    cameraUpRef.current = up;
    cam.upVector.set(up[0], up[1], up[2]);
    cam.setTarget(new B.Vector3(
      px + forward[0] * LOOK,
      py + forward[1] * LOOK,
      pz + forward[2] * LOOK,
    ));
    cam.fov = pose.fov;
  }, [globalSceneTransform, roomKitCage]);

  const resetImmersiveView = useCallback(() => {
    const pose = immersivePoseRef.current;
    if (!pose.enabled) return;
    pose.yawOffset = 0;
    pose.pitchOffset = 0;
    pose.dolly = 0;
    pose.walkOffset = [0, 0, 0];
    immersiveCoastRef.current = { yaw: 0, pitch: 0 };
    immersiveRenderBurstUntilRef.current = performance.now() + 350;
    animRef.current.holdActive = false;
    applyImmersivePose();
    setImmersiveAdjusted(false);
  }, [applyImmersivePose]);

  const toggleFullscreen = useCallback(async () => {
    try {
      const doc = document as Document & {
        webkitFullscreenElement?: Element | null;
        webkitExitFullscreen?: () => Promise<void> | void;
      };
      const current = document.fullscreenElement ?? doc.webkitFullscreenElement;
      if (current) {
        const exit = document.exitFullscreen?.bind(document) ?? doc.webkitExitFullscreen?.bind(doc);
        await exit?.();
        return;
      }

      // The shared-tour overlays are siblings of SplatViewer. Fullscreen the
      // parent so navigation, floorplan, property info, and camera controls stay.
      const target = (rootRef.current?.parentElement ?? rootRef.current) as (HTMLElement & {
        webkitRequestFullscreen?: () => Promise<void> | void;
      }) | null;
      if (!target) return;
      const request = target.requestFullscreen?.bind(target) ?? target.webkitRequestFullscreen?.bind(target);
      await request?.();
    } catch {
      // Fullscreen can be rejected by embedded browsers or OS policy. The
      // viewer remains usable in-place, so keep this a non-fatal action.
    }
  }, []);

  const setCameraFromForward = useCallback((
    cam: any,
    B: any,
    pos: Vec3,
    fwd: Vec3,
    exactForward: boolean,
    fov?: number,
    up: Vec3 = [0, 1, 0],
  ) => {
    const forward = normalizeVec3(fwd);
    const cameraUp = stableCameraReferenceUp(up, cameraUpRef.current);
    cameraUpRef.current = cameraUp;
    cam.upVector.set(...cameraUp);
    cam.position.set(pos[0], pos[1], pos[2]);
    if (exactForward) {
      cam.setTarget(new B.Vector3(
        pos[0] + forward[0] * LOOK,
        pos[1] + forward[1] * LOOK,
        pos[2] + forward[2] * LOOK,
      ));
    } else {
      cam.setTarget(new B.Vector3(
        pos[0] + forward[0] * LOOK,
        pos[1] - TILT_Y,
        pos[2] + forward[2] * LOOK,
      ));
    }
    cam.upVector.set(...cameraUp);
    if (typeof fov === "number" && Number.isFinite(fov)) cam.fov = fov;
  }, []);

  const transformSpatialPoint = useCallback((point: Vec3): Vec3 => {
    const B = babylonRef.current;
    const root = spatialRootRef.current;
    if (!B || !root) return [...point] as Vec3;
    root.computeWorldMatrix(true);
    const value = B.Vector3.TransformCoordinates(
      new B.Vector3(point[0], point[1], point[2]),
      root.getWorldMatrix(),
    );
    return [value.x, value.y, value.z];
  }, []);

  const inverseTransformSpatialPoint = useCallback((point: Vec3): Vec3 => {
    const B = babylonRef.current;
    const root = spatialRootRef.current;
    if (!B || !root) return [...point] as Vec3;
    root.computeWorldMatrix(true);
    const inverse = root.getWorldMatrix().clone();
    inverse.invert();
    const value = B.Vector3.TransformCoordinates(
      new B.Vector3(point[0], point[1], point[2]),
      inverse,
    );
    return [value.x, value.y, value.z];
  }, []);

  const inverseTransformSpatialDirection = useCallback((direction: Vec3): Vec3 => {
    const B = babylonRef.current;
    const root = spatialRootRef.current;
    if (!B || !root) return [...direction] as Vec3;
    root.computeWorldMatrix(true);
    const inverse = root.getWorldMatrix().clone();
    inverse.invert();
    const value = B.Vector3.TransformNormal(
      new B.Vector3(direction[0], direction[1], direction[2]),
      inverse,
    ).normalize();
    return [value.x, value.y, value.z];
  }, []);

  const worldTourPath = useCallback((data: TourData) => ({
    positions: data.positions.map(transformSpatialPoint),
    forwards: data.forwards.map(transformSpatialDirection),
    ups: (data.ups?.length === data.positions.length
      ? data.ups
      : data.positions.map(() => [0, 1, 0] as Vec3)
    ).map(transformSpatialDirection),
    arcLens: data.arcLens,
    totalArc: data.totalArc * globalSceneTransform.scale,
    shots: data.shots,
  }), [globalSceneTransform.scale, transformSpatialDirection, transformSpatialPoint]);

  const applyTourData = useCallback((
    data: TourData,
    preserveViewport = false,
  ) => {
    setTourData(data);
    onTourLoaded?.(data);
    canonicalTourDataRef.current = data;
    const worldPath = worldTourPath(data);
    pathDataRef.current = worldPath;

    const shot0 = data.shots[0];
    if (preserveViewport) {
      const camera = cameraRef.current;
      if (camera && worldPath.positions.length) {
        let nearestIndex = 0;
        let nearestDistanceSquared = Number.POSITIVE_INFINITY;
        for (let index = 0; index < worldPath.positions.length; index += 1) {
          const position = worldPath.positions[index];
          const dx = position[0] - camera.position.x;
          const dy = position[1] - camera.position.y;
          const dz = position[2] - camera.position.z;
          const distanceSquared = dx * dx + dy * dy + dz * dz;
          if (distanceSquared < nearestDistanceSquared) {
            nearestIndex = index;
            nearestDistanceSquared = distanceSquared;
          }
        }
        progressRef.current = worldPath.arcLens[nearestIndex]
          ?? Math.max(0, Math.min(worldPath.totalArc, progressRef.current));
      } else {
        progressRef.current = Math.max(
          0,
          Math.min(worldPath.totalArc, progressRef.current),
        );
      }
      shotIdxRef.current = Math.max(
        0,
        Math.min(shotIdxRef.current, data.shots.length - 1),
      );
      return;
    }
    progressRef.current = data.arcLens?.[data.startIdx ?? 0] ?? 0;
    const pos0 = worldPath.positions[shot0.startIdx];
    const fwd0 = worldPath.forwards[shot0.startIdx];
    const up0 = worldPath.ups[shot0.startIdx];
    const cam = cameraRef.current;
    const B = babylonRef.current;
    if (cam && B && !spatialNavigationRef.current) {
      setCameraFromForward(
        cam,
        B,
        pos0,
        fwd0,
        isSavedCameraTour(data),
        shot0.fov,
        up0,
      );
      if (immersiveControls) {
        cam.detachControl();
        setImmersiveBase(pos0, fwd0, shot0.fov, up0);
      }
    }
    shotIdxRef.current = 0;
    onShotChange?.(0, shot0);
  }, [
    immersiveControls,
    onShotChange,
    onTourLoaded,
    setCameraFromForward,
    setImmersiveBase,
    worldTourPath,
  ]);

  const buildTourFromSavedCameras = useCallback((cameraData: CameraData): TourData | null => {
    const normalizedData = normalizeCameraData(cameraData);
    const cams = normalizedData.cameras ?? [];
    if (!cams.length) return null;
    const sceneCameraFov = normalizedData.sceneFov
      ? cameraFovRadians(normalizedData.sceneFov, 0.66)
      : null;

    const positions: Vec3[] = [];
    const forwards: Vec3[] = [];
    const ups: Vec3[] = [];
    const shots: TourShot[] = [];
    const arcLens: number[] = [];
    let totalArc = 0;

    for (let i = 0; i < cams.length; i += 1) {
      const cam = cams[i];
      const pos = cam.position as Vec3;
      const rawFwd = (cam.forward ?? [0, 0, 1]) as Vec3;
      const len = Math.hypot(rawFwd[0], rawFwd[1], rawFwd[2]) || 1;
      const forward: Vec3 = [rawFwd[0] / len, rawFwd[1] / len, rawFwd[2] / len];
      positions.push([pos[0], pos[1], pos[2]]);
      forwards.push([forward[0], forward[1], forward[2]]);
      const rawUp = (cam.up ?? [0, 1, 0]) as Vec3;
      const upLength = Math.hypot(rawUp[0], rawUp[1], rawUp[2]) || 1;
      ups.push([
        rawUp[0] / upLength,
        rawUp[1] / upLength,
        rawUp[2] / upLength,
      ]);

      if (i === 0) {
        arcLens.push(0);
      } else {
        const prev = positions[i - 1];
        totalArc += Math.hypot(pos[0] - prev[0], pos[1] - prev[1], pos[2] - prev[2]);
        arcLens.push(totalArc);
      }

      shots.push({
        storyBeat: "saved-camera",
        label: `${t("tour.controls.shot", lang)} ${i + 1}`,
        startIdx: i,
        fov: sceneCameraFov ?? cameraFovRadians(cam.fov ?? normalizedData.fovY, 0.66),
        holdAfter: 3.5,
        moveDuration: 1.2,
        compositionScore: 1,
      });
    }

    return {
      version: 1,
      positions,
      forwards,
      ups,
      arcLens,
      totalArc,
      startIdx: 0,
      shots,
      sceneType: "saved-cameras",
    };
  }, [lang]);

  // ── Navigate to a shot ─────────────────────────────────────────────────────

  const goToShot = useCallback((raw: number, instant = false) => {
    const data = tourData;
    const worldPath = pathDataRef.current;
    if (!data || !worldPath || !cameraRef.current) return;

    const idx = Math.max(0, Math.min(data.shots.length - 1, raw));
    const shot = data.shots[idx];
    if (shot.startIdx >= worldPath.positions.length) return;
    const tPos = worldPath.positions[shot.startIdx];
    const tFwd = worldPath.forwards[shot.startIdx];
    const tUp = worldPath.ups[shot.startIdx];
    const targetForward = normalizeVec3(tFwd);
    // Immersive playback levels the horizon like the iOS tour: flying into a
    // shot whose captured up is banked would otherwise land tilted and then
    // snap level the moment the look-around pose takes over.
    const targetUp = immersiveControls
      ? stableCameraReferenceUp(transformSpatialDirection([0, 1, 0]), cameraUpRef.current)
      : stableCameraReferenceUp(tUp, cameraUpRef.current);
    const useExactForward = isSavedCameraTour(data);

    const cam = cameraRef.current;
    freeModeRef.current = false;
    cam.detachControl();
    if (immersiveControls) setImmersiveBase(tPos, targetForward, shot.fov, targetUp);

    const cur: Vec3 = [cam.position.x, cam.position.y, cam.position.z];
    const target = cam.getTarget();
    const dx = target.x - cam.position.x;
    const dy = target.y - cam.position.y;
    const dz = target.z - cam.position.z;
    const dlen = Math.hypot(dx, dy, dz) || 1;

    const anim = animRef.current;
    (anim as any).editorNav = false;
    anim.fromPos = cur;
    anim.toPos = [tPos[0], tPos[1], tPos[2]];
    anim.fromForward = normalizeVec3([dx, dy, dz]);
    anim.toForward = targetForward;
    anim.fromAngle = Math.atan2(dz / dlen, dx / dlen);
    anim.toAngle = Math.atan2(targetForward[2], targetForward[0]);
    anim.fromPitch = Math.asin(Math.max(-1, Math.min(1, dy / dlen)));
    anim.toPitch = Math.asin(Math.max(-1, Math.min(1, targetForward[1])));
    anim.fromUp = normalizeVec3(
      [cam.upVector.x, cam.upVector.y, cam.upVector.z],
      [0, 1, 0],
    );
    anim.toUp = targetUp;
    anim.fromFov = cam.fov;
    anim.toFov = shot.fov;
    anim.elapsed = 0;
    const distance = Math.hypot(
      tPos[0] - cur[0],
      tPos[1] - cur[1],
      tPos[2] - cur[2],
    );
    const yawDistance = Math.abs(slerpAngle(anim.fromAngle, anim.toAngle, 1) - anim.fromAngle);
    anim.duration = instant
      ? 0.001
      : Math.max(0.5, Math.min(1.25, 0.38 + distance * 0.12 + yawDistance * 0.16));
    anim.active = true;
    (anim as any).exactForward = useExactForward;

    const panDir = idx % 2 === 0 ? 1 : -1;
    anim.holdActive = false;
    anim.holdElapsed = 0;
    anim.holdDuration = 4.5;
    anim.holdAngle = anim.toAngle;
    anim.holdPanAmt = useExactForward ? 0 : panDir * (6 * Math.PI / 180);
    anim.holdBaseFov = shot.fov;

    pathScrubRef.current = null;
    scrollVelocityRef.current = 0;
    progressRef.current = pathDataRef.current?.arcLens?.[shot.startIdx] ?? progressRef.current;
    shotIdxRef.current = idx;
    onShotChange?.(idx, shot);
  }, [tourData, onShotChange, immersiveControls, setImmersiveBase, transformSpatialDirection]);

  const goToPrev = useCallback(() => {
    const n = tourData?.shots.length ?? 0;
    if (!n) return;
    goToShot((shotIdxRef.current - 1 + n) % n);
  }, [goToShot, tourData]);

  const goToNext = useCallback(() => {
    const n = tourData?.shots.length ?? 0;
    if (!n) return;
    goToShot((shotIdxRef.current + 1) % n);
  }, [goToShot, tourData]);

  const getCurrentCamera = useCallback(() => {
    const cam = cameraRef.current;
    const B = babylonRef.current;
    if (!cam || !B) return null;
    const worldPos: Vec3 = [cam.position.x, cam.position.y, cam.position.z];
    const target = cam.getTarget();
    const dx = target.x - cam.position.x;
    const dy = target.y - cam.position.y;
    const dz = target.z - cam.position.z;
    const len = Math.hypot(dx, dy, dz) || 1;
    const worldForward: Vec3 = [dx / len, dy / len, dz / len];
    // The editor authors yaw and pitch, not camera bank. Persist the canonical
    // form of presentation Y-up instead of a per-camera projected basis.
    const worldUp: Vec3 = [0, 1, 0];
    const canonicalForward = inverseTransformSpatialDirection(worldForward);
    const canonicalUp = stableCameraReferenceUp(
      inverseTransformSpatialDirection(worldUp),
    );
    return {
      position: inverseTransformSpatialPoint(worldPos),
      forward: canonicalForward,
      up: canonicalUp,
      fov: cam.fov,
    };
  }, [inverseTransformSpatialDirection, inverseTransformSpatialPoint]);

  const getTourData = useCallback(() => tourData, [tourData]);

  const syncSpatialOrbitToCamera = useCallback(() => {
    if (
      !spatialNavigationRef.current
      || spatialCameraModeRef.current !== "orbit"
    ) return;
    const cam = cameraRef.current;
    if (!cam) return;
    const target = cam.getTarget();
    const forward = target.subtract(cam.position).normalize();
    const focusDistance = Math.max(
      1.25,
      Math.min(4, (fallbackSceneRef.current?.radius ?? 4) * 0.5),
    );
    const pivot = cam.position.add(forward.scale(focusDistance));
    const offset = cam.position.subtract(pivot);
    const radius = Math.max(0.25, offset.length());
    spatialOrbitRef.current = {
      enabled: true,
      target: [pivot.x, pivot.y, pivot.z],
      radius,
      yaw: Math.atan2(offset.z, offset.x),
      pitch: Math.asin(Math.max(-1, Math.min(1, offset.y / radius))),
    };
  }, []);

  const navigateToWorldCamera = useCallback((
    pos: Vec3,
    fwd: Vec3,
    instant = false,
    fov?: number,
    up: Vec3 = cameraUpRef.current,
  ) => {
    const cam = cameraRef.current;
    const B = babylonRef.current;
    if (!cam || !B) return;
    const targetFov = typeof fov === "number" && Number.isFinite(fov) ? fov : cam.fov;
    const targetForward = normalizeVec3(fwd);
    // Same iOS-parity levelling as goToShot: immersive surfaces never adopt a
    // saved camera's bank; the editor keeps the exact authored basis.
    const targetUp = immersiveControls
      ? stableCameraReferenceUp(transformSpatialDirection([0, 1, 0]), cameraUpRef.current)
      : stableCameraReferenceUp(up, cameraUpRef.current);

    // Stop everything — no hold phase, no scroll, no path scrub
    pathScrubRef.current = null;
    scrollVelocityRef.current = 0;
    freeModeRef.current = false;
    cam.detachControl();
    if (immersiveControls) setImmersiveBase(pos, targetForward, targetFov, targetUp);

    const toTarget: Vec3 = [
      pos[0] + targetForward[0] * LOOK,
      pos[1] + targetForward[1] * LOOK,
      pos[2] + targetForward[2] * LOOK,
    ];

    if (instant) {
      cameraUpRef.current = targetUp;
      cam.upVector.set(...targetUp);
      cam.position.set(pos[0], pos[1], pos[2]);
      cam.setTarget(new B.Vector3(toTarget[0], toTarget[1], toTarget[2]));
      cam.upVector.set(...targetUp);
      cam.fov = targetFov;
      immersiveRenderBurstUntilRef.current = performance.now() + 220;
      animRef.current.active = false;
      animRef.current.holdActive = false;
      if (!immersiveControls && !spatialNavigationRef.current && canvasRef.current) {
        cam.attachControl(canvasRef.current, true);
      }
      syncSpatialOrbitToCamera();
      return;
    }

    const target = cam.getTarget();
    const anim = animRef.current;
    anim.fromPos = [cam.position.x, cam.position.y, cam.position.z];
    anim.toPos = [pos[0], pos[1], pos[2]];
    (anim as any).editorNav = true;
    // Decompose current look direction into yaw/pitch for smooth rotation
    const cdx = target.x - cam.position.x;
    const cdy = target.y - cam.position.y;
    const cdz = target.z - cam.position.z;
    const clen = Math.hypot(cdx, cdy, cdz) || 1;
    anim.fromForward = normalizeVec3([cdx, cdy, cdz]);
    anim.toForward = targetForward;
    anim.fromAngle = Math.atan2(cdz / clen, cdx / clen);
    anim.toAngle = Math.atan2(targetForward[2], targetForward[0]);
    anim.fromPitch = Math.asin(Math.max(-1, Math.min(1, cdy / clen)));
    anim.toPitch = Math.asin(Math.max(-1, Math.min(1, targetForward[1])));
    anim.fromUp = normalizeVec3(
      [cam.upVector.x, cam.upVector.y, cam.upVector.z],
      [0, 1, 0],
    );
    anim.toUp = targetUp;
    anim.fromFov = cam.fov;
    anim.toFov = targetFov;
    anim.elapsed = 0;
    // Re-targeting starts from the currently rendered pose, so repeated
    // selections never queue stale animations.
    const dist = Math.hypot(
      pos[0] - cam.position.x,
      pos[1] - cam.position.y,
      pos[2] - cam.position.z,
    );
    const yawDistance = Math.abs(slerpAngle(anim.fromAngle, anim.toAngle, 1) - anim.fromAngle);
    anim.duration = Math.max(
      0.34,
      Math.min(0.9, 0.28 + dist * 0.12 + yawDistance * 0.12),
    );
    anim.active = true;
    anim.holdActive = false;
    anim.holdDuration = 0;
  }, [immersiveControls, setImmersiveBase, syncSpatialOrbitToCamera, transformSpatialDirection]);

  const navigateToCamera = useCallback((
    pos: Vec3,
    fwd: Vec3,
    instant = false,
    fov?: number,
    up: Vec3 = [0, 1, 0],
  ) => {
    const camera = cameraRef.current;
    if (!camera) return;
    const worldForward = transformSpatialDirection(fwd);
    const worldUp = stableCameraReferenceUp(
      transformSpatialDirection(up),
      cameraUpRef.current,
    );
    spatialOrbitRef.current.enabled = false;
    navigateToWorldCamera(
      transformSpatialPoint(pos),
      worldForward,
      instant,
      fov,
      worldUp,
    );
  }, [
    navigateToWorldCamera,
    transformSpatialDirection,
    transformSpatialPoint,
  ]);

  const enableFreeCamera = useCallback(() => {
    const cam = cameraRef.current;
    if (!cam || !canvasRef.current) return;
    animRef.current.active = false;
    animRef.current.holdActive = false;
    scrollVelocityRef.current = 0;
    freeModeRef.current = true;
    if (spatialNavigationRef.current) {
      cam.detachControl();
      syncSpatialOrbitToCamera();
      return;
    }
    if (immersiveControls) {
      const target = cam.getTarget();
      setImmersiveBase(
        [cam.position.x, cam.position.y, cam.position.z],
        [target.x - cam.position.x, target.y - cam.position.y, target.z - cam.position.z],
        cam.fov,
      );
      cam.detachControl();
    } else {
      cam.attachControl(canvasRef.current, true);
    }
  }, [immersiveControls, setImmersiveBase, syncSpatialOrbitToCamera]);

  const applySpatialOrbitPose = useCallback(() => {
    const camera = cameraRef.current;
    const B = babylonRef.current;
    const pose = spatialOrbitRef.current;
    if (!camera || !B || !pose.enabled) return;
    // The advanced editor owns the camera pose directly. Keep Babylon's
    // detached FreeCamera input inertia from modifying it between pointer
    // events, and retain quaternion orientation across the ±180° yaw seam.
    camera.cameraDirection.set(0, 0, 0);
    camera.cameraRotation.set(0, 0);
    const cosPitch = Math.cos(pose.pitch);
    camera.position.set(
      pose.target[0] + pose.radius * cosPitch * Math.cos(pose.yaw),
      pose.target[1] + pose.radius * Math.sin(pose.pitch),
      pose.target[2] + pose.radius * cosPitch * Math.sin(pose.yaw),
    );
    // DCC orbit navigation has no roll gesture. Keep the presentation horizon
    // locked to Y-up so orbiting through ±180° cannot accumulate bank.
    const up: Vec3 = [0, 1, 0];
    camera.upVector.set(...up);
    cameraUpRef.current = up;
    camera.setTarget(new B.Vector3(pose.target[0], pose.target[1], pose.target[2]));
    camera.upVector.set(...up);
    immersiveRenderBurstUntilRef.current = performance.now() + 350;
  }, []);

  const frameScene = useCallback((instant = false) => {
    const frame = fallbackSceneRef.current;
    const camera = cameraRef.current;
    const B = babylonRef.current;
    if (!frame || !camera || !B) return;

    // DCC convention: Frame Selected is deterministic. It always frames the
    // visible asset bounds and establishes one stable orbit pivot.
    const framed = editorFramePose(frame, globalSceneTransformRef.current);
    const pose = spatialOrbitRef.current;
    pose.enabled = true;
    pose.target = framed.target;
    pose.radius = framed.radius;
    pose.yaw = framed.yaw;
    pose.pitch = framed.pitch;
    if (instant) {
      camera.position.set(...framed.position);
      camera.upVector.set(0, 1, 0);
      camera.setTarget(new B.Vector3(...framed.target));
      camera.rotation.z = 0;
      immersiveRenderBurstUntilRef.current = performance.now() + 350;
      return;
    }
    const forward = normalizeVec3([
      framed.target[0] - framed.position[0],
      framed.target[1] - framed.position[1],
      framed.target[2] - framed.position[2],
    ]);
    navigateToWorldCamera(
      framed.position,
      forward,
      false,
      cameraRef.current?.fov,
      [0, 1, 0],
    );
  }, [
    navigateToWorldCamera,
  ]);

  const navigateToSpatialCamera = useCallback((sample: SpatialCameraSample, instant = true) => {
    const camera = cameraRef.current;
    if (!camera) return;
    const position = transformSpatialPoint(sample.position);
    const forward = transformSpatialDirection(sample.forward);
    const up = transformSpatialDirection(sample.up);
    spatialOrbitRef.current.enabled = false;
    navigateToWorldCamera(position, forward, instant, sample.fov, up);
  }, [navigateToWorldCamera, transformSpatialDirection, transformSpatialPoint]);

  const stopCameraNavigation = useCallback(() => {
    animRef.current.active = false;
    animRef.current.holdActive = false;
    pathScrubRef.current = null;
    scrollVelocityRef.current = 0;
  }, []);

  useEffect(() => {
    spatialCameraModeRef.current = spatialCameraMode;
  }, [spatialCameraMode]);

  useEffect(() => {
    spatialNavigationRef.current = spatialNavigation;
    let frame = 0;
    const applyModeDensityWhenStill = () => {
      const anim = animRef.current;
      const coast = immersiveCoastRef.current;
      const cameraStill = !anim.active
        && !anim.holdActive
        && Math.abs(scrollVelocityRef.current) <= 0.001
        && !immersivePointersActiveRef.current
        && Math.abs(coast.yaw) < 0.04
        && Math.abs(coast.pitch) < 0.04;
      if (!cameraStill) {
        frame = window.requestAnimationFrame(applyModeDensityWhenStill);
        return;
      }
      resizeRef.current?.();
      immersiveRenderBurstUntilRef.current = performance.now() + 350;
    };
    frame = window.requestAnimationFrame(applyModeDensityWhenStill);
    return () => window.cancelAnimationFrame(frame);
  }, [spatialNavigation]);

  useEffect(() => {
    const threshold = viewerSortUpdateThreshold(
      spatialNavigation,
      performanceProfile,
    );
    if (gsRef.current) gsRef.current.viewUpdateThreshold = threshold;
    for (const item of compositionMeshesRef.current) {
      if (item.mesh) item.mesh.viewUpdateThreshold = threshold;
    }
  }, [performanceProfile, ready, spatialNavigation]);

  const setFov = useCallback((degrees: number) => {
    const cam = cameraRef.current;
    if (!cam) return;
    // BabylonJS camera.fov is vertical FOV in radians
    const radians = (degrees * Math.PI) / 180;
    cam.fov = radians;
    if (immersivePoseRef.current.enabled) immersivePoseRef.current.fov = radians;
    immersiveRenderBurstUntilRef.current = performance.now() + 350;
  }, []);

  const publishSplatSelectionStats = useCallback(() => {
    const alive = aliveSplatMaskRef.current;
    const selected = selectedSplatMaskRef.current;
    if (!alive || !selected) return;
    let remaining = 0;
    let selectedCount = 0;
    for (let index = 0; index < alive.length; index += 1) {
      if (!alive[index]) continue;
      remaining += 1;
      if (selected[index]) selectedCount += 1;
    }
    onSplatSelectionChangeRef.current?.({
      total: alive.length,
      selected: selectedCount,
      remaining,
      pruned: alive.length - remaining,
      dirty: !splatMasksEqual(alive, savedSplatMaskRef.current),
    });
  }, []);

  const refreshPrunedSplatMesh = useCallback(() => {
    const source = originalSplatDataRef.current;
    const alive = aliveSplatMaskRef.current;
    const gs = gsRef.current;
    const scene = sceneRef.current;
    if (!source || !alive || !gs || !scene) return;
    const filtered = filterPackedSplats(source, alive);
    splatBufferRef.current = filtered.buffer;
    gs.updateData(
      filtered.buffer,
      filtered.sh?.length ? filtered.sh : undefined,
      { flipY: false },
      undefined,
      filtered.shDegree ?? 0,
    );
    fallbackSceneRef.current = computeSceneFrameFromSplatBuffer(filtered.buffer);
    setSplatSelectionRevision((value) => value + 1);
    publishSplatSelectionStats();
    immersiveRenderBurstUntilRef.current = performance.now() + 500;
    scene.render();
  }, [publishSplatSelectionStats]);

  const clearSplatSelection = useCallback(() => {
    selectedSplatMaskRef.current?.fill(0);
    setSplatSelectionRevision((value) => value + 1);
    publishSplatSelectionStats();
    sceneRef.current?.render();
  }, [publishSplatSelectionStats]);

  const invertSplatSelection = useCallback(() => {
    const alive = aliveSplatMaskRef.current;
    const selected = selectedSplatMaskRef.current;
    if (!alive || !selected) return;
    for (let index = 0; index < selected.length; index += 1) {
      selected[index] = alive[index] ? (selected[index] ? 0 : 1) : 0;
    }
    setSplatSelectionRevision((value) => value + 1);
    publishSplatSelectionStats();
    sceneRef.current?.render();
  }, [publishSplatSelectionStats]);

  const applySplatPrune = useCallback((removeSelected: boolean) => {
    const alive = aliveSplatMaskRef.current;
    const selected = selectedSplatMaskRef.current;
    if (!alive || !selected) return;
    const next = alive.slice();
    let remaining = 0;
    for (let index = 0; index < next.length; index += 1) {
      if (!next[index]) continue;
      const remove = removeSelected ? Boolean(selected[index]) : !selected[index];
      if (remove) next[index] = 0;
      else remaining += 1;
    }
    if (remaining < 1 || remaining === countMask(alive)) return;
    splatPruneHistoryRef.current = [
      ...splatPruneHistoryRef.current.slice(-11),
      alive.slice(),
    ];
    aliveSplatMaskRef.current = next;
    selected.fill(0);
    refreshPrunedSplatMesh();
  }, [refreshPrunedSplatMesh]);

  const pruneSelectedSplats = useCallback(() => applySplatPrune(true), [applySplatPrune]);
  const pruneUnselectedSplats = useCallback(() => applySplatPrune(false), [applySplatPrune]);

  const undoSplatPrune = useCallback(() => {
    const previous = splatPruneHistoryRef.current.pop();
    if (!previous) return;
    aliveSplatMaskRef.current = previous;
    selectedSplatMaskRef.current?.fill(0);
    refreshPrunedSplatMesh();
  }, [refreshPrunedSplatMesh]);

  const resetSplatPrune = useCallback(() => {
    const alive = aliveSplatMaskRef.current;
    const saved = savedSplatMaskRef.current;
    if (!alive || !saved || alive.length !== saved.length) return;
    alive.set(saved);
    selectedSplatMaskRef.current?.fill(0);
    splatPruneHistoryRef.current = [];
    refreshPrunedSplatMesh();
  }, [refreshPrunedSplatMesh]);

  const exportPruneMask = useCallback((baseAssetFingerprint: string) => {
    const alive = aliveSplatMaskRef.current;
    if (!alive) return null;
    return encodeSplatPruneMask(alive, baseAssetFingerprint);
  }, []);

  const markSplatPruneSaved = useCallback(() => {
    const alive = aliveSplatMaskRef.current;
    if (!alive) return;
    savedSplatMaskRef.current = alive.slice();
    splatPruneHistoryRef.current = [];
    publishSplatSelectionStats();
  }, [publishSplatSelectionStats]);

  const exportPrunedPly = useCallback(async (filename = "reaigen-pruned.ply") => {
    const source = originalSplatDataRef.current;
    const alive = aliveSplatMaskRef.current;
    if (!source || !alive || countMask(alive) < 1) return null;
    const filtered = filterPackedSplats(source, alive);
    const blob = packedSplatsToPly(filtered);
    return new File([blob], filename, {
      type: "application/octet-stream",
      lastModified: Date.now(),
    });
  }, []);

  const captureThumbnail = useCallback(async (savedCamera?: SavedCamera | null) => {
    const engine = engineRef.current;
    const camera = cameraRef.current;
    const scene = sceneRef.current;
    const B = babylonRef.current;
    if (!engine || !camera || !scene || !B || spatialGizmoManagerRef.current?.isDragging) {
      return null;
    }

    const editorOverlayPrefixes = [
      "reaigen-active-camera",
      "reaigen-camera-",
      "reaigen-gaussian-centers",
      "reaigen-roomkit-",
      "reaigen-splat-selection",
      "reaigen-working-grid",
    ];
    const hidden: Array<{ mesh: any; enabled: boolean }> = (scene.meshes ?? [])
      .filter((mesh: any) => editorOverlayPrefixes.some(
        (prefix) => String(mesh.name ?? "").startsWith(prefix),
      ))
      .map((mesh: any) => ({ mesh, enabled: mesh.isEnabled?.() ?? true }));
    hidden.forEach(({ mesh }) => mesh.setEnabled?.(false));

    const gizmoManager = spatialGizmoManagerRef.current;
    const attachedRoot = spatialRootRef.current;
    let renderCamera = camera;
    const previousActiveCamera = scene.activeCamera;
    const previousCamera = {
      position: camera.position.clone(),
      target: camera.getTarget().clone(),
      up: camera.upVector.clone(),
      fov: camera.fov,
      direction: camera.cameraDirection?.clone?.(),
      rotation: camera.cameraRotation?.clone?.(),
    };
    const renderLoop = renderLoopRef.current;
    let renderLoopPaused = false;
    if (gizmoManager) gizmoManager.attachToNode(null);
    try {
      if (savedCamera) {
        const position = transformSpatialPoint(savedCamera.position);
        const forward = normalizeVec3(
          transformSpatialDirection(savedCamera.forward),
        );
        const up = normalizeVec3(
          transformSpatialDirection(savedCamera.up ?? [0, 1, 0]),
          [0, 1, 0],
        );
        if (renderLoop) {
          engine.stopRenderLoop(renderLoop);
          renderLoopPaused = true;
        }
        scene.activeCamera = camera;
        camera.upVector.set(...up);
        camera.position.set(...position);
        camera.setTarget(new B.Vector3(
          position[0] + forward[0],
          position[1] + forward[1],
          position[2] + forward[2],
        ));
        camera.fov = (
          typeof savedCamera.fov === "number" && Number.isFinite(savedCamera.fov)
            ? savedCamera.fov
            : camera.fov
        );
        renderCamera = camera;
      }
      const { CreateScreenshotUsingRenderTargetAsync } = await import(
        "@babylonjs/core/Misc/screenshotTools.pure"
      );
      if (savedCamera) {
        // Gaussian splats sort only for the scene's active camera. Pause the
        // visible render loop while the authored pose is active, warm its sort
        // buffers, capture, then restore the editor camera before resuming.
        await CreateScreenshotUsingRenderTargetAsync(
          engine,
          renderCamera,
          { width: 640, height: 400 },
          "image/webp",
          1,
          false,
          undefined,
          false,
          false,
          true,
          0.84,
        );
        const gaussian = gsRef.current as any;
        for (let attempt = 0; attempt < 120; attempt += 1) {
          const cameraSort = gaussian?._cameraViewInfos?.get(
            renderCamera.uniqueId,
          );
          if (
            cameraSort?.splatIndexBufferSet
            && cameraSort.sortAppliedId === cameraSort.sortRequestId
          ) break;
          await new Promise<void>((resolve) => {
            window.setTimeout(resolve, 16);
          });
        }
      }
      return await CreateScreenshotUsingRenderTargetAsync(
        engine,
        renderCamera,
        { width: 640, height: 400 },
        "image/webp",
        2,
        true,
        undefined,
        false,
        false,
        true,
        0.84,
      );
    } catch {
      return null;
    } finally {
      camera.position.copyFrom(previousCamera.position);
      camera.upVector.copyFrom(previousCamera.up);
      camera.setTarget(previousCamera.target);
      camera.fov = previousCamera.fov;
      if (previousCamera.direction && camera.cameraDirection?.copyFrom) {
        camera.cameraDirection.copyFrom(previousCamera.direction);
      }
      if (previousCamera.rotation && camera.cameraRotation?.copyFrom) {
        camera.cameraRotation.copyFrom(previousCamera.rotation);
      }
      scene.activeCamera = previousActiveCamera;
      hidden.forEach(({ mesh, enabled }) => mesh.setEnabled?.(enabled));
      if (gizmoManager && attachedRoot && !attachedRoot.isDisposed?.()) {
        gizmoManager.attachToNode(attachedRoot);
      }

      // The thumbnail and the editor reuse Babylon's one Gaussian sort worker.
      // Restoring only the camera pose is insufficient: a static editor camera
      // may never request another sort, leaving the visible canvas sorted for
      // the off-screen cover pose. Force and await the restored-camera sort
      // before the interactive render loop resumes.
      const gaussian = gsRef.current as any;
      gaussian?.computeWorldMatrix?.(true);
      gaussian?._postToWorker?.(true);
      for (let attempt = 0; attempt < 120; attempt += 1) {
        const restoredSort = gaussian?._cameraViewInfos?.get(camera.uniqueId);
        if (
          !gaussian
          || (
            restoredSort?.splatIndexBufferSet
            && restoredSort.sortAppliedId === restoredSort.sortRequestId
          )
        ) break;
        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, 16);
        });
      }
      scene.render();
      if (renderLoopPaused && renderLoop && !engine.isDisposed) {
        engine.runRenderLoop(renderLoop);
      }
    }
  }, [transformSpatialDirection, transformSpatialPoint]);

  useImperativeHandle(ref, () => ({
    goToShot,
    goToPrev,
    goToNext,
    getCurrentCamera,
    getTourData,
    navigateToCamera,
    navigateToSpatialCamera,
    stopCameraNavigation,
    enableFreeCamera,
    frameScene,
    setFov,
    clearSplatSelection,
    invertSplatSelection,
    pruneSelectedSplats,
    pruneUnselectedSplats,
    undoSplatPrune,
    resetSplatPrune,
    exportPruneMask,
    markSplatPruneSaved,
    exportPrunedPly,
    captureThumbnail,
  }), [
    goToShot,
    goToPrev,
    goToNext,
    getCurrentCamera,
    getTourData,
    navigateToCamera,
    navigateToSpatialCamera,
    stopCameraNavigation,
    enableFreeCamera,
    frameScene,
    setFov,
    clearSplatSelection,
    invertSplatSelection,
    pruneSelectedSplats,
    pruneUnselectedSplats,
    undoSplatPrune,
    resetSplatPrune,
    exportPruneMask,
    markSplatPruneSaved,
    exportPrunedPly,
    captureThumbnail,
  ]);

  // ── Spatial inspection layers ──────────────────────────────────────────────

  useEffect(() => {
    if (!ready) return;
    const B = babylonRef.current;
    const gs = gsRef.current;
    const scene = sceneRef.current;
    if (!B || !gs || !scene) return;

    let root = spatialRootRef.current;
    if (!root || root.isDisposed?.()) {
      root = new B.TransformNode("reaigen-spatial-root", scene);
      spatialRootRef.current = root;
    }

    // Backend output, RoomKit geometry and captured camera poses share the
    // canonical identity/Y-up space. The saved transform moves that complete
    // coordinate system into the tour's presentation space.
    applyGaussianRootTransform(B, root, globalSceneTransform);
    gs.parent = root;
    scene.render();
  }, [globalSceneTransform, ready]);

  useEffect(() => {
    for (const item of compositionMeshesRef.current) item.root?.dispose?.(false, true);
    compositionMeshesRef.current = [];
    if (!ready || !compositionAssets.length) return;

    const B = babylonRef.current;
    const scene = sceneRef.current;
    if (!B || !scene) return;
    let disposed = false;
    const loaded: any[] = [];

    const load = async () => {
      for (const asset of compositionAssets) {
        if (disposed || !asset.visible || !asset.url) continue;
        const root = new B.TransformNode(`splat-composition-root-${asset.id}`, scene);
        applyGaussianRootTransform(B, root, asset.transform);
        try {
          const mesh = await loadCompositionGaussian(
            B,
            scene,
            asset.url,
            `splat-composition-${asset.id}`,
            root,
            asset.pruneMask,
            viewerSortUpdateThreshold(spatialNavigation, performanceProfile),
          );
          if (disposed) {
            root.dispose?.(false, true);
            break;
          }
          if (!await settleHiddenGaussian(scene, mesh, () => disposed)) {
            root.dispose?.(false, true);
            break;
          }
          loaded.push({ root, mesh });
        } catch (error) {
          root.dispose?.(false, true);
          console.warn(`[REAI] Could not load composition node ${asset.id}:`, error);
        }
      }
      if (!disposed) compositionMeshesRef.current = loaded;
    };
    void load();

    return () => {
      disposed = true;
      // `compositionMeshesRef` is only published after the whole batch has
      // loaded. Dispose the in-flight batch directly so interrupted effects
      // cannot leave duplicate splats rendering behind the next batch.
      for (const item of loaded) item.root?.dispose?.(false, true);
      compositionMeshesRef.current = [];
    };
    // Changing between playback and authoring only adjusts the existing mesh
    // threshold in the effect above. It must not dispose and download every
    // composition node again when the editor opens or closes.
  }, [compositionAssets, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    spatialGizmoManagerRef.current?.dispose?.();
    spatialGizmoManagerRef.current = null;

    if (!ready || !spatialNavigation || spatialTransformTool === "select") return;

    const B = babylonRef.current;
    const scene = sceneRef.current;
    const root = spatialRootRef.current;
    if (!B || !scene || !root) return;

    // The USD root gizmo is a primary authoring control. Keep it screen-stable,
    // pen-sized and visually identical to a DCC transform manipulator. Plane
    // handles are intentionally omitted: Babylon's overlapping translucent
    // planes read as one cyan knot against a photographic Gaussian scene.
    const gizmoScale = compactTouch ? 1.15 : 0.96;
    const axisScale = gizmoScale;
    // Babylon's second constructor argument is line thickness, not a general
    // UI scale. The old 3.5–4.2 value produced oversized toy-like arrows.
    const manager = new B.GizmoManager(scene, compactTouch ? 1.65 : 1.2);
    spatialGizmoManagerRef.current = manager;
    manager.usePointerToAttachGizmos = false;
    manager.enableAutoPicking = false;
    manager.clearGizmoOnEmptyPointerEvent = false;
    manager.scaleRatio = gizmoScale;

    manager.positionGizmoEnabled = spatialTransformTool === "move";
    manager.rotationGizmoEnabled = spatialTransformTool === "rotate";
    manager.scaleGizmoEnabled = spatialTransformTool === "scale";
    manager.attachToNode(root);

    // GizmoManager does not propagate a coordinate mode to gizmos that do
    // not exist yet. Apply it only after the active gizmo is constructed and
    // attached; setting it before the `*GizmoEnabled` flags silently left
    // every newly-created handle in Babylon's default local space.
    if (B.GizmoCoordinatesMode?.World != null) {
      const coordinatesMode = (
        spatialTransformTool === "scale" || spatialTransformSpace === "local"
      )
        ? B.GizmoCoordinatesMode.Local
        : B.GizmoCoordinatesMode.World;
      manager.coordinatesMode = coordinatesMode;
      if (manager.gizmos.positionGizmo) {
        manager.gizmos.positionGizmo.coordinatesMode = coordinatesMode;
      }
      if (manager.gizmos.rotationGizmo) {
        manager.gizmos.rotationGizmo.coordinatesMode = coordinatesMode;
      }
      // Babylon intentionally supports scale only in local coordinates:
      // global non-uniform scaling of a rotated node requires a shear matrix,
      // which is outside the saved TRS scene representation.
      if (manager.gizmos.scaleGizmo) {
        manager.gizmos.scaleGizmo.coordinatesMode = B.GizmoCoordinatesMode.Local;
      }
    }

    const palette = {
      x: B.Color3.FromHexString("#F2384A"),
      y: B.Color3.FromHexString("#21C55D"),
      z: B.Color3.FromHexString("#2878FF"),
    };
    const tuneHandle = (handle: any, color: any, alpha = 1) => {
      if (!handle) return;
      if (handle.coloredMaterial) {
        // Gizmos are authoring UI, not scene geometry. With lighting disabled,
        // Babylon effectively left the old 18% emissive value as the visible
        // axis colour, producing near-black handles over photographic splats.
        // Drive the colour from the unlit emissive channel at full intensity.
        handle.coloredMaterial.diffuseColor = B.Color3.Black();
        handle.coloredMaterial.emissiveColor = color;
        handle.coloredMaterial.specularColor = B.Color3.Black();
        handle.coloredMaterial.disableLighting = true;
        handle.coloredMaterial.alpha = alpha;
      }
      if (handle.hoverMaterial) {
        const hover = B.Color3.Lerp(color, B.Color3.White(), 0.24);
        handle.hoverMaterial.diffuseColor = B.Color3.Black();
        handle.hoverMaterial.emissiveColor = hover;
        handle.hoverMaterial.specularColor = B.Color3.Black();
        handle.hoverMaterial.disableLighting = true;
        handle.hoverMaterial.alpha = 1;
      }
      if ("rotationColor" in handle) handle.rotationColor = color;
    };

    const positionGizmo = manager.gizmos.positionGizmo;
    if (positionGizmo) {
      positionGizmo.planarGizmoEnabled = false;
      positionGizmo.snapDistance = spatialTransformSnap ? 0.1 : 0;
      positionGizmo.xGizmo.scaleRatio = axisScale;
      positionGizmo.yGizmo.scaleRatio = axisScale;
      positionGizmo.zGizmo.scaleRatio = axisScale;
      tuneHandle(positionGizmo.xGizmo, palette.x);
      tuneHandle(positionGizmo.yGizmo, palette.y);
      tuneHandle(positionGizmo.zGizmo, palette.z);
    }

    const rotationGizmo = manager.gizmos.rotationGizmo;
    if (rotationGizmo) {
      rotationGizmo.sensitivity = compactTouch ? 1.15 : 0.9;
      rotationGizmo.snapDistance = spatialTransformSnap ? 5 * Math.PI / 180 : 0;
      const rotationScale = gizmoScale * 1.18;
      rotationGizmo.xGizmo.scaleRatio = rotationScale;
      rotationGizmo.yGizmo.scaleRatio = rotationScale;
      rotationGizmo.zGizmo.scaleRatio = rotationScale;
      tuneHandle(rotationGizmo.xGizmo, palette.x);
      tuneHandle(rotationGizmo.yGizmo, palette.y);
      tuneHandle(rotationGizmo.zGizmo, palette.z);
    }

    const scaleGizmo = manager.gizmos.scaleGizmo;
    if (scaleGizmo) {
      scaleGizmo.xGizmo.isEnabled = true;
      scaleGizmo.yGizmo.isEnabled = true;
      scaleGizmo.zGizmo.isEnabled = true;
      // The stock center octahedron obscures the pivot and reads as an
      // unrelated knob. Per-axis scale is the primary workspace operation;
      // uniform values remain available through the inspector.
      scaleGizmo.uniformScaleGizmo.isEnabled = false;
      scaleGizmo.snapDistance = spatialTransformSnap ? 0.05 : 0;
      for (const [handle, color] of [
        [scaleGizmo.xGizmo, palette.x],
        [scaleGizmo.yGizmo, palette.y],
        [scaleGizmo.zGizmo, palette.z],
      ] as const) {
        handle.scaleRatio = axisScale * 1.04;
        handle.sensitivity = compactTouch ? 0.85 : 0.72;
        handle.incrementalSnap = true;
        tuneHandle(handle, color);

        // Retain Babylon's generous invisible collider and drag behavior, but
        // replace the visible cube-like terminal with a thin DCC scale cap.
        // This improves precision without making the hit target smaller.
        const visibleMeshes = handle._gizmoMesh?.getChildMeshes?.() ?? [];
        for (const mesh of visibleMeshes) {
          if (mesh.visibility === 0) continue;
          if (mesh.name === "yPosMesh") {
            mesh.scaling.set(0.105, 0.032, 0.105);
          } else if (mesh.name === "cylinder") {
            mesh.scaling.x = 0.72;
            mesh.scaling.z = 0.72;
          }
        }
      }
    }

    const activeGizmo = spatialTransformTool === "move"
      ? positionGizmo
      : spatialTransformTool === "rotate"
        ? rotationGizmo
        : scaleGizmo;
    const publishTransform = () => {
      const previous = globalSceneTransformRef.current;
      const euler = root.rotationQuaternion?.toEulerAngles?.()
        ?? root.rotation
        ?? B.Vector3.Zero();
      const principalRotation: Vec3 = [
        normalizedEditorDegrees(euler.x),
        normalizedEditorDegrees(euler.y),
        normalizedEditorDegrees(euler.z),
      ];
      const alternateRotation: Vec3 = [
        normalizedEditorDegrees(Math.PI - euler.x),
        normalizedEditorDegrees(euler.y + Math.PI),
        normalizedEditorDegrees(euler.z + Math.PI),
      ];
      const principalDistance = principalRotation.reduce(
        (sum, value, index) => sum + editorAngleDistance(value, previous.rotationDeg[index]),
        0,
      );
      const alternateDistance = alternateRotation.reduce(
        (sum, value, index) => sum + editorAngleDistance(value, previous.rotationDeg[index]),
        0,
      );
      const rotationDeg = alternateDistance < principalDistance
        ? alternateRotation
        : principalRotation;

      const nextTransform: GlobalSceneTransform = {
        version: 1,
        coordinateSpace: "reaigen_y_up",
        translation: spatialTransformTool === "move"
          ? [
              Number(root.position.x.toFixed(4)),
              Number(root.position.y.toFixed(4)),
              Number(root.position.z.toFixed(4)),
            ]
          : [...previous.translation] as Vec3,
        rotationDeg: spatialTransformTool === "rotate"
          ? rotationDeg
          : [...previous.rotationDeg] as Vec3,
        scale: spatialTransformTool === "scale"
          ? sceneScaleMagnitude([
              root.scaling.x,
              root.scaling.y,
              root.scaling.z,
            ])
          : previous.scale,
        // A drag resizes; it never mirrors. Babylon's per-axis scale gizmo has
        // no sign clamp, so pulling a handle through the origin would flip that
        // axis and mirror the whole scene. An authored mirror is still honoured
        // because the sign comes from the transform being edited.
        scale3: spatialTransformTool === "scale"
          ? (() => {
              const authored = globalSceneScale3(previous);
              return [
                scaleComponentWithAuthoredSign(Number(root.scaling.x.toFixed(4)), authored[0]),
                scaleComponentWithAuthoredSign(Number(root.scaling.y.toFixed(4)), authored[1]),
                scaleComponentWithAuthoredSign(Number(root.scaling.z.toFixed(4)), authored[2]),
              ] as Vec3;
            })()
          : globalSceneScale3(previous),
      };

      globalSceneTransformRef.current = nextTransform;
      onSpatialTransformChangeRef.current?.(nextTransform);
      root.computeWorldMatrix(true);
      // Move the Gaussians now, on this drag frame, rather than waiting for the
      // transform to make a round trip through React state and come back as a
      // prop. Called through a ref because this observer is registered once and
      // must not be torn down and re-registered every time the applier's
      // identity changes.
      applyEngineModelTransformRef.current?.();
      immersiveRenderBurstUntilRef.current = performance.now() + 300;
    };

    const dragStartObserver = activeGizmo?.onDragStartObservable.add(() => {
      onSpatialTransformStartRef.current?.();
    });
    const dragObserver = activeGizmo?.onDragObservable.add(publishTransform);
    const dragEndObserver = activeGizmo?.onDragEndObservable.add(() => {
      publishTransform();
      onSpatialTransformEndRef.current?.();
    });
    scene.render();

    return () => {
      if (dragStartObserver) activeGizmo?.onDragStartObservable.remove(dragStartObserver);
      if (dragObserver) activeGizmo?.onDragObservable.remove(dragObserver);
      if (dragEndObserver) activeGizmo?.onDragEndObservable.remove(dragEndObserver);
      if (spatialGizmoManagerRef.current === manager) {
        spatialGizmoManagerRef.current = null;
      }
      manager.dispose();
      scene.render();
    };
  }, [
    compactTouch,
    ready,
    spatialNavigation,
    spatialGizmoResetKey,
    spatialTransformSnap,
    spatialTransformSpace,
    spatialTransformTool,
  ]);

  useEffect(() => {
    const canonical = canonicalTourDataRef.current;
    if (!ready || !canonical) return;
    // Keep playback data synchronized without snapping the camera while the
    // owner is interactively adjusting the scene.
    pathDataRef.current = worldTourPath(canonical);
  }, [globalSceneTransform, ready, worldTourPath]);

  useEffect(() => {
    if (!ready) return;
    const B = babylonRef.current;
    const gs = gsRef.current;
    const scene = sceneRef.current;
    const root = spatialRootRef.current;
    if (!B || !gs || !scene || !root) return;

    const disposables: any[] = [];
    if (!spatialNavigation) {
      gs.visibility = 1;
      inspectionSampleRef.current = null;
      onInspectionStats?.(null);
      return;
    }

    const buffer = splatBufferRef.current;
    const sample = buffer
      ? sampleSplatBuffer(buffer, compactTouch ? 3_200 : 7_500)
      : null;
    inspectionSampleRef.current = sample;
    onInspectionStats?.(sample?.stats ?? null);

    gs.visibility = spatialViewMode === "centers" ? 0.76 : 1;

    if (spatialViewMode === "centers" && sample) {
      const mesh = new B.Mesh("reaigen-gaussian-centers", scene);
      const positions = Array.from(sample.positions);
      const colors = Array.from(sample.colors);
      const structure = Array.from(sample.structure);
      const indices = Array.from({ length: positions.length / 3 }, (_, index) => index);
      mesh.setVerticesData(B.VertexBuffer.PositionKind, positions, false);
      mesh.setVerticesData(B.VertexBuffer.ColorKind, colors, false, 4);
      mesh.setVerticesData("structure", structure, false, 3);
      mesh.setIndices(indices);
      const shaderName = "reaigenGaussianStructure";
      B.Effect.ShadersStore[`${shaderName}VertexShader`] = `
        precision highp float;
        attribute vec3 position;
        attribute vec4 color;
        attribute vec3 structure;
        uniform mat4 world;
        uniform mat4 worldViewProjection;
        uniform vec3 cameraPosition;
        uniform float pointSize;
        uniform float nearFade;
        uniform float farFade;
        varying float vVisibility;
        varying vec4 vPointColor;
        varying vec3 vStructure;

        void main(void) {
          vec4 worldPosition = world * vec4(position, 1.0);
          float cameraDistance = distance(worldPosition.xyz, cameraPosition);
          float nearVisibility = smoothstep(nearFade * 0.22, nearFade, cameraDistance);
          float farVisibility = 1.0 - smoothstep(farFade * 0.72, farFade, cameraDistance);
          vVisibility = nearVisibility * farVisibility;
          vPointColor = color;
          vStructure = structure;
          gl_Position = worldViewProjection * vec4(position, 1.0);
          float footprint = mix(0.82, 2.85, smoothstep(0.0, 1.0, structure.x));
          float support = mix(0.86, 1.08, structure.y);
          gl_PointSize = pointSize * footprint * support;
        }
      `;
      B.Effect.ShadersStore[`${shaderName}FragmentShader`] = `
        precision highp float;
        uniform float opacity;
        varying float vVisibility;
        varying vec4 vPointColor;
        varying vec3 vStructure;

        void main(void) {
          vec2 centered = gl_PointCoord - vec2(0.5);
          float radius = length(centered);
          float softDisc = 1.0 - smoothstep(0.37, 0.5, radius);
          float core = 1.0 - smoothstep(0.18, 0.36, radius);
          float rim = max(0.0, softDisc - core);
          float supportOpacity = mix(0.38, 1.0, vStructure.y);
          float alpha = (core * 0.72 + rim) * vVisibility * opacity
            * supportOpacity * max(0.4, vPointColor.a);
          if (alpha < 0.012) discard;
          vec3 supportedColor = mix(vPointColor.rgb, vec3(0.16, 0.18, 0.20), 0.22);
          vec3 diagnosticColor = mix(
            supportedColor,
            vec3(0.88, 0.43, 0.20),
            smoothstep(0.48, 0.92, vStructure.z) * 0.82
          );
          vec3 finalColor = mix(diagnosticColor * 0.58, diagnosticColor, core);
          gl_FragColor = vec4(finalColor, alpha);
        }
      `;
      const material = new B.ShaderMaterial(
        "reaigen-gaussian-structure-material",
        scene,
        { vertex: shaderName, fragment: shaderName },
        {
          attributes: ["position", "color", "structure"],
          uniforms: [
            "world",
            "worldViewProjection",
            "cameraPosition",
            "pointSize",
            "nearFade",
            "farFade",
            "opacity",
          ],
          needAlphaBlending: true,
        },
      );
      material.pointsCloud = true;
      material.fillMode = B.Material.PointFillMode;
      material.backFaceCulling = false;
      material.alphaMode = B.Engine.ALPHA_COMBINE;
      const sceneRadius = fallbackSceneRef.current?.radius ?? 4;
      material.setFloat("pointSize", compactTouch ? 2.45 : 2.8);
      material.setFloat("nearFade", 0.6);
      material.setFloat("farFade", Math.max(5.5, Math.min(12, sceneRadius * 1.9)));
      material.setFloat("opacity", 0.72);
      mesh.material = material;
      mesh.alwaysSelectAsActiveMesh = true;
      mesh.renderingGroupId = 1;
      mesh.alphaIndex = 20;
      mesh.parent = root;
      const pointObserver = scene.onBeforeRenderObservable.add(() => {
        const camera = cameraRef.current;
        if (camera) material.setVector3("cameraPosition", camera.globalPosition ?? camera.position);
      });
      disposables.push(
        mesh,
        material,
        {
          dispose: () => scene.onBeforeRenderObservable.remove(pointObserver),
        },
      );
    }

    if (showRoomKitCage) {
      const cageMaterial = new B.StandardMaterial("reaigen-roomkit-material", scene);
      cageMaterial.disableLighting = true;
      cageMaterial.emissiveColor = new B.Color3(0.04, 0.74, 0.48);
      cageMaterial.alpha = 0.18;
      cageMaterial.backFaceCulling = false;
      disposables.push(cageMaterial);

      for (const wall of roomKitCage) {
        const mesh = B.MeshBuilder.CreateBox(
          `reaigen-roomkit-${wall.id}`,
          { width: wall.width, height: wall.height, depth: wall.thickness },
          scene,
        );
        mesh.position.set(wall.center[0], wall.center[1], wall.center[2]);
        mesh.rotation.y = wall.yaw;
        mesh.material = cageMaterial;
        mesh.enableEdgesRendering();
        mesh.edgesWidth = 1.5;
        mesh.edgesColor = new B.Color4(0.03, 0.82, 0.52, 0.88);
        mesh.parent = root;
        disposables.push(mesh);
      }
    }

    if (showSpatialGrid) {
      const frame = fallbackSceneRef.current;
      const camera = cameraRef.current;
      let centerX = frame?.center[0] ?? 0;
      let centerZ = frame?.center[2] ?? 0;
      let interiorGrid = false;

      if (frame && camera) {
        const currentCanonical = inversePresentationPoint(
          [camera.position.x, camera.position.y, camera.position.z],
          globalSceneTransformRef.current,
        );
        const target = camera.getTarget();
        const targetCanonical = inversePresentationPoint(
          [target.x, target.y, target.z],
          globalSceneTransformRef.current,
        );
        const width = frame.footprint.maxX - frame.footprint.minX;
        const depth = frame.footprint.maxZ - frame.footprint.minZ;
        const marginX = Math.max(0.15, width * 0.04);
        const marginZ = Math.max(0.15, depth * 0.04);
        interiorGrid = (
          currentCanonical[0] >= frame.footprint.minX - marginX
          && currentCanonical[0] <= frame.footprint.maxX + marginX
          && currentCanonical[2] >= frame.footprint.minZ - marginZ
          && currentCanonical[2] <= frame.footprint.maxZ + marginZ
        );
        if (interiorGrid) {
          centerX = Math.max(
            frame.footprint.minX,
            Math.min(frame.footprint.maxX, targetCanonical[0]),
          );
          centerZ = Math.max(
            frame.footprint.minZ,
            Math.min(frame.footprint.maxZ, targetCanonical[2]),
          );
        }
      }

      const canonicalGridRadius = interiorGrid
        ? Math.max(1.75, Math.min(2.8, (frame?.radius ?? 4) * 0.58))
        : Math.max(4, Math.min(10, (frame?.radius ?? 4) * 1.15));
      root.computeWorldMatrix(true);
      const transformedSceneAnchor = B.Vector3.TransformCoordinates(
        new B.Vector3(centerX, (frame?.floorY ?? 0), centerZ),
        root.getWorldMatrix(),
      );
      const scaledRadius = canonicalGridRadius * Math.max(
        0.001,
        Math.abs(globalSceneTransformRef.current.scale),
      );
      const gridRadius = Math.min(
        50,
        Math.max(
          4,
          scaledRadius,
          Math.abs(transformedSceneAnchor.x) + scaledRadius,
          Math.abs(transformedSceneAnchor.z) + scaledRadius,
        ),
      );
      const majorStep = gridRadius > 20 ? 5 : gridRadius > 7 ? 2 : 1;
      const minorStep = majorStep / 4;
      const halfSize = Math.ceil(gridRadius / majorStep) * majorStep;
      // Reaigen presentation space is explicitly Y-up. The working grid is a
      // DCC world reference, not object geometry. Its origin and floor must
      // never follow the selected asset's transform.
      centerX = 0;
      centerZ = 0;
      const floorY = 0.006;
      const minX = centerX - halfSize;
      const maxX = centerX + halfSize;
      const minZ = centerZ - halfSize;
      const maxZ = centerZ + halfSize;
      const textureSize = compactTouch ? 1024 : 2048;
      const gridTexture = new B.DynamicTexture(
        "reaigen-working-grid-texture",
        { width: textureSize, height: textureSize },
        scene,
        true,
        B.Texture.TRILINEAR_SAMPLINGMODE,
      );
      gridTexture.hasAlpha = true;
      gridTexture.wrapU = B.Texture.CLAMP_ADDRESSMODE;
      gridTexture.wrapV = B.Texture.CLAMP_ADDRESSMODE;
      gridTexture.anisotropicFilteringLevel = 16;

      const context = gridTexture.getContext();
      context.clearRect(0, 0, textureSize, textureSize);
      context.lineCap = "butt";

      const coordinateToPixel = (value: number, minimum: number) => (
        (value - minimum) / (halfSize * 2) * textureSize
      );
      const drawGridLine = (
        fromX: number,
        fromY: number,
        toX: number,
        toY: number,
        color: string,
        width: number,
      ) => {
        context.beginPath();
        context.moveTo(fromX, fromY);
        context.lineTo(toX, toY);
        context.strokeStyle = color;
        context.lineWidth = width;
        context.stroke();
      };
      const drawNeutralGridLine = (
        fromX: number,
        fromY: number,
        toX: number,
        toY: number,
        major: boolean,
      ) => {
        drawGridLine(
          fromX,
          fromY,
          toX,
          toY,
          major ? "rgba(48, 53, 61, 0.42)" : "rgba(67, 73, 82, 0.22)",
          major ? 1.35 : 0.72,
        );
      };
      const drawAxisLine = (
        fromX: number,
        fromY: number,
        toX: number,
        toY: number,
        color: string,
      ) => {
        drawGridLine(fromX, fromY, toX, toY, color, 1.65);
      };

      const firstX = Math.ceil(minX / minorStep) * minorStep;
      const firstZ = Math.ceil(minZ / minorStep) * minorStep;
      for (let x = firstX; x <= maxX + 1e-5; x += minorStep) {
        if (Math.abs(x) < minorStep * 0.15) continue;
        const major = Math.abs(x / majorStep - Math.round(x / majorStep)) < 1e-4;
        const pixel = coordinateToPixel(x, minX);
        drawNeutralGridLine(
          pixel,
          0,
          pixel,
          textureSize,
          major,
        );
      }
      for (let z = firstZ; z <= maxZ + 1e-5; z += minorStep) {
        if (Math.abs(z) < minorStep * 0.15) continue;
        const major = Math.abs(z / majorStep - Math.round(z / majorStep)) < 1e-4;
        const pixel = textureSize - coordinateToPixel(z, minZ);
        drawNeutralGridLine(
          0,
          pixel,
          textureSize,
          pixel,
          major,
        );
      }
      // One X/Z origin pair. The old grid drew these axes once as absolute
      // lines, again as an anchor crosshair, and a third time as line meshes.
      const anchorPixel = textureSize * 0.5;
      drawAxisLine(
        0,
        anchorPixel,
        textureSize,
        anchorPixel,
        "rgba(255, 46, 72, 0.72)",
      );
      drawAxisLine(
        anchorPixel,
        0,
        anchorPixel,
        textureSize,
        "rgba(30, 139, 255, 0.72)",
      );

      // Fade the working surface before its edge so the finite editor aid
      // never reads as a bright rectangular card in the Gaussian scene.
      context.globalCompositeOperation = "destination-in";
      const fade = context.createRadialGradient(
        textureSize * 0.5,
        textureSize * 0.5,
        textureSize * 0.18,
        textureSize * 0.5,
        textureSize * 0.5,
        textureSize * 0.56,
      );
      fade.addColorStop(0, "rgba(255, 255, 255, 1)");
      fade.addColorStop(0.62, "rgba(255, 255, 255, 0.82)");
      fade.addColorStop(1, "rgba(255, 255, 255, 0)");
      context.fillStyle = fade;
      context.fillRect(0, 0, textureSize, textureSize);
      context.globalCompositeOperation = "source-over";
      gridTexture.update(false);

      const gridShaderName = "reaigenWorkingGrid";
      B.Effect.ShadersStore[`${gridShaderName}VertexShader`] = `
        precision highp float;
        attribute vec3 position;
        attribute vec2 uv;
        uniform mat4 world;
        uniform mat4 worldViewProjection;
        varying vec2 vUV;
        varying vec3 vWorldPosition;

        void main(void) {
          vec4 worldPosition = world * vec4(position, 1.0);
          vWorldPosition = worldPosition.xyz;
          vUV = uv;
          gl_Position = worldViewProjection * vec4(position, 1.0);
        }
      `;
      B.Effect.ShadersStore[`${gridShaderName}FragmentShader`] = `
        precision highp float;
        uniform sampler2D gridTexture;
        uniform vec3 cameraPosition;
        uniform vec3 gridNormal;
        uniform float fadeStart;
        uniform float fadeEnd;
        uniform float opacity;
        varying vec2 vUV;
        varying vec3 vWorldPosition;

        void main(void) {
          vec4 grid = texture2D(gridTexture, vUV);
          vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
          float incidence = abs(dot(viewDirection, normalize(gridNormal)));
          float horizonFade = smoothstep(0.01, 0.08, incidence);
          float alpha = grid.a * horizonFade * opacity;
          if (alpha < 0.008) discard;
          gl_FragColor = vec4(grid.rgb, alpha);
        }
      `;
      const gridMaterial = new B.ShaderMaterial(
        "reaigen-working-grid-material",
        scene,
        { vertex: gridShaderName, fragment: gridShaderName },
        {
          attributes: ["position", "uv"],
          uniforms: [
            "world",
            "worldViewProjection",
            "cameraPosition",
            "gridNormal",
            "fadeStart",
            "fadeEnd",
            "opacity",
          ],
          samplers: ["gridTexture"],
          needAlphaBlending: true,
        },
      );
      gridMaterial.backFaceCulling = false;
      gridMaterial.alphaMode = B.Engine.ALPHA_COMBINE;
      gridMaterial.setTexture("gridTexture", gridTexture);
      gridMaterial.setFloat("fadeStart", Math.max(1.4, gridRadius * 0.58));
      gridMaterial.setFloat("fadeEnd", Math.max(3.2, gridRadius * 1.45));
      gridMaterial.setFloat("opacity", 1);

      const corners = [
        new B.Vector3(minX, floorY, minZ),
        new B.Vector3(maxX, floorY, minZ),
        new B.Vector3(maxX, floorY, maxZ),
        new B.Vector3(minX, floorY, maxZ),
      ];
      const gridNormal = new B.Vector3(0, 1, 0);
      gridMaterial.setVector3("gridNormal", gridNormal);
      const gridMesh = new B.Mesh("reaigen-working-grid", scene);
      const vertexData = new B.VertexData();
      vertexData.positions = corners.flatMap((corner: any) => [
        corner.x,
        corner.y,
        corner.z,
      ]);
      vertexData.indices = [0, 1, 2, 0, 2, 3];
      vertexData.uvs = [0, 1, 1, 1, 1, 0, 0, 0];
      vertexData.applyToMesh(gridMesh);
      gridMesh.material = gridMaterial;
      gridMesh.isPickable = false;
      // Babylon's Gaussian renderer does not write a conventional opaque
      // depth surface. Draw editor references after the splat, then control
      // their presence with the shader's distance, horizon and radial fades.
      gridMesh.renderingGroupId = 1;
      gridMesh.alphaIndex = 5;
      gridMesh.alwaysSelectAsActiveMesh = true;

      const gridObserver = scene.onBeforeRenderObservable.add(() => {
        const camera = cameraRef.current;
        if (camera) {
          gridMaterial.setVector3(
            "cameraPosition",
            camera.globalPosition ?? camera.position,
          );
        }
      });
      disposables.push(
        gridMesh,
        gridMaterial,
        gridTexture,
        {
          dispose: () => scene.onBeforeRenderObservable.remove(gridObserver),
        },
      );
    }

    if (showSpatialTrajectory) {
      const palette = [
        new B.Color3(0.10, 0.56, 0.95),
        new B.Color3(0.56, 0.35, 0.96),
        new B.Color3(0.04, 0.70, 0.52),
      ];
      spatialTrajectories.forEach((trajectory, trajectoryIndex) => {
        if (trajectory.samples.length < 2) return;
        const path = trajectory.samples.map(
          (camera) => new B.Vector3(camera.position[0], camera.position[1], camera.position[2]),
        );
        const min = path.reduce((value, point) => B.Vector3.Minimize(value, point), path[0].clone());
        const max = path.reduce((value, point) => B.Vector3.Maximize(value, point), path[0].clone());
        const markerLength = Math.max(0.05, Math.min(0.32, B.Vector3.Distance(min, max) * 0.018));
        const markerStep = Math.max(1, Math.ceil(trajectory.samples.length / 42));
        const line = B.MeshBuilder.CreateLines(
          `reaigen-camera-path-${trajectory.id}`,
          { points: path, updatable: false },
          scene,
        );
        line.color = palette[trajectoryIndex % palette.length];
        line.alpha = 0.88;
        line.parent = root;
        disposables.push(line);

        // Sparse direction ticks make the capture order and facing direction
        // readable without turning hundreds of source frames into a forest of
        // camera gizmos. Independent room paths remain independent line sets.
        const directionLines = trajectory.samples.flatMap((sample, sampleIndex) => {
          if (sampleIndex % markerStep !== 0 && sampleIndex !== trajectory.samples.length - 1) return [];
          const position = new B.Vector3(...sample.position);
          const forward = new B.Vector3(...sample.forward).normalize();
          return [[position, position.add(forward.scale(markerLength))]];
        });
        if (directionLines.length) {
          const directions = B.MeshBuilder.CreateLineSystem(
            `reaigen-camera-directions-${trajectory.id}`,
            { lines: directionLines },
            scene,
          );
          directions.color = palette[trajectoryIndex % palette.length];
          directions.alpha = 0.7;
          directions.parent = root;
          disposables.push(directions);
        }
      });

    }

    scene.render();
    return () => {
      gs.visibility = 1;
      disposables.reverse().forEach((item) => {
        try { item.dispose(); } catch { /* best effort */ }
      });
    };
  }, [
    onInspectionStats,
    compactTouch,
    ready,
    roomKitCage,
    showRoomKitCage,
    showSpatialGrid,
    showSpatialTrajectory,
    spatialNavigation,
    spatialTrajectories,
    spatialViewMode,
  ]);

  // The active camera marker changes continuously while scrubbing. Keep it
  // separate from the static cage/path effect so a slider gesture does not
  // rebuild every wall, line and inspection sample for each camera index.
  useEffect(() => {
    if (
      !ready ||
      !spatialNavigation ||
      !showSpatialTrajectory ||
      !selectedSpatialCamera
    ) return;
    const B = babylonRef.current;
    const scene = sceneRef.current;
    const root = spatialRootRef.current;
    if (!B || !scene || !root) return;

    const position = new B.Vector3(...selectedSpatialCamera.position);
    const forward = new B.Vector3(...selectedSpatialCamera.forward).normalize();
    const up = new B.Vector3(...selectedSpatialCamera.up).normalize();
    const right = B.Vector3.Cross(forward, up).normalize();
    const length = 0.34;
    const spread = length * Math.tan(Math.max(0.25, selectedSpatialCamera.fov) / 2);
    const target = position.add(forward.scale(length));
    const corners = [
      target.add(up.scale(spread)).add(right.scale(spread)),
      target.add(up.scale(spread)).subtract(right.scale(spread)),
      target.subtract(up.scale(spread)).subtract(right.scale(spread)),
      target.subtract(up.scale(spread)).add(right.scale(spread)),
    ];
    const frustum = B.MeshBuilder.CreateLineSystem(
      "reaigen-active-camera",
      {
        lines: [
          ...corners.map((corner) => [position, corner]),
          [corners[0], corners[1], corners[2], corners[3], corners[0]],
          [position, target],
        ],
      },
      scene,
    );
    frustum.color = new B.Color3(1, 0.47, 0.08);
    frustum.alpha = 1;
    frustum.parent = root;
    scene.render();
    return () => {
      try { frustum.dispose(); } catch { /* best effort */ }
    };
  }, [
    ready,
    selectedSpatialCamera,
    showSpatialTrajectory,
    spatialNavigation,
  ]);

  // ── Tour loading ───────────────────────────────────────────────────────────

  useEffect(() => {
    const resolvedTourUrl = tourUrl;
    if (!ready) return;
    const tourSource = resolvedTourUrl
      ? `tour:${resolvedTourUrl}`
      : camerasUrl
        ? `cameras:${camerasUrl}`
        : `splat-cameras:${splatId ?? "none"}`;

    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let usedSavedCameras = false;
    const commitTourData = (data: TourData) => {
      const preserveViewport = loadedTourSourceRef.current === tourSource;
      applyTourData(data, preserveViewport);
      loadedTourSourceRef.current = tourSource;
    };

    const tryLoadSavedCameras = async () => {
      // Use directly-provided camera data first (avoids data: URL / fetch issues)
      if (initialCameras) {
        if (!initialCameras.cameras?.length) return false;
        const savedTour = buildTourFromSavedCameras(initialCameras);
        if (!savedTour || cancelled) return false;
        usedSavedCameras = true;
        commitTourData(savedTour);
        return true;
      }
      const camUrl = camerasUrl ?? (splatId ? `/api/reaigen/splats/${splatId}/cameras/` : null);
      if (!camUrl) return false;
      try {
        const r = await fetch(camUrl);
        if (!r.ok) return false;
        const cameraData = (await r.json()) as CameraData;
        const savedTour = buildTourFromSavedCameras(cameraData);
        if (!savedTour || cancelled) return false;
        usedSavedCameras = true;
        commitTourData(savedTour);
        return true;
      } catch {
        return false;
      }
    };

    const tryLoad = () => {
      if (!resolvedTourUrl) {
        tryLoadSavedCameras().catch(() => {});
        return;
      }
      fetch(resolvedTourUrl)
        .then(r => r.ok ? r.json() : null)
        .then((data: TourData | null) => {
          if (cancelled) return;
          if (preferSavedCameras) {
            tryLoadSavedCameras().then((used) => {
              if (used || cancelled) return;
              if (!data?.positions?.length) {
                retryTimer = setTimeout(tryLoad, 6000);
                return;
              }
              if (!data.shots?.length) {
                const fallbackShots = buildFallbackShots(data, lang);
                if (!fallbackShots.length) {
                  retryTimer = setTimeout(tryLoad, 6000);
                  return;
                }
                data = { ...data, shots: fallbackShots };
              }
              commitTourData(data);
            }).catch(() => {});
            return;
          }
          if (!data?.positions?.length) {
            tryLoadSavedCameras().then((used) => {
              if (used || cancelled) return;
              retryTimer = setTimeout(tryLoad, 6000);
            }).catch(() => {
              if (!cancelled) retryTimer = setTimeout(tryLoad, 6000);
            });
            return;
          }
          if (!data.shots?.length) {
            const fallbackShots = buildFallbackShots(data, lang);
            if (!fallbackShots.length) {
              retryTimer = setTimeout(tryLoad, 6000);
              return;
            }
            data = { ...data, shots: fallbackShots };
          }

          commitTourData(data);
        })
        .catch(() => {
          if (usedSavedCameras || cancelled) return;
          tryLoadSavedCameras().then((used) => {
            if (used || cancelled) return;
            retryTimer = setTimeout(tryLoad, 6000);
          }).catch(() => {
            if (!cancelled) retryTimer = setTimeout(tryLoad, 6000);
          });
        });
    };

    tryLoad();
    return () => { cancelled = true; if (retryTimer) clearTimeout(retryTimer); };
  }, [ready, tourUrl, camerasUrl, initialCameras, splatId, preferSavedCameras, buildTourFromSavedCameras, applyTourData]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Spatial editor navigation ───────────────────────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current;
    const camera = cameraRef.current;
    const scene = sceneRef.current;
    const B = babylonRef.current;
    if (!spatialNavigation || !ready || !canvas || !camera || !scene || !B) return;

    animRef.current.active = false;
    animRef.current.holdActive = false;
    scrollVelocityRef.current = 0;
    freeModeRef.current = true;
    camera.detachControl();
    camera.cameraDirection.set(0, 0, 0);
    camera.cameraRotation.set(0, 0);
    if (!camera.rotationQuaternion) {
      const target = camera.getTarget();
      const forward = target.subtract(camera.position).normalize();
      const up = camera.upVector.clone().normalize();
      camera.rotationQuaternion = B.Quaternion.FromLookDirectionLH(forward, up);
    }
    canvas.focus({ preventScroll: true });

    if (spatialCameraMode === "orbit") {
      if (!spatialOrbitRef.current.enabled) {
        const target = camera.getTarget();
        const dx = camera.position.x - target.x;
        const dy = camera.position.y - target.y;
        const dz = camera.position.z - target.z;
        const radius = Math.max(0.25, Math.hypot(dx, dy, dz));
        spatialOrbitRef.current = {
          enabled: true,
          target: [target.x, target.y, target.z],
          radius,
          yaw: Math.atan2(dz, dx),
          pitch: Math.asin(Math.max(-1, Math.min(1, dy / radius))),
        };
      }
    } else {
      spatialOrbitRef.current.enabled = false;
    }

    type EditorPointer = {
      x: number;
      y: number;
      action: "orbit" | "pan" | "dolly";
    };
    const pointers = new Map<number, EditorPointer>();
    const pressed = new Set<string>();
    let previousPinchDistance: number | null = null;
    let previousCentroid: { x: number; y: number } | null = null;
    let touchPoints = new Map<number, { x: number; y: number }>();
    let previousTouchPinchDistance: number | null = null;
    let previousTouchCentroid: { x: number; y: number } | null = null;
    let touchCameraGesture = false;
    let flyYaw = 0;
    let flyPitch = 0;
    const nativeTouchNavigation = (
      compactTouch
      && splatSelectionTool === "none"
    );

    const syncFlyAngles = () => {
      const target = camera.getTarget();
      const forward = target.subtract(camera.position).normalize();
      flyYaw = Math.atan2(forward.z, forward.x);
      flyPitch = Math.asin(Math.max(-1, Math.min(1, forward.y)));
    };
    syncFlyAngles();

    const pointerValues = () => [...pointers.values()];
    const pointerCentroid = () => {
      const values = pointerValues();
      if (!values.length) return null;
      return {
        x: values.reduce((sum, value) => sum + value.x, 0) / values.length,
        y: values.reduce((sum, value) => sum + value.y, 0) / values.length,
      };
    };
    const pinchDistance = () => {
      const values = pointerValues();
      if (values.length < 2) return null;
      return Math.hypot(values[0].x - values[1].x, values[0].y - values[1].y);
    };
    const touchValues = () => [...touchPoints.values()];
    const touchCentroid = () => {
      const values = touchValues();
      if (!values.length) return null;
      return {
        x: values.reduce((sum, value) => sum + value.x, 0) / values.length,
        y: values.reduce((sum, value) => sum + value.y, 0) / values.length,
      };
    };
    const touchPinchDistance = () => {
      const values = touchValues();
      if (values.length < 2) return null;
      return Math.hypot(values[0].x - values[1].x, values[0].y - values[1].y);
    };
    const markMoving = () => {
      immersiveRenderBurstUntilRef.current = performance.now() + 350;
    };
    const applyFlyAngles = () => {
      const cosPitch = Math.cos(flyPitch);
      const forward: Vec3 = [
        Math.cos(flyYaw) * cosPitch,
        Math.sin(flyPitch),
        Math.sin(flyYaw) * cosPitch,
      ];
      // Fly navigation authors yaw and pitch only. Reassert Y-up on every
      // pointer update so a previous camera or quaternion cannot leak roll.
      const up: Vec3 = [0, 1, 0];
      camera.upVector.set(...up);
      camera.setTarget(camera.position.add(new B.Vector3(...forward)));
      // Babylon's setTarget recomposes the view matrix. Restore the reference
      // axis explicitly so repeated look/move events cannot accumulate bank.
      camera.upVector.set(...up);
      cameraUpRef.current = up;
      markMoving();
    };
    const interruptCameraAnimation = () => {
      if (animRef.current.active || animRef.current.holdActive) {
        animRef.current.active = false;
        animRef.current.holdActive = false;
        syncSpatialOrbitToCamera();
      }
    };
    const panOrbit = (dx: number, dy: number) => {
      const pose = spatialOrbitRef.current;
      const forward = new B.Vector3(
        pose.target[0] - camera.position.x,
        pose.target[1] - camera.position.y,
        pose.target[2] - camera.position.z,
      ).normalize();
      // Camera-plane pan: an orthonormal screen basis prevents the sideways
      // drift produced by a world-up cross product at oblique view angles.
      const authoredUp = camera.upVector?.clone?.() ?? B.Vector3.Up();
      const right = B.Vector3.Cross(authoredUp, forward).normalize();
      const up = B.Vector3.Cross(forward, right).normalize();
      const viewportHeight = Math.max(1, canvas.clientHeight);
      const scale = 2 * pose.radius * Math.tan(camera.fov * 0.5) / viewportHeight;
      // The rendered scene is mirrored horizontally relative to Babylon's
      // basis (same flip the rotation handlers compensate). Track with +dx so
      // the content follows the pointer on screen; with -dx a middle-drag
      // right pushed the room left while the vertical axis followed the
      // pointer, which read as panning on "some weird axis".
      const movement = right.scale(dx * scale).add(up.scale(dy * scale));
      pose.target = [
        pose.target[0] + movement.x,
        pose.target[1] + movement.y,
        pose.target[2] + movement.z,
      ];
      applySpatialOrbitPose();
    };
    const dollyOrbit = (amount: number) => {
      const pose = spatialOrbitRef.current;
      // The reference viewer sets lowerRadiusLimit 0.02 and leaves the upper
      // limit off entirely. This had 0.12 and a flat 250, so on any capture
      // bigger than a room the dolly stopped while the scene still filled the
      // frame, and the author could neither get close enough to inspect a
      // surface nor far enough to see the whole asset. The only ceiling that
      // means anything is the far plane — past it there is nothing to see.
      pose.radius = Math.max(
        ORBIT_MIN_RADIUS,
        Math.min(EDITOR_FAR_PLANE * 0.5, pose.radius * Math.exp(amount)),
      );
      applySpatialOrbitPose();
    };
    const moveFly = (amount: number) => {
      const target = camera.getTarget();
      const forward = target.subtract(camera.position).normalize();
      const up = camera.upVector.clone();
      const movement = forward.scale(amount);
      camera.position.addInPlace(movement);
      camera.upVector.copyFrom(up);
      camera.setTarget(target.add(movement));
      camera.upVector.copyFrom(up);
      markMoving();
    };
    const panFly = (dx: number, dy: number) => {
      const target = camera.getTarget();
      const forward = target.subtract(camera.position).normalize();
      const authoredUp = camera.upVector?.clone?.() ?? B.Vector3.Up();
      const right = B.Vector3.Cross(authoredUp, forward).normalize();
      const up = B.Vector3.Cross(forward, right).normalize();
      const sceneRadius = fallbackSceneRef.current?.radius ?? 2;
      const viewportHeight = Math.max(1, canvas.clientHeight);
      const scale = 2 * sceneRadius * Math.tan(camera.fov * 0.5) / viewportHeight;
      // Same +dx mirror compensation as panOrbit: content follows the pointer.
      const movement = right.scale(dx * scale).add(up.scale(dy * scale));
      camera.position.addInPlace(movement);
      camera.upVector.copyFrom(authoredUp);
      camera.setTarget(target.add(movement));
      camera.upVector.copyFrom(authoredUp);
      markMoving();
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (event.pointerType === "mouse" && ![0, 1, 2].includes(event.button)) return;
      // Phones use the native TouchEvent path below. It is not dependent on
      // pointer capture, which mobile Chromium/WebKit can transfer to a
      // Babylon gizmo and never return to the camera gesture.
      if (nativeTouchNavigation && event.pointerType === "touch") return;
      const gizmoManager = spatialGizmoManagerRef.current;
      if (gizmoManager?.isHovered || gizmoManager?.isDragging) return;
      interruptCameraAnimation();
      const action: EditorPointer["action"] = event.pointerType !== "mouse"
        ? ((event.pointerType === "pen" && (event.buttons & 2) !== 0) ? "pan" : "orbit")
        : event.button === 1
          ? "pan"
          : event.button === 2
            ? "dolly"
            : "orbit";
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, action });
      previousPinchDistance = pinchDistance();
      previousCentroid = pointerCentroid();
      syncFlyAngles();
      try { canvas.setPointerCapture(event.pointerId); } catch { /* best effort */ }
      canvas.style.cursor = action === "dolly" ? "ns-resize" : "grabbing";
      event.preventDefault();
    };

    const handlePointerMove = (event: PointerEvent) => {
      // Wake the otherwise idle authoring viewport before Babylon resolves
      // hover or drag state. This keeps gizmos and camera gestures immediate
      // without rendering a million-splat scene continuously at rest.
      markMoving();
      const previous = pointers.get(event.pointerId);
      if (!previous) return;
      pointers.set(event.pointerId, { ...previous, x: event.clientX, y: event.clientY });

      if (pointers.size >= 2) {
        const nextCentroid = pointerCentroid();
        const nextDistance = pinchDistance();
        if (spatialCameraMode === "orbit") {
          if (nextCentroid && previousCentroid) {
            panOrbit(nextCentroid.x - previousCentroid.x, nextCentroid.y - previousCentroid.y);
          }
          if (nextDistance && previousPinchDistance) {
            dollyOrbit(Math.log(previousPinchDistance / nextDistance));
          }
        } else {
          // Touch fly mode mirrors a DCC track/dolly gesture: two-finger drag
          // tracks in the camera plane, while pinch moves forward/backward.
          if (nextCentroid && previousCentroid) {
            panFly(nextCentroid.x - previousCentroid.x, nextCentroid.y - previousCentroid.y);
          }
          if (nextDistance && previousPinchDistance) {
            const sceneRadius = fallbackSceneRef.current?.radius ?? 2;
            const shortestSide = Math.max(240, Math.min(canvas.clientWidth, canvas.clientHeight));
            moveFly((nextDistance - previousPinchDistance) * sceneRadius * 1.6 / shortestSide);
          }
        }
        previousCentroid = nextCentroid;
        previousPinchDistance = nextDistance;
        event.preventDefault();
        return;
      }

      const dx = event.clientX - previous.x;
      const dy = event.clientY - previous.y;
      // A finger grabs the scene (it follows the drag), which is what touch
      // expects. A mouse drag steers the view instead: dragging left turns
      // the camera left. With the grab mapping on a mouse, a drag left swung
      // the heading right — the inversion reported as "I rotate left, it
      // goes right" — because inside a room the grab metaphor reads as the
      // room spinning, not as you turning.
      const steer = event.pointerType === "touch" ? -1 : 1;
      if (spatialCameraMode === "orbit") {
        if (previous.action === "pan") {
          panOrbit(dx, dy);
        } else if (previous.action === "dolly") {
          dollyOrbit(dy * 0.008);
        } else {
          const pose = spatialOrbitRef.current;
          pose.yaw += steer * dx * ORBIT_RADIANS_PER_PIXEL;
          pose.pitch = Math.max(
            -Math.PI * 0.485,
            Math.min(Math.PI * 0.485, pose.pitch + dy * ORBIT_RADIANS_PER_PIXEL),
          );
          applySpatialOrbitPose();
        }
      } else if (previous.action === "pan") {
        // Fly mode used to ignore the button and rotate on every drag, so a
        // middle-drag track — muscle memory from every DCC — spun the view.
        panFly(dx, dy);
      } else if (previous.action === "dolly") {
        const sceneRadius = fallbackSceneRef.current?.radius ?? 2;
        moveFly(-dy * sceneRadius * 0.004);
      } else {
        flyYaw += steer * dx * 0.0045;
        flyPitch = Math.max(-Math.PI * 0.485, Math.min(Math.PI * 0.485, flyPitch - dy * 0.0045));
        applyFlyAngles();
      }
      event.preventDefault();
    };

    const finishPointer = (event: PointerEvent) => {
      if (!pointers.has(event.pointerId)) return;
      pointers.delete(event.pointerId);
      previousPinchDistance = pinchDistance();
      previousCentroid = pointerCentroid();
      try { canvas.releasePointerCapture(event.pointerId); } catch { /* best effort */ }
      if (!pointers.size) canvas.style.cursor = spatialCameraMode === "orbit" ? "grab" : "crosshair";
      event.preventDefault();
    };

    const readTouches = (touches: TouchList) => {
      touchPoints = new Map(
        Array.from(touches).map((touch) => [
          touch.identifier,
          { x: touch.clientX, y: touch.clientY },
        ]),
      );
    };
    const resetTouchBaseline = (touches: TouchList) => {
      readTouches(touches);
      previousTouchCentroid = touchCentroid();
      previousTouchPinchDistance = touchPinchDistance();
    };
    const handleTouchStart = (event: TouchEvent) => {
      if (!nativeTouchNavigation) return;
      if (touchPoints.size === 0) {
        // Babylon receives the preceding pointerdown first. If it started a
        // transform drag, leave the full gesture to the gizmo; otherwise the
        // same touch belongs to camera navigation even while a transform tool
        // is selected.
        touchCameraGesture = !spatialGizmoManagerRef.current?.isDragging;
      }
      if (!touchCameraGesture) return;
      interruptCameraAnimation();
      syncFlyAngles();
      resetTouchBaseline(event.touches);
      event.preventDefault();
    };
    const handleTouchMove = (event: TouchEvent) => {
      if (!nativeTouchNavigation || !touchCameraGesture || event.touches.length < 1) return;
      if (spatialGizmoManagerRef.current?.isDragging) {
        touchCameraGesture = false;
        touchPoints.clear();
        return;
      }
      const priorPoints = touchPoints;
      readTouches(event.touches);

      if (touchPoints.size >= 2) {
        const nextCentroid = touchCentroid();
        const nextDistance = touchPinchDistance();
        if (spatialCameraMode === "orbit") {
          if (nextCentroid && previousTouchCentroid) {
            panOrbit(
              nextCentroid.x - previousTouchCentroid.x,
              nextCentroid.y - previousTouchCentroid.y,
            );
          }
          if (nextDistance && previousTouchPinchDistance) {
            dollyOrbit(Math.log(previousTouchPinchDistance / nextDistance));
          }
        } else {
          if (nextCentroid && previousTouchCentroid) {
            panFly(
              nextCentroid.x - previousTouchCentroid.x,
              nextCentroid.y - previousTouchCentroid.y,
            );
          }
          if (nextDistance && previousTouchPinchDistance) {
            const sceneRadius = fallbackSceneRef.current?.radius ?? 2;
            const shortestSide = Math.max(
              240,
              Math.min(canvas.clientWidth, canvas.clientHeight),
            );
            moveFly(
              (nextDistance - previousTouchPinchDistance)
              * sceneRadius
              * 1.6
              / shortestSide,
            );
          }
        }
        previousTouchCentroid = nextCentroid;
        previousTouchPinchDistance = nextDistance;
        event.preventDefault();
        return;
      }

      const touch = Array.from(event.touches)[0];
      const previous = priorPoints.get(touch.identifier);
      if (!previous) {
        resetTouchBaseline(event.touches);
        event.preventDefault();
        return;
      }
      const dx = touch.clientX - previous.x;
      const dy = touch.clientY - previous.y;
      if (spatialCameraMode === "orbit") {
        // Same rate as the pointer path above: a touch drag and a mouse drag of
        // the same distance must rotate the scene by the same amount, or the
        // editor feels like two different tools on a tablet with a trackpad.
        const pose = spatialOrbitRef.current;
        pose.yaw -= dx * ORBIT_RADIANS_PER_PIXEL;
        pose.pitch = Math.max(
          -Math.PI * 0.485,
          Math.min(Math.PI * 0.485, pose.pitch + dy * ORBIT_RADIANS_PER_PIXEL),
        );
        applySpatialOrbitPose();
      } else {
        flyYaw -= dx * 0.0045;
        flyPitch = Math.max(
          -Math.PI * 0.485,
          Math.min(Math.PI * 0.485, flyPitch - dy * 0.0045),
        );
        applyFlyAngles();
      }
      previousTouchCentroid = touchCentroid();
      previousTouchPinchDistance = null;
      event.preventDefault();
    };
    const handleTouchEnd = (event: TouchEvent) => {
      if (!nativeTouchNavigation || !touchCameraGesture) return;
      resetTouchBaseline(event.touches);
      if (event.touches.length === 0) touchCameraGesture = false;
      event.preventDefault();
    };

    const handleWheel = (event: WheelEvent) => {
      if (spatialGizmoManagerRef.current?.isDragging) return;
      interruptCameraAnimation();
      const deltaPixels = event.deltaY * (
        event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? 16
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? Math.max(1, canvas.clientHeight)
            : 1
      );
      const normalizedDelta = Math.max(-120, Math.min(120, deltaPixels));
      if (spatialCameraMode === "orbit") {
        dollyOrbit(normalizedDelta * 0.00135);
      } else {
        const scale = fallbackSceneRef.current?.radius ?? 2;
        moveFly(-normalizedDelta * scale * 0.0008);
      }
      event.preventDefault();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (cameraMovementTargetIsEditable(event.target)) return;
      const movementKey = cameraMovementKey(event);
      const key = movementKey ?? event.key.toLowerCase();
      if (key === "f") {
        event.preventDefault();
        frameScene();
        return;
      }
      if (key === "v") {
        event.preventDefault();
        onSpatialCameraModeChange?.(spatialCameraMode === "orbit" ? "fly" : "orbit");
        return;
      }
      if (movementKey) {
        interruptCameraAnimation();
        pressed.add(movementKey);
        // The spatial render loop sleeps at rest. Wake it in the key event so
        // the next animation frame advances the camera instead of waiting for
        // the editor's idle refresh.
        markMoving();
        event.preventDefault();
        return;
      }
      if (spatialCameraMode === "orbit") {
        const panStep = 24;
        if (event.key === "ArrowLeft") {
          interruptCameraAnimation();
          panOrbit(panStep, 0);
        } else if (event.key === "ArrowRight") {
          interruptCameraAnimation();
          panOrbit(-panStep, 0);
        } else if (event.key === "ArrowUp") {
          interruptCameraAnimation();
          panOrbit(0, panStep);
        } else if (event.key === "ArrowDown") {
          interruptCameraAnimation();
          panOrbit(0, -panStep);
        } else if (key === "+" || key === "=") {
          interruptCameraAnimation();
          dollyOrbit(-0.12);
        } else if (key === "-" || key === "_") {
          interruptCameraAnimation();
          dollyOrbit(0.12);
        } else return;
        event.preventDefault();
        return;
      }
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      const key = cameraMovementKey(event);
      if (key) pressed.delete(key);
    };
    const clearPressed = () => pressed.clear();
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") clearPressed();
    };
    const handleContextMenu = (event: MouseEvent) => event.preventDefault();

    const movementObserver = scene.onBeforeRenderObservable.add(() => {
      if (!pressed.size) return;
      const target = camera.getTarget();
      const forward = target.subtract(camera.position).normalize();
      const direction = cameraWalkDirection(
        [forward.x, forward.y, forward.z],
        [0, 1, 0],
        pressed,
      );
      const seconds = cameraMovementFrameSeconds(
        engineRef.current?.getDeltaTime?.() ?? Number.NaN,
      );
      const speed = Math.max(0.35, Math.min(4, (fallbackSceneRef.current?.radius ?? 2) * 0.75));
      if (Math.hypot(...direction) > 1e-6) {
        const movement = new B.Vector3(...direction).scaleInPlace(speed * seconds);
        if (spatialCameraMode === "orbit") {
          const pose = spatialOrbitRef.current;
          pose.target = [
            pose.target[0] + movement.x,
            pose.target[1] + movement.y,
            pose.target[2] + movement.z,
          ];
          applySpatialOrbitPose();
        } else {
          const up = camera.upVector.clone();
          camera.position.addInPlace(movement);
          camera.upVector.copyFrom(up);
          camera.setTarget(target.add(movement));
          camera.upVector.copyFrom(up);
          markMoving();
        }
      }
    });

    canvas.style.cursor = spatialCameraMode === "orbit" ? "grab" : "crosshair";
    canvas.addEventListener("pointerdown", handlePointerDown);
    canvas.addEventListener("pointermove", handlePointerMove);
    canvas.addEventListener("pointerup", finishPointer);
    canvas.addEventListener("pointercancel", finishPointer);
    canvas.addEventListener("lostpointercapture", finishPointer);
    canvas.addEventListener("touchstart", handleTouchStart, { passive: false });
    canvas.addEventListener("touchmove", handleTouchMove, { passive: false });
    canvas.addEventListener("touchend", handleTouchEnd, { passive: false });
    canvas.addEventListener("touchcancel", handleTouchEnd, { passive: false });
    canvas.addEventListener("wheel", handleWheel, { passive: false });
    canvas.addEventListener("contextmenu", handleContextMenu);
    // Capture keeps viewport navigation alive when an editor overlay owns
    // focus or stops bubbling. Editable text controls are still excluded.
    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("keyup", handleKeyUp, true);
    window.addEventListener("blur", clearPressed);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      pointers.clear();
      touchPoints.clear();
      pressed.clear();
      spatialOrbitRef.current.enabled = false;
      canvas.style.cursor = "";
      canvas.removeEventListener("pointerdown", handlePointerDown);
      canvas.removeEventListener("pointermove", handlePointerMove);
      canvas.removeEventListener("pointerup", finishPointer);
      canvas.removeEventListener("pointercancel", finishPointer);
      canvas.removeEventListener("lostpointercapture", finishPointer);
      canvas.removeEventListener("touchstart", handleTouchStart);
      canvas.removeEventListener("touchmove", handleTouchMove);
      canvas.removeEventListener("touchend", handleTouchEnd);
      canvas.removeEventListener("touchcancel", handleTouchEnd);
      canvas.removeEventListener("wheel", handleWheel);
      canvas.removeEventListener("contextmenu", handleContextMenu);
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("keyup", handleKeyUp, true);
      window.removeEventListener("blur", clearPressed);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      scene.onBeforeRenderObservable.remove(movementObserver);
      if (!immersiveControls) {
        // The normal tour viewer goes back to Babylon's native Euler
        // FreeCamera. Quaternion ownership is scoped to the detached spatial
        // editor so mouse pan/tilt cannot be stranded by editor orientation.
        if (camera.rotationQuaternion) {
          camera.rotation.copyFrom(camera.rotationQuaternion.toEulerAngles());
          camera.rotationQuaternion = null;
        }
        camera.attachControl(canvas, true);
      }
    };
  }, [
    applySpatialOrbitPose,
    compactTouch,
    frameScene,
    immersiveControls,
    onSpatialCameraModeChange,
    ready,
    spatialCameraMode,
    spatialNavigation,
    splatSelectionTool,
    syncSpatialOrbitToCamera,
  ]);

  useEffect(() => {
    if (!ready || !spatialNavigation || splatSelectionTool === "none") {
      setSelectionGesture(null);
      return;
    }
    const canvas = canvasRef.current;
    const scene = sceneRef.current;
    const root = spatialRootRef.current;
    const source = originalSplatDataRef.current;
    if (!canvas || !scene || !root || !source) return;

    type ActiveGesture = {
      pointerId: number;
      tool: Exclude<SplatSelectionTool, "none">;
      operation: SplatSelectionOperation;
      points: Array<{ x: number; y: number }>;
    };
    let active: ActiveGesture | null = null;
    const localPoint = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };
    const effectiveOperation = (event: PointerEvent): SplatSelectionOperation => {
      if (event.ctrlKey || event.metaKey) return "subtract";
      if (event.shiftKey) return "add";
      return splatSelectionOperation;
    };
    const updateGestureSurface = (gesture: ActiveGesture, pointer: { x: number; y: number }) => {
      setSelectionGesture({
        tool: gesture.tool,
        points: [...gesture.points],
        pointer,
      });
    };
    const applyGesture = (gesture: ActiveGesture) => {
      const alive = aliveSplatMaskRef.current;
      const selected = selectedSplatMaskRef.current;
      const currentSource = originalSplatDataRef.current;
      if (!alive || !selected || !currentSource || gesture.points.length < 1) return;
      if (gesture.operation === "replace") selected.fill(0);

      root.computeWorldMatrix(true);
      const matrix = root.getWorldMatrix().multiply(scene.getTransformMatrix());
      const m = matrix.m as ArrayLike<number>;
      const floats = new Float32Array(currentSource.buffer);
      const width = Math.max(1, canvas.clientWidth);
      const height = Math.max(1, canvas.clientHeight);
      const first = gesture.points[0];
      const last = gesture.points[gesture.points.length - 1];
      const minX = Math.min(first.x, last.x);
      const maxX = Math.max(first.x, last.x);
      const minY = Math.min(first.y, last.y);
      const maxY = Math.max(first.y, last.y);
      const polygon = gesture.tool === "lasso" && gesture.points.length > 2
        ? [...gesture.points, gesture.points[0]]
        : gesture.points;

      for (let index = 0; index < alive.length; index += 1) {
        if (!alive[index]) {
          selected[index] = 0;
          continue;
        }
        const offset = index * 8;
        const x = floats[offset];
        const y = floats[offset + 1];
        const z = floats[offset + 2];
        const clipX = x * m[0] + y * m[4] + z * m[8] + m[12];
        const clipY = x * m[1] + y * m[5] + z * m[9] + m[13];
        const clipZ = x * m[2] + y * m[6] + z * m[10] + m[14];
        const clipW = x * m[3] + y * m[7] + z * m[11] + m[15];
        if (!Number.isFinite(clipW) || clipW <= 1e-7) continue;
        const ndcZ = clipZ / clipW;
        if (ndcZ < -1 || ndcZ > 1) continue;
        const screenX = (clipX / clipW + 1) * width * 0.5;
        const screenY = (1 - clipY / clipW) * height * 0.5;
        let hit = false;
        if (gesture.tool === "box") {
          hit = screenX >= minX && screenX <= maxX && screenY >= minY && screenY <= maxY;
        } else if (gesture.tool === "lasso") {
          hit = polygon.length > 3 && pointInsidePolygon([screenX, screenY, 0], polygon);
        } else {
          hit = distanceToPolyline(screenX, screenY, gesture.points) <= splatBrushRadius;
        }
        if (!hit) continue;
        selected[index] = gesture.operation === "subtract" ? 0 : 1;
      }
      setSplatSelectionRevision((value) => value + 1);
      publishSplatSelectionStats();
      immersiveRenderBurstUntilRef.current = performance.now() + 500;
      scene.render();
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const point = localPoint(event);
      active = {
        pointerId: event.pointerId,
        tool: splatSelectionTool,
        operation: effectiveOperation(event),
        points: [point],
      };
      try { canvas.setPointerCapture(event.pointerId); } catch { /* best effort */ }
      updateGestureSurface(active, point);
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const handlePointerMove = (event: PointerEvent) => {
      if (!active || active.pointerId !== event.pointerId) return;
      const point = localPoint(event);
      if (active.tool === "box") {
        active.points = [active.points[0], point];
      } else {
        const previous = active.points[active.points.length - 1];
        if (Math.hypot(point.x - previous.x, point.y - previous.y) >= 2) {
          active.points.push(point);
        }
      }
      updateGestureSurface(active, point);
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const finishPointer = (event: PointerEvent) => {
      if (!active || active.pointerId !== event.pointerId) return;
      const completed = active;
      active = null;
      try { canvas.releasePointerCapture(event.pointerId); } catch { /* best effort */ }
      setSelectionGesture(null);
      applyGesture(completed);
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const blockContextMenu = (event: MouseEvent) => event.preventDefault();

    canvas.style.cursor = "crosshair";
    canvas.addEventListener("pointerdown", handlePointerDown, true);
    canvas.addEventListener("pointermove", handlePointerMove, true);
    canvas.addEventListener("pointerup", finishPointer, true);
    canvas.addEventListener("pointercancel", finishPointer, true);
    canvas.addEventListener("contextmenu", blockContextMenu);
    return () => {
      active = null;
      setSelectionGesture(null);
      canvas.style.cursor = "";
      canvas.removeEventListener("pointerdown", handlePointerDown, true);
      canvas.removeEventListener("pointermove", handlePointerMove, true);
      canvas.removeEventListener("pointerup", finishPointer, true);
      canvas.removeEventListener("pointercancel", finishPointer, true);
      canvas.removeEventListener("contextmenu", blockContextMenu);
    };
  }, [
    publishSplatSelectionStats,
    ready,
    spatialNavigation,
    splatBrushRadius,
    splatSelectionOperation,
    splatSelectionTool,
  ]);

  useEffect(() => {
    selectionOverlayRef.current?.dispose?.(false, true);
    selectionOverlayRef.current = null;
    if (!ready || !spatialNavigation) return;
    const B = babylonRef.current;
    const scene = sceneRef.current;
    const root = spatialRootRef.current;
    const source = originalSplatDataRef.current;
    const alive = aliveSplatMaskRef.current;
    const selected = selectedSplatMaskRef.current;
    if (!B || !scene || !root || !source || !alive || !selected) return;

    let selectedCount = 0;
    for (let index = 0; index < selected.length; index += 1) {
      if (alive[index] && selected[index]) selectedCount += 1;
    }
    if (!selectedCount) return;
    const sampleStep = Math.max(1, Math.ceil(selectedCount / 100_000));
    const positions: number[] = [];
    const floats = new Float32Array(source.buffer);
    let seen = 0;
    for (let index = 0; index < selected.length; index += 1) {
      if (!alive[index] || !selected[index]) continue;
      if (seen % sampleStep === 0) {
        const offset = index * 8;
        positions.push(floats[offset], floats[offset + 1], floats[offset + 2]);
      }
      seen += 1;
    }

    const mesh = new B.Mesh("reaigen-splat-selection", scene);
    mesh.setVerticesData(B.VertexBuffer.PositionKind, positions, false);
    mesh.setIndices(Array.from({ length: positions.length / 3 }, (_, index) => index));
    const material = new B.StandardMaterial("reaigen-splat-selection-material", scene);
    material.pointsCloud = true;
    material.pointSize = compactTouch ? 5 : 4;
    material.disableLighting = true;
    material.emissiveColor = new B.Color3(1, 0.39, 0.06);
    material.diffuseColor = material.emissiveColor;
    material.alpha = 0.96;
    material.disableDepthWrite = true;
    mesh.material = material;
    mesh.isPickable = false;
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.renderingGroupId = 3;
    mesh.parent = root;
    selectionOverlayRef.current = mesh;
    scene.render();
    return () => {
      if (selectionOverlayRef.current === mesh) selectionOverlayRef.current = null;
      mesh.dispose(false, true);
    };
  }, [
    compactTouch,
    ready,
    spatialNavigation,
    splatSelectionRevision,
  ]);

  // ── Keyboard navigation ────────────────────────────────────────────────────

  useEffect(() => {
    if (spatialNavigation || !ready) return;

    const scene = sceneRef.current;
    const camera = cameraRef.current;
    const B = babylonRef.current;
    if (!scene || !camera || !B) return;

    // The authenticated desktop viewer used Babylon's native FreeCamera
    // keyboard input before the August 2 regression. Keep that proven path
    // for desktop mouse/WASD, and reserve the explicit movement observer for
    // immersive/shared controls where Babylon is intentionally detached.
    const nativeDesktopControls = !immersiveControls;
    const pressed = new Set<string>();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (cameraMovementTargetIsEditable(event.target)) return;

      // Arrow keys navigate between shots
      if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        if (event.repeat) return;
        goToPrev();
        return;
      }
      if (event.key === "ArrowRight" || event.key === "ArrowDown") {
        event.preventDefault();
        event.stopPropagation();
        if (event.repeat) return;
        goToNext();
        return;
      }

      const key = cameraMovementKey(event);
      if (key) {
        event.preventDefault();
        event.stopPropagation();
        if (!freeModeRef.current) enableFreeCamera();
        if (nativeDesktopControls) return;
        pressed.add(key);
        // Wake an idle shared viewer before its next throttled render. The
        // movement observer then extends this burst on every rendered frame.
        immersiveRenderBurstUntilRef.current = performance.now() + 350;
        if (immersiveControls) {
          setImmersiveAdjusted(true);
          setShowGestureHint(false);
        }
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        enableFreeCamera();
      }
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      const key = cameraMovementKey(event);
      if (key) pressed.delete(key);
    };
    const clearPressed = () => pressed.clear();
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") clearPressed();
    };

    const movementObserver = scene.onBeforeRenderObservable.add(() => {
      if (!pressed.size) return;
      const target = camera.getTarget();
      const forward = normalizeVec3([
        target.x - camera.position.x,
        target.y - camera.position.y,
        target.z - camera.position.z,
      ]);
      const pose = immersivePoseRef.current;
      const up = normalizeVec3(
        immersiveControls && pose.enabled
          ? pose.baseUp
          : [camera.upVector.x, camera.upVector.y, camera.upVector.z],
        [0, 1, 0],
      );
      const direction = cameraWalkDirection(forward, up, pressed, pose.baseForward);
      if (Math.hypot(...direction) < 1e-6) return;
      const seconds = Math.min(
        0.05,
        engineRef.current?.getDeltaTime?.() / 1000 || 1 / 60,
      );
      const transformedRadius = (fallbackSceneRef.current?.radius ?? 2)
        * sceneScaleMagnitude(globalSceneScale3(globalSceneTransformRef.current));
      const speed = Math.max(0.35, Math.min(4, transformedRadius * 0.75));
      const step = speed * seconds;
      const delta: Vec3 = [direction[0] * step, direction[1] * step, direction[2] * step];

      animRef.current.active = false;
      animRef.current.holdActive = false;
      immersiveRenderBurstUntilRef.current = performance.now() + 350;
      if (immersiveControls && pose.enabled) {
        pose.walkOffset = [
          pose.walkOffset[0] + delta[0],
          pose.walkOffset[1] + delta[1],
          pose.walkOffset[2] + delta[2],
        ];
        applyImmersivePose();
        return;
      }

      const movementVector = new B.Vector3(...delta);
      const authoredUp = camera.upVector.clone();
      camera.position.addInPlace(movementVector);
      camera.upVector.copyFrom(authoredUp);
      camera.setTarget(target.add(movementVector));
      camera.upVector.copyFrom(authoredUp);
      cameraUpRef.current = [authoredUp.x, authoredUp.y, authoredUp.z];
    });

    // Babylon registered its native desktop keyboard listener before this
    // effect. Use the same bubbling lifecycle as the known-good July viewer;
    // immersive overlays retain capture because they own movement themselves.
    const keyboardCapture = !nativeDesktopControls;
    window.addEventListener("keydown", handleKeyDown, keyboardCapture);
    window.addEventListener("keyup", handleKeyUp, keyboardCapture);
    window.addEventListener("blur", clearPressed);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      pressed.clear();
      window.removeEventListener("keydown", handleKeyDown, keyboardCapture);
      window.removeEventListener("keyup", handleKeyUp, keyboardCapture);
      window.removeEventListener("blur", clearPressed);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      scene.onBeforeRenderObservable.remove(movementObserver);
    };
  }, [
    applyImmersivePose,
    enableFreeCamera,
    goToNext,
    goToPrev,
    immersiveControls,
    ready,
    spatialNavigation,
  ]);

  // ── Scroll navigation ─────────────────────────────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || spatialNavigation) return;
    const handleWheel = (e: WheelEvent) => {
      // In readOnly (shared tour), disable scroll navigation entirely
      // so guests can view without accidental scrolling
      if (readOnly) { e.preventDefault(); return; }
      if (!pathDataRef.current) return;
      // Only allow scroll scrubbing in free-camera / edit mode
      if (!freeModeRef.current) { e.preventDefault(); return; }
      e.preventDefault();
      scrollVelocityRef.current += e.deltaY * 0.003;
    };
    canvas.addEventListener("wheel", handleWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", handleWheel);
  }, [readOnly, spatialNavigation]);

  // ── Constrained immersive controls (shared + touch studio) ───────────────

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!immersiveControls || spatialNavigation || !ready || !canvas) return;

    cameraRef.current?.detachControl();

    const pointers = new Map<number, { x: number; y: number; pointerType: string }>();
    let lastPinchDistance: number | null = null;
    let lastCentroid: { x: number; y: number } | null = null;
    let pointerDownAt = 0;
    let pointerDownX = 0;
    let pointerDownY = 0;
    let gestureMoved = false;
    let lastTap: { at: number; x: number; y: number } | null = null;
    let lastMoveAt = 0;

    const distanceBetweenPointers = () => {
      const values = [...pointers.values()];
      if (values.length < 2) return null;
      return Math.hypot(values[0].x - values[1].x, values[0].y - values[1].y);
    };
    const pointerCentroid = () => {
      const values = [...pointers.values()];
      if (!values.length) return null;
      return {
        x: values.reduce((sum, pointer) => sum + pointer.x, 0) / values.length,
        y: values.reduce((sum, pointer) => sum + pointer.y, 0) / values.length,
      };
    };

    const markAdjusted = () => {
      setImmersiveAdjusted(true);
      setShowGestureHint(false);
      animRef.current.holdActive = false;
      immersiveRenderBurstUntilRef.current = performance.now() + 350;
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      if (!immersivePoseRef.current.enabled) return;
      // The navigation contract is deliberately one- or two-pointer. Ignore
      // extra contacts instead of letting their changing centroid kick the
      // camera when a palm or third finger touches the screen.
      if (!pointers.has(event.pointerId) && pointers.size >= 2) {
        event.preventDefault();
        return;
      }
      if (animRef.current.active) {
        const cam = cameraRef.current;
        if (cam) {
          const target = cam.getTarget();
          setImmersiveBase(
            [cam.position.x, cam.position.y, cam.position.z],
            [
              target.x - cam.position.x,
              target.y - cam.position.y,
              target.z - cam.position.z,
            ],
            cam.fov,
            [cam.upVector.x, cam.upVector.y, cam.upVector.z],
          );
        }
        animRef.current.active = false;
        animRef.current.holdActive = false;
      }
      immersiveCoastRef.current = { yaw: 0, pitch: 0 };
      immersivePointersActiveRef.current = true;
      if (pointers.size === 0) {
        pointerDownAt = performance.now();
        pointerDownX = event.clientX;
        pointerDownY = event.clientY;
        gestureMoved = false;
        lastMoveAt = performance.now();
      } else {
        gestureMoved = true;
      }
      pointers.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY,
        pointerType: event.pointerType,
      });
      lastPinchDistance = distanceBetweenPointers();
      lastCentroid = pointerCentroid();
      try { canvas.setPointerCapture(event.pointerId); } catch { /* best effort */ }
      event.preventDefault();
    };

    const handlePointerMove = (event: PointerEvent) => {
      const previous = pointers.get(event.pointerId);
      if (!previous) return;
      pointers.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY,
        pointerType: previous.pointerType,
      });
      if (animRef.current.active || !immersivePoseRef.current.enabled) return;

      const pose = immersivePoseRef.current;
      if (pointers.size >= 2) {
        immersiveCoastRef.current = { yaw: 0, pitch: 0 };
        const nextCentroid = pointerCentroid();
        const nextDistance = distanceBetweenPointers();
        const shortestSide = Math.max(240, Math.min(canvas.clientWidth, canvas.clientHeight));
        let adjusted = false;
        if (nextCentroid && lastCentroid) {
          const centroidDx = nextCentroid.x - lastCentroid.x;
          const centroidDy = nextCentroid.y - lastCentroid.y;
          const cam = cameraRef.current;
          if (cam && (Math.abs(centroidDx) > 0.01 || Math.abs(centroidDy) > 0.01)) {
            const target = cam.getTarget();
            const pan = cameraTouchPanDelta(
              [
                target.x - cam.position.x,
                target.y - cam.position.y,
                target.z - cam.position.z,
              ],
              [cam.upVector.x, cam.upVector.y, cam.upVector.z],
              centroidDx,
              centroidDy,
              pose.maxDolly * 1.35 / shortestSide,
            );
            pose.walkOffset = [
              pose.walkOffset[0] + pan[0],
              pose.walkOffset[1] + pan[1],
              pose.walkOffset[2] + pan[2],
            ];
            adjusted = true;
          }
        }
        if (nextDistance != null && lastPinchDistance != null) {
          const distanceDelta = nextDistance - lastPinchDistance;
          pose.dolly = Math.max(
            -pose.maxDolly * 0.6,
            Math.min(pose.maxDolly, pose.dolly + distanceDelta * pose.maxDolly * 1.7 / shortestSide),
          );
          if (Math.abs(distanceDelta) > 0.01) adjusted = true;
        }
        if (adjusted) {
          gestureMoved = true;
          markAdjusted();
        }
        lastCentroid = nextCentroid;
        lastPinchDistance = nextDistance;
      } else {
        const dx = event.clientX - previous.x;
        const dy = event.clientY - previous.y;
        const sensitivity = 0.004; // ≈ 0.23° per CSS pixel, matching iOS.
        const now = performance.now();
        const elapsedSeconds = Math.max(1 / 120, Math.min(0.08, (now - lastMoveAt) / 1000));
        // Same steer-vs-grab split as the spatial editor: a finger drags the
        // scene with it (phone tours), a mouse turns the camera the way it
        // moves, so desktop shot framing no longer looks right on a drag left.
        const steer = previous.pointerType === "touch" ? -1 : 1;
        pose.yawOffset += steer * dx * sensitivity;
        const pitchLimit = 85 * Math.PI / 180;
        pose.pitchOffset = Math.max(
          -pitchLimit,
          Math.min(pitchLimit, pose.pitchOffset - dy * sensitivity),
        );
        if (Math.hypot(event.clientX - pointerDownX, event.clientY - pointerDownY) > 5) {
          gestureMoved = true;
        }
        if (Math.abs(dx) > 0.1 || Math.abs(dy) > 0.1) markAdjusted();
        // Finger navigation is direct manipulation: the camera must stop on
        // release. Retain a small, bounded coast only for mouse/pen dragging.
        immersiveCoastRef.current = previous.pointerType === "touch"
          ? { yaw: 0, pitch: 0 }
          : {
              yaw: boundedAngularVelocity(steer * dx * sensitivity, elapsedSeconds),
              pitch: boundedAngularVelocity(-dy * sensitivity, elapsedSeconds),
            };
        lastCentroid = pointerCentroid();
        lastMoveAt = now;
      }

      applyImmersivePose();
      event.preventDefault();
    };

    const finishPointer = (event: PointerEvent, allowTap: boolean) => {
      const finishedPointer = pointers.get(event.pointerId);
      if (!finishedPointer) return;
      const wasOnlyPointer = pointers.size === 1 && pointers.has(event.pointerId);
      pointers.delete(event.pointerId);
      immersivePointersActiveRef.current = pointers.size > 0;
      lastPinchDistance = distanceBetweenPointers();
      lastCentroid = pointerCentroid();
      try { canvas.releasePointerCapture(event.pointerId); } catch { /* best effort */ }
      if (finishedPointer.pointerType === "touch" || !allowTap) {
        immersiveCoastRef.current = { yaw: 0, pitch: 0 };
      }

      const now = performance.now();
      const isTap = allowTap && wasOnlyPointer && !gestureMoved && now - pointerDownAt < 280;
      if (isTap) {
        const repeatedNearbyTap = lastTap
          && now - lastTap.at < 360
          && Math.hypot(event.clientX - lastTap.x, event.clientY - lastTap.y) < 36;
        if (repeatedNearbyTap) {
          resetImmersiveView();
          setShowGestureHint(false);
          lastTap = null;
        } else {
          lastTap = { at: now, x: event.clientX, y: event.clientY };
        }
      }
      if (!pointers.size) lastMoveAt = 0;
      if (event.cancelable) event.preventDefault();
    };

    const cancelAllPointers = () => {
      pointers.clear();
      lastPinchDistance = null;
      lastCentroid = null;
      lastMoveAt = 0;
      gestureMoved = false;
      immersivePointersActiveRef.current = false;
      immersiveCoastRef.current = { yaw: 0, pitch: 0 };
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") cancelAllPointers();
    };
    const handleContextMenu = (event: MouseEvent) => event.preventDefault();

    const handleWheel = (event: WheelEvent) => {
      const pose = immersivePoseRef.current;
      if (!pose.enabled || animRef.current.active) return;
      immersiveCoastRef.current = { yaw: 0, pitch: 0 };
      pose.dolly = Math.max(
        -pose.maxDolly * 0.6,
        Math.min(pose.maxDolly, pose.dolly - event.deltaY * 0.0015),
      );
      markAdjusted();
      applyImmersivePose();
      event.preventDefault();
    };

    const handlePointerUp = (event: PointerEvent) => finishPointer(event, true);
    const handlePointerCancel = (event: PointerEvent) => finishPointer(event, false);

    canvas.addEventListener("pointerdown", handlePointerDown, { passive: false });
    canvas.addEventListener("pointermove", handlePointerMove, { passive: false });
    canvas.addEventListener("pointerup", handlePointerUp, { passive: false });
    canvas.addEventListener("pointercancel", handlePointerCancel, { passive: false });
    canvas.addEventListener("lostpointercapture", handlePointerCancel, { passive: false });
    canvas.addEventListener("wheel", handleWheel, { passive: false });
    canvas.addEventListener("contextmenu", handleContextMenu);
    window.addEventListener("blur", cancelAllPointers);
    window.addEventListener("pagehide", cancelAllPointers);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelAllPointers();
      canvas.removeEventListener("pointerdown", handlePointerDown);
      canvas.removeEventListener("pointermove", handlePointerMove);
      canvas.removeEventListener("pointerup", handlePointerUp);
      canvas.removeEventListener("pointercancel", handlePointerCancel);
      canvas.removeEventListener("lostpointercapture", handlePointerCancel);
      canvas.removeEventListener("wheel", handleWheel);
      canvas.removeEventListener("contextmenu", handleContextMenu);
      window.removeEventListener("blur", cancelAllPointers);
      window.removeEventListener("pagehide", cancelAllPointers);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [
    applyImmersivePose,
    immersiveControls,
    ready,
    resetImmersiveView,
    setImmersiveBase,
    spatialNavigation,
  ]);

  useEffect(() => {
    if (!immersiveControls || spatialNavigation || !ready) {
      setShowGestureHint(false);
      return;
    }
    setShowGestureHint(true);
    const timer = window.setTimeout(() => setShowGestureHint(false), 4800);
    return () => window.clearTimeout(timer);
  }, [immersiveControls, ready, spatialNavigation, tourData]);

  useEffect(() => {
    if (!immersiveControls) return;
    const doc = document as Document & { webkitFullscreenElement?: Element | null };
    const target = (rootRef.current?.parentElement ?? rootRef.current) as (HTMLElement & {
      webkitRequestFullscreen?: () => Promise<void> | void;
    }) | null;
    setCanFullscreen(Boolean(target?.requestFullscreen || target?.webkitRequestFullscreen));

    const updateFullscreenState = () => {
      setIsFullscreen(Boolean(document.fullscreenElement ?? doc.webkitFullscreenElement));
    };
    document.addEventListener("fullscreenchange", updateFullscreenState);
    document.addEventListener("webkitfullscreenchange", updateFullscreenState);
    return () => {
      document.removeEventListener("fullscreenchange", updateFullscreenState);
      document.removeEventListener("webkitfullscreenchange", updateFullscreenState);
    };
  }, [immersiveControls]);

  // ── BabylonJS init ─────────────────────────────────────────────────────────

  useEffect(() => {
    let disposed = false;
    let layoutResizeObserver: ResizeObserver | null = null;
    let layoutResizePending = false;
    let lastCanvasCssWidth = 0;
    let lastCanvasCssHeight = 0;
    setReady(false);

    async function init() {
      if (!canvasRef.current) return;
      let viewerInitializing = true;
      try {
        setStatus(t("viewer.status.loadingEngine", lang));
        const BABYLON = await import("@babylonjs/core");
        if (!spinoffEligible) await import("@babylonjs/loaders");
        babylonRef.current = BABYLON;
        if (disposed) return;

        const canvas = canvasRef.current;
        // In the editor Babylon sits above the external Gaussian layer so its
        // grid, gizmos and selection stay visible, which only works if its own
        // backbuffer has an alpha channel. Without alpha: true a clearColor of
        // alpha 0 still composites opaque and hides the splats completely.
        const engine = new BABYLON.Engine(canvas, true, {
          antialias: true, powerPreference: "high-performance",
          preserveDrawingBuffer: false, stencil: false,
          alpha: true, premultipliedAlpha: false,
        });
        engineRef.current = engine;

        // Babylon's hardware scale is inverse resolution: 0.5 renders at 2×
        // CSS pixels. Keep one stable, pixel-budgeted backbuffer for loading,
        // camera travel and rest. Camera trajectories must never resize the
        // viewport or switch render profiles mid-flight.
        const resolveHardwareScale = () => {
          const dpr = typeof window !== "undefined"
            ? window.devicePixelRatio || 1
            : 1;
          const renderDpr = spinoffEligible
            ? spatialNavigationRef.current ? 1 : 0.125
            : viewerRenderDpr(
                dpr,
                canvas.clientWidth,
                canvas.clientHeight,
                compactTouch,
                spatialNavigationRef.current,
                performanceProfile,
              );
          canvas.dataset.renderDpr = renderDpr.toFixed(3);
          canvas.dataset.renderProfile = spinoffEligible
            ? "spinoff-camera-controller"
            : spatialNavigationRef.current
              ? "authoring"
              : `delivery-${performanceProfile}`;
          return 1 / renderDpr;
        };
        let activeHardwareScale = resolveHardwareScale();
        const applyHardwareScale = (next: number) => {
          if (Math.abs(activeHardwareScale - next) < 0.005) return false;
          activeHardwareScale = next;
          engine.setHardwareScalingLevel(next);
          return true;
        };
        engine.setHardwareScalingLevel(activeHardwareScale);
        // The engine is created before the DPR override. Force allocation of
        // the high-density backbuffer immediately; otherwise it can remain at
        // its initial CSS-pixel size until the first window resize.
        engine.resize(true);

        engine.onContextLostObservable.add(() => console.warn("[REAI] WebGL context lost"));
        engine.onContextRestoredObservable.add(() => {
          console.log("[REAI] WebGL context restored");
          sceneRef.current?.render();
        });

        const scene = new BABYLON.Scene(engine);
        // Reconstruction content, saved cameras, and the OpenUSD workspace are
        // canonical right-handed. Babylon defaults to a left-handed scene;
        // leaving that default active mirrors the photographic view and makes
        // the decoded Gaussian covariance basis disagree with the producer.
        scene.useRightHandedSystem = true;
        sceneRef.current = scene;
        // When an external engine draws the Gaussians, Babylon is only the
        // camera/gizmo layer above it and must clear fully transparent; the
        // backdrop then comes from the DOM behind both canvases. When Babylon
        // is drawing the splats itself it owns the backdrop directly. Either
        // way the colour is the same one — see SPLAT_BACKDROP for why it is not
        // the app's page white.
        scene.clearColor = new BABYLON.Color4(
          SPLAT_BACKDROP[0],
          SPLAT_BACKDROP[1],
          SPLAT_BACKDROP[2],
          spinoffEligible ? 0 : 1,
        );

        const camera = new BABYLON.FreeCamera("cam", BABYLON.Vector3.Zero(), scene);
        // Authoring gets the reference viewer's static wide range so the camera
        // can leave the capture without clipping it away. Delivery keeps the
        // tight pair, where the camera is held inside the reconstruction and a
        // narrow range is the better trade.
        camera.minZ = spatialNavigation ? EDITOR_NEAR_PLANE : 0.1;
        camera.maxZ = spatialNavigation ? EDITOR_FAR_PLANE : 100;
        camera.fov = 0.66;
        camera.inertia = 0.5;
        camera.speed = 0.3;
        camera.upVector = new BABYLON.Vector3(0, 1, 0);

        /*
          Hold the camera inside the reconstruction — when presenting it.

          A FreeCamera has no limits, so pulling back far enough leaves the
          captured volume and shows the splat cloud from outside — floaters,
          background gaussians, no room. Nothing coherent exists out there to
          render; a reconstruction is only defined where cameras looked. For a
          buyer walking a listing that is a dead end, so delivery keeps the box.

          Authoring is the opposite case. Placing a capture in the USD
          workspace, framing it whole, judging its footprint against another
          asset or setting up an exterior shot all require standing outside the
          volume and looking in. The box applied there too, so the editor could
          not leave the room it was editing — and it silently fought the
          editor's own Frame Selected, which orbits deliberately from beyond the
          bounds only to be pulled back to the wall on the next frame.

          Read through the ref rather than the captured prop: this observer
          outlives the render that installed it, and the mode can change under
          it without the scene being rebuilt.

          Applied here rather than in any one input path: keys, pointer drag,
          wheel, immersive and spatial modes all move this camera, and a limit
          that only some of them respect is not a limit. Inertia keeps writing
          position after the input stops, so the check has to run per frame.
        */
        const boundsObserver = scene.onBeforeRenderObservable.add(() => {
          if (spatialNavigationRef.current) return;
          const frame = fallbackSceneRef.current;
          if (!frame) return;
          const held = clampCameraPosition(camera.position, {
            footprint: frame.footprint,
            floorY: frame.floorY,
            ceilingY: frame.ceilingY,
            radius: frame.radius,
          });
          if (!held.clamped) return;
          camera.position.set(held.x, held.y, held.z);
          // Kill the momentum that carried it out, or inertia spends the next
          // frames pushing back into the wall and the view judders.
          camera.cameraDirection.setAll(0);
        });
        // No explicit removal: the observable belongs to the scene and is
        // released with it, and this scope has no disposer list of its own.
        void boundsObserver;

        // No tone mapping here. Adding ACES rolloff did remove the clipped
        // highlights (1.33% -> 0%) but flattened the image: contrast fell
        // 0.2177 -> 0.1751 and it read as *more* washed out, not less. Zero
        // clipped pixels was the wrong thing to optimise for -- the reference
        // render is high-contrast with deep blacks, not highlight-safe.

        if (!immersiveControls) camera.attachControl(canvas, true);
        /*
          This attachControl path only ever serves a desktop pointer: phones
          and read-only pages take the immersive controls branch instead. The
          sensibility used to be negated here so the drag carried the scene
          with it (grab style), but with a mouse that swings the heading the
          opposite way — "I rotate left, it goes right" — which made framing
          shots in the tour editor painful. Babylon's positive default steers:
          drag left, look left, matching the spatial editor's mouse mapping.
          Touch keeps grab style in the immersive branch.
        */
        camera.angularSensibility = Math.abs(camera.angularSensibility);
        // Restore the native FreeCamera bindings used by the known-good July
        // tour viewer. Spatial and immersive modes detach Babylon and keep
        // their dedicated transform-aware movement implementations.
        camera.keysUp = [87];       // W only
        camera.keysDown = [83];     // S only
        camera.keysLeft = [65];     // A only
        camera.keysRight = [68];    // D only
        camera.keysUpward = [69];   // E
        camera.keysDownward = [81]; // Q
        cameraRef.current = camera;
        camera.onViewMatrixChangedObservable.add(() => {
          if (!animRef.current.active) {
            immersiveRenderBurstUntilRef.current = performance.now() + 220;
          }
        });

        // VKGS-tier: no post-process pipeline. Engine-level antialias:true
        // provides clean splat silhouettes without colour transforms or blits.

        // Match Spinoff's accepted deterministic Mip profile. Babylon's
        // material expects variance, not the user-facing pixel sigma.
        const { GaussianSplattingMaterial } = BABYLON;
        const baseProfile = resolveSplatRenderProfile({}, renderTuning());
        GaussianSplattingMaterial.KernelSize = baseProfile.kernelSize;
        GaussianSplattingMaterial.Compensation = baseProfile.compensation;

        // Reduce per-frame work
        scene.skipPointerMovePicking = true;

        // ── Render loop ──
        let prevT = performance.now();
        scene.registerBeforeRender(() => {
          const now = performance.now();
          const dt = cameraMovementFrameSeconds(now - prevT);
          prevT = now;
          if (!spatialNavigationRef.current) {
            const up = cameraUpRef.current;
            camera.upVector.set(up[0], up[1], up[2]);
          }

          const anim = animRef.current;

          if (!anim.active) {
            if (immersiveControls && immersivePoseRef.current.enabled) {
              const coast = immersiveCoastRef.current;
              if (!immersivePointersActiveRef.current) {
                const pose = immersivePoseRef.current;
                if (Math.abs(coast.yaw) >= 0.04 || Math.abs(coast.pitch) >= 0.04) {
                  pose.yawOffset += coast.yaw * dt;
                  const pitchLimit = 85 * Math.PI / 180;
                  pose.pitchOffset = Math.max(
                    -pitchLimit,
                    Math.min(pitchLimit, pose.pitchOffset + coast.pitch * dt),
                  );
                  const damping = Math.exp(-5 * dt);
                  coast.yaw *= damping;
                  coast.pitch *= damping;
                } else {
                  coast.yaw = 0;
                  coast.pitch = 0;
                }
              }
              applyImmersivePose();
              return;
            }

            // Hold phase
            if (anim.holdActive && anim.holdElapsed < anim.holdDuration) {
              anim.holdElapsed = Math.min(anim.holdElapsed + dt, anim.holdDuration);
              const ht = anim.holdElapsed / anim.holdDuration;
              const sh = ht * ht * (3 - 2 * ht);
              const panAngle = anim.holdAngle + anim.holdPanAmt * sh;
              const tiltDeg = 5 + sh * 2;
              const tiltY = LOOK * Math.tan(tiltDeg * Math.PI / 180);
              const fov = anim.holdBaseFov - sh * 0.02;
              const [hx, hy, hz] = anim.holdPos;
              camera.position.set(hx, hy, hz);
              camera.setTarget(new BABYLON.Vector3(
                hx + Math.cos(panAngle) * LOOK,
                hy - tiltY,
                hz + Math.sin(panAngle) * LOOK,
              ));
              camera.fov = fov;
              if (anim.holdElapsed >= anim.holdDuration) {
                anim.holdActive = false;
                if (
                  cameraNavigationShouldRestorePointerControls(
                    immersiveControls,
                    spatialNavigationRef.current,
                  )
                  && canvasRef.current
                ) {
                  freeModeRef.current = true;
                  camera.attachControl(canvasRef.current, true);
                }
              }
              return;
            }

            // Scroll-driven Steadicam
            if (Math.abs(scrollVelocityRef.current) > 0.001) {
              const pd = pathDataRef.current;
              if (pd) {
                progressRef.current += scrollVelocityRef.current * dt;
                scrollVelocityRef.current *= 0.95;
                progressRef.current = Math.max(0, Math.min(pd.totalArc, progressRef.current));
                if (progressRef.current >= pd.totalArc || progressRef.current <= 0) {
                  scrollVelocityRef.current = 0;
                }
                const d = progressRef.current;
                let lo = 0, hi = pd.arcLens.length - 1;
                while (lo < hi - 1) {
                  const mid = (lo + hi) >> 1;
                  if (pd.arcLens[mid] <= d) lo = mid; else hi = mid;
                }
                const segLen = pd.arcLens[hi] - pd.arcLens[lo];
                const t = segLen > 0 ? (d - pd.arcLens[lo]) / segLen : 0;
                const px = pd.positions[lo][0] + (pd.positions[hi][0] - pd.positions[lo][0]) * t;
                const py = pd.positions[lo][1] + (pd.positions[hi][1] - pd.positions[lo][1]) * t;
                const pz = pd.positions[lo][2] + (pd.positions[hi][2] - pd.positions[lo][2]) * t;
                const fx = pd.forwards[lo][0] + (pd.forwards[hi][0] - pd.forwards[lo][0]) * t;
                const fy = pd.forwards[lo][1] + (pd.forwards[hi][1] - pd.forwards[lo][1]) * t;
                const fz = pd.forwards[lo][2] + (pd.forwards[hi][2] - pd.forwards[lo][2]) * t;
                const fLength = Math.hypot(fx, fy, fz) || 1;
                const ux = pd.ups[lo][0] + (pd.ups[hi][0] - pd.ups[lo][0]) * t;
                const uy = pd.ups[lo][1] + (pd.ups[hi][1] - pd.ups[lo][1]) * t;
                const uz = pd.ups[lo][2] + (pd.ups[hi][2] - pd.ups[lo][2]) * t;
                const upLength = Math.hypot(ux, uy, uz) || 1;
                cameraUpRef.current = [ux / upLength, uy / upLength, uz / upLength];
                camera.upVector.set(
                  cameraUpRef.current[0],
                  cameraUpRef.current[1],
                  cameraUpRef.current[2],
                );
                camera.position.set(px, py, pz);
                camera.setTarget(new BABYLON.Vector3(
                  px + (fx / fLength) * LOOK,
                  py + (fy / fLength) * LOOK,
                  pz + (fz / fLength) * LOOK,
                ));
              }
              return;
            }
            return;
          }

          // Travel animation
          anim.elapsed = Math.min(anim.elapsed + dt, anim.duration);
          const rawT = anim.elapsed / anim.duration;
          const et = quintic(rawT);
          // Keep position, orientation and FOV on one timing curve. A leading
          // rotation felt like the trajectory briefly changed direction.
          const previewPose = stableCameraPreviewPose(
            anim.fromPos,
            anim.toPos,
            anim.fromForward,
            anim.toForward,
            anim.fromUp,
            anim.toUp,
            et,
          );
          const [px, py, pz] = previewPose.position;
          camera.position.set(px, py, pz);
          cameraUpRef.current = previewPose.up;
          camera.upVector.set(
            cameraUpRef.current[0],
            cameraUpRef.current[1],
            cameraUpRef.current[2],
          );
          camera.setTarget(new BABYLON.Vector3(
            px + previewPose.forward[0] * LOOK,
            py + previewPose.forward[1] * LOOK,
            pz + previewPose.forward[2] * LOOK,
          ));
          camera.upVector.set(...previewPose.up);
          camera.fov = anim.fromFov + (anim.toFov - anim.fromFov) * et;

          if (anim.elapsed >= anim.duration) {
            // Finish on the exact authored values. Preview interpolation must
            // never mutate or approximate the camera that will be edited or
            // delivered after the flight.
            const finalForward = normalizeVec3(anim.toForward);
            const finalUp = stableCameraReferenceUp(anim.toUp, anim.fromUp);
            camera.position.set(...anim.toPos);
            cameraUpRef.current = finalUp;
            camera.upVector.set(...finalUp);
            camera.setTarget(new BABYLON.Vector3(
              anim.toPos[0] + finalForward[0] * LOOK,
              anim.toPos[1] + finalForward[1] * LOOK,
              anim.toPos[2] + finalForward[2] * LOOK,
            ));
            camera.upVector.set(...finalUp);
            camera.fov = anim.toFov;
            anim.active = false;
            if ((anim as any).editorNav) {
              (anim as any).editorNav = false;
              if (
                cameraNavigationShouldRestorePointerControls(
                  immersiveControls,
                  spatialNavigationRef.current,
                )
                && canvasRef.current
              ) {
                camera.attachControl(canvasRef.current, true);
              }
              syncSpatialOrbitToCamera();
            } else if (!readOnly && !(anim as any).exactForward && !anim.holdActive && anim.holdDuration > 0) {
              anim.holdActive = true;
              anim.holdElapsed = 0;
              anim.holdPos = [anim.toPos[0], anim.toPos[1], anim.toPos[2]];
            } else if (
              cameraNavigationShouldRestorePointerControls(
                immersiveControls,
                spatialNavigationRef.current,
              )
              && canvasRef.current
            ) {
              // Saved-camera tours intentionally skip the cinematic hold. The
              // old completion branch also skipped reattaching desktop input,
              // leaving mouse look dead after arrow/camera navigation.
              freeModeRef.current = true;
              camera.attachControl(canvasRef.current, true);
            }
          }
        });

        // Gaussian rendering is expensive even when the camera is perfectly
        // still. Keep motion continuous, cap balanced public delivery at
        // 60 fps on high-refresh panels, and refresh an idle immersive viewer
        // only occasionally so HTML overlays retain main-thread headroom.
        let lastIdleRenderAt = 0;
        let lastMotionRenderAt: number | null = null;
        const renderLoop = () => {
          const coast = immersiveCoastRef.current;
          const now = performance.now();
          if (
            layoutResizePending
            && !animRef.current.active
            && !immersivePointersActiveRef.current
          ) {
            layoutResizePending = false;
            resizeRef.current?.();
          }
          const moving = cameraRenderIsActive({
            viewerInitializing,
            immersiveControls,
            spatialNavigation: spatialNavigationRef.current,
            animationActive: animRef.current.active,
            pointersActive: immersivePointersActiveRef.current,
            renderBurstActive: now < immersiveRenderBurstUntilRef.current,
            coastYaw: coast.yaw,
            coastPitch: coast.pitch,
          });
          if (moving) {
            const nextMotionTimestamp = nextViewerMotionFrameTimestamp(
              lastMotionRenderAt,
              now,
              performanceProfile,
            );
            if (nextMotionTimestamp == null) return;
            lastMotionRenderAt = nextMotionTimestamp;
          } else {
            if (now - lastIdleRenderAt < 500) return;
            lastIdleRenderAt = now;
          }
          scene.render();
        };
        renderLoopRef.current = renderLoop;
        engine.runRenderLoop(renderLoop);
        resizeRef.current = () => {
          const cssWidth = Math.max(1, Math.round(canvas.clientWidth));
          const cssHeight = Math.max(1, Math.round(canvas.clientHeight));
          const scaleChanged = applyHardwareScale(resolveHardwareScale());
          if (
            !scaleChanged
            && cssWidth === lastCanvasCssWidth
            && cssHeight === lastCanvasCssHeight
          ) {
            return;
          }
          lastCanvasCssWidth = cssWidth;
          lastCanvasCssHeight = cssHeight;
          engine.resize(true);
          canvas.dataset.renderSize =
            `${engine.getRenderWidth()}x${engine.getRenderHeight()}`;
          immersiveRenderBurstUntilRef.current = performance.now() + 350;
        };
        window.addEventListener("resize", resizeRef.current);
        // Editor drawers and responsive controls can resize the viewport
        // without emitting a window resize. Keep the physical backbuffer
        // matched to the canvas, but never resize it in a second animation
        // frame while a camera trajectory is running.
        if (typeof ResizeObserver !== "undefined") {
          layoutResizeObserver = new ResizeObserver(() => {
            if (!disposed) layoutResizePending = true;
          });
          layoutResizeObserver.observe(canvas);
        }
        resizeRef.current();

        // ── Place camera from COLMAP data ──
        async function placeCamera() {
          const fallback = fallbackSceneRef.current;
          // An authored workspace opens in a neutral editor frame. Captured
          // cameras are shots, not viewport state, and are entered explicitly
          // from the camera panel.
          if (fallback && spatialNavigationRef.current) {
            const framed = editorFramePose(
              fallback,
              globalSceneTransformRef.current,
            );
            camera.position.set(...framed.position);
            camera.upVector.set(0, 1, 0);
            cameraUpRef.current = [0, 1, 0];
            camera.setTarget(new BABYLON.Vector3(...framed.target));
            camera.rotation.z = 0;
            camera.fov = 60 * Math.PI / 180;
            setCameraDepthRange(
              camera,
              spatialNavigation,
              Math.max(0.02, framed.radius / 500),
              Math.max(100, framed.radius * 40),
            );
            spatialOrbitRef.current = {
              enabled: true,
              target: framed.target,
              radius: framed.radius,
              yaw: framed.yaw,
              pitch: framed.pitch,
            };
            return;
          }
          try {
            let d: CameraData | null = null;
            const assetSplatId = extractSplatIdFromAssetUrl(splatUrl);
            // Use directly-provided camera data first
            if (initialCameras) {
              d = initialCameras;
            } else {
              const camUrl = camerasUrl ?? (splatId ? `/api/reaigen/splats/${splatId}/cameras/` : null);
              if (camUrl) {
                const r = await fetch(camUrl);
                if (r.ok) d = await r.json() as CameraData;
              }
            }
            if (!d) throw new Error("No camera data available");
            d = normalizeCameraData(d);
            const cams = d.cameras ?? [];
            if (cams.length > 0) {
              const c = cams[0];
              const fx = Number(c.forward?.[0] ?? 0);
              const fy = Number(c.forward?.[1] ?? 0);
              const fz = Number(c.forward?.[2] ?? 1);
              const fl = Math.hypot(fx, fy, fz) || 1;
              const nx = fx / fl, ny = fy / fl, nz = fz / fl;
              // Captured and edited cameras are authoritative viewpoints. Do
              // not offset them: look-through must reproduce the stored pose.
              const canonicalPosition: Vec3 = [
                c.position[0],
                c.position[1],
                c.position[2],
              ];
              const canonicalForward: Vec3 = [nx, ny, nz];
              const canonicalUp = normalizeVec3(
                (c.up ?? [0, 1, 0]) as Vec3,
                [0, 1, 0],
              );
              const editorTransform = globalSceneTransformRef.current;
              // Geometry and every authored camera share canonical scene
              // space. Initialize both tour and editor cameras in presentation
              // space so horizon stabilization never compares unlike axes.
              const worldPosition = transformCanonicalPoint(
                canonicalPosition,
                editorTransform,
              );
              const worldForward = transformCanonicalDirection(
                canonicalForward,
                editorTransform,
              );
              const worldUp = transformCanonicalDirection(
                canonicalUp,
                editorTransform,
              );
              const allowCameraPose =
                !assetSplatId || !splatId || assetSplatId === splatId || !!initialCameras?.cameras?.length;
              if (allowCameraPose && shouldUseCameraPose(canonicalPosition, fallback)) {
                camera.position.set(...worldPosition);
                camera.upVector.set(...worldUp);
                cameraUpRef.current = worldUp;
                camera.setTarget(new BABYLON.Vector3(
                  worldPosition[0] + worldForward[0] * LOOK,
                  worldPosition[1] + worldForward[1] * LOOK,
                  worldPosition[2] + worldForward[2] * LOOK,
                ));
                camera.fov = d.sceneFov
                  ? cameraFovRadians(d.sceneFov, camera.fov)
                  : cameraFovRadians(c.fov ?? d.fovY, camera.fov);
                return;
              }
              console.warn("[REAI] Ignoring outlier camera pose; using scene-bounds fallback");
            }
          } catch { /* best-effort */ }

          if (fallback) {
            const overview = fallbackOverviewCamera(fallback);
            const worldPosition = transformCanonicalPoint(
              overview.position,
              globalSceneTransformRef.current,
            );
            const worldTarget = transformCanonicalPoint(
              overview.target,
              globalSceneTransformRef.current,
            );
            const [px, py, pz] = worldPosition;
            const [tx, ty, tz] = worldTarget;
            camera.position.set(px, py, pz);
            camera.upVector.set(0, 1, 0);
            cameraUpRef.current = [0, 1, 0];
            camera.setTarget(new BABYLON.Vector3(tx, ty, tz));
            camera.rotation.z = 0;
            camera.fov = overview.fov;
            setCameraDepthRange(
              camera,
              spatialNavigation,
              Math.max(0.05, fallback.radius / 250),
              Math.max(80, fallback.radius * 30),
            );
          }
        }

        // ── Load Gaussian Splatting mesh ──
        const { GaussianSplattingMesh } = BABYLON;
        let gs: any = null;
        const primaryRoot = new BABYLON.TransformNode(
          "reaigen-spatial-root",
          scene,
        );
        applyGaussianRootTransform(
          BABYLON,
          primaryRoot,
          globalSceneTransformRef.current,
        );
        spatialRootRef.current = primaryRoot;
        const createPrimaryGaussian = () => {
          const mesh = new GaussianSplattingMesh("splat", null, scene);
          mesh.viewUpdateThreshold = viewerSortUpdateThreshold(
            spatialNavigationRef.current,
            performanceProfile,
          );
          mesh.visibility = 0;
          mesh.alwaysSelectAsActiveMesh = true;
          mesh.parent = primaryRoot;
          return mesh;
        };
        const publishSceneFrame = (frame: SceneFrame | null) => {
          // The exporter's camera is deliberately NOT used here. A SOG's
          // viewer block describes an exterior orbit -- for the living-room
          // capture that prompted this it sits at y 3.79 above a ceiling at
          // 1.82, a dollhouse view. These are interior scans and the viewer
          // belongs inside the room at eye height, which is what the derived
          // framing below produces.
          if (!frame) return;
          fallbackSceneRef.current = frame;
          const resolvedTransform = onSceneFrameRef.current?.(frame);
          if (!resolvedTransform) return;
          globalSceneTransformRef.current = resolvedTransform;
          applyGaussianRootTransform(
            BABYLON,
            primaryRoot,
            resolvedTransform,
          );
        };
        const initializeSplatEditing = (
          data: ArrayBuffer,
          sh?: Uint8Array[],
          shDegree = 0,
        ): PackedSplatData => {
          const count = Math.floor(data.byteLength / 32);
          const source = {
            buffer: data,
            sh: sh?.length ? sh : undefined,
            shDegree,
          };
          const savedAlive = decodeSplatPruneMask(initialPruneMask, count);
          if (readOnly) {
            // Public playback never edits points. Avoid retaining the source
            // twice and allocating three million-entry masks solely to render
            // an already-frozen tour delivery.
            originalSplatDataRef.current = null;
            aliveSplatMaskRef.current = null;
            savedSplatMaskRef.current = null;
            selectedSplatMaskRef.current = null;
            splatPruneHistoryRef.current = [];
            return savedAlive ? filterPackedSplats(source, savedAlive) : source;
          }
          originalSplatDataRef.current = source;
          aliveSplatMaskRef.current = savedAlive ?? new Uint8Array(count).fill(1);
          savedSplatMaskRef.current = aliveSplatMaskRef.current.slice();
          selectedSplatMaskRef.current = new Uint8Array(count);
          splatPruneHistoryRef.current = [];
          setSplatSelectionRevision((value) => value + 1);
          const remaining = countMask(aliveSplatMaskRef.current);
          onSplatSelectionChangeRef.current?.({
            total: count,
            selected: 0,
            remaining,
            pruned: count - remaining,
            dirty: false,
          });
          return remaining === count
            ? source
            : filterPackedSplats(source, aliveSplatMaskRef.current);
        };

        const isSogUrl = splatUrl.split("?")[0].toLowerCase().endsWith(".sog");
        const isSpzUrl = splatUrl.split("?")[0].toLowerCase().endsWith(".spz");

        // NOTE: the editor takes this path too, and that costs it the selection
        // tools. Nothing here unzips the archive, so originalSplatDataRef and
        // the masks beside it are never populated — and those are exactly what
        // box, lasso and brush select against, what pruning marks, and what a
        // save writes back. The selection effect requires that data and returns
        // early without it, so on a stored SOG the tools install no pointer
        // handlers and appear to do nothing.
        //
        // Forcing the editor down the download-and-decode path below does fix
        // that, and must not be done: the whole archive then comes through
        // /api/sog, which measured 82s for tour 47's asset against a few
        // hundred milliseconds of range requests here. Trading a working editor
        // for one that takes a minute and a half to open is not a trade.
        //
        // The editable data has to be produced without a second full download —
        // either from the Gaussian mesh the renderer has already decoded, or by
        // fetching it lazily when a selection tool is first used rather than on
        // open.
        if (spinoffEligible && isSogUrl) {
          // A stored SOG can go to Spinoff by URL: it then fetches only the
          // public property planes it renders. Downloading the complete archive
          // instead also pulls the private exact/editor tensors (about 65 MB for
          // room 10122), unzips and rebuilds the file before the renderer can
          // start, and Firefox can terminate that large cross-origin response
          // with a generic NetworkError. So the range path stays the fast path —
          // but only for archives that are actually range-readable. Deflated
          // ones fall through to be repackaged stored below, which keeps Spinoff
          // as the renderer and leaves appearance unchanged.
          setStatus(t("viewer.status.processing", lang));
          const probe = await probeStoredSog(splatUrl);
          if (disposed) return;
          if (probe.stored) {
            spinoffSourceRef.current = splatUrl;
            splatBufferRef.current = null;
            // The archive is never unzipped on this path, so the probe's
            // meta.json is the only description of the file the renderer will
            // ever see. Skipping it meant every stored SOG was drawn as though
            // it were trained without antialiasing — and Splatfiction's exports,
            // which are precisely the ones stored well enough to qualify here,
            // all carry `antialias: true`. That halved the Mip kernel and, with
            // it, the opacity compensation derived from the same kernel, which
            // is what made these scenes render brighter and hazier than the
            // exporter intended.
            if (probe.meta) {
              sogViewerHintRef.current = parseSogViewerHint(probe.meta);
              sogAntialiasRef.current =
                (probe.meta as { antialias?: unknown }).antialias === true;
            }
            await placeCamera();
            if (immersiveControls) {
              const target = camera.getTarget();
              setImmersiveBase(
                [camera.position.x, camera.position.y, camera.position.z],
                [target.x - camera.position.x, target.y - camera.position.y, target.z - camera.position.z],
                camera.fov,
              );
            }
            setReady(true);
            viewerInitializing = false;
            return;
          }
          console.warn(
            "[REAI] SOG members are deflated; repackaging stored for Spinoff range access",
          );
        }

        const sourceCacheEligible = isSogUrl || isSpzUrl;

        const [cachedSource, cachedFull]: [ArrayBuffer | null, ArrayBuffer | null] = await Promise.all([
          sourceCacheEligible && splatId
            ? getCache(splatId, "source", outputsVersion)
            : Promise.resolve(null),
          !sourceCacheEligible && splatId
          ? await getCache(splatId, "full", outputsVersion)
          : Promise.resolve(null),
        ]);

        if (disposed) return;

        // Download the file
        setStatus(t("viewer.status.downloading", lang));
        let rawBuffer: ArrayBuffer | null = cachedSource ?? cachedFull;

        if (!rawBuffer) {
          // Asset URLs are fingerprinted. Browser + IndexedDB caching keeps
          // repeat opens fast without risking a stale reconstruction.
          const resp = await fetch(splatUrl, { cache: "force-cache" });
          if (!resp.ok) throw new Error(`Download ${resp.status}`);
          rawBuffer = await resp.arrayBuffer();
          if (disposed) return;
          if (sourceCacheEligible && splatId) {
            deferSplatCacheWrite(splatId, "source", rawBuffer, outputsVersion);
          }
        }

        // Detect format by signature first, then by URL suffix for signed URLs without clear MIME.
        const u8 = new Uint8Array(rawBuffer);
        const isZip = u8.length >= 2 && u8[0] === 0x50 && u8[1] === 0x4B;
        const isGZippedSpz = u8.length >= 2 && u8[0] === 0x1f && u8[1] === 0x8b;
        const isNgspSpz = u8.length >= 4 && u8[0] === 0x4e && u8[1] === 0x47 && u8[2] === 0x53 && u8[3] === 0x50;
        if (isZip || isSogUrl) {
          // SOG format. Delivery sends the compressed source directly to the
          // exact renderer and samples only three textures for camera bounds;
          // editor mode keeps Babylon's full mutable decode.
          setStatus(t("viewer.status.processing", lang));
          const fflate = await import("fflate");
          const zipData = await new Promise<Record<string, Uint8Array>>((resolve, reject) => {
            fflate.unzip(new Uint8Array(rawBuffer), (error, data) => {
              if (error) reject(error);
              else resolve(data);
            });
          });
          if (spinoffEligible) {
            // Portable Splatfiction exports deflate their ZIP members. Spinoff
            // uses stored members for zero-copy range access, so repackage the
            // already-compressed WebPs losslessly without decoding Gaussians.
            const storedSog = fflate.zipSync(zipData, { level: 0 });
            spinoffSourceRef.current = new Blob(
              [new Uint8Array(storedSog).buffer],
              { type: "application/octet-stream" },
            );
          }
          let vkgsMeta: VkgsSogMeta | null = null;
          let boundsMeta: SogBoundsMeta | null = null;
          const metaEntry = zipData["meta.json"];
          if (metaEntry) {
            try {
              const decoded = new TextDecoder().decode(metaEntry);
              const meta = JSON.parse(decoded) as VkgsSogMeta & {
                shN?: { shape?: number[]; files?: string[]; bands?: number; mins?: number; maxs?: number; codebook?: number[] };
              };
              if (
                Array.isArray(meta.means?.files)
                && meta.means.files.length >= 2
                && Array.isArray(meta.means.mins)
                && Array.isArray(meta.means.maxs)
                && Array.isArray(meta.sh0?.files)
                && meta.sh0.files.length >= 1
              ) {
                boundsMeta = meta as SogBoundsMeta;
              }
              sogViewerHintRef.current = parseSogViewerHint(meta);
              sogAntialiasRef.current =
                (meta as { antialias?: unknown }).antialias === true;
              if (isVkgsSogMeta(meta)) {
                vkgsMeta = meta;
              }
              if (!vkgsMeta) {
                const shN = meta.shN;
                const hasUsableShN =
                  !!shN &&
                  Array.isArray(shN.files) &&
                  shN.files.length > 0 &&
                  (
                    typeof shN.bands === "number" ||
                    (Array.isArray(shN.shape) && typeof shN.shape[1] === "number")
                  );
                if (shN && !hasUsableShN) {
                  delete meta.shN;
                  zipData["meta.json"] = new TextEncoder().encode(JSON.stringify(meta));
                  console.warn("[REAI] SOG meta.json has incomplete shN block; loading as SH0-only");
                }
              }
            } catch (error) {
              console.warn("[REAI] Failed to sanitize SOG meta.json:", error);
            }
          }
          if (disposed) return;
          if (spinoffEligible) {
            if (!spinoffSourceRef.current) {
              throw new Error("SOG delivery source was not prepared");
            }
            if (boundsMeta) {
              publishSceneFrame(await computeSceneFrameFromSogTextures(zipData, boundsMeta));
            }
            splatBufferRef.current = null;
          } else {
            const { ParseSogMeta } = await import("@babylonjs/loaders/SPLAT/sog");
            let parsedSOG: ParsedSogData;
            if (vkgsMeta) {
              parsedSOG = await parseVkgsSogMeta(zipData, vkgsMeta, scene);
            } else {
              const files = new Map<string, Uint8Array>();
              for (const [name, data] of Object.entries(zipData)) {
                files.set(name, data);
              }
              parsedSOG = await ParseSogMeta(files, "", scene);
            }
            if (disposed) return;
            const sogSh = renderTuning().sh && parsedSOG.sh && parsedSOG.sh.length
              ? parsedSOG.sh
              : undefined;
            const sogDegree = sogSh ? (parsedSOG.shDegree ?? 0) : 0;
            const renderData = initializeSplatEditing(parsedSOG.data, sogSh, sogDegree);
            publishSceneFrame(computeSceneFrameFromSplatBuffer(renderData.buffer));
            splatBufferRef.current = renderData.buffer;

            gs = createPrimaryGaussian();
            gs.updateData(
              renderData.buffer,
              renderData.sh,
              { flipY: false },
              undefined,
              renderData.sh?.length ? (renderData.shDegree ?? 0) : 0,
            );
          }
        } else if (isGZippedSpz || isNgspSpz || isSpzUrl) {
          // SPZ format: this is the current R&D-packed web format.
          setStatus(t("viewer.status.processing", lang));
          const { ParseSpz, GetSpzModule, ConvertSpzToSplatAsync } = await import("@babylonjs/loaders/SPLAT/spz");
          let parsedSPZ: {
            data: ArrayBuffer;
            sh?: Uint8Array[];
            shDegree?: number;
            trainedWithAntialiasing?: boolean;
          };

          if (isNgspSpz) {
            const spz = await GetSpzModule("https://unpkg.com/@adobe/spz@0.2.2/dist/spz.js");
            const cloud = spz.loadSpzFromBuffer(u8, { to: spz.CoordinateSystem.RUB });
            parsedSPZ = await ConvertSpzToSplatAsync(cloud, scene);
          } else {
            const readableStream = new ReadableStream({
              start(controller) {
                controller.enqueue(u8);
                controller.close();
              },
            });
            const decompressed = await new Response(
              readableStream.pipeThrough(new DecompressionStream("gzip")),
            ).arrayBuffer();
            parsedSPZ = await ParseSpz(decompressed, scene, {});
          }

          if (disposed) return;
          const renderData = initializeSplatEditing(
            parsedSPZ.data,
            parsedSPZ.sh && parsedSPZ.sh.length ? parsedSPZ.sh : undefined,
            parsedSPZ.shDegree ?? 0,
          );
          publishSceneFrame(computeSceneFrameFromSplatBuffer(renderData.buffer));
          splatBufferRef.current = renderData.buffer;

          gs = createPrimaryGaussian();
          gs.updateData(
            renderData.buffer,
            renderData.sh,
            { flipY: false },
            undefined,
            renderData.sh?.length ? (renderData.shDegree ?? 0) : 0,
          );
        } else {
          // PLY/splat format
          setStatus(t("viewer.status.processing", lang));
          const converted = cachedFull
            ? { buffer: cachedFull, sh: undefined, shDegree: 0 }
            : await GaussianSplattingMesh.ConvertPLYWithSHToSplatAsync(rawBuffer) as {
                buffer: ArrayBuffer;
                sh?: Uint8Array[];
                shDegree?: number;
              };
          const fullConv = converted.buffer;
          if (disposed) return;
          const renderData = initializeSplatEditing(
            fullConv,
            converted.sh,
            converted.shDegree ?? 0,
          );
          publishSceneFrame(computeSceneFrameFromSplatBuffer(renderData.buffer));
          splatBufferRef.current = renderData.buffer;
          if (!cachedFull && splatId) {
            deferSplatCacheWrite(splatId, "full", fullConv, outputsVersion);
          }

          gs = createPrimaryGaussian();
          if (renderData.sh?.length) {
            gs.updateData(
              renderData.buffer,
              renderData.sh,
              { flipY: false },
              undefined,
              renderData.shDegree ?? 0,
            );
          } else {
            await gs.updateDataAsync(renderData.buffer);
          }
          if (disposed) return;
        }
        if (spinoffEligible && (isZip || isSogUrl)) {
          // Camera/input state is ready; the Spinoff effect now owns the only
          // Gaussian upload, sort, and draw for this delivery scene.
          await placeCamera();
          if (immersiveControls) {
            const target = camera.getTarget();
            setImmersiveBase(
              [camera.position.x, camera.position.y, camera.position.z],
              [target.x - camera.position.x, target.y - camera.position.y, target.z - camera.position.z],
              camera.fov,
            );
          }
          setReady(true);
          viewerInitializing = false;
          return;
        }

        gsRef.current = gs;

        // Backend output and current web/iOS cameras are already Y-up in the
        // same identity scene space. Historical edited cameras are normalized
        // on read; the mesh itself must never be mirrored.
        const mat = gs.material as any;
        if (mat) {
          mat.backFaceCulling = false;
          // Set this on the concrete material as well as the Babylon default
          // so a loader-created material cannot restore its softer default.
          // Kernel deliberately not keyed off the antialias flag: a controlled
          // CPU render of the same file showed 0.09 vs 0.30 changes mean
          // luminance by 0.00005 and only costs sharpness. Overrides remain,
          // so a scene can still be dialled against a reference.
          const profile = resolveSplatRenderProfile({}, renderTuning());
          mat.kernelSize = profile.kernelSize;
          mat.compensation = profile.compensation;
        }

        let meshReady = false;
        for (let i = 0; i < 300; i++) {
          if (gs.isReady()) {
            meshReady = true;
            break;
          }
          await new Promise(r => setTimeout(r, 100));
        }
        if (disposed) return;
        if (!meshReady) {
          const assetKind = isSogUrl ? "SOG" : isSpzUrl || isGZippedSpz || isNgspSpz ? "SPZ" : "PLY";
          throw new Error(`${assetKind} mesh did not become ready`);
        }

        await placeCamera();
        if (!await settleHiddenGaussian(scene, gs, () => disposed)) return;
        if (immersiveControls) {
          const target = camera.getTarget();
          setImmersiveBase(
            [camera.position.x, camera.position.y, camera.position.z],
            [target.x - camera.position.x, target.y - camera.position.y, target.z - camera.position.z],
            camera.fov,
          );
        }
        setReady(true);
        viewerInitializing = false;
        setStatus("");
        onReady?.();

      } catch (err: any) {
        if (!disposed) {
          viewerInitializing = false;
          setStatus(t("viewer.status.error", lang));
          console.error("[REAI]", err);
          // Never report an empty reason: some failures arrive as a string, a
          // DOMException, or an object with no `message`, and an undefined
          // reason is what made these failures undiagnosable from the UI.
          const reason =
            (typeof err === "string" && err)
            || err?.message
            || err?.name
            || (err != null ? String(err) : "")
            || "Unknown viewer error";
          onError?.(reason);
        }
      }
    }

    init();
    return () => {
      disposed = true;
      splatBufferRef.current = null;
      spinoffSourceRef.current = null;
      originalSplatDataRef.current = null;
      aliveSplatMaskRef.current = null;
      savedSplatMaskRef.current = null;
      selectedSplatMaskRef.current = null;
      splatPruneHistoryRef.current = [];
      inspectionSampleRef.current = null;
      spatialRootRef.current = null;
      gsRef.current = null;
      compositionMeshesRef.current = [];
      fallbackSceneRef.current = null;
      renderLoopRef.current = null;
      if (resizeRef.current) window.removeEventListener("resize", resizeRef.current);
      layoutResizeObserver?.disconnect();
      engineRef.current?.dispose();
    };
  }, [splatUrl, splatId, camerasUrl, spinoffEligible]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Exact single-Gaussian delivery renderer ──────────────────────────────

  useEffect(() => {
    const canvas = spinoffCanvasRef.current;
    let source = spinoffSourceRef.current;
    const babylonCamera = cameraRef.current;
    const scene = sceneRef.current;
    if (!ready || !spinoffEligible || useSparkEngine || !canvas || !source || !babylonCamera || !scene) {
      if (!useSparkEngine) setSpinoffStatus("idle");
      return;
    }

    let disposed = false;
    let cameraObserver: any = null;
    const abortController = new AbortController();
    setSpinoffStatus("loading");
    setStatus(t("viewer.status.processing", lang));

    void (async () => {
      try {
        const { SpinoffOrbitCamera, SpinoffRenderer } = await import("@reaigen/spinoff");
        if (disposed) return;
        const camera = new SpinoffOrbitCamera();
        synchronizeSpinoffCamera(camera, babylonCamera);
        const currentTransform = spinoffModelTransform(globalSceneTransformRef.current);
        const renderer = new SpinoffRenderer(canvas, {
          camera,
          backendPreference: "auto",
          sourceUpAxis: "y",
          modelScale: currentTransform.scale,
          modelRotationRadians: currentTransform.rotationRadians,
          modelTranslation: currentTransform.translation,
          renderMode: "deterministic",
          // Splatfiction's actual settled-viewport recipe (app/page.tsx +
          // lib/viewport-quality.ts), which overrides the engine defaults:
          // a crisp 0.075px² dilation floor, and compensation OFF — their
          // source calls it "a faint full-frame softness layer". The old
          // sqrt(0.30) sigma here squared to 0.30px² of variance, 4x wider
          // than the reference, which is why even ?renderer=spinoff looked
          // hazier than Splatfiction with the same file.
          mipSigmaPixels: SPLATFICTION_VIEWPORT_SIGMA,
          mipOpacityCompensation: false,
          // Spinoff's own answer to the oversized, nearly isotropic Gaussians
          // that a reconstruction leaves behind in under-observed regions —
          // ceilings, windows, anywhere few training views looked. Approach one
          // and it inflates into a soft balloon across the frame. The guard
          // shrinks a splat's footprint only when it is both round and oversized
          // on screen, deliberately sparing elongated ones because those are
          // real thin surfaces. Off by default (`strength` resolves to 0 when
          // the option is absent), which is why the balloons were showing.
          // Footprint only: the SOG bytes and the lossless tensors are untouched.
          reconstructionFogGuard: true,
          motionSmoothing: false,
          maxCanvasPixels: spatialNavigation
            ? compactTouch ? 3_000_000 : 8_000_000
            : performanceProfile === "balanced"
              ? compactTouch ? 2_250_000 : 4_500_000
              : compactTouch ? 3_500_000 : 9_000_000,
          // Spinoff contributes no application theme or UI chrome; this is the
          // surface the Gaussians are composited onto, and it has to match the
          // Spark path and the DOM behind it or the same scene would change
          // exposure depending on which engine happened to be available.
          background: SPLAT_BACKDROP,
          physicalSky: false,
        });
        spinoffRendererRef.current = renderer;
        canvas.dataset.spinoffStatus = "initializing";
        await renderer.initialize();
        if (disposed) return;
        renderer.start();
        canvas.dataset.spinoffStatus = "loading";
        const loadedScene = await renderer.loadSog(source, {
          signal: abortController.signal,
          sourceUpAxis: "y",
        });
        source = null;
        spinoffSourceRef.current = null;
        if (disposed) return;

        // vkgs_trainer and other standard SOG producers are not required to
        // persist a viewer pose. The range renderer has already loaded
        // meta.json, whose signed-log means domain is enough to frame the
        // scene without a second full-file download or texture decode.
        const metadataFrame = sceneFrameFromSogMetadata(loadedScene.metadata);
        if (metadataFrame) fallbackSceneRef.current = metadataFrame;

        // Splatfiction persists the viewport pose in meta.json. The range
        // loader has now read that metadata, so restore the exact authored
        // camera instead of waiting for a second full-file bounds decode.
        // The OpenUSD root is applied to the camera once, just like geometry.
        const viewerHint = parseSogViewerHint(loadedScene.metadata);
        if (viewerHint && spatialNavigationRef.current) {
          const canonicalEye = eyeFromSogViewer(viewerHint);
          const transform = globalSceneTransformRef.current;
          const worldEye = transformCanonicalPoint(canonicalEye, transform);
          const worldTarget = transformCanonicalPoint(viewerHint.target, transform);
          const worldUp = transformCanonicalDirection([0, 1, 0], transform);
          babylonCamera.position.set(...worldEye);
          babylonCamera.upVector.set(...worldUp);
          cameraUpRef.current = worldUp;
          babylonCamera.setTarget(new (babylonRef.current.Vector3)(...worldTarget));
          babylonCamera.rotation.z = 0;
          if (viewerHint.verticalFovRadians) {
            babylonCamera.fov = viewerHint.verticalFovRadians;
          }
          // An authored SOG camera carries its own clip planes, which are sized
          // for the shot the exporter framed. Honour them when presenting that
          // shot; ignore them while authoring, where the camera does not stay
          // in it.
          if (!spatialNavigation) {
            if (viewerHint.near) babylonCamera.minZ = viewerHint.near;
            if (viewerHint.far) babylonCamera.maxZ = viewerHint.far;
          }
          spatialOrbitRef.current = {
            enabled: true,
            target: worldTarget,
            radius: Math.max(
              0.08,
              Math.hypot(
                worldEye[0] - worldTarget[0],
                worldEye[1] - worldTarget[1],
                worldEye[2] - worldTarget[2],
              ),
            ),
            yaw: viewerHint.yawRadians,
            pitch: viewerHint.pitchRadians,
          };
        } else if (metadataFrame) {
          const framed = editorFramePose(
            metadataFrame,
            globalSceneTransformRef.current,
          );
          babylonCamera.position.set(...framed.position);
          babylonCamera.upVector.set(0, 1, 0);
          cameraUpRef.current = [0, 1, 0];
          babylonCamera.setTarget(
            new (babylonRef.current.Vector3)(...framed.target),
          );
          babylonCamera.rotation.z = 0;
          babylonCamera.fov = 60 * Math.PI / 180;
          setCameraDepthRange(
            babylonCamera,
            spatialNavigation,
            Math.max(0.02, framed.radius / 500),
            Math.max(100, framed.radius * 40),
          );
          spatialOrbitRef.current = {
            enabled: true,
            target: framed.target,
            radius: framed.radius,
            yaw: framed.yaw,
            pitch: framed.pitch,
          };
        }

        const syncCamera = () => synchronizeSpinoffCamera(camera, babylonCamera);
        cameraObserver = scene.onBeforeRenderObservable.add(syncCamera);
        syncCamera();
        renderer.renderOnce();
        canvas.dataset.spinoffStatus = "ready";
        canvas.dataset.spinoffBackend = renderer.stats.backend;
        canvas.dataset.spinoffSplats = String(renderer.stats.sceneSplats);
        canvas.dataset.spinoffGaussianEngines = "1";
        setSpinoffStatus("ready");
        setStatus("");
        onReady?.();
      } catch (error) {
        if (disposed || abortController.signal.aborted) return;
        const reason = error instanceof Error ? error.message : String(error);
        canvas.dataset.spinoffStatus = "error";
        canvas.dataset.spinoffError = reason;
        console.error("[REAI] Exact Spinoff delivery renderer failed:", error);
        setSpinoffStatus("error");
        setStatus(t("viewer.status.error", lang));
        onError?.(reason);
      }
    })();

    return () => {
      disposed = true;
      source = null;
      abortController.abort();
      if (cameraObserver) scene.onBeforeRenderObservable.remove(cameraObserver);
      spinoffRendererRef.current?.dispose();
      spinoffRendererRef.current = null;
    };
  }, [compactTouch, lang, outputsVersion, performanceProfile, ready, spatialNavigation, spinoffEligible, splatUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Push the current model transform into whichever engine draws the Gaussians.
   *
   * Reads `globalSceneTransformRef` rather than the prop so a gizmo drag can
   * call this synchronously, in the same frame it moves the Babylon root,
   * without waiting for the change to travel out to the page, come back as a
   * new prop and arrive here through an effect. Babylon's gizmo and grid moved
   * on the drag frame while the reconstruction itself only caught up a render
   * later, so the splats visibly trailed the handle being dragged.
   */
  const applyEngineModelTransform = useCallback(() => {
    if (useSparkEngine) {
      sparkModelTransformRef.current?.();
      return;
    }
    if (!spinoffEligible) return;
    const renderer = spinoffRendererRef.current;
    if (!renderer) return;
    const transform = spinoffModelTransform(globalSceneTransformRef.current);
    renderer.setModelTransform({
      scale: transform.scale,
      rotationRadians: transform.rotationRadians,
      translation: transform.translation,
    });
  }, [spinoffEligible, useSparkEngine]);

  useEffect(() => {
    applyEngineModelTransformRef.current = applyEngineModelTransform;
  }, [applyEngineModelTransform]);

  // Still driven by the prop as well, for every transform change that does not
  // come from a drag: the inspector's numeric fields, undo, and the workspace
  // reloading after a save.
  useEffect(() => {
    applyEngineModelTransform();
  }, [applyEngineModelTransform, globalSceneTransform]);

  // SparkJS engine. Same contract as the Spinoff effect above: Babylon owns the
  // camera and all chrome, this only draws the Gaussians underneath and follows
  // the Babylon camera every frame.
  useEffect(() => {
    const canvas = sparkCanvasRef.current;
    const source = spinoffSourceRef.current;
    const babylonCamera = cameraRef.current;
    const scene = sceneRef.current;
    if (!ready || !useSparkEngine || !canvas || !source || !babylonCamera || !scene) {
      return;
    }

    let disposed = false;
    let frame = 0;
    let cleanup: (() => void) | null = null;
    setSpinoffStatus("loading");

    void (async () => {
      try {
        const [THREE, { SparkRenderer, SplatMesh, SplatFileType }] = await Promise.all([
          import("three"),
          import("@sparkjsdev/spark"),
        ]);
        if (disposed) return;

        const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true });
        renderer.setClearColor(0x000000, 0);
        // Spinoff's resolution policy, not a DPR cap: a physical-pixel budget
        // (1M mobile / 2.5M desktop) with a hard floor at 1.0 DPR, so CSS
        // never upscales more than the budget demands. The old flat 1.5 cap
        // rendered a third of a 2.6-DPR phone's pixels and the upscale beat
        // against fine texture — the moiré. Sort cost scales with splat
        // count, not pixels, so the budget only spends GPU fill.
        const resolveSparkPixelRatio = () => {
          const dpr = window.devicePixelRatio || 1;
          const cssW = Math.max(1, canvas.clientWidth);
          const cssH = Math.max(1, canvas.clientHeight);
          // One budget for every device. Spinoff halves it on mobile as a
          // guard for multi-million-splat scenes, but our room captures are
          // ~150k splats and fill-cheap, while the upscale from a partial
          // buffer is exactly the moiré being fought — a 2.4M-px phone at
          // the 1M mobile budget still stretched 54%. 2.5M covers full
          // native DPR on phones and caps only very large desktop windows.
          const budget = 2_500_000;
          const scale = Math.min(1, Math.sqrt(budget / (cssW * cssH * dpr * dpr)));
          return Math.max(1, dpr * scale);
        };
        renderer.setPixelRatio(resolveSparkPixelRatio());

        const threeScene = new THREE.Scene();
        const threeCamera = new THREE.PerspectiveCamera(60, 1, 0.05, 1000);
        // Where each Gaussian's edge falls: Spark draws out to `maxStdDev`
        // sigma and hard-discards, so this decides whether a splat ends
        // gradually or in a visible rim. It tracks Spinoff's own cutoff —
        // see SPLAT_MAX_STD_DEV for why sqrt(8) and not 2.0.
        //
        // Splatfiction parity — the image the user actually accepts — not the
        // engine defaults. Splatfiction's settled viewport overrides Spinoff
        // with a 0.075px² dilation floor and compensation OFF ("compensation
        // reduced sub-pixel opacity across the entire image and presented as
        // a faint full-frame softness layer"). In Spark terms that means the
        // kernel goes into preBlurAmount (added before the compensation
        // determinant is captured → dilation only) and blurAmount stays 0.
        // ?kernel= still overrides for A/B.
        const kernelOverride = renderTuning().kernel;
        const kernel = typeof kernelOverride === "number" && kernelOverride >= 0
          ? kernelOverride
          : SPLATFICTION_VIEWPORT_VARIANCE;
        // 3. Which splats are considered at all. Spark discards a splat on its
        //    centre alone — `abs(clipCenter.xy) > clipXY * w` — and defaults
        //    clipXY to 1.4. That is fine at a distance, where a splat's
        //    footprint is close to a point, and wrong up close: approach a
        //    surface and most of the splats covering the frame have centres
        //    just outside it, so they are dropped while the few whose centres
        //    remain on screen keep drawing. The continuous field falls apart
        //    into isolated blobs floating on the backdrop, which is the
        //    artefact, rather than the smooth wash SuperSplat degrades to.
        //
        //    Measured on room_3.sog, this is not a tail of oversized
        //    Gaussians: the median splat is 7cm across at 3 sigma and only 22
        //    of 147,382 exceed a metre, all of them elongated. They are
        //    ordinary splats seen from nearer than they are wide.
        //
        //    maxPixelRadius is deliberately left at Spark's default. It clamps
        //    the quad without rescaling the Gaussian's UV, so a clamped splat
        //    is cut off square instead of shrunk — trading soft balloons for
        //    hard-edged discs.
        const sparkRenderer = new SparkRenderer({
          renderer,
          blurAmount: 0,
          preBlurAmount: kernel,
          maxStdDev: SPLAT_MAX_STD_DEV,
          clipXY: SPLAT_CLIP_XY,
          // Spinoff's sub-pixel cull, its primary moiré suppressor: a splat
          // whose kernel-support radius projects under one physical pixel is
          // dropped, not shrunk. Spark's predicate (both axes below the
          // threshold, and scale1 is the major axis) matches Spinoff's
          // major-axis test exactly at 1.0. Spark defaults this to 0 and
          // keeps rasterising sub-pixel splats, which shimmer at any DPR.
          minPixelRadius: 1.0,
        });
        threeScene.add(sparkRenderer);

        // The loader hands over either the asset URL for range streaming or a
        // repackaged stored archive; Spark reads both.
        // The loader hands over either the asset URL for range streaming or a
        // repackaged stored archive; Spark reads both.
        const fileBytes = typeof source === "string"
          ? null
          : new Uint8Array(await (source as Blob).arrayBuffer());
        if (disposed) return;

        // SplatMesh loads asynchronously; reading numSplats straight after the
        // constructor always reports 0 and would reveal the layer before a
        // single Gaussian exists.
        // Never let Spark sniff the format. Our delivery bundles are always
        // PlayCanvas SOGS zips, and a signed URL that has expired — or any
        // error page served in its place — sniffs as "Unknown file type" and
        // throws out of the worker where nothing can catch it.
        const mesh: InstanceType<typeof SplatMesh> = new SplatMesh({
          fileType: SplatFileType.PCSOGSZIP,
          ...(typeof source === "string" ? { url: source } : { fileBytes: fileBytes! }),
          onLoad: () => {
            if (disposed) return;
            const count = mesh.packedSplats?.numSplats ?? 0;

            // Camera placement belongs to the loader's own scene-frame path,
            // shared with Spinoff — re-framing unconditionally fought the
            // editor's orbit state, snapping the pose back on drag.
            //
            // But that path only runs when the scene has something to frame
            // from. A tour with no authored cameras gets nothing, leaving the
            // camera parked at the origin inside the geometry: the render looks
            // like mush and the controls appear dead because there is no orbit
            // radius to work with. Frame from the splats only in that case.
            // A camera still sitting exactly on the origin was never placed.
            // Its target is Babylon's default (0,0,1), so only the position is
            // a reliable signal that the scene-frame path had nothing to work
            // from.
            const unplaced = babylonCamera.position.lengthSquared() < 1e-6;
            if (unplaced && count > 0) {
              const axes = [
                new Float32Array(count),
                new Float32Array(count),
                new Float32Array(count),
              ];
              let kept = 0;
              mesh.forEachSplat((_i, centre) => {
                if (
                  kept < count
                  && Number.isFinite(centre.x)
                  && Number.isFinite(centre.y)
                  && Number.isFinite(centre.z)
                ) {
                  axes[0][kept] = centre.x;
                  axes[1][kept] = centre.y;
                  axes[2][kept] = centre.z;
                  kept += 1;
                }
              });
              if (kept > 0) {
                // SOG stores means in a signed-log domain, so far-field
                // Gaussians decode tens of thousands of units out. Percentiles
                // frame the room rather than the noise.
                const lo: number[] = [];
                const hi: number[] = [];
                for (const axis of axes) {
                  const values = axis.subarray(0, kept).slice().sort();
                  lo.push(values[Math.floor(kept * 0.02)]);
                  hi.push(values[Math.min(kept - 1, Math.floor(kept * 0.98))]);
                }
                const frame: SceneFrame = {
                  center: [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2],
                  radius: Math.max(
                    0.25,
                    Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 2,
                  ),
                  safePosition: [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2],
                  safeTarget: [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2],
                  floorY: lo[1],
                  ceilingY: hi[1],
                  footprint: { minX: lo[0], maxX: hi[0], minZ: lo[2], maxZ: hi[2] },
                };
                fallbackSceneRef.current = frame;

                // Stand inside the room, not outside it. editorFramePose orbits
                // the capture from beyond its bounds, which for an interior scan
                // means looking in through the ceiling and walls — every surface
                // between the camera and the room smears across the view. An
                // authored camera is always inside, which is the whole reason
                // tours that have one look right.
                //
                // Eye height above the floor, at the footprint centre, facing
                // along the room's longest horizontal axis so the view runs down
                // the space rather than into the nearest wall.
                const spanX = hi[0] - lo[0];
                const spanZ = hi[2] - lo[2];
                const eyeY = Math.min(
                  frame.floorY + 1.6,
                  frame.floorY + (frame.ceilingY - frame.floorY) * 0.6,
                );

                // Face the densest eye-level region, the way the iOS player
                // does. The centroid of splats at standing height points at the
                // room's interior mass — furniture, walls, features — while the
                // global centroid is dragged around by floor and ceiling.
                // Aiming down the longest axis instead just finds a blank wall.
                let dx = 0, dz = 0, band = 0;
                const bandLo = frame.floorY + (eyeY - frame.floorY) * 0.5;
                const bandHi = eyeY + 0.4;
                for (let i = 0; i < kept; i += 1) {
                  const y = axes[1][i];
                  if (y >= bandLo && y <= bandHi) {
                    dx += axes[0][i];
                    dz += axes[2][i];
                    band += 1;
                  }
                }
                const eye: Vec3 = [frame.center[0], eyeY, frame.center[2]];
                let look: Vec3;
                if (band > 0) {
                  const towardX = dx / band - eye[0];
                  const towardZ = dz / band - eye[2];
                  // Below iOS's 0.20 m threshold the centroid sits on top of the
                  // anchor and its direction is noise, so fall back to the axis.
                  if (Math.hypot(towardX, towardZ) > 0.2) {
                    const scale = Math.max(spanX, spanZ) / 2;
                    const norm = Math.hypot(towardX, towardZ);
                    look = [
                      eye[0] + (towardX / norm) * scale,
                      eyeY,
                      eye[2] + (towardZ / norm) * scale,
                    ];
                  } else {
                    look = spanX >= spanZ
                      ? [hi[0], eyeY, frame.center[2]]
                      : [frame.center[0], eyeY, hi[2]];
                  }
                } else {
                  look = spanX >= spanZ
                    ? [hi[0], eyeY, frame.center[2]]
                    : [frame.center[0], eyeY, hi[2]];
                }
                const worldEye = transformCanonicalPoint(eye, globalSceneTransformRef.current);
                const worldLook = transformCanonicalPoint(look, globalSceneTransformRef.current);

                babylonCamera.position.set(...worldEye);
                babylonCamera.upVector.set(0, 1, 0);
                cameraUpRef.current = [0, 1, 0];
                babylonCamera.setTarget(
                  new (babylonRef.current.Vector3)(...worldLook),
                );
                babylonCamera.rotation.z = 0;
                // 85° matches the iOS player's indoor default and the fov the
                // authored tour cameras carry; 60° crops an interior too tightly.
                babylonCamera.fov = 85 * Math.PI / 180;
                setCameraDepthRange(
                  babylonCamera,
                  spatialNavigation,
                  Math.max(0.02, frame.radius / 500),
                  Math.max(100, frame.radius * 40),
                );
                // Derive the orbit state from the camera we just set rather
                // than computing yaw/radius by hand — the pivot is offset along
                // the view direction, not the look point, so a hand-rolled
                // target/radius disagrees with the pose and dragging either
                // jumps or does nothing.
                syncSpatialOrbitToCamera();
                canvas.dataset.sparkFramed = "interior";
                canvas.dataset.sparkOrbit = JSON.stringify(spatialOrbitRef.current);
              }
            }

            canvas.dataset.sparkStatus = "ready";
            canvas.dataset.sparkSplats = String(count);
            canvas.dataset.sparkQuality = JSON.stringify({
              maxSh: (mesh as { maxSh?: number }).maxSh ?? null,
              dpr: renderer.getPixelRatio(),
              buffer: `${renderer.domElement.width}x${renderer.domElement.height}`,
              css: `${canvas.clientWidth}x${canvas.clientHeight}`,
              devicePixelRatio: window.devicePixelRatio,
            });
            setSpinoffStatus("ready");
            setStatus("");
            onReady?.();
          },
        });
        // Babylon transforms the *camera* into world space, while the external
        // Gaussian engine is expected to transform the *model* by the USD root
        // (Spinoff does this via setModelTransform). Leaving the mesh in
        // canonical space puts the geometry and the camera in two different
        // frames: poses land inside the floor and orbiting appears to drag the
        // whole scene. Apply the root as a quaternion rather than re-deriving
        // Euler angles, so there is no order convention to get wrong.
        const applyModelTransform = () => {
          const transform = globalSceneTransformRef.current;
          const [qx, qy, qz, qw] = globalSceneQuaternion(transform);
          const [sx, sy, sz] = globalSceneScale3(transform);
          mesh.quaternion.set(qx, qy, qz, qw);
          mesh.scale.set(sx, sy, sz);
          mesh.position.set(...transform.translation);
          mesh.updateMatrixWorld(true);
        };
        applyModelTransform();
        sparkModelTransformRef.current = applyModelTransform;
        threeScene.add(mesh);

        // SplatMesh decodes on a worker, so a load failure surfaces as an
        // unhandled rejection — a full-screen dev overlay instead of the
        // viewer's own error path. Route it back into onError like every
        // other load failure here.
        void Promise.resolve(mesh.initialized).catch((error: unknown) => {
          if (disposed) return;
          const reason = error instanceof Error ? error.message : String(error);
          canvas.dataset.sparkStatus = "error";
          console.error("[REAI] Spark delivery renderer failed:", error);
          setSpinoffStatus("error");
          setStatus(t("viewer.status.error", lang));
          onError?.(reason);
        });

        const target = new THREE.Vector3();
        const syncCamera = () => {
          const babylonTarget = babylonCamera.getTarget();
          threeCamera.position.set(
            babylonCamera.position.x,
            babylonCamera.position.y,
            babylonCamera.position.z,
          );
          target.set(babylonTarget.x, babylonTarget.y, babylonTarget.z);

          // camera.upVector is the *reference* up, not the camera's oriented
          // up. On phones the immersive controls roll the camera, and reading
          // upVector silently drops that roll — the scene renders on its side.
          // The world matrix's up column carries the real orientation.
          //
          // Babylon stores matrices in WebGL column-major order, same as THREE,
          // so columns are [right | up | forward | translation].
          const world = babylonCamera.getWorldMatrix?.()?.m;
          if (world && Number.isFinite(world[4])) {
            threeCamera.up.set(world[4], world[5], world[6]).normalize();
          } else {
            const up = babylonCamera.upVector;
            if (up) threeCamera.up.set(up.x, up.y, up.z);
          }
          threeCamera.lookAt(target);
          // Babylon stores fov in radians and applies it vertically, matching
          // THREE's perspective camera once converted to degrees.
          threeCamera.fov = (babylonCamera.fov ?? 1) * 180 / Math.PI;
          threeCamera.near = Math.max(0.01, babylonCamera.minZ ?? 0.05);
          threeCamera.far = Math.max(threeCamera.near + 1, babylonCamera.maxZ ?? 1000);
          const width = canvas.clientWidth || 1;
          const height = canvas.clientHeight || 1;
          threeCamera.aspect = width / height;
          threeCamera.updateProjectionMatrix();
          // The budget-derived ratio depends on the CSS size, so a resize or
          // rotation must re-resolve it before setSize allocates the buffer.
          const nextRatio = resolveSparkPixelRatio();
          if (Math.abs(renderer.getPixelRatio() - nextRatio) > 0.01) {
            renderer.setPixelRatio(nextRatio);
          }
          renderer.setSize(width, height, false);
          canvas.dataset.sparkCamera = [
            threeCamera.position.x, threeCamera.position.y, threeCamera.position.z,
          ].map((v) => v.toFixed(2)).join(",");
          canvas.dataset.sparkTarget = [target.x, target.y, target.z]
            .map((v) => v.toFixed(2)).join(",");
          canvas.dataset.sparkSize = `${width}x${height}`;
          canvas.dataset.sparkClip =
            `${threeCamera.near.toFixed(3)}/${threeCamera.far.toFixed(1)}/fov${threeCamera.fov.toFixed(1)}`;
        };
        // Babylon pauses its render loop while a saved camera is applied, which
        // would silently freeze an onBeforeRender-driven sync. Pull the pose
        // every frame from our own loop so the layers can never diverge.
        const tick = () => {
          syncCamera();
          renderer.render(threeScene, threeCamera);
          frame = requestAnimationFrame(tick);
        };
        syncCamera();
        frame = requestAnimationFrame(tick);

        cleanup = () => {
          cancelAnimationFrame(frame);
          threeScene.remove(mesh);
          mesh.dispose?.();
          renderer.dispose();
        };
      } catch (error) {
        if (disposed) return;
        const reason = error instanceof Error ? error.message : String(error);
        canvas.dataset.sparkStatus = "error";
        console.error("[REAI] Spark delivery renderer failed:", error);
        setSpinoffStatus("error");
        setStatus(t("viewer.status.error", lang));
        onError?.(reason);
      }
    })();

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [lang, ready, splatUrl, useSparkEngine]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── UI ─────────────────────────────────────────────────────────────────────

  return (
    <div
      ref={rootRef}
      className={`relative h-full w-full select-none ${className ?? ""}`}
      // The Gaussian canvases are transparent wherever coverage is incomplete,
      // so this element is literally the backdrop of the render rather than
      // decoration around it. Set from the same constant the two engines use —
      // as a style rather than a class so a caller's className cannot silently
      // put the page white back underneath the splats.
      style={{ backgroundColor: SPLAT_BACKDROP_CSS }}
      aria-busy={!visibleReady}
    >
      <canvas
        ref={canvasRef}
        tabIndex={0}
        aria-label={t("viewer.canvas", lang)}
        onPointerDown={(event) => {
          // Keyboard focus is useful for desktop shortcuts, but focusing a
          // canvas during a phone touch can cancel the gesture before its
          // first move on mobile Chromium.
          if (event.pointerType !== "touch") {
            event.currentTarget.focus();
          }
        }}
        className={`block h-full w-full outline-none ${
          spinoffEligible && spatialNavigation ? "absolute inset-0 z-10" : ""
        }`}
        style={{ touchAction: "none", overscrollBehavior: "none" }}
      />

      {useSparkEngine ? (
        <canvas
          ref={sparkCanvasRef}
          aria-label="Spark Gaussian renderer"
          data-render-profile="spark"
          className={`pointer-events-none absolute inset-0 h-full w-full transition-opacity duration-200 ${
            spatialNavigation ? "z-0" : "z-10"
          } ${
            spinoffStatus === "ready" ? "opacity-100" : "opacity-0"
          }`}
        />
      ) : null}

      {spinoffEligible && !useSparkEngine ? (
        <canvas
          ref={spinoffCanvasRef}
          aria-label="Spinoff Gaussian renderer"
          className={`pointer-events-none absolute inset-0 h-full w-full transition-opacity duration-200 ${
            spatialNavigation ? "z-0" : "z-10"
          } ${
            spinoffStatus === "ready" ? "opacity-100" : "opacity-0"
          }`}
        />
      ) : null}

      {selectionGesture ? (
        <svg
          className="pointer-events-none absolute inset-0 z-20 h-full w-full overflow-visible"
          aria-hidden="true"
        >
          {selectionGesture.tool === "box" && selectionGesture.points.length > 1 ? (
            <rect
              x={Math.min(selectionGesture.points[0].x, selectionGesture.points[1].x)}
              y={Math.min(selectionGesture.points[0].y, selectionGesture.points[1].y)}
              width={Math.abs(selectionGesture.points[1].x - selectionGesture.points[0].x)}
              height={Math.abs(selectionGesture.points[1].y - selectionGesture.points[0].y)}
              fill="rgba(249, 115, 22, 0.10)"
              stroke="rgba(249, 115, 22, 0.96)"
              strokeWidth="1.25"
            />
          ) : null}
          {selectionGesture.tool !== "box" && selectionGesture.points.length > 1 ? (
            <path
              d={`${selectionGesture.points.map((point, index) => (
                `${index ? "L" : "M"} ${point.x} ${point.y}`
              )).join(" ")}${selectionGesture.tool === "lasso" ? " Z" : ""}`}
              fill={selectionGesture.tool === "lasso" ? "rgba(249, 115, 22, 0.08)" : "none"}
              stroke="rgba(249, 115, 22, 0.96)"
              strokeWidth={selectionGesture.tool === "brush" ? Math.max(1, splatBrushRadius * 2) : 1.25}
              strokeOpacity={selectionGesture.tool === "brush" ? 0.22 : 1}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ) : null}
          {selectionGesture.tool === "brush" ? (
            <circle
              cx={selectionGesture.pointer.x}
              cy={selectionGesture.pointer.y}
              r={splatBrushRadius}
              fill="rgba(249, 115, 22, 0.08)"
              stroke="rgba(249, 115, 22, 0.98)"
              strokeWidth="1.25"
            />
          ) : null}
        </svg>
      ) : null}

      {immersiveControls && !spatialNavigation && visibleReady && (
        <>
          <div
            className={`pointer-events-none absolute inset-x-0 top-[42%] z-10 flex justify-center px-6 transition-all duration-500 md:hidden ${showGestureHint ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"}`}
            aria-hidden={!showGestureHint}
          >
            <div className="rounded-full border border-white/10 bg-black/55 px-4 py-2 text-center text-[12px] font-medium text-white/85 shadow-xl backdrop-blur-xl">
              {t("viewer.immersive.gestureHint", lang)}
            </div>
          </div>

          <div className="pointer-events-none absolute right-3 top-[calc(3.75rem+env(safe-area-inset-top,0px))] z-10 flex flex-col gap-2 md:hidden">
            <button
              type="button"
              onClick={resetImmersiveView}
              disabled={!immersiveAdjusted}
              aria-label={t("viewer.immersive.reset", lang)}
              className="floating-icon-button pointer-events-auto border border-white/10 bg-black/45 text-white/90 shadow-lg backdrop-blur-xl enabled:hover:bg-black/60 enabled:active:scale-95 disabled:opacity-35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
            >
              <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M4.7 8.7A8 8 0 1 1 4 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                <path d="M4.7 4.8v3.9h3.9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>

            {canFullscreen && (
              <button
                type="button"
                onClick={() => { void toggleFullscreen(); }}
                aria-label={t(isFullscreen ? "viewer.immersive.exitFullscreen" : "viewer.immersive.fullscreen", lang)}
                className="floating-icon-button pointer-events-auto border border-white/10 bg-black/45 text-white/90 shadow-lg backdrop-blur-xl hover:bg-black/60 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
              >
                <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none">
                  {isFullscreen ? (
                    <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  ) : (
                    <path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  )}
                </svg>
              </button>
            )}
          </div>
        </>
      )}

      {/* Keep one loading surface mounted and cross-fade it into the first
          rendered frame. This avoids the page loader → viewer loader flash. */}
      <div
        className={`absolute inset-0 flex flex-col items-center justify-center bg-background text-foreground transition-opacity duration-500 ease-[var(--motion-ease-smooth)] ${
          spatialNavigation ? "z-40" : "z-10"
        } ${
          visibleReady ? "pointer-events-none opacity-0" : "opacity-100"
        }`}
        aria-hidden={visibleReady}
        inert={visibleReady ? true : undefined}
      >
        <ReaigenLoadingMark
          status={status}
          slowStatus={t("viewer.status.slow", lang)}
          retryLabel={t("common.tryAgain", lang)}
          cancelLabel={t("common.back", lang)}
          onRetry={onRetry}
          onCancel={onCancel}
        />
      </div>
    </div>
  );
});

export default SplatViewer;

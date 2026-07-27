"use client";

import { useEffect, useRef, useState, useCallback, forwardRef, useImperativeHandle } from "react";
import { AllocateShBuffers } from "@babylonjs/core/Meshes/GaussianSplatting/gaussianSplattingMeshBase.js";
import { cameraFovRadians, normalizeCameraData } from "@/app/lib/camera-coordinates";
import { getCache, putCache } from "@/app/lib/splat-cache";
import { t } from "@/app/lib/i18n";
import type {
  CameraData,
  GlobalSceneTransform,
  RoomKitCageWall,
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
  IDENTITY_GLOBAL_SCENE_TRANSFORM,
  inversePresentationPoint,
  transformCanonicalPoint,
} from "@/app/lib/global-scene-transform";
import { resolveRoomKitMovement } from "@/app/lib/spatial-editor-data";

/**
 * SplatViewer — BabylonJS Gaussian Splatting renderer with guided tour.
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
const DEFAULT_IMMERSIVE_FOV = 85 * Math.PI / 180;

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
    xs.push(x);
    ys.push(y);
    zs.push(z);
  }

  if (xs.length < 8) return null;
  const sortedX = [...xs].sort((a, b) => a - b);
  const sortedY = [...ys].sort((a, b) => a - b);
  const sortedZ = [...zs].sort((a, b) => a - b);

  // Match the native renderer: p5/p95 removes flyaway Gaussians without
  // shaving away the room envelope.
  const minX = percentile(sortedX, 0.05);
  const maxX = percentile(sortedX, 0.95);
  const floorY = percentile(sortedY, 0.05);
  const ceilingY = percentile(sortedY, 0.95);
  const minZ = percentile(sortedZ, 0.05);
  const maxZ = percentile(sortedZ, 0.95);
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

  let safeX = center[0];
  let safeZ = center[2];
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
    safeX = minX + ((gx + 0.5) / gridSize) * width;
    safeZ = minZ + ((gz + 0.5) / gridSize) * depth;
  } else if (floorCount >= 10) {
    safeX = floorXSum / floorCount;
    safeZ = floorZSum / floorCount;
  } else if (eyeCount >= 5) {
    safeX = eyeXSum / eyeCount;
    safeZ = eyeZSum / eyeCount;
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
  fromAngle: number;
  toAngle: number;
  fromPitch: number;
  toPitch: number;
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
  fromAngle: 0, toAngle: 0,
  fromPitch: 0, toPitch: 0,
  fromFov: 0.66, toFov: 0.66,
  holdActive: false, holdElapsed: 0, holdDuration: 4.5,
  holdPos: [0, 0, 0], holdAngle: 0, holdPanAmt: 0, holdBaseFov: 0.66,
});

interface ImmersivePose {
  enabled: boolean;
  basePosition: Vec3;
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
  baseForward: [0, 0, 1],
  baseUp: [0, 1, 0],
  yawOffset: 0,
  pitchOffset: 0,
  dolly: 0,
  maxDolly: 0.75,
  fov: 0.66,
});

// ── Props & Handle ───────────────────────────────────────────────────────────

interface Props {
  splatUrl: string;
  splatId?: number;
  tourUrl?: string;
  camerasUrl?: string;
  /** Camera data passed directly (avoids fetch). Takes priority over camerasUrl. */
  initialCameras?: CameraData | null;
  preferSavedCameras?: boolean;
  readOnly?: boolean;
  /** outputs_updated_at from backend — used as cache version key */
  outputsVersion?: string | null;
  className?: string;
  onShotChange?: (idx: number, shot: TourShot | null) => void;
  onReady?: () => void;
  onError?: (msg: string) => void;
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
  spatialGizmoResetKey?: string | number | null;
  onSpatialTransformChange?: (transform: GlobalSceneTransform) => void;
  onInspectionStats?: (stats: SplatInspectionStats | null) => void;
  spatialNavigation?: boolean;
  spatialCameraMode?: SpatialCameraMode;
  onSpatialCameraModeChange?: (mode: SpatialCameraMode) => void;
  lang?: string;
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
    outputsVersion,
    className,
    onShotChange,
    onReady,
    onError,
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
    spatialGizmoResetKey,
    onSpatialTransformChange,
    onInspectionStats,
    spatialNavigation = false,
    spatialCameraMode = "orbit",
    onSpatialCameraModeChange,
    lang = "en",
  },
  ref,
) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<any>(null);
  const cameraRef = useRef<any>(null);
  const babylonRef = useRef<any>(null);
  const sceneRef = useRef<any>(null);
  const gsRef = useRef<any>(null);
  const spatialRootRef = useRef<any>(null);
  const spatialGizmoManagerRef = useRef<any>(null);
  const globalSceneTransformRef = useRef(globalSceneTransform);
  const onSpatialTransformChangeRef = useRef(onSpatialTransformChange);
  const splatBufferRef = useRef<ArrayBuffer | null>(null);
  const inspectionSampleRef = useRef<SplatSample | null>(null);
  const resizeRef = useRef<(() => void) | null>(null);
  const animRef = useRef<Anim>(defaultAnim());
  const shotIdxRef = useRef(0);
  const pathDataRef = useRef<{
    positions: Vec3[]; forwards: Vec3[]; ups: Vec3[]; arcLens: number[];
    totalArc: number; shots: TourShot[];
  } | null>(null);
  const cameraUpRef = useRef<Vec3>([0, 1, 0]);
  const canonicalTourDataRef = useRef<TourData | null>(null);
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

  const [status, setStatus] = useState(() => t("viewer.status.loading", lang));
  const [downloadPct, setDownloadPct] = useState(0);
  const [ready, setReady] = useState(false);
  const [tourData, setTourData] = useState<TourData | null>(null);
  const [immersiveAdjusted, setImmersiveAdjusted] = useState(false);
  const [showGestureHint, setShowGestureHint] = useState(false);
  const [canFullscreen, setCanFullscreen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [compactTouch, setCompactTouch] = useState(() => (
    typeof window !== "undefined" && window.matchMedia("(max-width: 767px), (pointer: coarse)").matches
  ));
  const fallbackSceneRef = useRef<SceneFrame | null>(null);
  const immersiveControls = Boolean(readOnly || compactTouch);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 767px), (pointer: coarse)");
    const sync = () => setCompactTouch(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  const setImmersiveBase = useCallback((
    pos: Vec3,
    fwd: Vec3,
    fov?: number,
    authoredUp: Vec3 = cameraUpRef.current,
  ) => {
    const length = Math.hypot(fwd[0], fwd[1], fwd[2]) || 1;
    const forward: Vec3 = [fwd[0] / length, fwd[1] / length, fwd[2] / length];
    const upDot = authoredUp[0] * forward[0]
      + authoredUp[1] * forward[1]
      + authoredUp[2] * forward[2];
    const projectedUp: Vec3 = [
      authoredUp[0] - forward[0] * upDot,
      authoredUp[1] - forward[1] * upDot,
      authoredUp[2] - forward[2] * upDot,
    ];
    let upLength = Math.hypot(...projectedUp);
    if (upLength < 1e-6) {
      const fallback: Vec3 = Math.abs(forward[1]) < 0.98 ? [0, 1, 0] : [0, 0, 1];
      const fallbackDot = fallback[0] * forward[0]
        + fallback[1] * forward[1]
        + fallback[2] * forward[2];
      projectedUp[0] = fallback[0] - forward[0] * fallbackDot;
      projectedUp[1] = fallback[1] - forward[1] * fallbackDot;
      projectedUp[2] = fallback[2] - forward[2] * fallbackDot;
      upLength = Math.hypot(...projectedUp) || 1;
    }
    const up: Vec3 = [
      projectedUp[0] / upLength,
      projectedUp[1] / upLength,
      projectedUp[2] / upLength,
    ];
    const sceneRadius = fallbackSceneRef.current?.radius ?? 8;
    immersivePoseRef.current = {
      enabled: true,
      basePosition: [pos[0], pos[1], pos[2]],
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
  }, [globalSceneTransform.scale]);

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
    let px = pose.basePosition[0] + planarForward[0] * pose.dolly;
    let py = pose.basePosition[1] + planarForward[1] * pose.dolly;
    let pz = pose.basePosition[2] + planarForward[2] * pose.dolly;

    // Collision is authored in canonical capture space. Resolve the world-space
    // movement through the inverse USD root, then compose the accepted point
    // back to presentation space. This keeps RoomKit, cameras and Gaussians
    // coincident after any global translation/rotation/scale.
    const frame = fallbackSceneRef.current;
    if ((roomKitCage.length || frame) && Math.abs(pose.dolly) > 1e-5) {
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
    cameraUpRef.current = [...up] as Vec3;
    cam.upVector.set(up[0], up[1], up[2]);
    cam.position.set(pos[0], pos[1], pos[2]);
    if (exactForward) {
      cam.setTarget(new B.Vector3(
        pos[0] + fwd[0] * LOOK,
        pos[1] + fwd[1] * LOOK,
        pos[2] + fwd[2] * LOOK,
      ));
    } else {
      cam.setTarget(new B.Vector3(
        pos[0] + fwd[0] * LOOK,
        pos[1] - TILT_Y,
        pos[2] + fwd[2] * LOOK,
      ));
    }
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

  const applyTourData = useCallback((data: TourData) => {
    setTourData(data);
    onTourLoaded?.(data);
    canonicalTourDataRef.current = data;
    const worldPath = worldTourPath(data);
    pathDataRef.current = worldPath;
    progressRef.current = data.arcLens?.[data.startIdx ?? 0] ?? 0;

    const shot0 = data.shots[0];
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
    const useExactForward = isSavedCameraTour(data);

    const cam = cameraRef.current;
    cameraUpRef.current = [...tUp] as Vec3;
    cam.upVector.set(tUp[0], tUp[1], tUp[2]);
    freeModeRef.current = false;
    cam.detachControl();
    if (immersiveControls) setImmersiveBase(tPos, tFwd, shot.fov, tUp);

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
    anim.fromAngle = Math.atan2(dz / dlen, dx / dlen);
    anim.toAngle = Math.atan2(tFwd[2], tFwd[0]);
    anim.fromPitch = Math.asin(Math.max(-1, Math.min(1, dy / dlen)));
    anim.toPitch = Math.asin(Math.max(-1, Math.min(1, tFwd[1])));
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
  }, [tourData, onShotChange, immersiveControls, setImmersiveBase]);

  const goToPrev = useCallback(() => {
    const n = tourData?.shots.length ?? 0;
    if (!n) return;
    if (shotIdxRef.current <= 0) return;
    goToShot(shotIdxRef.current - 1);
  }, [goToShot, tourData]);

  const goToNext = useCallback(() => {
    const n = tourData?.shots.length ?? 0;
    if (!n) return;
    if (shotIdxRef.current >= n - 1) return;
    goToShot(shotIdxRef.current + 1);
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
    const worldUp: Vec3 = [cam.upVector.x, cam.upVector.y, cam.upVector.z];
    return {
      position: inverseTransformSpatialPoint(worldPos),
      forward: inverseTransformSpatialDirection(worldForward),
      up: inverseTransformSpatialDirection(worldUp),
      fov: cam.fov,
    };
  }, [inverseTransformSpatialDirection, inverseTransformSpatialPoint]);

  const getTourData = useCallback(() => tourData, [tourData]);

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

    // Stop everything — no hold phase, no scroll, no path scrub
    pathScrubRef.current = null;
    scrollVelocityRef.current = 0;
    freeModeRef.current = false;
    cam.detachControl();
    cameraUpRef.current = [...up] as Vec3;
    cam.upVector.set(up[0], up[1], up[2]);
    if (immersiveControls) setImmersiveBase(pos, fwd, targetFov, up);

    const toTarget: Vec3 = [
      pos[0] + fwd[0] * LOOK,
      pos[1] + fwd[1] * LOOK,
      pos[2] + fwd[2] * LOOK,
    ];

    if (instant) {
      cam.position.set(pos[0], pos[1], pos[2]);
      cam.setTarget(new B.Vector3(toTarget[0], toTarget[1], toTarget[2]));
      cam.fov = targetFov;
      immersiveRenderBurstUntilRef.current = performance.now() + 220;
      animRef.current.active = false;
      animRef.current.holdActive = false;
      if (!immersiveControls && !spatialNavigationRef.current && canvasRef.current) {
        cam.attachControl(canvasRef.current, true);
      }
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
    anim.fromAngle = Math.atan2(cdz / clen, cdx / clen);
    anim.toAngle = Math.atan2(fwd[2], fwd[0]);
    anim.fromPitch = Math.asin(Math.max(-1, Math.min(1, cdy / clen)));
    anim.toPitch = Math.asin(Math.max(-1, Math.min(1, fwd[1])));
    anim.fromFov = cam.fov;
    anim.toFov = targetFov;
    anim.elapsed = 0;
    // Camera-to-camera travel is deliberately short and distance-aware.
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
  }, [immersiveControls, setImmersiveBase]);

  const navigateToCamera = useCallback((
    pos: Vec3,
    fwd: Vec3,
    instant = false,
    fov?: number,
    up: Vec3 = [0, 1, 0],
  ) => {
    const camera = cameraRef.current;
    if (!camera) return;
    const worldUp = transformSpatialDirection(up);
    cameraUpRef.current = [...worldUp] as Vec3;
    camera.upVector.set(worldUp[0], worldUp[1], worldUp[2]);
    spatialOrbitRef.current.enabled = false;
    navigateToWorldCamera(
      transformSpatialPoint(pos),
      transformSpatialDirection(fwd),
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
  }, [immersiveControls, setImmersiveBase]);

  const applySpatialOrbitPose = useCallback(() => {
    const camera = cameraRef.current;
    const B = babylonRef.current;
    const pose = spatialOrbitRef.current;
    if (!camera || !B || !pose.enabled) return;
    const cosPitch = Math.cos(pose.pitch);
    camera.position.set(
      pose.target[0] + pose.radius * cosPitch * Math.cos(pose.yaw),
      pose.target[1] + pose.radius * Math.sin(pose.pitch),
      pose.target[2] + pose.radius * cosPitch * Math.sin(pose.yaw),
    );
    camera.upVector.set(0, 1, 0);
    camera.setTarget(new B.Vector3(pose.target[0], pose.target[1], pose.target[2]));
    camera.rotation.z = 0;
    immersiveRenderBurstUntilRef.current = performance.now() + 350;
  }, []);

  const frameScene = useCallback((instant = false) => {
    const frame = fallbackSceneRef.current;
    const camera = cameraRef.current;
    const B = babylonRef.current;
    if (!frame || !camera || !B) return;

    const canonicalCamera = inversePresentationPoint(
      [camera.position.x, camera.position.y, camera.position.z],
      globalSceneTransformRef.current,
    );
    const footprintWidth = frame.footprint.maxX - frame.footprint.minX;
    const footprintDepth = frame.footprint.maxZ - frame.footprint.minZ;
    const marginX = Math.max(0.15, footprintWidth * 0.04);
    const marginZ = Math.max(0.15, footprintDepth * 0.04);
    const cameraInside = (
      canonicalCamera[0] >= frame.footprint.minX - marginX
      && canonicalCamera[0] <= frame.footprint.maxX + marginX
      && canonicalCamera[2] >= frame.footprint.minZ - marginZ
      && canonicalCamera[2] <= frame.footprint.maxZ + marginZ
    );

    if (cameraInside) {
      // Interior work is about the room around the current view, not the full
      // reconstruction envelope. Establish a local orbit pivot in front of
      // the user without moving the camera by even one pixel.
      const currentTarget = camera.getTarget();
      const forward = currentTarget.subtract(camera.position).normalize();
      const focusDistance = Math.max(1.25, Math.min(3, frame.radius * 0.5));
      const target = camera.position.add(forward.scale(focusDistance));
      const offset = camera.position.subtract(target);
      const radius = Math.max(0.25, offset.length());
      spatialOrbitRef.current = {
        enabled: true,
        target: [target.x, target.y, target.z],
        radius,
        yaw: Math.atan2(offset.z, offset.x),
        pitch: Math.asin(Math.max(-1, Math.min(1, offset.y / radius))),
      };
      immersiveRenderBurstUntilRef.current = performance.now() + 200;
      return;
    }

    // An exterior camera is intentionally asking for the complete asset.
    const center = transformSpatialPoint(frame.center);
    const pose = spatialOrbitRef.current;
    pose.enabled = true;
    pose.target = center;
    pose.radius = Math.max(
      2.2,
      frame.radius * globalSceneTransformRef.current.scale * 1.65,
    );
    pose.yaw = Math.PI / 4;
    pose.pitch = 22 * Math.PI / 180;
    if (instant) {
      applySpatialOrbitPose();
      return;
    }
    const cosPitch = Math.cos(pose.pitch);
    const position: Vec3 = [
      pose.target[0] + pose.radius * cosPitch * Math.cos(pose.yaw),
      pose.target[1] + pose.radius * Math.sin(pose.pitch),
      pose.target[2] + pose.radius * cosPitch * Math.sin(pose.yaw),
    ];
    const forward = normalizeVec3([
      pose.target[0] - position[0],
      pose.target[1] - position[1],
      pose.target[2] - position[2],
    ]);
    navigateToWorldCamera(position, forward, false, cameraRef.current?.fov, [0, 1, 0]);
  }, [
    applySpatialOrbitPose,
    navigateToWorldCamera,
    transformSpatialPoint,
  ]);

  const navigateToSpatialCamera = useCallback((sample: SpatialCameraSample, instant = true) => {
    const camera = cameraRef.current;
    if (!camera) return;
    const position = transformSpatialPoint(sample.position);
    const forward = transformSpatialDirection(sample.forward);
    const up = transformSpatialDirection(sample.up);
    cameraUpRef.current = [...up] as Vec3;
    camera.upVector.set(up[0], up[1], up[2]);
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
  }, [spatialNavigation]);

  const setFov = useCallback((degrees: number) => {
    const cam = cameraRef.current;
    if (!cam) return;
    // BabylonJS camera.fov is vertical FOV in radians
    const radians = (degrees * Math.PI) / 180;
    cam.fov = radians;
    if (immersivePoseRef.current.enabled) immersivePoseRef.current.fov = radians;
    immersiveRenderBurstUntilRef.current = performance.now() + 350;
  }, []);

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
    const [x, y, z] = globalSceneTransform.rotationDeg;
    const [tx, ty, tz] = globalSceneTransform.translation;
    root.position.set(tx, ty, tz);
    root.scaling.setAll(globalSceneTransform.scale);
    root.rotationQuaternion = B.Quaternion.RotationYawPitchRoll(
      y * Math.PI / 180,
      x * Math.PI / 180,
      z * Math.PI / 180,
    );
    gs.parent = root;
    root.computeWorldMatrix(true);
    scene.render();
  }, [globalSceneTransform, ready]);

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
    const gizmoScale = compactTouch ? 1.72 : 1.46;
    const axisScale = gizmoScale * 1.08;
    const manager = new B.GizmoManager(scene, compactTouch ? 4.2 : 3.5);
    spatialGizmoManagerRef.current = manager;
    manager.usePointerToAttachGizmos = false;
    manager.enableAutoPicking = false;
    manager.clearGizmoOnEmptyPointerEvent = false;
    manager.scaleRatio = gizmoScale;
    if (B.GizmoCoordinatesMode?.World != null) {
      manager.coordinatesMode = B.GizmoCoordinatesMode.World;
    }

    manager.positionGizmoEnabled = spatialTransformTool === "move";
    manager.rotationGizmoEnabled = spatialTransformTool === "rotate";
    manager.scaleGizmoEnabled = spatialTransformTool === "scale";
    manager.attachToNode(root);

    const palette = {
      x: B.Color3.FromHexString("#FF1F3D"),
      y: B.Color3.FromHexString("#00D95F"),
      z: B.Color3.FromHexString("#087BFF"),
      neutral: B.Color3.FromHexString("#FFF8E7"),
    };
    const tuneHandle = (handle: any, color: any, alpha = 1) => {
      if (!handle) return;
      if (handle.coloredMaterial) {
        handle.coloredMaterial.diffuseColor = color;
        handle.coloredMaterial.emissiveColor = color;
        handle.coloredMaterial.specularColor = B.Color3.Black();
        handle.coloredMaterial.disableLighting = true;
        handle.coloredMaterial.alpha = alpha;
      }
      if (handle.hoverMaterial) {
        const hover = B.Color3.Lerp(color, B.Color3.White(), 0.24);
        handle.hoverMaterial.diffuseColor = hover;
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
      positionGizmo.snapDistance = 0;
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
      rotationGizmo.snapDistance = 0;
      rotationGizmo.xGizmo.scaleRatio = gizmoScale;
      rotationGizmo.yGizmo.scaleRatio = gizmoScale;
      rotationGizmo.zGizmo.scaleRatio = gizmoScale;
      tuneHandle(rotationGizmo.xGizmo, palette.x);
      tuneHandle(rotationGizmo.yGizmo, palette.y);
      tuneHandle(rotationGizmo.zGizmo, palette.z);
    }

    const scaleGizmo = manager.gizmos.scaleGizmo;
    if (scaleGizmo) {
      // The shared scene contract permits only a uniform root scale.
      scaleGizmo.xGizmo.isEnabled = false;
      scaleGizmo.yGizmo.isEnabled = false;
      scaleGizmo.zGizmo.isEnabled = false;
      scaleGizmo.uniformScaleGizmo.isEnabled = true;
      scaleGizmo.snapDistance = 0;
      tuneHandle(scaleGizmo.uniformScaleGizmo, palette.neutral);
    }

    const activeGizmo = positionGizmo ?? rotationGizmo ?? scaleGizmo;
    const publishTransform = () => {
      const previous = globalSceneTransformRef.current;
      if (spatialTransformTool === "scale") {
        const uniformScale = Math.max(
          0.001,
          Math.min(1000, Number(root.scaling.x.toFixed(4))),
        );
        root.scaling.setAll(uniformScale);
      }

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
          ? Math.max(0.001, Math.min(1000, Number(root.scaling.x.toFixed(4))))
          : previous.scale,
      };

      globalSceneTransformRef.current = nextTransform;
      onSpatialTransformChangeRef.current?.(nextTransform);
      root.computeWorldMatrix(true);
      immersiveRenderBurstUntilRef.current = performance.now() + 300;
    };

    const dragObserver = activeGizmo?.onDragObservable.add(publishTransform);
    const dragEndObserver = activeGizmo?.onDragEndObservable.add(publishTransform);
    scene.render();

    return () => {
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
      const transformedGridAnchor = B.Vector3.TransformCoordinates(
        new B.Vector3(centerX, (frame?.floorY ?? 0), centerZ),
        root.getWorldMatrix(),
      );
      const gridRadius = canonicalGridRadius * Math.max(
        0.001,
        Math.abs(globalSceneTransformRef.current.scale),
      );
      const majorStep = gridRadius > 7 ? 2 : 1;
      const minorStep = majorStep / 4;
      const halfSize = Math.ceil(gridRadius / majorStep) * majorStep;
      // Reaigen presentation space is explicitly Y-up. The working grid is a
      // DCC world reference, not object geometry, so it remains on world XZ
      // even while the authored USD root rotates or scales the scan.
      centerX = transformedGridAnchor.x;
      centerZ = transformedGridAnchor.z;
      const floorY = transformedGridAnchor.y + 0.006;
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
        // A fine light stroke over a wider dark keyline remains legible on
        // both white walls and dark floors without reading as neon.
        drawGridLine(
          fromX,
          fromY,
          toX,
          toY,
          major ? "rgba(10, 13, 17, 0.50)" : "rgba(12, 15, 19, 0.25)",
          major ? 3.2 : 1.8,
        );
        drawGridLine(
          fromX,
          fromY,
          toX,
          toY,
          major ? "rgba(242, 245, 248, 0.56)" : "rgba(242, 245, 248, 0.34)",
          major ? 1.25 : 0.72,
        );
      };
      const drawAxisLine = (
        fromX: number,
        fromY: number,
        toX: number,
        toY: number,
        color: string,
      ) => {
        drawGridLine(fromX, fromY, toX, toY, "rgba(8, 10, 14, 0.45)", 4.1);
        drawGridLine(fromX, fromY, toX, toY, color, 2.1);
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
      if (minZ <= 0 && maxZ >= 0) {
        const xAxisPixel = textureSize - coordinateToPixel(0, minZ);
        drawAxisLine(
          0,
          xAxisPixel,
          textureSize,
          xAxisPixel,
          "rgba(255, 46, 72, 0.82)",
        );
      }
      // The editor grid is local to the current working area. Keep a subtle
      // crosshair at that anchor even when the absolute USD origin is outside
      // the room, so its orientation remains immediately readable.
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
      if (minX <= 0 && maxX >= 0) {
        const zAxisPixel = coordinateToPixel(0, minX);
        drawAxisLine(
          zAxisPixel,
          0,
          zAxisPixel,
          textureSize,
          "rgba(30, 139, 255, 0.82)",
        );
      }

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
          float cameraDistance = distance(vWorldPosition, cameraPosition);
          float distanceFade = 1.0 - smoothstep(fadeStart, fadeEnd, cameraDistance);
          vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
          float incidence = abs(dot(viewDirection, normalize(gridNormal)));
          float horizonFade = smoothstep(0.055, 0.22, incidence);
          float alpha = grid.a * distanceFade * horizonFade * opacity;
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

    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let usedSavedCameras = false;

    const tryLoadSavedCameras = async () => {
      // Use directly-provided camera data first (avoids data: URL / fetch issues)
      if (initialCameras) {
        if (!initialCameras.cameras?.length) return false;
        const savedTour = buildTourFromSavedCameras(initialCameras);
        if (!savedTour || cancelled) return false;
        usedSavedCameras = true;
        applyTourData(savedTour);
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
        applyTourData(savedTour);
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
              applyTourData(data);
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

          applyTourData(data);
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

    type EditorPointer = { x: number; y: number; pan: boolean };
    const pointers = new Map<number, EditorPointer>();
    const pressed = new Set<string>();
    let previousPinchDistance: number | null = null;
    let previousCentroid: { x: number; y: number } | null = null;
    let flyYaw = 0;
    let flyPitch = 0;

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
    const markMoving = () => {
      immersiveRenderBurstUntilRef.current = performance.now() + 350;
    };
    const panOrbit = (dx: number, dy: number) => {
      const pose = spatialOrbitRef.current;
      const forward = new B.Vector3(
        pose.target[0] - camera.position.x,
        pose.target[1] - camera.position.y,
        pose.target[2] - camera.position.z,
      ).normalize();
      const right = B.Vector3.Cross(forward, B.Vector3.Up()).normalize();
      const up = B.Vector3.Cross(right, forward).normalize();
      const scale = Math.max(0.0008, pose.radius * 0.0012);
      const movement = right.scale(-dx * scale).add(up.scale(dy * scale));
      pose.target = [
        pose.target[0] + movement.x,
        pose.target[1] + movement.y,
        pose.target[2] + movement.z,
      ];
      applySpatialOrbitPose();
    };
    const dollyOrbit = (amount: number) => {
      const pose = spatialOrbitRef.current;
      pose.radius = Math.max(0.12, Math.min(250, pose.radius * Math.exp(amount)));
      applySpatialOrbitPose();
    };
    const moveFly = (amount: number) => {
      const target = camera.getTarget();
      const forward = target.subtract(camera.position).normalize();
      camera.position.addInPlace(forward.scale(amount));
      camera.setTarget(camera.position.add(forward));
      markMoving();
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (event.pointerType === "mouse" && ![0, 1, 2].includes(event.button)) return;
      const gizmoManager = spatialGizmoManagerRef.current;
      if (gizmoManager?.isHovered || gizmoManager?.isDragging) return;
      const pan = event.button === 1
        || event.button === 2
        || event.shiftKey
        || event.altKey
        || (event.pointerType === "pen" && (event.buttons & 2) !== 0);
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, pan });
      previousPinchDistance = pinchDistance();
      previousCentroid = pointerCentroid();
      syncFlyAngles();
      try { canvas.setPointerCapture(event.pointerId); } catch { /* best effort */ }
      canvas.style.cursor = pan ? "grabbing" : "grabbing";
      event.preventDefault();
    };

    const handlePointerMove = (event: PointerEvent) => {
      const previous = pointers.get(event.pointerId);
      if (!previous) return;
      pointers.set(event.pointerId, { ...previous, x: event.clientX, y: event.clientY });

      if (pointers.size >= 2 && spatialCameraMode === "orbit") {
        const nextCentroid = pointerCentroid();
        const nextDistance = pinchDistance();
        if (nextCentroid && previousCentroid) {
          panOrbit(nextCentroid.x - previousCentroid.x, nextCentroid.y - previousCentroid.y);
        }
        if (nextDistance && previousPinchDistance) {
          dollyOrbit(Math.log(previousPinchDistance / nextDistance));
        }
        previousCentroid = nextCentroid;
        previousPinchDistance = nextDistance;
        event.preventDefault();
        return;
      }

      const dx = event.clientX - previous.x;
      const dy = event.clientY - previous.y;
      if (spatialCameraMode === "orbit") {
        if (previous.pan) {
          panOrbit(dx, dy);
        } else {
          const pose = spatialOrbitRef.current;
          pose.yaw -= dx * 0.006;
          pose.pitch = Math.max(-Math.PI * 0.485, Math.min(Math.PI * 0.485, pose.pitch + dy * 0.006));
          applySpatialOrbitPose();
        }
      } else {
        flyYaw -= dx * 0.0045;
        flyPitch = Math.max(-Math.PI * 0.485, Math.min(Math.PI * 0.485, flyPitch - dy * 0.0045));
        const cosPitch = Math.cos(flyPitch);
        camera.setTarget(camera.position.add(new B.Vector3(
          Math.cos(flyYaw) * cosPitch,
          Math.sin(flyPitch),
          Math.sin(flyYaw) * cosPitch,
        )));
        markMoving();
      }
      event.preventDefault();
    };

    const finishPointer = (event: PointerEvent) => {
      pointers.delete(event.pointerId);
      previousPinchDistance = pinchDistance();
      previousCentroid = pointerCentroid();
      try { canvas.releasePointerCapture(event.pointerId); } catch { /* best effort */ }
      if (!pointers.size) canvas.style.cursor = spatialCameraMode === "orbit" ? "grab" : "crosshair";
      event.preventDefault();
    };

    const handleWheel = (event: WheelEvent) => {
      if (spatialGizmoManagerRef.current?.isDragging) return;
      if (spatialCameraMode === "orbit") {
        dollyOrbit(event.deltaY * 0.0015);
      } else {
        const scale = fallbackSceneRef.current?.radius ?? 2;
        moveFly(-event.deltaY * scale * 0.0008);
      }
      event.preventDefault();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target?.isContentEditable
        || target?.tagName === "INPUT"
        || target?.tagName === "TEXTAREA"
        || target?.tagName === "SELECT"
      ) return;
      const key = event.key.toLowerCase();
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
      if (spatialCameraMode === "orbit") {
        const panStep = 24;
        if (event.key === "ArrowLeft") panOrbit(panStep, 0);
        else if (event.key === "ArrowRight") panOrbit(-panStep, 0);
        else if (event.key === "ArrowUp") panOrbit(0, panStep);
        else if (event.key === "ArrowDown") panOrbit(0, -panStep);
        else if (key === "+" || key === "=") dollyOrbit(-0.12);
        else if (key === "-" || key === "_") dollyOrbit(0.12);
        else return;
        event.preventDefault();
        return;
      }
      if (["w", "a", "s", "d", "q", "e"].includes(key)) {
        pressed.add(key);
        event.preventDefault();
      }
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      pressed.delete(event.key.toLowerCase());
    };
    const handleContextMenu = (event: MouseEvent) => event.preventDefault();
    const handleDoubleClick = () => {
      if (!spatialGizmoManagerRef.current?.isHovered) frameScene();
    };

    const movementObserver = scene.onBeforeRenderObservable.add(() => {
      if (spatialCameraMode !== "fly" || !pressed.size) return;
      const target = camera.getTarget();
      const forward = target.subtract(camera.position).normalize();
      const horizontalForward = new B.Vector3(forward.x, 0, forward.z).normalize();
      const right = B.Vector3.Cross(horizontalForward, B.Vector3.Up()).normalize();
      const seconds = Math.min(0.05, engineRef.current?.getDeltaTime?.() / 1000 || 1 / 60);
      const speed = Math.max(0.35, Math.min(4, (fallbackSceneRef.current?.radius ?? 2) * 0.75));
      const movement = B.Vector3.Zero();
      if (pressed.has("w")) movement.addInPlace(horizontalForward);
      if (pressed.has("s")) movement.subtractInPlace(horizontalForward);
      if (pressed.has("d")) movement.addInPlace(right);
      if (pressed.has("a")) movement.subtractInPlace(right);
      if (pressed.has("e")) movement.y += 1;
      if (pressed.has("q")) movement.y -= 1;
      if (movement.lengthSquared() > 0) {
        movement.normalize().scaleInPlace(speed * seconds);
        camera.position.addInPlace(movement);
        camera.setTarget(camera.position.add(forward));
        markMoving();
      }
    });

    canvas.style.cursor = spatialCameraMode === "orbit" ? "grab" : "crosshair";
    canvas.addEventListener("pointerdown", handlePointerDown);
    canvas.addEventListener("pointermove", handlePointerMove);
    canvas.addEventListener("pointerup", finishPointer);
    canvas.addEventListener("pointercancel", finishPointer);
    canvas.addEventListener("wheel", handleWheel, { passive: false });
    canvas.addEventListener("contextmenu", handleContextMenu);
    canvas.addEventListener("dblclick", handleDoubleClick);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    return () => {
      pointers.clear();
      pressed.clear();
      spatialOrbitRef.current.enabled = false;
      canvas.style.cursor = "";
      canvas.removeEventListener("pointerdown", handlePointerDown);
      canvas.removeEventListener("pointermove", handlePointerMove);
      canvas.removeEventListener("pointerup", finishPointer);
      canvas.removeEventListener("pointercancel", finishPointer);
      canvas.removeEventListener("wheel", handleWheel);
      canvas.removeEventListener("contextmenu", handleContextMenu);
      canvas.removeEventListener("dblclick", handleDoubleClick);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      scene.onBeforeRenderObservable.remove(movementObserver);
      if (!immersiveControls) camera.attachControl(canvas, true);
    };
  }, [
    applySpatialOrbitPose,
    frameScene,
    immersiveControls,
    onSpatialCameraModeChange,
    ready,
    spatialCameraMode,
    spatialNavigation,
  ]);

  // ── Keyboard navigation ────────────────────────────────────────────────────

  useEffect(() => {
    // In readOnly (shared tour), disable all keyboard navigation
    // so guests preview using only the on-screen controls
    if (readOnly || spatialNavigation) return;

    const MOVE_KEYS = new Set(["w", "a", "s", "d", "q", "e"]);
    const handleKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      // Arrow keys navigate between shots
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        goToPrev();
        return;
      }
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        e.stopPropagation();
        goToNext();
        return;
      }

      // WASD + Q/E = scene movement (free camera)
      if (MOVE_KEYS.has(e.key.toLowerCase())) {
        e.preventDefault();
        e.stopPropagation();
        if (!freeModeRef.current) enableFreeCamera();
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        enableFreeCamera();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [readOnly, spatialNavigation, enableFreeCamera, goToPrev, goToNext]);

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

    const pointers = new Map<number, { x: number; y: number }>();
    let lastPinchDistance: number | null = null;
    let pointerDownAt = 0;
    let pointerDownX = 0;
    let pointerDownY = 0;
    let gestureMoved = false;
    let lastTapAt = 0;
    let lastMoveAt = 0;

    const distanceBetweenPointers = () => {
      const values = [...pointers.values()];
      if (values.length < 2) return null;
      return Math.hypot(values[0].x - values[1].x, values[0].y - values[1].y);
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
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      lastPinchDistance = distanceBetweenPointers();
      try { canvas.setPointerCapture(event.pointerId); } catch { /* best effort */ }
      event.preventDefault();
    };

    const handlePointerMove = (event: PointerEvent) => {
      const previous = pointers.get(event.pointerId);
      if (!previous) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (animRef.current.active || !immersivePoseRef.current.enabled) return;

      const pose = immersivePoseRef.current;
      if (pointers.size >= 2) {
        immersiveCoastRef.current = { yaw: 0, pitch: 0 };
        const nextDistance = distanceBetweenPointers();
        if (nextDistance != null && lastPinchDistance != null) {
          const shortestSide = Math.max(240, Math.min(canvas.clientWidth, canvas.clientHeight));
          const distanceDelta = nextDistance - lastPinchDistance;
          pose.dolly = Math.max(
            -pose.maxDolly * 0.6,
            Math.min(pose.maxDolly, pose.dolly + distanceDelta * pose.maxDolly * 1.7 / shortestSide),
          );
          if (Math.abs(distanceDelta) > 0.25) markAdjusted();
        }
        lastPinchDistance = nextDistance;
      } else {
        const dx = event.clientX - previous.x;
        const dy = event.clientY - previous.y;
        const sensitivity = 0.004; // ≈ 0.23° per CSS pixel, matching iOS.
        const now = performance.now();
        const elapsedSeconds = Math.max(1 / 120, Math.min(0.08, (now - lastMoveAt) / 1000));
        pose.yawOffset -= dx * sensitivity;
        const pitchLimit = 85 * Math.PI / 180;
        pose.pitchOffset = Math.max(
          -pitchLimit,
          Math.min(pitchLimit, pose.pitchOffset - dy * sensitivity),
        );
        if (Math.hypot(event.clientX - pointerDownX, event.clientY - pointerDownY) > 5) {
          gestureMoved = true;
        }
        if (Math.abs(dx) > 0.1 || Math.abs(dy) > 0.1) markAdjusted();
        immersiveCoastRef.current = {
          yaw: (-dx * sensitivity) / elapsedSeconds,
          pitch: (-dy * sensitivity) / elapsedSeconds,
        };
        lastMoveAt = now;
      }

      applyImmersivePose();
      event.preventDefault();
    };

    const finishPointer = (event: PointerEvent, allowTap: boolean) => {
      const wasOnlyPointer = pointers.size === 1 && pointers.has(event.pointerId);
      pointers.delete(event.pointerId);
      immersivePointersActiveRef.current = pointers.size > 0;
      lastPinchDistance = distanceBetweenPointers();
      try { canvas.releasePointerCapture(event.pointerId); } catch { /* best effort */ }

      const now = performance.now();
      const isTap = allowTap && wasOnlyPointer && !gestureMoved && now - pointerDownAt < 280;
      if (isTap) {
        if (now - lastTapAt < 360) {
          resetImmersiveView();
          setShowGestureHint(false);
          lastTapAt = 0;
        } else {
          lastTapAt = now;
        }
      }
      if (!pointers.size) lastMoveAt = 0;
      event.preventDefault();
    };

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
    canvas.addEventListener("wheel", handleWheel, { passive: false });

    return () => {
      immersivePointersActiveRef.current = false;
      immersiveCoastRef.current = { yaw: 0, pitch: 0 };
      canvas.removeEventListener("pointerdown", handlePointerDown);
      canvas.removeEventListener("pointermove", handlePointerMove);
      canvas.removeEventListener("pointerup", handlePointerUp);
      canvas.removeEventListener("pointercancel", handlePointerCancel);
      canvas.removeEventListener("wheel", handleWheel);
    };
  }, [applyImmersivePose, immersiveControls, ready, resetImmersiveView, spatialNavigation]);

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

    async function init() {
      if (!canvasRef.current) return;
      try {
        setStatus(t("viewer.status.loadingEngine", lang));
        const BABYLON = await import("@babylonjs/core");
        await import("@babylonjs/loaders");
        babylonRef.current = BABYLON;
        if (disposed) return;

        const canvas = canvasRef.current;
        const engine = new BABYLON.Engine(canvas, true, {
          antialias: true, powerPreference: "high-performance",
          preserveDrawingBuffer: false, stencil: false,
        });
        engineRef.current = engine;

        // Keep the existing Retina cap for a settled frame, then use a modest
        // motion scale while a camera is travelling or being manipulated.
        // The canvas keeps its CSS size, so this is progressive refinement
        // rather than a layout change.
        const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
        const restingHardwareScale = Math.max(1, dpr / Math.min(dpr, 1.5));
        const motionHardwareScale = Math.max(
          restingHardwareScale,
          typeof window !== "undefined" && window.innerWidth * window.innerHeight > 1_900_000
            ? 1.65
            : 1.45,
        );
        let activeHardwareScale = restingHardwareScale;
        const applyHardwareScale = (next: number) => {
          if (Math.abs(activeHardwareScale - next) < 0.01) return;
          activeHardwareScale = next;
          engine.setHardwareScalingLevel(next);
          engine.resize();
        };
        engine.setHardwareScalingLevel(restingHardwareScale);

        engine.onContextLostObservable.add(() => console.warn("[REAI] WebGL context lost"));
        engine.onContextRestoredObservable.add(() => {
          console.log("[REAI] WebGL context restored");
          sceneRef.current?.render();
        });

        const scene = new BABYLON.Scene(engine);
        sceneRef.current = scene;
        scene.clearColor = new BABYLON.Color4(1, 1, 1, 1);

        const camera = new BABYLON.FreeCamera("cam", BABYLON.Vector3.Zero(), scene);
        camera.minZ = 0.1;
        camera.maxZ = 100;
        camera.fov = 0.66;
        camera.inertia = 0.5;
        camera.speed = 0.3;
        camera.upVector = new BABYLON.Vector3(0, 1, 0);
        if (!immersiveControls) camera.attachControl(canvas, true);
        camera.keysUp = [87];       // W only
        camera.keysDown = [83];      // S only
        camera.keysLeft = [65];      // A only
        camera.keysRight = [68];     // D only
        camera.keysUpward = [69];    // E
        camera.keysDownward = [81];  // Q
        cameraRef.current = camera;
        camera.onViewMatrixChangedObservable.add(() => {
          if (!animRef.current.active) {
            immersiveRenderBurstUntilRef.current = performance.now() + 220;
          }
        });

        // VKGS-tier: no post-process pipeline. Engine-level antialias:true
        // provides clean splat silhouettes without colour transforms or blits.

        // VKGS-tier: Mip-Splatting screen-space kernel — fixed at 0.15 for
        // crisp rendering that matches vk_gaussian_splatting reference.
        const { GaussianSplattingMaterial } = BABYLON;
        GaussianSplattingMaterial.KernelSize = 0.15;
        GaussianSplattingMaterial.Compensation = true;

        // Reduce per-frame work
        scene.skipPointerMovePicking = true;

        // ── Render loop ──
        let prevT = performance.now();
        scene.registerBeforeRender(() => {
          const now = performance.now();
          const dt = Math.min((now - prevT) / 1000, 0.05);
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
          const rotT = et;
          const px = anim.fromPos[0] + (anim.toPos[0] - anim.fromPos[0]) * et;
          const py = anim.fromPos[1] + (anim.toPos[1] - anim.fromPos[1]) * et;
          const pz = anim.fromPos[2] + (anim.toPos[2] - anim.fromPos[2]) * et;
          camera.position.set(px, py, pz);

          // Angle-based look direction interpolation (avoids mirror-flip on opposing cameras)
          const yaw = slerpAngle(anim.fromAngle, anim.toAngle, rotT);
          const pitch = anim.fromPitch + (anim.toPitch - anim.fromPitch) * rotT;
          const cosPitch = Math.cos(pitch);
          camera.setTarget(new BABYLON.Vector3(
            px + Math.cos(yaw) * cosPitch * LOOK,
            py + Math.sin(pitch) * LOOK,
            pz + Math.sin(yaw) * cosPitch * LOOK,
          ));
          camera.fov = anim.fromFov + (anim.toFov - anim.fromFov) * et;

          if (anim.elapsed >= anim.duration) {
            anim.active = false;
            if ((anim as any).editorNav) {
              (anim as any).editorNav = false;
              if (!immersiveControls && !spatialNavigationRef.current && canvasRef.current) {
                camera.attachControl(canvasRef.current, true);
              }
            } else if (!readOnly && !(anim as any).exactForward && !anim.holdActive && anim.holdDuration > 0) {
              anim.holdActive = true;
              anim.holdElapsed = 0;
              anim.holdPos = [anim.toPos[0], anim.toPos[1], anim.toPos[2]];
            }
          }
        });

        // Mobile Gaussian rendering is expensive even when the camera is
        // perfectly still. Keep full cadence during loading, gestures, coast,
        // and camera flights; once idle, only refresh occasionally so overlays
        // stay responsive without holding the GPU at 60 fps.
        let viewerInitializing = true;
        let lastIdleRenderAt = 0;
        let lastMotionAt = performance.now();
        engine.runRenderLoop(() => {
          const coast = immersiveCoastRef.current;
          const now = performance.now();
          const qualityMoving = viewerInitializing ||
            animRef.current.active ||
            immersivePointersActiveRef.current ||
            now < immersiveRenderBurstUntilRef.current ||
            Math.abs(coast.yaw) >= 0.04 ||
            Math.abs(coast.pitch) >= 0.04;
          if (qualityMoving) lastMotionAt = now;
          applyHardwareScale(
            qualityMoving || now - lastMotionAt < 180
              ? motionHardwareScale
              : restingHardwareScale,
          );
          const moving = viewerInitializing || !immersiveControls ||
            animRef.current.active || immersivePointersActiveRef.current ||
            now < immersiveRenderBurstUntilRef.current ||
            Math.abs(coast.yaw) >= 0.04 || Math.abs(coast.pitch) >= 0.04;
          if (!moving && now - lastIdleRenderAt < 500) return;
          lastIdleRenderAt = now;
          scene.render();
        });
        resizeRef.current = () => {
          engine.resize();
          immersiveRenderBurstUntilRef.current = performance.now() + 350;
        };
        window.addEventListener("resize", resizeRef.current);

        // ── Place camera from COLMAP data ──
        async function placeCamera() {
          const fallback = fallbackSceneRef.current;
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
              const px = c.position[0];
              const py = c.position[1];
              const pz = c.position[2];
              const candidate: Vec3 = [px, py, pz];
              const allowCameraPose =
                !assetSplatId || !splatId || assetSplatId === splatId || !!initialCameras?.cameras?.length;
              if (allowCameraPose && shouldUseCameraPose(candidate, fallback)) {
                camera.position.set(px, py, pz);
                camera.setTarget(new BABYLON.Vector3(
                  px + nx * LOOK, py + ny * LOOK, pz + nz * LOOK,
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
            const [px, py, pz] = fallback.safePosition;
            const [tx, ty, tz] = fallback.safeTarget;
            camera.position.set(px, py, pz);
            camera.setTarget(new BABYLON.Vector3(tx, ty, tz));
            camera.rotation.z = 0;
            camera.fov = DEFAULT_IMMERSIVE_FOV;
            camera.minZ = Math.max(0.05, fallback.radius / 250);
            camera.maxZ = Math.max(80, fallback.radius * 30);
          }
        }

        // ── Load Gaussian Splatting mesh ──
        const { GaussianSplattingMesh } = BABYLON;
        let gs: any = null;

        const isSogUrl = splatUrl.split("?")[0].toLowerCase().endsWith(".sog");
        const isSpzUrl = splatUrl.split("?")[0].toLowerCase().endsWith(".spz");
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
          const total = parseInt(resp.headers.get("content-length") || "0", 10);
          const reader = resp.body!.getReader();
          const chunks: Uint8Array[] = [];
          let received = 0;
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            received += value.length;
            if (total > 0) setDownloadPct(Math.round((received / total) * 100));
          }
          rawBuffer = new ArrayBuffer(received);
          const u8 = new Uint8Array(rawBuffer);
          let off2 = 0;
          for (const c of chunks) { u8.set(c, off2); off2 += c.length; }
          if (disposed) return;
          if (sourceCacheEligible && splatId) {
            void putCache(splatId, "source", rawBuffer, outputsVersion);
          }
        }

        // Detect format by signature first, then by URL suffix for signed URLs without clear MIME.
        const u8 = new Uint8Array(rawBuffer);
        const isZip = u8.length >= 2 && u8[0] === 0x50 && u8[1] === 0x4B;
        const isGZippedSpz = u8.length >= 2 && u8[0] === 0x1f && u8[1] === 0x8b;
        const isNgspSpz = u8.length >= 4 && u8[0] === 0x4e && u8[1] === 0x47 && u8[2] === 0x53 && u8[3] === 0x50;
        if (isZip || isSogUrl) {
          // SOG format: unzip and parse with BabylonJS SOG parser
          setStatus(t("viewer.status.processing", lang));
          const { ParseSogMeta } = await import("@babylonjs/loaders/SPLAT/sog");
          const fflate = await import("fflate");
          const zipData = await new Promise<Record<string, Uint8Array>>((resolve, reject) => {
            fflate.unzip(new Uint8Array(rawBuffer), (error, data) => {
              if (error) reject(error);
              else resolve(data);
            });
          });
          let vkgsMeta: VkgsSogMeta | null = null;
          const metaEntry = zipData["meta.json"];
          if (metaEntry) {
            try {
              const decoded = new TextDecoder().decode(metaEntry);
              const meta = JSON.parse(decoded) as VkgsSogMeta & {
                shN?: { shape?: number[]; files?: string[]; bands?: number; mins?: number; maxs?: number; codebook?: number[] };
              };
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
          let parsedSOG: ParsedSogData;
          if (vkgsMeta) {
            parsedSOG = await parseVkgsSogMeta(zipData as Record<string, Uint8Array>, vkgsMeta, scene);
          } else {
            const files = new Map<string, Uint8Array>();
            for (const [name, data] of Object.entries(zipData)) {
              files.set(name, data as Uint8Array);
            }
            parsedSOG = await ParseSogMeta(files, "", scene);
          }
          if (disposed) return;
          fallbackSceneRef.current = computeSceneFrameFromSplatBuffer(parsedSOG.data);
          splatBufferRef.current = parsedSOG.data;

          gs = new GaussianSplattingMesh("splat", null, scene);
          const sogSh = parsedSOG.sh && parsedSOG.sh.length ? parsedSOG.sh : undefined;
          const sogDegree = sogSh ? (parsedSOG.shDegree ?? 0) : 0;
          gs.updateData(parsedSOG.data, sogSh, { flipY: false }, undefined, sogDegree);
          gs.alwaysSelectAsActiveMesh = true;
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
          fallbackSceneRef.current = computeSceneFrameFromSplatBuffer(parsedSPZ.data);
          splatBufferRef.current = parsedSPZ.data;

          gs = new GaussianSplattingMesh("splat", null, scene);
          gs.updateData(
            parsedSPZ.data,
            parsedSPZ.sh && parsedSPZ.sh.length ? parsedSPZ.sh : undefined,
            { flipY: false },
            undefined,
            parsedSPZ.shDegree ?? 0,
          );
          gs.alwaysSelectAsActiveMesh = true;
        } else {
          // PLY/splat format
          setStatus(t("viewer.status.processing", lang));
          const fullConv = cachedFull ?? (
            await GaussianSplattingMesh.ConvertPLYWithSHToSplatAsync(rawBuffer) as { buffer: ArrayBuffer }
          ).buffer;
          if (disposed) return;
          fallbackSceneRef.current = computeSceneFrameFromSplatBuffer(fullConv);
          splatBufferRef.current = fullConv;
          if (!cachedFull && splatId) void putCache(splatId, "full", fullConv, outputsVersion);

          gs = new GaussianSplattingMesh("splat", null, scene);
          await gs.updateDataAsync(fullConv);
          if (disposed) return;
          gs.alwaysSelectAsActiveMesh = true;
        }
        gsRef.current = gs;

        // Backend output and current web/iOS cameras are already Y-up in the
        // same identity scene space. Historical edited cameras are normalized
        // on read; the mesh itself must never be mirrored.
        const mat = gs.material as any;
        if (mat) {
          mat.backFaceCulling = false;
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
          setStatus(t("viewer.status.error", lang));
          console.error("[REAI]", err);
          onError?.(err?.message);
        }
      }
    }

    init();
    return () => {
      disposed = true;
      splatBufferRef.current = null;
      inspectionSampleRef.current = null;
      spatialRootRef.current = null;
      gsRef.current = null;
      fallbackSceneRef.current = null;
      if (resizeRef.current) window.removeEventListener("resize", resizeRef.current);
      engineRef.current?.dispose();
    };
  }, [splatUrl, splatId, camerasUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── UI ─────────────────────────────────────────────────────────────────────

  return (
    <div ref={rootRef} className={`relative w-full h-full bg-white select-none ${className ?? ""}`} tabIndex={0}>
      <canvas
        ref={canvasRef}
        className="w-full h-full block outline-none"
        style={{ touchAction: "none" }}
      />

      {immersiveControls && ready && (
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
        className={`absolute inset-0 z-10 flex flex-col items-center justify-center bg-background transition-opacity duration-500 ease-[var(--motion-ease-smooth)] ${
          ready ? "pointer-events-none opacity-0" : "opacity-100"
        }`}
        aria-hidden={ready}
      >
          <span
            className="mb-6 text-[28px] text-foreground/85"
            style={{ fontFamily: "var(--font-brand), ui-serif, Georgia, serif", fontWeight: 400, letterSpacing: "0.01em" }}
          >
            Reaigen
          </span>
          <div
            className="loading-progress-track mb-3 w-36"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={downloadPct > 0 ? downloadPct : undefined}
          >
            {downloadPct > 0 ? (
              <div
                className="h-full rounded-full bg-foreground/55 transition-[width] duration-300 ease-[var(--motion-ease-smooth)]"
                style={{ width: `${Math.min(100, downloadPct)}%` }}
              />
            ) : (
              <span className="loading-progress-indeterminate" />
            )}
          </div>
          <span className="min-h-5 text-[12px] text-muted-foreground">{status}</span>
      </div>
    </div>
  );
});

export default SplatViewer;

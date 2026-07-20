"use client";

import { useEffect, useRef, useState, useCallback, forwardRef, useImperativeHandle } from "react";
import { AllocateShBuffers } from "@babylonjs/core/Meshes/GaussianSplatting/gaussianSplattingMeshBase.js";
import { getCache, putCache } from "@/app/lib/splat-cache";
import { t } from "@/app/lib/i18n";
import type { CameraData, Vec3, TourData, TourShot } from "@/app/lib/tour-types";

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

const LOOK = 5;
const TILT_Y = LOOK * Math.tan(5 * Math.PI / 180);
const SH_C0 = 0.28209479177387814;

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

function computeSceneBoundsFromSplatBuffer(buffer: ArrayBuffer): { center: Vec3; radius: number } | null {
  if (buffer.byteLength < 32) return null;
  const floats = new Float32Array(buffer);
  const stride = 8;
  const count = Math.floor(floats.length / stride);
  if (!count) return null;

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  for (let i = 0; i < count; i += 1) {
    const base = i * stride;
    const x = floats[base];
    const y = floats[base + 1];
    const z = floats[base + 2];
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }

  if (!Number.isFinite(minX) || !Number.isFinite(maxX)) return null;
  const center: Vec3 = [
    (minX + maxX) * 0.5,
    (minY + maxY) * 0.5,
    (minZ + maxZ) * 0.5,
  ];
  const radius = Math.max(
    0.75,
    Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) * 0.5,
  );
  return { center, radius };
}

function shouldUseCameraPose(
  position: Vec3,
  fallback: { center: Vec3; radius: number } | null,
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
  lang?: string;
}

export interface SplatViewerHandle {
  goToShot: (idx: number, instant?: boolean) => void;
  goToPrev: () => void;
  goToNext: () => void;
  getCurrentCamera: () => { position: Vec3; forward: Vec3; up: Vec3; fov: number } | null;
  getTourData: () => TourData | null;
  navigateToCamera: (pos: Vec3, fwd: Vec3, instant?: boolean, fov?: number) => void;
  enableFreeCamera: () => void;
  /** Set camera FOV in degrees (applies immediately to the live BabylonJS camera). */
  setFov: (degrees: number) => void;
}

// ── Component ────────────────────────────────────────────────────────────────

const SplatViewer = forwardRef<SplatViewerHandle, Props>(function SplatViewer(
  { splatUrl, splatId, tourUrl, camerasUrl, initialCameras, preferSavedCameras, readOnly, outputsVersion, className, onShotChange, onReady, onError, onTourLoaded, lang = "en" },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<any>(null);
  const cameraRef = useRef<any>(null);
  const babylonRef = useRef<any>(null);
  const sceneRef = useRef<any>(null);
  const gsRef = useRef<any>(null);
  const resizeRef = useRef<(() => void) | null>(null);
  const animRef = useRef<Anim>(defaultAnim());
  const shotIdxRef = useRef(0);
  const pathDataRef = useRef<{
    positions: Vec3[]; forwards: Vec3[]; arcLens: number[];
    totalArc: number; shots: TourShot[];
  } | null>(null);
  const scrollVelocityRef = useRef(0);
  const progressRef = useRef(0);
  const pathScrubRef = useRef<{ active: boolean } | null>(null);
  const gravityAppliedRef = useRef<string | null>(null);
  const freeModeRef = useRef(false);

  const [status, setStatus] = useState(() => t("viewer.status.loading", lang));
  const [downloadPct, setDownloadPct] = useState(0);
  const [ready, setReady] = useState(false);
  const [tourData, setTourData] = useState<TourData | null>(null);
  const fallbackSceneRef = useRef<{ center: Vec3; radius: number } | null>(null);

  const setCameraFromForward = useCallback((cam: any, B: any, pos: Vec3, fwd: Vec3, exactForward: boolean, fov?: number) => {
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
    cam.rotation.z = 0;
    if (typeof fov === "number" && Number.isFinite(fov)) cam.fov = fov;
  }, []);

  const applyTourData = useCallback((data: TourData) => {
    setTourData(data);
    onTourLoaded?.(data);
    pathDataRef.current = {
      positions: data.positions,
      forwards: data.forwards,
      arcLens: data.arcLens,
      totalArc: data.totalArc,
      shots: data.shots,
    };
    progressRef.current = data.arcLens?.[data.startIdx ?? 0] ?? 0;

    const shot0 = data.shots[0];
    const pos0 = data.positions[shot0.startIdx];
    const fwd0 = data.forwards[shot0.startIdx];
    const cam = cameraRef.current;
    const B = babylonRef.current;
    if (cam && B) {
      setCameraFromForward(cam, B, pos0, fwd0, isSavedCameraTour(data), shot0.fov);
      if (readOnly) cam.detachControl();
    }
    shotIdxRef.current = 0;
    onShotChange?.(0, shot0);
  }, [onShotChange, onTourLoaded, readOnly, setCameraFromForward]);

  const buildTourFromSavedCameras = useCallback((cameraData: CameraData): TourData | null => {
    const cams = cameraData.cameras ?? [];
    if (!cams.length) return null;

    const positions: Vec3[] = [];
    const forwards: Vec3[] = [];
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
        fov: Number(cam.fov ?? cameraData.fovY ?? 0.66),
        holdAfter: 3.5,
        moveDuration: 1.2,
        compositionScore: 1,
      });
    }

    return {
      version: 1,
      positions,
      forwards,
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
    if (!data || !cameraRef.current) return;

    const idx = Math.max(0, Math.min(data.shots.length - 1, raw));
    const shot = data.shots[idx];
    if (shot.startIdx >= data.positions.length) return;
    const tPos = data.positions[shot.startIdx];
    const tFwd = data.forwards[shot.startIdx];
    const useExactForward = isSavedCameraTour(data);

    const cam = cameraRef.current;
    freeModeRef.current = false;
    cam.detachControl();

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
    anim.duration = instant ? 0.001 : 1.5;
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
  }, [tourData, onShotChange]);

  const goToPrev = useCallback(() => {
    const n = tourData?.shots.length ?? 0;
    if (!n) return;
    goToShot(shotIdxRef.current <= 0 ? n - 1 : shotIdxRef.current - 1);
  }, [goToShot, tourData]);

  const goToNext = useCallback(() => {
    const n = tourData?.shots.length ?? 0;
    if (!n) return;
    goToShot(shotIdxRef.current >= n - 1 ? 0 : shotIdxRef.current + 1);
  }, [goToShot, tourData]);

  const getCurrentCamera = useCallback(() => {
    const cam = cameraRef.current;
    const B = babylonRef.current;
    if (!cam || !B) return null;
    const pos: Vec3 = [cam.position.x, cam.position.y, cam.position.z];
    const target = cam.getTarget();
    const dx = target.x - cam.position.x;
    const dy = target.y - cam.position.y;
    const dz = target.z - cam.position.z;
    const len = Math.hypot(dx, dy, dz) || 1;
    const fwd: Vec3 = [dx / len, dy / len, dz / len];
    const up: Vec3 = [cam.upVector.x, cam.upVector.y, cam.upVector.z];
    return { position: pos, forward: fwd, up, fov: cam.fov };
  }, []);

  const getTourData = useCallback(() => tourData, [tourData]);

  const navigateToCamera = useCallback((pos: Vec3, fwd: Vec3, instant = false, fov?: number) => {
    const cam = cameraRef.current;
    const B = babylonRef.current;
    if (!cam || !B) return;
    const targetFov = typeof fov === "number" && Number.isFinite(fov) ? fov : cam.fov;

    // Stop everything — no hold phase, no scroll, no path scrub
    pathScrubRef.current = null;
    scrollVelocityRef.current = 0;
    freeModeRef.current = false;
    cam.detachControl();

    const toTarget: Vec3 = [
      pos[0] + fwd[0] * LOOK,
      pos[1] + fwd[1] * LOOK,
      pos[2] + fwd[2] * LOOK,
    ];

    if (instant) {
      cam.position.set(pos[0], pos[1], pos[2]);
      cam.setTarget(new B.Vector3(toTarget[0], toTarget[1], toTarget[2]));
      cam.rotation.z = 0;
      cam.fov = targetFov;
      animRef.current.active = false;
      animRef.current.holdActive = false;
      if (canvasRef.current) cam.attachControl(canvasRef.current, true);
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
    // Adaptive duration based on distance
    const dist = Math.hypot(
      pos[0] - cam.position.x,
      pos[1] - cam.position.y,
      pos[2] - cam.position.z,
    );
    anim.duration = Math.max(0.8, Math.min(2.0, dist * 0.35));
    anim.active = true;
    anim.holdActive = false;
    anim.holdDuration = 0;
  }, []);

  const enableFreeCamera = useCallback(() => {
    const cam = cameraRef.current;
    if (!cam || !canvasRef.current) return;
    animRef.current.active = false;
    animRef.current.holdActive = false;
    scrollVelocityRef.current = 0;
    freeModeRef.current = true;
    cam.attachControl(canvasRef.current, true);
  }, []);

  const setFov = useCallback((degrees: number) => {
    const cam = cameraRef.current;
    if (!cam) return;
    // BabylonJS camera.fov is vertical FOV in radians
    cam.fov = (degrees * Math.PI) / 180;
  }, []);

  useImperativeHandle(ref, () => ({
    goToShot, goToPrev, goToNext, getCurrentCamera, getTourData, navigateToCamera, enableFreeCamera, setFov,
  }), [goToShot, goToPrev, goToNext, getCurrentCamera, getTourData, navigateToCamera, enableFreeCamera, setFov]);

  // ── Gravity alignment ──────────────────────────────────────────────────────

  useEffect(() => {
    const B = babylonRef.current;
    const gs = gsRef.current;
    const scene = sceneRef.current;
    if (!B || !gs || !scene) return;

    const R = tourData?.metadata?.gravityRotation as number[] | null;
    if (!R || R.length !== 9) return;

    const rKey = R.map((v: number) => v.toFixed(5)).join(",");
    if (gravityAppliedRef.current === rKey) return;
    gravityAppliedRef.current = rKey;

    try {
      if (gs.parent) { gs.parent.dispose(); gs.parent = null; }
      const parent = new B.TransformNode("gravityAlign", scene);
      const bmat = B.Matrix.FromArray([
        R[0], R[3], R[6], 0,
        R[1], R[4], R[7], 0,
        R[2], R[5], R[8], 0,
        0, 0, 0, 1,
      ]);
      parent.rotationQuaternion = B.Quaternion.FromRotationMatrix(bmat);
      gs.parent = parent;
    } catch (e) {
      console.warn("[REAI] Gravity alignment failed:", e);
    }
  }, [tourData]);

  // ── Tour loading ───────────────────────────────────────────────────────────

  useEffect(() => {
    const resolvedTourUrl = tourUrl;
    if (!ready) return;

    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let usedSavedCameras = false;

    const tryLoadSavedCameras = async () => {
      // Use directly-provided camera data first (avoids data: URL / fetch issues)
      if (initialCameras && initialCameras.cameras?.length) {
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

  // ── Keyboard navigation ────────────────────────────────────────────────────

  useEffect(() => {
    // In readOnly (shared tour), disable all keyboard navigation
    // so guests preview using only the on-screen controls
    if (readOnly) return;

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
  }, [readOnly, enableFreeCamera, goToPrev, goToNext]);

  // ── Scroll navigation ─────────────────────────────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
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
  }, [readOnly]);

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

        // VKGS-tier DPR cap: lock at 1.5× to keep sort/render sharp without
        // overloading the GPU on retina displays. No motion drop — switching
        // DPR is itself a visible artefact.
        const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
        engine.setHardwareScalingLevel(dpr / Math.min(dpr, 1.5));

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
        camera.attachControl(canvas, true);
        camera.keysUp = [87];       // W only
        camera.keysDown = [83];      // S only
        camera.keysLeft = [65];      // A only
        camera.keysRight = [68];     // D only
        camera.keysUpward = [69];    // E
        camera.keysDownward = [81];  // Q
        cameraRef.current = camera;

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
          camera.upVector.set(0, 1, 0);

          const anim = animRef.current;

          if (!anim.active) {
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
              camera.rotation.z = 0;
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
                const fz = pd.forwards[lo][2] + (pd.forwards[hi][2] - pd.forwards[lo][2]) * t;
                const angle = Math.atan2(fz, fx);
                camera.position.set(px, py, pz);
                camera.setTarget(new BABYLON.Vector3(
                  px + Math.cos(angle) * LOOK,
                  py - TILT_Y,
                  pz + Math.sin(angle) * LOOK,
                ));
                camera.rotation.z = 0;
              }
              return;
            }
            camera.rotation.z = 0;
            return;
          }

          // Travel animation
          anim.elapsed = Math.min(anim.elapsed + dt, anim.duration);
          const rawT = anim.elapsed / anim.duration;
          const et = quintic(rawT);
          // Rotation leads position slightly for cinematic "look where you're going" feel
          const rotT = quintic(Math.min(1, rawT * 1.15));
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
          camera.rotation.z = 0;
          camera.fov = anim.fromFov + (anim.toFov - anim.fromFov) * et;

          if (anim.elapsed >= anim.duration) {
            anim.active = false;
            if ((anim as any).editorNav) {
              (anim as any).editorNav = false;
              if (canvasRef.current) camera.attachControl(canvasRef.current, true);
            } else if (!(anim as any).exactForward && !anim.holdActive && anim.holdDuration > 0) {
              anim.holdActive = true;
              anim.holdElapsed = 0;
              anim.holdPos = [anim.toPos[0], anim.toPos[1], anim.toPos[2]];
            }
          }
        });

        engine.runRenderLoop(() => scene.render());
        resizeRef.current = () => engine.resize();
        window.addEventListener("resize", resizeRef.current);

        // ── Place camera from COLMAP data ──
        async function placeCamera() {
          const fallback = fallbackSceneRef.current;
          try {
            let d: any = null;
            const assetSplatId = extractSplatIdFromAssetUrl(splatUrl);
            // Use directly-provided camera data first
            if (initialCameras && initialCameras.cameras?.length) {
              d = initialCameras;
            } else {
              const camUrl = camerasUrl ?? (splatId ? `/api/reaigen/splats/${splatId}/cameras/` : null);
              if (!camUrl) return;
              const r = await fetch(camUrl);
              if (!r.ok) return;
              d = await r.json();
            }
            const cams = d.cameras ?? [];
            if (cams.length > 0) {
              const c = cams[0];
              const fx = Number(c.forward?.[0] ?? 0);
              const fy = Number(c.forward?.[1] ?? 0);
              const fz = Number(c.forward?.[2] ?? 1);
              const fl = Math.hypot(fx, fy, fz) || 1;
              const nx = fx / fl, ny = fy / fl, nz = fz / fl;
              const BACK_OFF = 0.45;
              const px = c.position[0] - nx * BACK_OFF;
              const py = c.position[1] - ny * BACK_OFF;
              const pz = c.position[2] - nz * BACK_OFF;
              const candidate: Vec3 = [px, py, pz];
              const allowCameraPose =
                !assetSplatId || !splatId || assetSplatId === splatId || !!initialCameras?.cameras?.length;
              if (!allowCameraPose || shouldUseCameraPose(candidate, fallback)) {
                camera.position.set(px, py, pz);
                camera.setTarget(new BABYLON.Vector3(
                  px + nx * LOOK, py + ny * LOOK, pz + nz * LOOK,
                ));
                const fovY = Number(d.fovY || 0);
                if (fovY > 0) camera.fov = fovY;
                return;
              }
              console.warn("[REAI] Ignoring outlier camera pose; using scene-bounds fallback");
            }
          } catch { /* best-effort */ }

          if (fallback) {
            const [cx, cy, cz] = fallback.center;
            const dist = Math.max(2.5, fallback.radius * 1.5);
            camera.position.set(cx - dist, cy + dist * 0.2, cz - dist);
            camera.setTarget(new BABYLON.Vector3(cx, cy, cz));
            camera.rotation.z = 0;
            camera.minZ = Math.max(0.05, fallback.radius / 250);
            camera.maxZ = Math.max(80, fallback.radius * 30);
          }
        }

        // ── Load Gaussian Splatting mesh ──
        const { GaussianSplattingMesh } = BABYLON;
        let gs: any = null;

        const isSogUrl = splatUrl.split("?")[0].toLowerCase().endsWith(".sog");

        const cachedFull: ArrayBuffer | null = (!isSogUrl && splatId)
          ? await getCache(splatId, "full", outputsVersion)
          : null;

        if (disposed) return;

        // Download the file
        setStatus(t("viewer.status.downloading", lang));
        let rawBuffer: ArrayBuffer | null = cachedFull;

        if (!rawBuffer) {
          const resp = await fetch(splatUrl, { cache: "no-store" });
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
        }

        // Detect format by signature first, then by URL suffix for signed URLs without clear MIME.
        const u8 = new Uint8Array(rawBuffer);
        const isZip = u8.length >= 2 && u8[0] === 0x50 && u8[1] === 0x4B;
        const isGZippedSpz = u8.length >= 2 && u8[0] === 0x1f && u8[1] === 0x8b;
        const isNgspSpz = u8.length >= 4 && u8[0] === 0x4e && u8[1] === 0x47 && u8[2] === 0x53 && u8[3] === 0x50;
        const isSpzUrl = splatUrl.split("?")[0].toLowerCase().endsWith(".spz");

        if (isZip || isSogUrl) {
          // SOG format: unzip and parse with BabylonJS SOG parser
          setStatus(t("viewer.status.processing", lang));
          const { ParseSogMeta } = await import("@babylonjs/loaders/SPLAT/sog");
          const fflate = await import("fflate");
          const zipData = fflate.unzipSync(new Uint8Array(rawBuffer));
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
          fallbackSceneRef.current = computeSceneBoundsFromSplatBuffer(parsedSOG.data);

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
          fallbackSceneRef.current = computeSceneBoundsFromSplatBuffer(parsedSPZ.data);

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
          const conv: { buffer: ArrayBuffer } = await GaussianSplattingMesh.ConvertPLYWithSHToSplatAsync(rawBuffer) as { buffer: ArrayBuffer };
          if (disposed) return;
          const fullConv = conv.buffer;
          fallbackSceneRef.current = computeSceneBoundsFromSplatBuffer(fullConv);
          if (splatId) void putCache(splatId, "full", fullConv, outputsVersion);

          gs = new GaussianSplattingMesh("splat", null, scene);
          await gs.updateDataAsync(fullConv);
          if (disposed) return;
          gs.alwaysSelectAsActiveMesh = true;
        }
        gsRef.current = gs;

        // Per-mesh quality
        gs.scaling.x = -1;
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
        setReady(true);
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
      if (resizeRef.current) window.removeEventListener("resize", resizeRef.current);
      engineRef.current?.dispose();
    };
  }, [splatUrl, splatId, camerasUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── UI ─────────────────────────────────────────────────────────────────────

  return (
    <div className={`relative w-full h-full bg-white select-none ${className ?? ""}`} tabIndex={0}>
      <canvas
        ref={canvasRef}
        className="w-full h-full block outline-none"
        style={{ touchAction: "none" }}
      />

      {/* Loading overlay */}
      {!ready && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-white">
          {/* Single indicator: real download fill when we have a percentage,
              otherwise an indeterminate shimmer. Never both. */}
          <div className="mb-3 h-[3px] w-44 overflow-hidden rounded-full bg-foreground/10">
            {downloadPct > 0 && downloadPct < 100 ? (
              <div
                className="h-full rounded-full bg-foreground/50 transition-all duration-200"
                style={{ width: `${downloadPct}%` }}
              />
            ) : (
              <div className="h-full w-1/2 rounded-full bg-foreground/40 animate-[shimmer-bar_1.2s_ease-in-out_infinite]" />
            )}
          </div>
          <span className="text-[13px] text-muted-foreground">{status}</span>
        </div>
      )}
    </div>
  );
});

export default SplatViewer;

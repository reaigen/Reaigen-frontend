"use client";

import { useEffect, useRef, useState, useCallback, forwardRef, useImperativeHandle } from "react";
import { getCache, putCache } from "@/app/lib/splat-cache";
import type { CameraData, Vec3, TourData, TourShot } from "@/app/lib/tour-types";

/**
 * SplatViewer — BabylonJS Gaussian Splatting renderer with guided tour.
 *
 * Modes:
 *   Tour    — arrow keys / buttons navigate shots with quintic easing.
 *   Explore — WASD + mouse free-fly when Escape pressed or no tour data.
 *
 * Coordinate system: PLY files are Y-up (Y-flip done server-side).
 * Tour positions from tour.json arrive in COLMAP/RoomKit (Y-down) →
 * apply CPU-side flip: y = -y, z = -z before camera placement.
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

function buildFallbackShots(data: TourData): TourShot[] {
  const n = data.positions?.length ?? 0;
  if (n < 2) return [];
  const count = Math.max(3, Math.min(10, Math.floor(n / 250)));
  const shots: TourShot[] = [];
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0 : i / (count - 1);
    const idx = Math.max(0, Math.min(n - 1, Math.round(t * (n - 1))));
    shots.push({
      storyBeat: "auto",
      label: `Shot ${i + 1}`,
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

// ── Animation state ──────────────────────────────────────────────────────────

interface Anim {
  active: boolean;
  elapsed: number;
  duration: number;
  fromPos: Vec3;
  toPos: Vec3;
  fromAngle: number;
  toAngle: number;
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
}

export interface SplatViewerHandle {
  goToShot: (idx: number, instant?: boolean) => void;
  goToPrev: () => void;
  goToNext: () => void;
  getCurrentCamera: () => { position: Vec3; forward: Vec3; up: Vec3; fov: number } | null;
  getTourData: () => TourData | null;
  navigateToCamera: (pos: Vec3, fwd: Vec3, instant?: boolean) => void;
  enableFreeCamera: () => void;
  /** Set camera FOV in degrees (applies immediately to the live BabylonJS camera). */
  setFov: (degrees: number) => void;
}

// ── Component ────────────────────────────────────────────────────────────────

const SplatViewer = forwardRef<SplatViewerHandle, Props>(function SplatViewer(
  { splatUrl, splatId, tourUrl, camerasUrl, initialCameras, preferSavedCameras, readOnly, outputsVersion, className, onShotChange, onReady, onError, onTourLoaded },
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

  const [status, setStatus] = useState("Loading...");
  const [downloadPct, setDownloadPct] = useState(0);
  const [ready, setReady] = useState(false);
  const [tourData, setTourData] = useState<TourData | null>(null);
  const [shotIdx, setShotIdx] = useState(0);

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
    setShotIdx(0);
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
      forwards.push(forward);

      if (i === 0) {
        arcLens.push(0);
      } else {
        const prev = positions[i - 1];
        totalArc += Math.hypot(pos[0] - prev[0], pos[1] - prev[1], pos[2] - prev[2]);
        arcLens.push(totalArc);
      }

      shots.push({
        storyBeat: "saved-camera",
        label: `Shot ${i + 1}`,
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
  }, []);

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
    const dz = target.z - cam.position.z;

    const anim = animRef.current;
    (anim as any).editorNav = false;
    anim.fromPos = cur;
    anim.toPos = [tPos[0], tPos[1], tPos[2]];
    anim.fromAngle = Math.atan2(dz, dx);
    anim.toAngle = Math.atan2(tFwd[2], tFwd[0]);
    anim.fromFov = cam.fov;
    anim.toFov = shot.fov;
    anim.elapsed = 0;
    anim.duration = instant ? 0.001 : 1.5;
    anim.active = true;
    (anim as any).exactForward = useExactForward;
    (anim as any).toForward = tFwd;
    (anim as any).fromTarget = [target.x, target.y, target.z] as Vec3;
    (anim as any).toTarget = [
      tPos[0] + tFwd[0] * LOOK,
      tPos[1] + tFwd[1] * LOOK,
      tPos[2] + tFwd[2] * LOOK,
    ] as Vec3;

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
    setShotIdx(idx);
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

  const navigateToCamera = useCallback((pos: Vec3, fwd: Vec3, instant = false) => {
    const cam = cameraRef.current;
    const B = babylonRef.current;
    if (!cam || !B) return;

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
      animRef.current.active = false;
      animRef.current.holdActive = false;
      if (canvasRef.current) cam.attachControl(canvasRef.current, true);
      return;
    }

    const target = cam.getTarget();
    const anim = animRef.current;
    anim.fromPos = [cam.position.x, cam.position.y, cam.position.z];
    anim.toPos = [pos[0], pos[1], pos[2]];
    // Store full 3D targets for direct interpolation
    (anim as any).fromTarget = [target.x, target.y, target.z] as Vec3;
    (anim as any).toTarget = toTarget;
    (anim as any).editorNav = true;
    anim.fromAngle = 0;
    anim.toAngle = 0;
    anim.fromFov = cam.fov;
    anim.toFov = cam.fov;
    anim.elapsed = 0;
    anim.duration = 1.2;
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
                const fallbackShots = buildFallbackShots(data);
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
            const fallbackShots = buildFallbackShots(data);
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
        setStatus("Loading engine...");
        const BABYLON = await import("@babylonjs/core");
        await import("@babylonjs/loaders");
        babylonRef.current = BABYLON;
        if (disposed) return;

        const canvas = canvasRef.current;
        const engine = new BABYLON.Engine(canvas, true, {
          antialias: true, powerPreference: "high-performance",
        });
        engineRef.current = engine;

        engine.onContextLostObservable.add(() => console.warn("[REAI] WebGL context lost"));
        engine.onContextRestoredObservable.add(() => {
          console.log("[REAI] WebGL context restored");
          sceneRef.current?.render();
        });

        const scene = new BABYLON.Scene(engine);
        sceneRef.current = scene;
        scene.clearColor = new BABYLON.Color4(1, 1, 1, 1);

        const camera = new BABYLON.FreeCamera("cam", BABYLON.Vector3.Zero(), scene);
        camera.minZ = 0.15;
        camera.maxZ = 80;
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

        const pipeline = new BABYLON.DefaultRenderingPipeline("pp", true, scene, [camera]);
        pipeline.fxaaEnabled = true;
        pipeline.imageProcessingEnabled = false;

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
          const et = quintic(anim.elapsed / anim.duration);
          const px = anim.fromPos[0] + (anim.toPos[0] - anim.fromPos[0]) * et;
          const py = anim.fromPos[1] + (anim.toPos[1] - anim.fromPos[1]) * et;
          const pz = anim.fromPos[2] + (anim.toPos[2] - anim.fromPos[2]) * et;
          camera.position.set(px, py, pz);

          if ((anim as any).editorNav || (anim as any).exactForward) {
            // Direct 3D target interpolation for editor navigation
            const ft = (anim as any).fromTarget as Vec3;
            const tt = (anim as any).toTarget as Vec3;
            camera.setTarget(new BABYLON.Vector3(
              ft[0] + (tt[0] - ft[0]) * et,
              ft[1] + (tt[1] - ft[1]) * et,
              ft[2] + (tt[2] - ft[2]) * et,
            ));
          } else {
            const angle = slerpAngle(anim.fromAngle, anim.toAngle, et);
            camera.setTarget(new BABYLON.Vector3(
              px + Math.cos(angle) * LOOK,
              py - TILT_Y,
              pz + Math.sin(angle) * LOOK,
            ));
          }
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
          try {
            let d: any = null;
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
              camera.position.set(px, py, pz);
              camera.setTarget(new BABYLON.Vector3(
                px + nx * LOOK, py + ny * LOOK, pz + nz * LOOK,
              ));
              const fovY = Number(d.fovY || 0);
              if (fovY > 0) camera.fov = fovY;
            }
          } catch { /* best-effort */ }
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
        setStatus("Downloading...");
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

        // Detect format: ZIP signature = SOG, otherwise PLY/splat
        const header = new Uint8Array(rawBuffer, 0, 2);
        const isZip = header[0] === 0x50 && header[1] === 0x4B;

        if (isZip || isSogUrl) {
          // SOG format: unzip and parse with BabylonJS SOG parser
          setStatus("Processing...");
          const { ParseSogMeta } = await import("@babylonjs/loaders/splat/sog");
          const fflate = await import("fflate");
          const zipData = fflate.unzipSync(new Uint8Array(rawBuffer));
          const files = new Map<string, Uint8Array>();
          for (const [name, data] of Object.entries(zipData)) {
            files.set(name, data as Uint8Array);
          }
          if (disposed) return;
          const parsedSOG = await ParseSogMeta(files, "", scene);
          if (disposed) return;

          gs = new GaussianSplattingMesh("splat", null, scene);
          gs.updateData(parsedSOG.data, parsedSOG.sh, { flipY: false }, undefined, parsedSOG.shDegree);
          gs.alwaysSelectAsActiveMesh = true;
          gs.scaling = new BABYLON.Vector3(-1, 1, 1);
        } else {
          // PLY/splat format
          setStatus("Processing...");
          const conv = await GaussianSplattingMesh.ConvertPLYWithSHToSplatAsync(rawBuffer);
          if (disposed) return;
          const fullConv = conv.buffer;
          if (splatId) void putCache(splatId, "full", fullConv, outputsVersion);

          gs = new GaussianSplattingMesh("splat", null, scene);
          await gs.updateDataAsync(fullConv);
          if (disposed) return;
          gs.alwaysSelectAsActiveMesh = true;
          gs.scaling = new BABYLON.Vector3(-1, 1, 1);
        }
        gsRef.current = gs;

        for (let i = 0; i < 300; i++) {
          if (gs.isReady()) break;
          await new Promise(r => setTimeout(r, 100));
        }
        if (disposed) return;

        await placeCamera();
        setReady(true);
        setStatus("");
        onReady?.();

      } catch (err: any) {
        if (!disposed) {
          setStatus("Error: " + (err?.message || String(err)));
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
          <div className="w-8 h-8 border-2 border-foreground/20 border-t-foreground rounded-full animate-spin mb-3" />
          <span className="text-sm text-muted-foreground">{status}</span>
          {downloadPct > 0 && downloadPct < 100 && (
            <div className="mt-2 w-48 h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-foreground/60 rounded-full transition-all duration-200"
                style={{ width: `${downloadPct}%` }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
});

export default SplatViewer;

"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { useParams, useRouter } from "next/navigation";
import { AppShell } from "../../../components/app-shell";
import { useAuth } from "../../../components/hooks/use-auth";
import { useLiveSplatAccess } from "../../../components/hooks/use-live-splat-access";
import { useLiveScanCaptureDevice } from "../../../components/hooks/use-live-scan-device";
import { ArrowLeftIcon, VideoIcon } from "../../../components/icons";
import { PageLoading } from "../../../components/page-loading";
import {
  confirmLiveSplatFrame,
  finishLiveSplatSession,
  getLiveSplatSession,
  getLiveSplatPreview,
  presignLiveSplatFrame,
  startLiveSplatSession,
  syncLiveSplatSession,
  type LiveSplatPreview,
  type LiveSplatSession,
} from "../../../lib/api/client";
import { getUserLanguage, t } from "../../../lib/i18n";
import {
  listLiveScanFrames,
  removeLiveScanFrame,
  storeLiveScanFrame,
} from "../../../lib/live-scan-frame-queue";
import { newestLiveSplatPreview } from "../../../lib/live-scan-preview";
import { Button } from "../../../lib/ui/button";

const CAPTURE_WIDTH = 540;
const CAPTURE_HEIGHT = 960;
const CAPTURE_INTERVAL_MS = 200;
const STATUS_INTERVAL_MS = 400;
const MAX_FRAME_SIZE = 16 * 1024 * 1024;
const MAX_PARALLEL_UPLOADS = 8;
const MAX_CAPTURE_BACKLOG = 150;
const FRAME_UPLOAD_ATTEMPTS = 6;
const TERMINAL_SESSION_STATES = new Set<LiveSplatSession["status"]>([
  "completed",
  "failed",
  "cancelled",
]);
const ACTIVE_MODAL_STATUSES = new Set<LiveSplatSession["status"]>([
  "starting",
  "capturing",
  "draining",
  "refining",
]);
const CAPTURE_ACCEPTING_SESSION_STATES = new Set<LiveSplatSession["status"]>([
  "starting",
  "capturing",
]);
const ScanningPointCloudViewer = dynamic(
  () => import("../../../components/scanning-point-cloud-viewer"),
  { ssr: false },
);

async function frameDigest(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function videoFrame(video: HTMLVideoElement, canvas: HTMLCanvasElement): Promise<Blob> {
  const width = Math.max(1, video.videoWidth);
  const height = Math.max(1, video.videoHeight);
  const sourceAspect = width / height;
  const targetAspect = CAPTURE_WIDTH / CAPTURE_HEIGHT;
  let sourceX = 0;
  let sourceY = 0;
  let sourceWidth = width;
  let sourceHeight = height;
  if (sourceAspect > targetAspect) {
    sourceWidth = height * targetAspect;
    sourceX = (width - sourceWidth) / 2;
  } else if (sourceAspect < targetAspect) {
    sourceHeight = width / targetAspect;
    sourceY = (height - sourceHeight) / 2;
  }
  if (canvas.width !== CAPTURE_WIDTH) canvas.width = CAPTURE_WIDTH;
  if (canvas.height !== CAPTURE_HEIGHT) canvas.height = CAPTURE_HEIGHT;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) return Promise.reject(new Error("Canvas is unavailable."));
  context.drawImage(
    video,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    CAPTURE_WIDTH,
    CAPTURE_HEIGHT,
  );
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error("Frame encoding failed.")),
      "image/jpeg",
      0.90,
    );
  });
}

interface CapturedFrame {
  frameId: string;
  blob: Blob;
  capturedAt: string;
}

function newestSession(
  current: LiveSplatSession | null,
  incoming: LiveSplatSession,
): LiveSplatSession {
  return !current || incoming.progress.revision >= current.progress.revision
    ? incoming
    : current;
}

export default function LiveScanWorkspacePage() {
  const { isAuthenticated, isLoading, user, logout } = useAuth();
  const { allowed, loading: accessLoading, access } = useLiveSplatAccess(isAuthenticated);
  const { supported: captureDevice } = useLiveScanCaptureDevice();
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const sessionId = String(params.id || "");
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const captureCanvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const captureActiveRef = React.useRef(false);
  const activeUploadsRef = React.useRef<Set<Promise<void>>>(new Set());
  const activeFrameIdsRef = React.useRef<Set<string>>(new Set());
  const persistenceSlotsRef = React.useRef(0);
  const persistenceWaitersRef = React.useRef<Array<() => void>>([]);
  const recoveredSessionRef = React.useRef<string | null>(null);
  const outstandingFramesRef = React.useRef(0);
  const uploadFailedRef = React.useRef(false);
  const [session, setSession] = React.useState<LiveSplatSession | null>(null);
  const [sessionLoading, setSessionLoading] = React.useState(true);
  const [cameraReady, setCameraReady] = React.useState(false);
  const [cameraLoading, setCameraLoading] = React.useState(false);
  const [runtimeStarting, setRuntimeStarting] = React.useState(false);
  const [capturePending, setCapturePending] = React.useState(false);
  const [savingFrame, setSavingFrame] = React.useState(false);
  const [queuedFrameCount, setQueuedFrameCount] = React.useState(0);
  const [capturedFrameCount, setCapturedFrameCount] = React.useState(0);
  const [captureThrottled, setCaptureThrottled] = React.useState(false);
  const [finishing, setFinishing] = React.useState(false);
  const [capturing, setCapturing] = React.useState(false);
  const [preview, setPreview] = React.useState<LiveSplatPreview | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!isLoading && !isAuthenticated) router.replace("/");
  }, [isAuthenticated, isLoading, router]);

  React.useEffect(() => {
    if (!accessLoading && isAuthenticated && !allowed) router.replace("/dashboard");
  }, [accessLoading, allowed, isAuthenticated, router]);

  React.useEffect(() => {
    if (!allowed || !sessionId) return;
    let active = true;
    getLiveSplatSession(sessionId)
      .then((value) => {
        if (!active) return;
        setSession((current) => newestSession(current, value));
        setError((current) => current === "session" ? null : current);
      })
      .catch(() => { if (active) setError("session"); })
      .finally(() => { if (active) setSessionLoading(false); });
    return () => { active = false; };
  }, [allowed, sessionId]);

  React.useEffect(() => {
    if (!session) return;
    setCapturedFrameCount((current) => Math.max(current, session.progress.allocated_frames));
  }, [session]);

  React.useEffect(() => {
    if (!session?.runtime.active || !ACTIVE_MODAL_STATUSES.has(session.status)) return;
    let active = true;
    let timer: number | undefined;
    const refresh = async () => {
      try {
        const value = await syncLiveSplatSession(sessionId);
        if (!active) return;
        setSession((current) => newestSession(current, value));
        setError((current) => current === "runtime" ? null : current);
        if (TERMINAL_SESSION_STATES.has(value.status)) {
          setCapturing(false);
          setCapturePending(false);
        }
      } catch {
        if (active) setError("runtime");
      } finally {
        if (active) timer = window.setTimeout(refresh, STATUS_INTERVAL_MS);
      }
    };
    timer = window.setTimeout(refresh, STATUS_INTERVAL_MS);
    return () => {
      active = false;
      if (timer) window.clearTimeout(timer);
    };
  }, [session?.runtime.active, session?.status, sessionId]);

  const sessionRevision = session?.progress.revision;
  React.useEffect(() => {
    if (sessionRevision === undefined) return;
    let active = true;
    getLiveSplatPreview(sessionId, sessionRevision)
      .then(({ preview: value }) => {
        if (!active || !value) return;
        setPreview((current) => newestLiveSplatPreview(current, value));
        setError((current) => current === "preview" ? null : current);
      })
      .catch(() => { /* The last rendered preview remains visible. */ });
    return () => { active = false; };
  }, [sessionId, sessionRevision]);

  React.useEffect(() => () => {
    captureActiveRef.current = false;
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  React.useEffect(() => {
    if (!capturing && !savingFrame && !finishing) return;
    const protectActiveCapture = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", protectActiveCapture);
    return () => window.removeEventListener("beforeunload", protectActiveCapture);
  }, [capturing, finishing, savingFrame]);

  const enableCamera = async (): Promise<boolean> => {
    if (cameraReady) return true;
    if (!captureDevice) return false;
    setCameraLoading(true);
    setError(null);
    let openedStream: MediaStream | null = null;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1080 },
          height: { ideal: 1920 },
          aspectRatio: { ideal: CAPTURE_WIDTH / CAPTURE_HEIGHT },
        },
      });
      openedStream = stream;
      const video = videoRef.current;
      if (!video) throw new Error("The camera preview is unavailable.");
      video.srcObject = stream;
      await video.play();
      const settings = stream.getVideoTracks()[0]?.getSettings();
      const width = Number(video.videoWidth || settings?.width || 0);
      const height = Number(video.videoHeight || settings?.height || 0);
      if (Math.max(width, height) < 1280 || Math.min(width, height) < 720) {
        throw new Error("The selected camera does not meet the capture resolution.");
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = stream;
      setCameraReady(true);
      return true;
    } catch {
      openedStream?.getTracks().forEach((track) => track.stop());
      if (videoRef.current?.srcObject === openedStream) videoRef.current.srcObject = null;
      setError("cameraQuality");
      return false;
    } finally {
      setCameraLoading(false);
    }
  };

  const updateOutstandingFrames = React.useCallback((change: number) => {
    const next = Math.max(0, outstandingFramesRef.current + change);
    outstandingFramesRef.current = next;
    setQueuedFrameCount(next);
    setSavingFrame(next > 0);
  }, []);

  const acquirePersistenceSlot = React.useCallback(async () => {
    if (persistenceSlotsRef.current < MAX_PARALLEL_UPLOADS) {
      persistenceSlotsRef.current += 1;
      return;
    }
    await new Promise<void>((resolve) => {
      persistenceWaitersRef.current.push(resolve);
    });
  }, []);

  const releasePersistenceSlot = React.useCallback(() => {
    const next = persistenceWaitersRef.current.shift();
    if (next) {
      next();
      return;
    }
    persistenceSlotsRef.current = Math.max(0, persistenceSlotsRef.current - 1);
  }, []);

  const failCapturePersistence = React.useCallback(() => {
    uploadFailedRef.current = true;
    captureActiveRef.current = false;
    setCapturing(false);
    setError("capture");
  }, []);

  const persistCapturedFrame = React.useCallback((
    frame: CapturedFrame,
    alreadyStored = false,
  ) => {
    if (activeFrameIdsRef.current.has(frame.frameId)) return;
    activeFrameIdsRef.current.add(frame.frameId);
    updateOutstandingFrames(1);
    const persistence = (async () => {
      let slotAcquired = false;
      try {
        if (frame.blob.size > MAX_FRAME_SIZE) {
          throw new Error("Encoded frame exceeds the capture limit.");
        }
        if (!alreadyStored) {
          await storeLiveScanFrame({
            sessionId,
            frameId: frame.frameId,
            capturedAt: frame.capturedAt,
            blob: frame.blob,
          });
        }
        await acquirePersistenceSlot();
        slotAcquired = true;
        const sha256 = await frameDigest(frame.blob);
        let lastFailure: unknown = null;
        let confirmedSession: LiveSplatSession | undefined;
        for (let attempt = 1; attempt <= FRAME_UPLOAD_ATTEMPTS; attempt += 1) {
          try {
            const presign = await presignLiveSplatFrame(sessionId, {
              frame_id: frame.frameId,
              content_type: "image/jpeg",
              file_size: frame.blob.size,
              width: CAPTURE_WIDTH,
              height: CAPTURE_HEIGHT,
              sha256,
              captured_at: frame.capturedAt,
            });
            if (!presign.already_confirmed) {
              const headers = { ...presign.required_headers };
              delete headers["Content-Length"];
              const uploaded = await fetch(presign.upload_url, {
                method: "PUT",
                headers,
                body: frame.blob,
              });
              if (!uploaded.ok) throw new Error(`Upload failed: HTTP ${uploaded.status}`);
              const confirmed = await confirmLiveSplatFrame(sessionId, presign.frame_id);
              confirmedSession = confirmed.session;
            }
            lastFailure = null;
            break;
          } catch (reason) {
            lastFailure = reason;
            if (attempt < FRAME_UPLOAD_ATTEMPTS) {
              await new Promise((resolve) => window.setTimeout(resolve, attempt * 250));
            }
          }
        }
        if (lastFailure) {
          throw lastFailure instanceof Error
            ? lastFailure
            : new Error("live_scan_frame_upload_failed");
        }
        if (confirmedSession) {
          setSession((current) => newestSession(current, confirmedSession!));
        }
        setError((current) => current === "capture" ? null : current);
        try {
          await removeLiveScanFrame(sessionId, frame.frameId);
        } catch {
          // The backend copy is authoritative. A stale local copy is harmless:
          // the same frame UUID makes the next recovery idempotent.
        }
      } finally {
        if (slotAcquired) releasePersistenceSlot();
      }
    })();
    const settled = persistence
      .catch(() => { failCapturePersistence(); })
      .finally(() => {
        activeFrameIdsRef.current.delete(frame.frameId);
        updateOutstandingFrames(-1);
      });
    activeUploadsRef.current.add(settled);
    void settled.finally(() => { activeUploadsRef.current.delete(settled); });
  }, [
    acquirePersistenceSlot,
    failCapturePersistence,
    releasePersistenceSlot,
    sessionId,
    updateOutstandingFrames,
  ]);

  const recoverStoredFrames = React.useCallback(async () => {
    try {
      const stored = await listLiveScanFrames(sessionId);
      for (const frame of stored) {
        persistCapturedFrame(
          {
            frameId: frame.frameId,
            blob: frame.blob,
            capturedAt: frame.capturedAt,
          },
          true,
        );
      }
    } catch {
      failCapturePersistence();
    }
  }, [failCapturePersistence, persistCapturedFrame, sessionId]);

  React.useEffect(() => {
    if (!session || recoveredSessionRef.current === sessionId) return;
    recoveredSessionRef.current = sessionId;
    void recoverStoredFrames();
  }, [recoverStoredFrames, session, sessionId]);

  const beginCapture = async () => {
    if (!session || capturePending) return;
    setError(null);
    uploadFailedRef.current = false;
    void recoverStoredFrames();
    setCapturePending(true);
    const cameraAvailable = cameraReady || await enableCamera();
    if (!cameraAvailable) {
      setCapturePending(false);
      return;
    }
    let current = session;
    if (!session.runtime.active) {
      setRuntimeStarting(true);
      try {
        const started = await startLiveSplatSession(sessionId);
        setSession((current) => newestSession(current, started));
        if (!started.runtime.active) throw new Error("Runtime dispatch is still pending.");
        current = started;
      } catch {
        setError("runtimeStart");
        setRuntimeStarting(false);
        setCapturePending(false);
        return;
      }
      setRuntimeStarting(false);
    }
    if (
      current.runtime.active
      && CAPTURE_ACCEPTING_SESSION_STATES.has(current.status)
    ) {
      setCapturePending(false);
      captureActiveRef.current = true;
      setCapturing(true);
    }
  };

  React.useEffect(() => {
    if (!capturePending || !session) return;
    if (
      session.runtime.active
      && CAPTURE_ACCEPTING_SESSION_STATES.has(session.status)
    ) {
      setCapturePending(false);
      captureActiveRef.current = true;
      setCapturing(true);
    } else if (TERMINAL_SESSION_STATES.has(session.status)) {
      setCapturePending(false);
      setError("runtimeStart");
    }
  }, [capturePending, session]);

  const finishSession = async () => {
    if (!session) return;
    captureActiveRef.current = false;
    setCapturing(false);
    setCaptureThrottled(false);
    setCapturePending(false);
    setFinishing(true);
    setError(null);
    try {
      // Re-enqueue anything left by an interrupted page before freezing the
      // server-side capture boundary. Keep draining until no persistence task
      // can still add a newly recovered frame.
      await recoverStoredFrames();
      while (activeUploadsRef.current.size > 0) {
        await Promise.all(Array.from(activeUploadsRef.current));
      }
      if (uploadFailedRef.current) return;
      const finished = await finishLiveSplatSession(sessionId);
      setSession((current) => newestSession(current, finished));
    } catch {
      setError("finish");
    } finally {
      setFinishing(false);
    }
  };

  const handlePreviewError = React.useCallback(() => {
    // Captured RGB remains durable even if this browser cannot render one PLY.
    // Keep the last-good canvas mounted and surface the failure to the user.
    setError("preview");
  }, []);

  React.useEffect(() => {
    if (!capturing) return;
    captureActiveRef.current = true;
    let active = true;
    let timer: number | undefined;
    let nextCaptureAt = performance.now();
    const run = async () => {
      nextCaptureAt += CAPTURE_INTERVAL_MS;
      try {
        if (outstandingFramesRef.current < MAX_CAPTURE_BACKLOG) {
          setCaptureThrottled(false);
          const video = videoRef.current;
          if (!video || video.videoWidth <= 0) throw new Error("Camera frame is unavailable.");
          const canvas = captureCanvasRef.current ?? document.createElement("canvas");
          captureCanvasRef.current = canvas;
          const capturedAt = new Date().toISOString();
          const blob = await videoFrame(video, canvas);
          if (!active || !captureActiveRef.current) return;
          setCapturedFrameCount((current) => current + 1);
          persistCapturedFrame({
            frameId: crypto.randomUUID(),
            blob,
            capturedAt,
          });
        } else {
          setCaptureThrottled(true);
        }
      } catch {
        captureActiveRef.current = false;
        setCapturing(false);
        setError("capture");
      }
      if (active && captureActiveRef.current) {
        const now = performance.now();
        if (nextCaptureAt < now - CAPTURE_INTERVAL_MS) {
          nextCaptureAt = now;
        }
        const delay = Math.max(0, nextCaptureAt - now);
        timer = window.setTimeout(() => { void run(); }, delay);
      }
    };
    void run();
    return () => {
      active = false;
      captureActiveRef.current = false;
      setCaptureThrottled(false);
      if (timer) window.clearTimeout(timer);
    };
  }, [capturing, persistCapturedFrame]);

  if (isLoading || accessLoading || !user || !allowed) return <PageLoading />;
  const lang = getUserLanguage(user.localization);
  if (sessionLoading) return <PageLoading />;
  if (!session) {
    return (
      <AppShell user={user} onLogout={logout} hideMobileNav>
        <div className="mx-auto flex min-h-[60vh] max-w-lg items-center justify-center">
          <div className="floating-panel w-full p-8 text-center">
            <h1 className="text-xl font-semibold">{t("liveScan.sessionUnavailable", lang)}</h1>
            <Button className="mt-5" variant="outline" onClick={() => router.push("/create/live-scan")}>{t("common.back", lang)}</Button>
          </div>
        </div>
      </AppShell>
    );
  }

  const errorText = error === "cameraQuality"
    ? t("liveScan.cameraQuality", lang)
    : error === "camera"
      ? t("liveScan.cameraUnavailable", lang)
    : error === "capture"
      ? t("liveScan.captureFailed", lang)
      : error === "runtimeStart" || error === "runtime"
        ? t("liveScan.runtimeStartFailed", lang)
        : error === "finish"
          ? t("liveScan.finishFailed", lang)
        : error === "preview"
          ? t("liveScan.previewDisplayFailed", lang)
      : error === "session"
        ? t("liveScan.sessionUnavailable", lang)
        : null;
  const terminal = TERMINAL_SESSION_STATES.has(session.status);
  const finalizing = session.status === "draining" || session.status === "refining";
  const refinementFailed = session.status === "failed";
  const visualSaved = terminal && Boolean(preview);
  const pointCloudLabel = refinementFailed && !preview
    ? t("liveScan.pointCloudNeedsRefinement", lang)
    : finalizing
      ? t("liveScan.pointCloudRefining", lang)
      : preview?.refined
        ? t("liveScan.pointCloudRefined", lang)
        : visualSaved
          ? t("liveScan.pointCloudSaved", lang)
        : capturing || preview
          ? t("liveScan.pointCloudForming", lang)
          : t("liveScan.previewWaiting", lang);
  const interrupted = (
    !capturing
    && session.progress.allocated_frames > session.progress.ready_frames + queuedFrameCount
  );

  return (
    <AppShell user={user} onLogout={logout} hideMobileNav immersive>
      <div className="fixed inset-0 overscroll-none bg-background">
        <div className="flex h-full min-h-0 flex-col">
          <section className="relative min-h-0 flex-1 overflow-hidden bg-[#111215]">
            <h1 className="sr-only">{t("liveScan.workspaceTitle", lang)}</h1>
            {preview ? (
              <ScanningPointCloudViewer
                pointCloudUrl={preview.splat_url}
                inlinePointCloudBase64={preview.inline_ply_base64}
                gaugeRevision={preview.gauge_revision ?? 0}
                showFloorGrid={preview.show_floor_grid}
                className="h-full w-full"
                onError={handlePreviewError}
              />
            ) : null}
            <video
              ref={videoRef}
              muted
              playsInline
              className={!cameraReady
                ? "hidden"
                : "absolute right-[calc(0.5rem+env(safe-area-inset-right,0px))] top-[calc(0.5rem+env(safe-area-inset-top,0px))] z-20 aspect-[9/16] w-[72px] rounded-xl border border-white/20 bg-black object-cover shadow-2xl sm:right-[calc(1rem+env(safe-area-inset-right,0px))] sm:top-[calc(1rem+env(safe-area-inset-top,0px))] sm:w-[90px] lg:w-[104px]"}
            />
            {!capturing && !capturePending && !finalizing && !savingFrame ? (
              <button
                type="button"
                onClick={() => router.push("/create")}
                aria-label={t("common.back", lang)}
                className="floating-icon-button pen-touch-target absolute left-[calc(0.5rem+env(safe-area-inset-left,0px))] top-[calc(0.5rem+env(safe-area-inset-top,0px))] z-40 border border-white/15 bg-black/72 text-white/80 shadow-xl backdrop-blur-xl hover:bg-black/85 sm:left-[calc(1rem+env(safe-area-inset-left,0px))] sm:top-[calc(1rem+env(safe-area-inset-top,0px))]"
              >
                <ArrowLeftIcon size={17} />
              </button>
            ) : null}
            {!preview ? (
              <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
                <div>
                  {!cameraReady ? <VideoIcon size={28} className="mx-auto text-white/35" /> : null}
                  <p className="mt-3 text-sm font-medium text-white/80">
                    {interrupted
                      ? t("liveScan.interrupted", lang)
                      : cameraReady
                      ? t("liveScan.pointCloudForming", lang)
                      : t("liveScan.cameraPrompt", lang)}
                  </p>
                </div>
              </div>
            ) : null}

            <div className="pointer-events-none absolute left-[calc(3.5rem+env(safe-area-inset-left,0px))] right-[calc(5.125rem+env(safe-area-inset-right,0px))] top-[calc(0.5rem+env(safe-area-inset-top,0px))] z-30 flex flex-col items-start gap-2 sm:left-[calc(4rem+env(safe-area-inset-left,0px))] sm:right-[calc(6.875rem+env(safe-area-inset-right,0px))] sm:top-[calc(1rem+env(safe-area-inset-top,0px))]">
              {errorText ? (
                <p role="alert" className="rounded-xl border border-red-300/20 bg-red-950/85 px-3 py-2 text-xs leading-relaxed text-red-100 shadow-lg backdrop-blur">
                  {errorText}
                </p>
              ) : null}
            </div>

            <div className="absolute bottom-[calc(0.5rem+env(safe-area-inset-bottom,0px))] left-[calc(0.5rem+env(safe-area-inset-left,0px))] right-[calc(0.5rem+env(safe-area-inset-right,0px))] z-30 rounded-2xl border border-white/15 bg-black/72 p-3 text-white shadow-2xl backdrop-blur-xl sm:bottom-[calc(1rem+env(safe-area-inset-bottom,0px))] sm:left-[calc(1rem+env(safe-area-inset-left,0px))] sm:right-auto sm:w-[min(82vw,30rem)]">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 truncate text-sm font-semibold">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${refinementFailed && !preview ? "bg-red-300" : finalizing || savingFrame ? "animate-pulse bg-sky-300" : "bg-emerald-300"}`} />
                    {pointCloudLabel}
                  </p>
                  {capturedFrameCount > 0 ? (
                    <p role="status" className={`mt-1 truncate text-[11px] font-medium ${captureThrottled || savingFrame ? "text-sky-200" : "text-emerald-200"}`}>
                      {captureThrottled
                        ? t("liveScan.catchingUp", lang)
                        : savingFrame
                          ? t("liveScan.savingLatest", lang)
                          : t("liveScan.savedSafely", lang)}
                    </p>
                  ) : null}
                </div>
                {refinementFailed ? (
                  <Button
                    className="h-11 shrink-0 rounded-full px-4 shadow-control"
                    variant="default"
                    size="sm"
                    onClick={() => router.push("/create/live-scan")}
                  >
                    {t("liveScan.newScan", lang)}
                  </Button>
                ) : !terminal && session.status !== "draining" && session.status !== "refining" ? (
                  <Button
                    className="h-11 shrink-0 rounded-full px-4 shadow-control"
                    variant={capturing ? "destructive" : "default"}
                    size="sm"
                    loading={cameraLoading || runtimeStarting || capturePending || finishing}
                    disabled={
                      !captureDevice
                      || (!session.runtime.active && access?.runtime_available !== true)
                    }
                    onClick={interrupted
                      ? () => router.push("/create/live-scan")
                      : capturing
                        ? finishSession
                        : beginCapture}
                  >
                    {interrupted
                      ? t("liveScan.restart", lang)
                      : capturing
                        ? t("liveScan.finishPreview", lang)
                        : t("liveScan.startCapture", lang)}
                  </Button>
                ) : null}
              </div>
            </div>
          </section>
        </div>
      </div>
    </AppShell>
  );
}

"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { useParams, useRouter } from "next/navigation";
import { AppShell } from "../../../components/app-shell";
import { useAuth } from "../../../components/hooks/use-auth";
import { useLiveSplatAccess } from "../../../components/hooks/use-live-splat-access";
import { useLiveScanCaptureDevice } from "../../../components/hooks/use-live-scan-device";
import { ArrowLeftIcon, PlayIcon, VideoIcon } from "../../../components/icons";
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
import { Button } from "../../../lib/ui/button";

const CAPTURE_WIDTH = 540;
const CAPTURE_HEIGHT = 960;
const CAPTURE_INTERVAL_MS = 250;
const STATUS_INTERVAL_MS = 400;
const MAX_FRAME_SIZE = 16 * 1024 * 1024;
const MAX_PARALLEL_UPLOADS = 3;
const MAX_CAPTURE_BACKLOG = 24;
const FRAME_UPLOAD_ATTEMPTS = 3;
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
const FLOOR_LABEL_KEYS: Record<LiveSplatSession["floor_status"],
  | "liveScan.floor.pending"
  | "liveScan.floor.locked"
  | "liveScan.floor.manual"
  | "liveScan.floor.rejected"
> = {
  pending: "liveScan.floor.pending",
  locked: "liveScan.floor.locked",
  manual: "liveScan.floor.manual",
  rejected: "liveScan.floor.rejected",
};

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
      0.82,
    );
  });
}

interface CapturedFrame {
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
  const allocationTailRef = React.useRef<Promise<void>>(Promise.resolve());
  const activeUploadsRef = React.useRef<Set<Promise<void>>>(new Set());
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
        setPreview((current) => (
          current
          && current.epoch === value.epoch
          && (current.gauge_revision ?? 0) === (value.gauge_revision ?? 0)
            ? current
            : value
        ));
      })
      .catch(() => { /* The last rendered preview remains visible. */ });
    return () => { active = false; };
  }, [sessionId, sessionRevision]);

  React.useEffect(() => () => {
    captureActiveRef.current = false;
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  React.useEffect(() => {
    if (!savingFrame) return;
    const protectPendingUploads = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", protectPendingUploads);
    return () => window.removeEventListener("beforeunload", protectPendingUploads);
  }, [savingFrame]);

  const enableCamera = async () => {
    if (!captureDevice) return;
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
    } catch {
      openedStream?.getTracks().forEach((track) => track.stop());
      if (videoRef.current?.srcObject === openedStream) videoRef.current.srcObject = null;
      setError("cameraQuality");
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

  const failCapturePersistence = React.useCallback(() => {
    uploadFailedRef.current = true;
    captureActiveRef.current = false;
    setCapturing(false);
    setError("capture");
  }, []);

  const persistCapturedFrame = React.useCallback((frame: CapturedFrame) => {
    updateOutstandingFrames(1);
    const allocateAndUpload = async () => {
      let uploadStarted = false;
      try {
        if (uploadFailedRef.current) return;
        if (frame.blob.size > MAX_FRAME_SIZE) {
          throw new Error("Encoded frame exceeds the capture limit.");
        }
        const sha256 = await frameDigest(frame.blob);
        const presign = await presignLiveSplatFrame(sessionId, {
          content_type: "image/jpeg",
          file_size: frame.blob.size,
          width: CAPTURE_WIDTH,
          height: CAPTURE_HEIGHT,
          sha256,
          captured_at: frame.capturedAt,
        });

        while (activeUploadsRef.current.size >= MAX_PARALLEL_UPLOADS) {
          await Promise.race(activeUploadsRef.current);
        }
        if (uploadFailedRef.current) return;

        const upload = (async () => {
          let lastFailure: unknown = null;
          for (let attempt = 1; attempt <= FRAME_UPLOAD_ATTEMPTS; attempt += 1) {
            try {
              const headers = { ...presign.required_headers };
              delete headers["Content-Length"];
              const uploaded = await fetch(presign.upload_url, {
                method: "PUT",
                headers,
                body: frame.blob,
              });
              if (!uploaded.ok) throw new Error(`Upload failed: HTTP ${uploaded.status}`);
              const confirmed = await confirmLiveSplatFrame(sessionId, presign.frame_id);
              if (confirmed.session) {
                setSession((current) => newestSession(current, confirmed.session!));
              }
              setError((current) => current === "capture" ? null : current);
              return;
            } catch (reason) {
              lastFailure = reason;
              if (attempt < FRAME_UPLOAD_ATTEMPTS) {
                await new Promise((resolve) => window.setTimeout(resolve, attempt * 250));
              }
            }
          }
          throw lastFailure instanceof Error
            ? lastFailure
            : new Error("live_scan_frame_upload_failed");
        })();
        const settled = upload
          .catch(() => { failCapturePersistence(); })
          .finally(() => { updateOutstandingFrames(-1); });
        uploadStarted = true;
        activeUploadsRef.current.add(settled);
        void settled.finally(() => { activeUploadsRef.current.delete(settled); });
      } catch {
        failCapturePersistence();
      } finally {
        if (!uploadStarted) updateOutstandingFrames(-1);
      }
    };
    const scheduled = allocationTailRef.current.then(allocateAndUpload);
    allocationTailRef.current = scheduled.catch(() => { /* failure is reflected in the UI */ });
  }, [failCapturePersistence, sessionId, updateOutstandingFrames]);

  const toggleCapture = async () => {
    if (capturing) {
      captureActiveRef.current = false;
      setCapturing(false);
      return;
    }
    if (!session || capturePending) return;
    setError(null);
    uploadFailedRef.current = false;
    setCapturePending(true);
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
    if (current.status === "capturing") {
      setCapturePending(false);
      captureActiveRef.current = true;
      setCapturing(true);
    }
  };

  React.useEffect(() => {
    if (!capturePending || !session) return;
    if (session.status === "capturing") {
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
    setCapturePending(false);
    setFinishing(true);
    setError(null);
    try {
      await allocationTailRef.current;
      await Promise.all(Array.from(activeUploadsRef.current));
      if (uploadFailedRef.current) return;
      const finished = await finishLiveSplatSession(sessionId);
      setSession((current) => newestSession(current, finished));
    } catch {
      setError("finish");
    } finally {
      setFinishing(false);
    }
  };

  React.useEffect(() => {
    if (!capturing) return;
    captureActiveRef.current = true;
    let active = true;
    let timer: number | undefined;
    const run = async () => {
      const started = performance.now();
      try {
        if (outstandingFramesRef.current < MAX_CAPTURE_BACKLOG) {
          const video = videoRef.current;
          if (!video || video.videoWidth <= 0) throw new Error("Camera frame is unavailable.");
          const canvas = captureCanvasRef.current ?? document.createElement("canvas");
          captureCanvasRef.current = canvas;
          const capturedAt = new Date().toISOString();
          const blob = await videoFrame(video, canvas);
          if (!active || !captureActiveRef.current) return;
          persistCapturedFrame({ blob, capturedAt });
        }
      } catch {
        captureActiveRef.current = false;
        setCapturing(false);
        setError("capture");
      }
      if (active && captureActiveRef.current) {
        const delay = Math.max(0, CAPTURE_INTERVAL_MS - (performance.now() - started));
        timer = window.setTimeout(() => { void run(); }, delay);
      }
    };
    void run();
    return () => {
      active = false;
      captureActiveRef.current = false;
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

  const floorLabel = t(FLOOR_LABEL_KEYS[session.floor_status], lang);
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
      : error === "session"
        ? t("liveScan.sessionUnavailable", lang)
        : null;
  const terminal = TERMINAL_SESSION_STATES.has(session.status);

  return (
    <AppShell user={user} onLogout={logout} hideMobileNav>
      <div
        className="fixed bottom-0 right-0 top-[var(--header-h)] bg-background"
        style={{ left: "var(--sidebar-offset, 0px)" }}
      >
        <div className="flex h-full min-h-0 flex-col">
          <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border/60 bg-card/85 px-3 py-2 backdrop-blur-xl sm:px-5">
            <div className="flex min-w-0 items-center gap-3">
              <button
                type="button"
                onClick={() => router.push("/create/live-scan")}
                aria-label={t("common.back", lang)}
                className="floating-icon-button pen-touch-target text-foreground/65 hover:bg-foreground/[0.06]"
              >
                <ArrowLeftIcon size={17} />
              </button>
              <div className="min-w-0">
                <h1 className="truncate text-[15px] font-semibold">{t("liveScan.workspaceTitle", lang)}</h1>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {!cameraReady ? (
                <Button size="sm" loading={cameraLoading} disabled={!captureDevice} onClick={enableCamera}>
                  <VideoIcon size={14} />
                  {captureDevice ? t("liveScan.enableCamera", lang) : t("liveScan.phoneOnly", lang)}
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant={capturing ? "destructive" : "default"}
                  loading={runtimeStarting || capturePending}
                  disabled={
                    terminal
                    || session.status === "draining"
                    || session.status === "refining"
                    || (!session.runtime.active && access?.runtime_available !== true)
                  }
                  onClick={toggleCapture}
                >
                  <PlayIcon size={14} />
                  {capturing ? t("liveScan.stopCapture", lang) : t("liveScan.startCapture", lang)}
                </Button>
              )}
            </div>
          </header>

          <section className="relative min-h-0 flex-1 overflow-hidden bg-[#111215]">
            {preview ? (
              <ScanningPointCloudViewer
                pointCloudUrl={preview.splat_url}
                gaugeRevision={preview.gauge_revision ?? 0}
                showFloorGrid={preview.show_floor_grid}
                className="h-full w-full"
              />
            ) : null}
            <video
              ref={videoRef}
              muted
              playsInline
              className={!cameraReady
                ? "hidden"
                : "absolute right-2 top-2 z-20 aspect-[9/16] w-[72px] rounded-xl border border-white/20 bg-black object-cover shadow-2xl sm:right-4 sm:top-4 sm:w-[90px] lg:w-[104px]"}
            />
            {!cameraReady && !preview ? (
              <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
                <div>
                  <VideoIcon size={28} className="mx-auto text-white/35" />
                  <p className="mt-3 text-sm font-medium text-white/80">{t("liveScan.cameraPrompt", lang)}</p>
                </div>
              </div>
            ) : null}

            <div className="pointer-events-none absolute left-2 top-2 z-30 flex max-w-[min(72vw,34rem)] flex-col items-start gap-2 sm:left-4 sm:top-4">
              {session.runtime.profile === "contract-test" ? (
                <p role="status" className="rounded-xl border border-amber-300/30 bg-amber-950/85 px-3 py-2 text-xs leading-relaxed text-amber-100 shadow-lg backdrop-blur">
                  {t("liveScan.contractTest", lang)}
                </p>
              ) : null}
              {session.runtime.profile === "preview" && !capturing && !preview ? (
                <p role="status" className="rounded-xl border border-sky-300/25 bg-sky-950/85 px-3 py-2 text-xs leading-relaxed text-sky-100 shadow-lg backdrop-blur">
                  {t("liveScan.previewMode", lang)}
                </p>
              ) : null}
              {capturing ? (
                <span className="inline-flex items-center gap-2 rounded-full bg-black/70 px-3 py-1.5 text-[11px] font-semibold text-white backdrop-blur">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-red-500 motion-reduce:animate-none" />
                  {t("liveScan.capturing", lang)}
                </span>
              ) : null}
              {capturePending ? (
                <span className="inline-flex items-center gap-2 rounded-full bg-black/70 px-3 py-1.5 text-[11px] font-semibold text-white backdrop-blur">
                  <span className="h-3 w-3 animate-spin rounded-full border border-white/25 border-t-white motion-reduce:animate-none" />
                  {t("liveScan.mapperStarting", lang)}
                </span>
              ) : null}
              {errorText ? (
                <p role="alert" className="rounded-xl border border-red-300/20 bg-red-950/85 px-3 py-2 text-xs leading-relaxed text-red-100 shadow-lg backdrop-blur">
                  {errorText}
                </p>
              ) : null}
            </div>

            <div className="absolute bottom-2 left-2 z-30 w-[min(70vw,20rem)] rounded-2xl border border-white/15 bg-black/70 p-3 text-white shadow-2xl backdrop-blur-xl sm:bottom-4 sm:left-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">
                    {preview
                      ? t(preview.refined ? "liveScan.pointCloudRefined" : "liveScan.pointCloudForming", lang)
                      : t("liveScan.previewWaiting", lang)}
                  </p>
                  <p className="mt-1 text-[11px] leading-relaxed text-white/60">
                    {preview
                      ? `${(preview.point_count ?? 0).toLocaleString()} ${t("liveScan.points", lang)} · ${(preview.camera_count ?? 0).toLocaleString()} ${t("liveScan.cameras", lang)}`
                      : t("liveScan.previewHint", lang)}
                  </p>
                </div>
                {preview ? (
                  <span className="shrink-0 rounded-full bg-white/10 px-2 py-1 text-[10px] font-semibold tabular-nums text-white/75">
                    {t("liveScan.epoch", lang)} {preview.epoch}
                  </span>
                ) : null}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] font-medium text-white/65">
                <span
                  role="status"
                  aria-live="polite"
                  className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2 py-1"
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${savingFrame ? "animate-pulse bg-sky-300" : "bg-emerald-300"}`} />
                  {savingFrame
                    ? `${t("liveScan.savingLatest", lang)}${queuedFrameCount > 1 ? ` · ${queuedFrameCount}` : ""}`
                    : session.progress.ready_frames > 0
                      ? t("liveScan.savedSafely", lang)
                      : t("liveScan.readyToSave", lang)}
                </span>
                <span className="rounded-full bg-white/10 px-2 py-1">
                  {t("liveScan.quality", lang)} · {t(`liveScan.quality.${session.options.quality}`, lang)}
                </span>
                <span className="rounded-full bg-white/10 px-2 py-1">{floorLabel}</span>
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-x-3 border-t border-white/10 pt-2 text-[11px]">
                <div>
                  <dt className="text-white/50">{t("liveScan.framesReady", lang)}</dt>
                  <dd className="mt-0.5 font-semibold tabular-nums">{session.progress.ready_frames}</dd>
                </div>
                <div>
                  <dt className="text-white/50">{t("liveScan.framesProcessed", lang)}</dt>
                  <dd className="mt-0.5 font-semibold tabular-nums">{session.progress.processed_frames}</dd>
                </div>
              </dl>
              {session.runtime.active && !terminal ? (
                <Button
                  className="mt-3 w-full border-white/15 bg-white/10 text-white hover:bg-white/15"
                  variant="outline"
                  size="sm"
                  loading={finishing}
                  onClick={finishSession}
                >
                  {t(
                    access?.capabilities.dragon_refinement === true
                      ? "liveScan.finish"
                      : "liveScan.finishPreview",
                    lang,
                  )}
                </Button>
              ) : null}
            </div>
          </section>
        </div>
      </div>
    </AppShell>
  );
}

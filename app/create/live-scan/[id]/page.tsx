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

const CAPTURE_INTERVAL_MS = 1_200;
const STATUS_INTERVAL_MS = 2_500;
const MAX_FRAME_SIZE = 16 * 1024 * 1024;
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

const SplatViewer = dynamic(() => import("../../../components/splat-viewer"), {
  ssr: false,
});

async function frameDigest(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function videoFrame(video: HTMLVideoElement): Promise<Blob> {
  const width = Math.max(1, video.videoWidth);
  const height = Math.max(1, video.videoHeight);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) return Promise.reject(new Error("Canvas is unavailable."));
  context.drawImage(video, 0, 0, width, height);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error("Frame encoding failed.")),
      "image/jpeg",
      0.86,
    );
  });
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
  const captureBusyRef = React.useRef(false);
  const [session, setSession] = React.useState<LiveSplatSession | null>(null);
  const [sessionLoading, setSessionLoading] = React.useState(true);
  const [cameraReady, setCameraReady] = React.useState(false);
  const [cameraLoading, setCameraLoading] = React.useState(false);
  const [runtimeStarting, setRuntimeStarting] = React.useState(false);
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
        setSession(value);
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
        setSession(value);
        setError((current) => current === "runtime" ? null : current);
        if (TERMINAL_SESSION_STATES.has(value.status)) setCapturing(false);
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

  React.useEffect(() => {
    if (!session) return;
    let active = true;
    getLiveSplatPreview(sessionId, session.progress.revision)
      .then(({ preview: value }) => { if (active) setPreview(value); })
      .catch(() => { /* The last rendered preview remains visible. */ });
    return () => { active = false; };
  }, [session, sessionId]);

  React.useEffect(() => () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

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
          width: { ideal: 1920 },
          height: { ideal: 1080 },
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

  const captureOne = React.useCallback(async () => {
    const video = videoRef.current;
    if (!video || video.videoWidth <= 0 || captureBusyRef.current) return;
    captureBusyRef.current = true;
    try {
      const blob = await videoFrame(video);
      if (blob.size > MAX_FRAME_SIZE) throw new Error("Encoded frame exceeds the capture limit.");
      const sha256 = await frameDigest(blob);
      const presign = await presignLiveSplatFrame(sessionId, {
        content_type: "image/jpeg",
        file_size: blob.size,
        width: video.videoWidth,
        height: video.videoHeight,
        sha256,
        captured_at: new Date().toISOString(),
      });
      const headers = { ...presign.required_headers };
      delete headers["Content-Length"];
      const uploaded = await fetch(presign.upload_url, {
        method: "PUT",
        headers,
        body: blob,
      });
      if (!uploaded.ok) throw new Error(`Upload failed: HTTP ${uploaded.status}`);
      const confirmed = await confirmLiveSplatFrame(sessionId, presign.frame_id);
      if (confirmed.session) setSession(confirmed.session);
      setError(null);
    } catch {
      setCapturing(false);
      setError("capture");
    } finally {
      captureBusyRef.current = false;
    }
  }, [sessionId]);

  const toggleCapture = async () => {
    if (capturing) {
      setCapturing(false);
      return;
    }
    if (!session) return;
    setError(null);
    if (!session.runtime.active) {
      setRuntimeStarting(true);
      try {
        const started = await startLiveSplatSession(sessionId);
        setSession(started);
        if (!started.runtime.active) throw new Error("Runtime dispatch is still pending.");
      } catch {
        setError("runtimeStart");
        setRuntimeStarting(false);
        return;
      }
      setRuntimeStarting(false);
    }
    setCapturing(true);
  };

  const finishSession = async () => {
    if (!session) return;
    setCapturing(false);
    setFinishing(true);
    setError(null);
    try {
      setSession(await finishLiveSplatSession(sessionId));
    } catch {
      setError("finish");
    } finally {
      setFinishing(false);
    }
  };

  React.useEffect(() => {
    if (!capturing) return;
    void captureOne();
    const timer = window.setInterval(() => { void captureOne(); }, CAPTURE_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [captureOne, capturing]);

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
                  loading={runtimeStarting}
                  disabled={
                    terminal
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

          <div className="grid min-h-0 flex-1 gap-px bg-border/50 lg:grid-cols-[minmax(0,1fr)_320px]">
            <section className="relative min-h-0 overflow-hidden bg-[#111215]">
              {session.runtime.profile === "contract-test" ? (
                <p role="status" className="absolute left-4 right-4 top-4 z-30 rounded-xl border border-amber-300/30 bg-amber-950/85 px-3 py-2 text-xs leading-relaxed text-amber-100 shadow-lg backdrop-blur">
                  {t("liveScan.contractTest", lang)}
                </p>
              ) : null}
              {preview ? (
                <SplatViewer
                  key={`${preview.trust}-${preview.epoch}`}
                  splatUrl={preview.splat_url}
                  readOnly
                  performanceProfile="balanced"
                  showSpatialGrid={preview.show_floor_grid}
                  gaussianRenderer="spark"
                  lang={lang}
                  className="h-full w-full"
                />
              ) : null}
              <video
                ref={videoRef}
                muted
                playsInline
                className={preview
                  ? "absolute bottom-4 right-4 z-20 aspect-video w-[min(32%,300px)] rounded-xl border border-white/15 bg-black object-cover shadow-2xl"
                  : "h-full w-full object-contain"}
              />
              {!cameraReady && !preview ? (
                <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
                  <div>
                    <VideoIcon size={28} className="mx-auto text-white/35" />
                    <p className="mt-3 text-sm font-medium text-white/80">{t("liveScan.cameraPrompt", lang)}</p>
                  </div>
                </div>
              ) : null}
              {capturing ? (
                <span className="absolute left-4 top-4 inline-flex items-center gap-2 rounded-full bg-black/60 px-3 py-1.5 text-[11px] font-semibold text-white backdrop-blur">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-red-500 motion-reduce:animate-none" />
                  {t("liveScan.capturing", lang)}
                </span>
              ) : null}
              {preview ? (
                <span className="absolute left-4 bottom-4 z-20 rounded-full bg-black/60 px-3 py-1.5 text-[11px] font-semibold text-white backdrop-blur">
                  {preview.trust === "qualified" ? t("liveScan.previewQualified", lang) : t("liveScan.previewProvisional", lang)} · {t("liveScan.epoch", lang)} {preview.epoch}
                </span>
              ) : null}
            </section>

            <aside className="min-h-0 overflow-y-auto bg-card p-4 sm:p-5">
              <div className="space-y-3">
                <div className="rounded-2xl border border-border/60 bg-background/60 p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{t("liveScan.progress", lang)}</p>
                  <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                    <div><dt className="text-[11px] text-muted-foreground">{t("liveScan.framesReady", lang)}</dt><dd className="mt-0.5 font-semibold tabular-nums">{session.progress.ready_frames}</dd></div>
                    <div><dt className="text-[11px] text-muted-foreground">{t("liveScan.framesProcessed", lang)}</dt><dd className="mt-0.5 font-semibold tabular-nums">{session.progress.processed_frames}</dd></div>
                    <div className="col-span-2"><dt className="text-[11px] text-muted-foreground">{t("liveScan.floorState", lang)}</dt><dd className="mt-0.5 font-semibold">{floorLabel}</dd></div>
                  </dl>
                </div>
                <div className="rounded-2xl border border-dashed border-border bg-background/35 p-5 text-center">
                  <p className="text-sm font-semibold">{t("liveScan.previewWaiting", lang)}</p>
                  <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">{t("liveScan.previewHint", lang)}</p>
                </div>
                {session.runtime.active && !terminal ? (
                  <Button
                    className="w-full"
                    variant="outline"
                    loading={finishing}
                    onClick={finishSession}
                  >
                    {t("liveScan.finish", lang)}
                  </Button>
                ) : null}
                {errorText ? <p role="alert" className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">{errorText}</p> : null}
              </div>
            </aside>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

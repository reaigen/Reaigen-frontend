"use client";

import { useEffect, useState, useRef, useCallback, use } from "react";
import { getSharedTourViewer, verifySharePin } from "../../lib/api/client";
import { getApiErrorJson, getSafeApiErrorMessage } from "../../lib/api/error-message";
import type { TourViewerData, TourData, TourShot, RoomData, CameraData } from "../../lib/tour-types";
import dynamic from "next/dynamic";
import TourControls from "../../components/tour-controls";
import FloorplanNav from "../../components/floorplan-nav";
import { Button } from "../../lib/ui/button";
import { Input } from "../../lib/ui/input";
import { getBrowserLanguage, t } from "../../lib/i18n";

const SplatViewer = dynamic(() => import("../../components/splat-viewer"), { ssr: false });
const SOG_READY_TIMEOUT_MS = 15000;

function pickRenderableUrl(data: TourViewerData): string {
  return data.signed_outputs?.sog
    ?? data.signed_outputs?.["model.sog"]
    ?? (data.format === "sog" ? data.url : undefined)
    ?? data.signed_outputs?.splat
    ?? data.signed_outputs?.["model.splat"]
    ?? data.signed_outputs?.spz
    ?? data.signed_outputs?.["model.spz"]
    ?? data.signed_outputs?.ply
    ?? data.signed_outputs?.["model.ply"]
    ?? data.signed_outputs?.["output_mcmc.ply"]
    ?? data.url;
}

function pickFallbackRenderableUrl(data: TourViewerData): string | null {
  return data.signed_outputs?.ply
    ?? data.signed_outputs?.["model.ply"]
    ?? data.signed_outputs?.["output_mcmc.ply"]
    ?? null;
}

type SharedErrorKind = "notAvailable" | "expired" | "limit" | "paused" | "generic";

function sanitizeError(msg: string, lang: string): { kind: SharedErrorKind; message: string } {
  const lower = msg.toLowerCase();
  if (lower.includes("requires_pin")) return { kind: "generic", message: t("shared.error.pinRequired", lang) };
  if (lower.includes("not found") || lower.includes("revoked")) return { kind: "notAvailable", message: t("shared.error.notAvailable", lang) };
  if (lower.includes("expired")) return { kind: "expired", message: t("shared.error.expired", lang) };
  if (lower.includes("maximum")) return { kind: "limit", message: t("shared.error.viewLimit", lang) };
  if (lower.includes("paused")) return { kind: "paused", message: t("shared.error.paused", lang) };
  return { kind: "generic", message: t("shared.error.loadFailed", lang) };
}

function Brand() {
  return (
    <span
      className="text-[22px] text-foreground/80"
      style={{ fontFamily: "var(--font-brand), ui-serif, Georgia, serif", fontWeight: 400, letterSpacing: "0.02em" }}
    >
      Reaigen
    </span>
  );
}

export default function SharedTourPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);

  const [lang, setLang] = useState("en");
  const [data, setData] = useState<TourViewerData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<SharedErrorKind | null>(null);
  const [requiresPin, setRequiresPin] = useState(false);
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinLoading, setPinLoading] = useState(false);
  const [tourData, setTourData] = useState<TourData | null>(null);
  const [shotIdx, setShotIdx] = useState(0);
  const [activeRoomId, setActiveRoomId] = useState<number | null>(null);
  const [activeRenderUrl, setActiveRenderUrl] = useState<string | null>(null);
  const [viewerReady, setViewerReady] = useState(false);

  const splatRef = useRef<any>(null);

  useEffect(() => {
    setLang(getBrowserLanguage());
  }, []);

  const loadViewer = useCallback(async () => {
    try {
      setError(null);
      setErrorKind(null);
      const result = await getSharedTourViewer(token);
      setData(result);
    } catch (err) {
      const body = getApiErrorJson(err);
      if (body?.requires_pin) {
        setRequiresPin(true);
        return;
      }
      const rawMessage = typeof body?.error === "string" ? body.error : typeof body?.message === "string" ? body.message : "";
      const nextError = rawMessage
        ? sanitizeError(rawMessage, lang)
        : { kind: "generic" as const, message: getSafeApiErrorMessage(err, lang, "shared.error.loadFailed") };
      setErrorKind(nextError.kind);
      setError(nextError.message);
    }
  }, [token, lang]);

  useEffect(() => { loadViewer(); }, [loadViewer]);
  useEffect(() => {
    setActiveRenderUrl(data ? pickRenderableUrl(data) : null);
    setViewerReady(false);
  }, [data]);
  useEffect(() => {
    if (!data || !activeRenderUrl) return;
    if (viewerReady) return;
    const fallbackUrl = pickFallbackRenderableUrl(data);
    if (!fallbackUrl || activeRenderUrl === fallbackUrl) return;
    if (!activeRenderUrl.split("?")[0].toLowerCase().endsWith(".sog")) return;

    const timer = window.setTimeout(() => {
      setActiveRenderUrl(fallbackUrl);
    }, SOG_READY_TIMEOUT_MS);

    return () => window.clearTimeout(timer);
  }, [activeRenderUrl, data, viewerReady]);

  const handlePinSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (pinLoading) return;
    setPinLoading(true);
    setPinError(null);
    setError(null);
    try {
      const result = await verifySharePin(token, pin);
      if (result.verified) {
        setRequiresPin(false);
        setPin("");
        await loadViewer();
      } else {
        setPinError(t("shared.pin.invalid", lang));
      }
    } catch (err) {
      let msg = getSafeApiErrorMessage(err, lang, "shared.pin.invalid");
      const body = getApiErrorJson(err);
      if (typeof body?.retry_after_seconds === "number") {
        const mins = Math.ceil(body.retry_after_seconds / 60);
        msg = `${t("shared.pin.tooManyAttempts", lang)} ${mins} ${mins === 1 ? t("shared.pin.minute", lang) : t("shared.pin.minutes", lang)}.`;
      }
      setPinError(msg);
    } finally {
      setPinLoading(false);
    }
  }, [token, pin, loadViewer, pinLoading, lang]);

  const handleShotChange = useCallback((idx: number) => {
    setShotIdx(idx);
  }, []);

  const handleTourLoaded = useCallback((data: TourData) => {
    setTourData(data);
  }, []);

  const handleRoomClick = useCallback((room: RoomData) => {
    setActiveRoomId(room.id);
    if (tourData?.rooms) {
      const featured = tourData.rooms.find((r) => r.id === room.id);
      if (featured && featured.featuredShotIdx >= 0) {
        splatRef.current?.goToShot(featured.featuredShotIdx);
      }
    }
  }, [tourData]);

  // ── PIN gate ──
  if (requiresPin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[hsl(var(--muted))]/35 px-4">
        <div className="w-full max-w-xs space-y-6 px-6">
          <div className="text-center space-y-2">
            <Brand />
            <div className="pt-2">
              <div className="mx-auto w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="text-muted-foreground">
                  <rect x="3" y="11" width="18" height="11" rx="2" stroke="currentColor" strokeWidth="2" />
                  <path d="M7 11V7a5 5 0 0110 0v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </div>
              <h2 className="text-base font-semibold">{t("shared.pin.title", lang)}</h2>
              <p className="text-sm text-muted-foreground mt-1">{t("shared.pin.subtitle", lang)}</p>
            </div>
          </div>

          <form onSubmit={handlePinSubmit} className="space-y-3">
            <Input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              placeholder={t("shared.pin.placeholder", lang)}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 10))}
              disabled={pinLoading}
              autoFocus
              autoComplete="off"
              className="h-10 text-center text-sm tracking-[0.2em] tabular-nums"
            />
            {pinError && (
              <div className="rounded-lg bg-foreground/[0.04] border border-foreground/[0.08] px-3 py-2">
                <p className="text-xs text-foreground/60 text-center">{pinError}</p>
              </div>
            )}
            <Button className="w-full h-10" loading={pinLoading} disabled={pinLoading || pin.length < 4}>
              {t("shared.pin.viewTour", lang)}
            </Button>
          </form>
        </div>
      </div>
    );
  }

  // ── Error state ──
  if (error) {
    const isExpired = errorKind === "expired" || errorKind === "notAvailable";
    const isPaused = errorKind === "paused";
    const isLimitReached = errorKind === "limit";
    const showRetry = !isExpired && !isPaused && !isLimitReached;

    return (
      <div className="min-h-screen flex items-center justify-center bg-[hsl(var(--muted))]/35 px-4">
        <div className="text-center space-y-4 px-6 max-w-xs">
          <Brand />
          <div className="pt-2">
            <div className="mx-auto w-12 h-12 rounded-full bg-foreground/[0.04] flex items-center justify-center mb-3">
              {isExpired ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="text-foreground/30">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M12 6v6l4 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : isPaused ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="text-foreground/30">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M10 15V9M14 15V9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="text-foreground/30">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M12 8v4M12 16h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              )}
            </div>
            <p className="text-[14px] font-medium text-foreground/70 mb-1">
              {isExpired ? t("shared.error.titleExpired", lang) : isPaused ? t("shared.error.titlePaused", lang) : isLimitReached ? t("shared.error.titleLimit", lang) : t("shared.error.titleGeneric", lang)}
            </p>
            <p className="text-[13px] text-foreground/40 leading-relaxed">{error}</p>
          </div>
          {showRetry && (
            <Button variant="outline" size="sm" onClick={() => { setError(null); loadViewer(); }}>
              {t("common.tryAgain", lang)}
            </Button>
          )}
        </div>
      </div>
    );
  }

  // ── Loading ──
  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-3">
          <div className="animate-spin h-7 w-7 border-2 border-foreground/15 border-t-foreground/60 rounded-full mx-auto" />
          <p className="text-xs text-muted-foreground">{t("shared.loadingTour", lang)}</p>
        </div>
      </div>
    );
  }

  // ── Viewer ──
  return (
    <div className="relative h-[100dvh] w-screen overflow-hidden bg-black">
      <SplatViewer
        ref={splatRef}
        splatUrl={activeRenderUrl ?? pickRenderableUrl(data)}
        tourUrl={data.tour_url ?? undefined}
        initialCameras={data.cameras as CameraData ?? undefined}
        preferSavedCameras={!!data.cameras?.cameras?.length}
        readOnly
        onReady={() => setViewerReady(true)}
        onError={() => {
          const fallbackUrl = pickFallbackRenderableUrl(data);
          if (fallbackUrl && activeRenderUrl !== fallbackUrl) {
            setViewerReady(false);
            setActiveRenderUrl(fallbackUrl);
          }
        }}
        onShotChange={handleShotChange}
        onTourLoaded={handleTourLoaded}
        lang={lang}
      />

      {/* Title badge */}
      {data.draft_title && (
        <div className="absolute left-3 top-3 z-20 max-w-[calc(100%-5.5rem)] animate-fade-in sm:left-4 sm:top-4 sm:max-w-[calc(100%-6rem)]">
          <span className="text-sm font-medium text-white bg-black/40 backdrop-blur-xl px-3.5 py-2 rounded-full border border-white/10 shadow-lg block truncate">
            {data.draft_title}
          </span>
        </div>
      )}

      {/* Branding */}
      <div className="absolute right-3 top-3 z-20 animate-fade-in sm:right-4 sm:top-4">
        <span
          className="text-[13px] text-white/50 bg-black/20 backdrop-blur-sm px-2.5 py-1 rounded-full"
          style={{ fontFamily: "var(--font-brand), ui-serif, Georgia, serif", fontWeight: 400 }}
        >
          Reaigen
        </span>
      </div>

      {/* Tour controls */}
      {tourData && (
        <TourControls
          shots={tourData.shots}
          currentIdx={shotIdx}
          onGoToShot={(i) => splatRef.current?.goToShot(i)}
          onPrev={() => splatRef.current?.goToPrev()}
          onNext={() => splatRef.current?.goToNext()}
          lang={lang}
        />
      )}

      {/* Floorplan */}
      {data.floorplan_url && data.rooms.length > 0 && (
        <FloorplanNav
          floorplanUrl={data.floorplan_url}
          rooms={data.rooms}
          onRoomClick={handleRoomClick}
          activeRoomId={activeRoomId}
          lang={lang}
        />
      )}
    </div>
  );
}

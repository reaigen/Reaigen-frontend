"use client";

/**
 * Public shared view — renders content for a share token.
 *
 * Always shows the property card (SharedDraftView) as the primary view.
 * When a 3D tour exists, a "View 3D Tour" button opens the full-screen
 * SplatViewer as an overlay. This way the recipient always sees the
 * property info first, and can explore the tour if available.
 *
 * Flow:
 *   1. Load draft data via GET /shared/{token}/ (always)
 *   2. Try tour-viewer endpoint in parallel (may 404 if no tour)
 *   3. If PIN required → show PIN gate first
 *   4. Render: property card + optional tour overlay
 */

import { useEffect, useState, useRef, useCallback, use } from "react";
import { getSharedTourViewer, verifySharePin, getSharedDraftData, listUnits } from "../../lib/api/client";
import { getApiErrorJson, getSafeApiErrorMessage } from "../../lib/api/error-message";
import type { TourViewerData, TourData, RoomData, CameraData, SharedDraftData } from "../../lib/tour-types";
import dynamic from "next/dynamic";
import TourControls from "../../components/tour-controls";
import FloorplanNav from "../../components/floorplan-nav";
import { SharedPropertyPanel } from "../../components/shared-property-panel";
import { SharedDraftView } from "../../components/shared-draft-view";
import { Button } from "../../lib/ui/button";
import { Input } from "../../lib/ui/input";
import { getBrowserLanguage, t } from "../../lib/i18n";
import { PageLoading } from "../../components/page-loading";
import type { SplatViewerHandle } from "../../components/splat-viewer";
import type { UnitLookup } from "../../lib/unit-catalog";

const SplatViewer = dynamic(() => import("../../components/splat-viewer"), { ssr: false });

// ── Splat URL selection ────────────────────────────────────────────────

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

// ── Error classification ───────────────────────────────────────────────

type SharedErrorKind = "notAvailable" | "expired" | "limit" | "paused" | "auth" | "generic";

function classifyError(msg: string, lang: string): { kind: SharedErrorKind; message: string } {
  const lower = msg.toLowerCase();
  if (lower.includes("requires_pin")) return { kind: "generic", message: t("shared.error.pinRequired", lang) };
  if (lower.includes("not found") || lower.includes("revoked")) return { kind: "notAvailable", message: t("shared.error.notAvailable", lang) };
  if (lower.includes("expired")) return { kind: "expired", message: t("shared.error.expired", lang) };
  if (lower.includes("maximum")) return { kind: "limit", message: t("shared.error.viewLimit", lang) };
  if (lower.includes("paused")) return { kind: "paused", message: t("shared.error.paused", lang) };
  return { kind: "generic", message: t("shared.error.loadFailed", lang) };
}

// ── Branding ───────────────────────────────────────────────────────────

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

// ── Page ───────────────────────────────────────────────────────────────

export default function SharedPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);

  const [lang, setLang] = useState("en");
  useEffect(() => { setLang(getBrowserLanguage()); }, []);

  // Data
  const [tourViewerData, setTourViewerData] = useState<TourViewerData | null>(null);
  const [draftData, setDraftData] = useState<SharedDraftData | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasTour, setHasTour] = useState(false);
  const [unitCatalog, setUnitCatalog] = useState<UnitLookup[]>([]);

  useEffect(() => {
    let active = true;
    void listUnits()
      .then((units) => { if (active) setUnitCatalog(units); })
      .catch(() => { if (active) setUnitCatalog([]); });
    return () => { active = false; };
  }, []);

  // Error / PIN
  const [error, setError] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<SharedErrorKind | null>(null);
  const [requiresPin, setRequiresPin] = useState(false);
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinLoading, setPinLoading] = useState(false);

  // Tour overlay
  const [tourOpen, setTourOpen] = useState(false);
  const [tourMeta, setTourMeta] = useState<TourData | null>(null);
  const [shotIdx, setShotIdx] = useState(0);
  const [activeRoomId, setActiveRoomId] = useState<number | null>(null);
  const [activeRenderUrl, setActiveRenderUrl] = useState<string | null>(null);
  const [viewerReady, setViewerReady] = useState(false);
  const [tourPanel, setTourPanel] = useState<"property" | "floorplan" | null>(null);
  const splatRef = useRef<SplatViewerHandle | null>(null);

  // ── Load both draft data and tour data in parallel ────────────────

  const loadContent = useCallback(async () => {
    setError(null);
    setErrorKind(null);
    setLoading(true);

    // Load draft data and tour data in parallel
    const [draftResult, tourResult] = await Promise.allSettled([
      getSharedDraftData(token),
      getSharedTourViewer(token),
    ]);

    // Check for PIN / sign-in requirement from either endpoint.
    // (A share may exclude the tour, so the tour endpoint alone is not
    // authoritative — the draft endpoint reports the same gates.)
    const tourErrBody = tourResult.status === "rejected" ? getApiErrorJson(tourResult.reason) : null;
    const draftErrBody = draftResult.status === "rejected" ? getApiErrorJson(draftResult.reason) : null;
    if (tourErrBody?.requires_pin || draftErrBody?.requires_pin) {
      setRequiresPin(true);
      setLoading(false);
      return;
    }
    if (tourErrBody?.requires_auth || draftErrBody?.requires_auth) {
      setErrorKind("auth");
      setError(t("shared.error.signInRequired", lang));
      setLoading(false);
      return;
    }

    // Draft data
    if (draftResult.status === "fulfilled" && draftResult.value) {
      setDraftData(draftResult.value);
    }

    // Tour data
    if (tourResult.status === "fulfilled" && tourResult.value) {
      setTourViewerData(tourResult.value);
      setHasTour(true);
      // Tour response may also include inline draft data
      if (!(draftResult.status === "fulfilled" && draftResult.value) && tourResult.value.draft_data) {
        setDraftData(tourResult.value.draft_data);
      }
    }

    // If we got neither, show error
    const gotDraft = draftResult.status === "fulfilled" && draftResult.value;
    const gotTour = tourResult.status === "fulfilled" && tourResult.value;
    if (!gotDraft && !gotTour) {
      // Try to classify the error from whichever endpoint failed.
      // Prefer the draft endpoint — the tour endpoint 404s for shares
      // that simply don't include the tour.
      const err = draftResult.status === "rejected"
        ? draftResult.reason
        : tourResult.status === "rejected" ? tourResult.reason : null;
      if (err) {
        const body = getApiErrorJson(err);
        const rawMessage = typeof body?.error === "string" ? body.error : typeof body?.message === "string" ? body.message : "";
        const classified = rawMessage
          ? classifyError(rawMessage, lang)
          : { kind: "generic" as const, message: getSafeApiErrorMessage(err, lang, "shared.error.loadFailed") };
        setErrorKind(classified.kind);
        setError(classified.message);
      } else {
        setError(t("shared.error.loadFailed", lang));
        setErrorKind("generic");
      }
    }

    setLoading(false);
  }, [token, lang]);

  useEffect(() => { loadContent(); }, [loadContent]);

  // ── Render URL management ─────────────────────────────────────────

  useEffect(() => {
    setActiveRenderUrl(tourViewerData ? pickRenderableUrl(tourViewerData) : null);
    setViewerReady(false);
  }, [tourViewerData]);

  useEffect(() => {
    if (!tourViewerData || !activeRenderUrl || viewerReady) return;
    const fallbackUrl = pickFallbackRenderableUrl(tourViewerData);
    if (!fallbackUrl || activeRenderUrl === fallbackUrl) return;
    if (!activeRenderUrl.split("?")[0].toLowerCase().endsWith(".sog")) return;
    const timer = window.setTimeout(() => setActiveRenderUrl(fallbackUrl), SOG_READY_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [activeRenderUrl, tourViewerData, viewerReady]);

  // ── PIN verification ──────────────────────────────────────────────

  const handlePinSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (pinLoading) return;
    setPinLoading(true);
    setPinError(null);
    try {
      const result = await verifySharePin(token, pin);
      if (result.verified) {
        setRequiresPin(false);
        setPin("");
        await loadContent();
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
  }, [token, pin, loadContent, pinLoading, lang]);

  // ── Tour overlay handlers ─────────────────────────────────────────

  const handleRoomClick = useCallback((room: RoomData) => {
    setActiveRoomId(room.id);
    if (tourMeta?.rooms) {
      const featured = tourMeta.rooms.find((r) => r.id === room.id);
      if (featured && featured.featuredShotIdx >= 0) splatRef.current?.goToShot(featured.featuredShotIdx);
    }
  }, [tourMeta]);

  // ── Render ────────────────────────────────────────────────────────

  // PIN gate
  if (requiresPin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[hsl(var(--muted))]/35 px-4">
        <div className="w-full max-w-xs space-y-6 px-6">
          <div className="text-center space-y-2">
            <Brand />
            <div className="pt-2">
              <div className="mx-auto w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="text-muted-foreground"><rect x="3" y="11" width="18" height="11" rx="2" stroke="currentColor" strokeWidth="2" /><path d="M7 11V7a5 5 0 0110 0v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
              </div>
              <h2 className="text-[15px] font-semibold">{t("shared.pin.title", lang)}</h2>
              <p className="text-[13px] text-muted-foreground mt-1">{t("shared.pin.subtitle", lang)}</p>
            </div>
          </div>
          <form onSubmit={handlePinSubmit} className="space-y-3">
            <div className="space-y-1.5">
              <Input type="text" inputMode="numeric" pattern="[0-9]*" placeholder={t("shared.pin.placeholder", lang)} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 10))} disabled={pinLoading} autoFocus autoComplete="off" className="h-10 text-center text-[13px] tracking-[0.2em] tabular-nums" />
              <p className="text-[11px] text-foreground/50 text-center">{t("shared.pin.minLength", lang)}</p>
            </div>
            {pinError && <div role="alert" className="rounded-lg bg-foreground/[0.04] border border-foreground/[0.08] px-3 py-2"><p className="text-xs text-foreground/60 text-center">{pinError}</p></div>}
            {/* Neutral CTA — at gate time we don't yet know whether the share includes a tour */}
            <Button className="w-full h-10" loading={pinLoading} disabled={pinLoading || pin.length < 4}>{t("shared.pin.continue", lang)}</Button>
          </form>
        </div>
      </div>
    );
  }

  // Error
  if (error) {
    const isUnavailable = errorKind === "notAvailable";
    const isExpired = errorKind === "expired";
    const isPaused = errorKind === "paused";
    const isLimitReached = errorKind === "limit";
    const isAuthRequired = errorKind === "auth";
    const showRetry = !isUnavailable && !isExpired && !isPaused && !isLimitReached && !isAuthRequired;
    return (
      <div className="min-h-screen flex items-center justify-center bg-[hsl(var(--muted))]/35 px-4">
        <div className="text-center space-y-4 px-6 max-w-xs">
          <Brand />
          <div className="pt-2">
            <div className="mx-auto w-12 h-12 rounded-full bg-foreground/[0.04] flex items-center justify-center mb-3">
              {isExpired || isUnavailable ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="text-foreground/30"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" /><path d="M12 6v6l4 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
              ) : isPaused ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="text-foreground/30"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" /><path d="M10 15V9M14 15V9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="text-foreground/30"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" /><path d="M12 8v4M12 16h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
              )}
            </div>
            <p className="text-[14px] font-medium text-foreground/70 mb-1">
              {isUnavailable ? t("shared.error.titleUnavailable", lang) : isExpired ? t("shared.error.titleExpired", lang) : isPaused ? t("shared.error.titlePaused", lang) : isLimitReached ? t("shared.error.titleLimit", lang) : isAuthRequired ? t("shared.error.titleSignIn", lang) : t("shared.error.titleGeneric", lang)}
            </p>
            <p className="text-[13px] text-foreground/40 leading-relaxed">{error}</p>
          </div>
          {isAuthRequired && (
            <Button variant="outline" size="sm" onClick={() => { window.location.href = `/?next=${encodeURIComponent(`/shared/${token}`)}`; }}>
              {t("shared.error.signIn", lang)}
            </Button>
          )}
          {showRetry && <Button variant="outline" size="sm" onClick={() => { setError(null); loadContent(); }}>{t("common.tryAgain", lang)}</Button>}
        </div>
      </div>
    );
  }

  // Loading
  if (loading) {
    return <PageLoading />;
  }

  // ── Render ────────────────────────────────────────────────────────
  // The property card stays mounted underneath; the tour renders as a
  // fixed overlay on top so scroll position and gallery state survive
  // opening/closing the tour.

  return (
    <>
      {draftData && (
        <SharedDraftView draftData={draftData} lang={lang} hasTour={hasTour} onOpenTour={() => setTourOpen(true)} floorplanUrl={tourViewerData?.floorplan_url} rooms={tourViewerData?.rooms} units={unitCatalog} />
      )}

      {tourOpen && tourViewerData && (
        <div className="fixed inset-0 z-[9999] bg-white">
          <div className="relative h-full w-full overflow-hidden bg-black">
        <SplatViewer
          ref={splatRef}
          splatUrl={activeRenderUrl ?? pickRenderableUrl(tourViewerData)}
          tourUrl={tourViewerData.tour_url ?? undefined}
          initialCameras={tourViewerData.cameras as CameraData ?? undefined}
          preferSavedCameras={!!tourViewerData.cameras?.cameras?.length}
          readOnly
          onReady={() => setViewerReady(true)}
          onError={() => {
            const fallbackUrl = pickFallbackRenderableUrl(tourViewerData);
            if (fallbackUrl && activeRenderUrl !== fallbackUrl) {
              setViewerReady(false);
              setActiveRenderUrl(fallbackUrl);
            }
          }}
          onShotChange={setShotIdx}
          onTourLoaded={setTourMeta}
          lang={lang}
        />

        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-28 bg-gradient-to-b from-black/50 to-transparent" aria-hidden="true" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-36 bg-gradient-to-t from-black/55 to-transparent" aria-hidden="true" />

        {/* Close button — back to property card */}
        <button
          type="button"
        onClick={() => { setTourPanel(null); setTourOpen(false); }}
          className="absolute left-3 top-[calc(0.75rem+env(safe-area-inset-top,0px))] z-20 flex h-11 items-center gap-1.5 rounded-full border border-white/10 bg-black/40 px-3 text-[11px] font-medium text-white/70 backdrop-blur-xl transition-colors hover:bg-black/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 sm:left-4 sm:top-[calc(1rem+env(safe-area-inset-top,0px))] sm:h-8"
        >
          <svg aria-hidden="true" width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M10 12L6 8l4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          {t("common.back", lang)}
        </button>

        {/* Branding */}
        <div className="absolute right-3 top-[calc(0.75rem+env(safe-area-inset-top,0px))] z-20 animate-fade-in sm:right-4 sm:top-[calc(1rem+env(safe-area-inset-top,0px))]">
          <span className="text-[13px] text-white/50 bg-black/20 backdrop-blur-sm px-2.5 py-1 rounded-full" style={{ fontFamily: "var(--font-brand), ui-serif, Georgia, serif", fontWeight: 400 }}>Reaigen</span>
        </div>

        {tourMeta && (
          <TourControls shots={tourMeta.shots} currentIdx={shotIdx} onGoToShot={(i) => splatRef.current?.goToShot(i)} onPrev={() => splatRef.current?.goToPrev()} onNext={() => splatRef.current?.goToNext()} lang={lang} />
        )}

        {tourViewerData.floorplan_url && tourViewerData.rooms.length > 0 && (
          <FloorplanNav
            floorplanUrl={tourViewerData.floorplan_url}
            rooms={tourViewerData.rooms}
            onRoomClick={handleRoomClick}
            activeRoomId={activeRoomId}
            lang={lang}
            open={tourPanel === "floorplan"}
            onOpenChange={(open) => setTourPanel(open ? "floorplan" : null)}
          />
        )}

        {draftData && (
          <SharedPropertyPanel
            draftData={draftData}
            lang={lang}
            units={unitCatalog}
            open={tourPanel === "property"}
            onOpenChange={(open) => setTourPanel(open ? "property" : null)}
          />
        )}
          </div>
        </div>
      )}
    </>
  );
}

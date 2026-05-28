"use client";

import { useEffect, useState, useRef, useCallback, use } from "react";
import { getSharedTourViewer, verifySharePin } from "../../lib/api/client";
import type { TourViewerData, TourData, TourShot, RoomData } from "../../lib/tour-types";
import dynamic from "next/dynamic";
import TourControls from "../../components/tour-controls";
import FloorplanNav from "../../components/floorplan-nav";
import { Button } from "../../lib/ui/button";
import { Input } from "../../lib/ui/input";

const SplatViewer = dynamic(() => import("../../components/splat-viewer"), { ssr: false });

// Map raw backend errors to user-friendly messages
function sanitizeError(msg: string): string {
  if (msg.includes("requires_pin")) return "PIN required to view this link.";
  if (msg.includes("not found") || msg.includes("revoked")) return "This link is no longer available.";
  if (msg.includes("expired")) return "This link has expired.";
  if (msg.includes("maximum")) return "This link has reached its view limit.";
  if (msg.includes("paused")) return "This link has been paused by the owner.";
  return "Unable to load tour. Please try again.";
}

function Brand() {
  return (
    <span
      className="text-[22px] text-foreground/80"
      style={{ fontFamily: "var(--font-brand), ui-serif, Georgia, serif", fontWeight: 500, letterSpacing: "0.02em" }}
    >
      Reaigen
    </span>
  );
}

export default function SharedTourPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);

  const [data, setData] = useState<TourViewerData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [requiresPin, setRequiresPin] = useState(false);
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinLoading, setPinLoading] = useState(false);
  const [tourData, setTourData] = useState<TourData | null>(null);
  const [shotIdx, setShotIdx] = useState(0);
  const [activeRoomId, setActiveRoomId] = useState<number | null>(null);

  // Persist PIN token in sessionStorage so page reloads don't re-prompt
  const pinTokenRef = useRef<string | undefined>(
    typeof window !== "undefined" ? (sessionStorage.getItem(`reaigen_pin_${token}`) ?? undefined) : undefined,
  );

  const splatRef = useRef<any>(null);

  const loadViewer = useCallback(async () => {
    try {
      setError(null);
      const result = await getSharedTourViewer(token, pinTokenRef.current);
      setData(result);
    } catch (e: any) {
      try {
        const body = JSON.parse(e.body);
        if (body.requires_pin) {
          setRequiresPin(true);
          return;
        }
        setError(sanitizeError(body.error || body.message || e.message));
      } catch {
        setError(sanitizeError(e.message));
      }
    }
  }, [token]);

  useEffect(() => { loadViewer(); }, [loadViewer]);

  const handlePinSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (pinLoading) return;
    setPinLoading(true);
    setPinError(null);
    setError(null);
    try {
      const result = await verifySharePin(token, pin);
      if (result.pin_token) {
        pinTokenRef.current = result.pin_token;
        sessionStorage.setItem(`reaigen_pin_${token}`, result.pin_token);
      }
      setRequiresPin(false);
      await loadViewer();
    } catch (err: any) {
      let msg = "Invalid PIN. Please try again.";
      try {
        const body = JSON.parse(err.body);
        if (body.error) msg = body.error;
        if (body.retry_after_seconds) {
          const mins = Math.ceil(body.retry_after_seconds / 60);
          msg = `Too many attempts. Try again in ${mins} minute${mins > 1 ? "s" : ""}.`;
        }
      } catch {}
      setPinError(msg);
    } finally {
      setPinLoading(false);
    }
  }, [token, pin, loadViewer, pinLoading]);

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
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-background to-muted/30">
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
              <h2 className="text-base font-semibold">This tour is protected</h2>
              <p className="text-sm text-muted-foreground mt-1">Enter the PIN to view this virtual tour.</p>
            </div>
          </div>

          <form onSubmit={handlePinSubmit} className="space-y-3">
            <Input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              placeholder="Enter PIN"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 10))}
              disabled={pinLoading}
              autoFocus
              autoComplete="off"
              className="h-11 text-center text-lg tracking-[0.3em] font-mono"
            />
            {pinError && (
              <div className="rounded-lg bg-destructive/5 border border-destructive/20 px-3 py-2">
                <p className="text-xs text-destructive text-center">{pinError}</p>
              </div>
            )}
            <Button className="w-full h-10" loading={pinLoading} disabled={pinLoading || pin.length < 4}>
              View tour
            </Button>
          </form>
        </div>
      </div>
    );
  }

  // ── Error state ──
  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-background to-muted/30">
        <div className="text-center space-y-4 px-6">
          <Brand />
          <div className="pt-2">
            <div className="mx-auto w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="text-muted-foreground">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
                <path d="M12 8v4M12 16h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </div>
            <p className="text-sm text-muted-foreground max-w-xs mx-auto">{error}</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => { setError(null); loadViewer(); }}>
            Try again
          </Button>
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
          <p className="text-xs text-muted-foreground">Loading tour...</p>
        </div>
      </div>
    );
  }

  // ── Viewer ──
  return (
    <div className="h-screen w-screen relative overflow-hidden">
      <SplatViewer
        ref={splatRef}
        splatUrl={data.url}
        tourUrl={data.tour_url ?? undefined}
        camerasUrl={data.cameras ? `data:application/json,${encodeURIComponent(JSON.stringify(data.cameras))}` : undefined}
        readOnly
        onShotChange={handleShotChange}
        onTourLoaded={handleTourLoaded}
      />

      {/* Title badge */}
      {data.draft_title && (
        <div className="absolute top-4 left-4 z-20 animate-fade-in">
          <span className="text-sm font-medium text-white bg-black/40 backdrop-blur-xl px-3.5 py-2 rounded-full border border-white/10 shadow-lg">
            {data.draft_title}
          </span>
        </div>
      )}

      {/* Branding */}
      <div className="absolute top-4 right-4 z-20 animate-fade-in">
        <span
          className="text-[13px] text-white/50 bg-black/20 backdrop-blur-sm px-2.5 py-1 rounded-full"
          style={{ fontFamily: "var(--font-brand), ui-serif, Georgia, serif", fontWeight: 500 }}
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
        />
      )}

      {/* Floorplan */}
      {data.floorplan_url && data.rooms.length > 0 && (
        <FloorplanNav
          floorplanUrl={data.floorplan_url}
          rooms={data.rooms}
          onRoomClick={handleRoomClick}
          activeRoomId={activeRoomId}
        />
      )}
    </div>
  );
}

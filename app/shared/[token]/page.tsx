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

  const splatRef = useRef<any>(null);

  const loadViewer = useCallback(async () => {
    try {
      const result = await getSharedTourViewer(token);
      setData(result);
    } catch (e: any) {
      try {
        const body = JSON.parse(e.body);
        if (body.requires_pin) {
          setRequiresPin(true);
          return;
        }
        setError(body.error || e.message);
      } catch {
        setError(e.message);
      }
    }
  }, [token]);

  useEffect(() => { loadViewer(); }, [loadViewer]);

  const handlePinSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setPinLoading(true);
    setPinError(null);
    try {
      await verifySharePin(token, pin);
      setRequiresPin(false);
      loadViewer();
    } catch (err: any) {
      setPinError("Invalid PIN");
    } finally {
      setPinLoading(false);
    }
  }, [token, pin, loadViewer]);

  const handleShotChange = useCallback((idx: number) => {
    setShotIdx(idx);
  }, []);

  const handleTourLoaded = useCallback((data: TourData) => {
    setTourData(data);
  }, []);

  const handleRoomClick = useCallback((room: RoomData) => {
    setActiveRoomId(room.id);
    // If tour has rooms with featured shots, navigate there
    if (tourData?.rooms) {
      const featured = tourData.rooms.find((r) => r.id === room.id);
      if (featured && featured.featuredShotIdx >= 0) {
        splatRef.current?.goToShot(featured.featuredShotIdx);
      }
    }
  }, [tourData]);

  // PIN gate
  if (requiresPin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-full max-w-sm space-y-4 px-6">
          <h2 className="text-lg font-semibold text-center">Enter PIN to view</h2>
          <form onSubmit={handlePinSubmit} className="space-y-3">
            <Input
              type="password"
              placeholder="PIN"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              autoFocus
            />
            {pinError && <p className="text-xs text-destructive">{pinError}</p>}
            <Button className="w-full" loading={pinLoading}>
              Verify
            </Button>
          </form>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <p className="text-destructive">{error}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin h-8 w-8 border-2 border-foreground/20 border-t-foreground rounded-full" />
      </div>
    );
  }

  return (
    <div className="h-screen w-screen relative overflow-hidden">
      <SplatViewer
        ref={splatRef}
        splatUrl={data.splat_url}
        tourUrl={data.tour_url ?? undefined}
        readOnly
        onShotChange={handleShotChange}
        onTourLoaded={handleTourLoaded}
      />

      {tourData && (
        <TourControls
          shots={tourData.shots}
          currentIdx={shotIdx}
          onGoToShot={(i) => splatRef.current?.goToShot(i)}
          onPrev={() => splatRef.current?.goToPrev()}
          onNext={() => splatRef.current?.goToNext()}
        />
      )}

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

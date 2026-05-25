"use client";

import { useEffect, useState, useRef, useCallback, use } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../components/hooks/use-auth";
import { getSplatViewer } from "../../lib/api/client";
import type { SplatViewerPayload, TourData, TourShot } from "../../lib/tour-types";
import dynamic from "next/dynamic";
import TourControls from "../../components/tour-controls";
import CameraEditor from "../../components/camera-editor";
import { Button } from "../../lib/ui/button";

const SplatViewer = dynamic(() => import("../../components/splat-viewer"), { ssr: false });

export default function TourPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const splatId = parseInt(id, 10);
  const { isAuthenticated, isLoading } = useAuth();
  const router = useRouter();

  const [viewer, setViewer] = useState<SplatViewerPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tourData, setTourData] = useState<TourData | null>(null);
  const [shotIdx, setShotIdx] = useState(0);
  const splatRef = useRef<any>(null);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) router.replace("/");
  }, [isLoading, isAuthenticated, router]);

  useEffect(() => {
    if (!isAuthenticated || isNaN(splatId)) return;
    getSplatViewer(splatId)
      .then((data) => setViewer(data))
      .catch((e) => setError(e.body || e.message));
  }, [isAuthenticated, splatId]);

  const handleShotChange = useCallback((idx: number, shot: TourShot | null) => {
    setShotIdx(idx);
  }, []);

  const handleTourLoaded = useCallback((data: TourData) => {
    setTourData(data);
  }, []);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-2 border-foreground/20 border-t-foreground rounded-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-4">
          <p className="text-destructive">{error}</p>
          <Button variant="outline" onClick={() => router.back()}>Go back</Button>
        </div>
      </div>
    );
  }

  if (!viewer) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-2 border-foreground/20 border-t-foreground rounded-full" />
      </div>
    );
  }

  return (
    <div className="h-screen w-screen relative overflow-hidden">
      <SplatViewer
        ref={splatRef}
        splatUrl={viewer.url}
        splatId={viewer.splat_id}
        tourUrl={viewer.tour_url ?? undefined}
        camerasUrl={`/api/reaigen/splats/${splatId}/cameras/`}
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

      {/* Top bar */}
      <div className="absolute top-4 left-4 z-20 flex items-center gap-2">
        <Button variant="ghost" size="icon-sm" onClick={() => router.back()} aria-label="Back">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M10 12L6 8L10 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Button>
      </div>

      <CameraEditor
        splatId={splatId}
        viewerRef={splatRef}
        tourData={tourData}
        defaultMode="preview"
      />
    </div>
  );
}

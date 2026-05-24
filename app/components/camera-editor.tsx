"use client";

import { useState, useCallback, useEffect, useRef, type RefObject } from "react";
import { Button } from "@/app/lib/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/app/lib/ui/card";
import { saveCameras, getCameras } from "@/app/lib/api/client";
import type { TourData, Vec3 } from "@/app/lib/tour-types";
import type { SplatViewerHandle } from "./splat-viewer";

interface CameraShot {
  position: Vec3;
  forward: Vec3;
  up: Vec3;
  label: string;
}

interface Props {
  splatId: number;
  viewerRef: RefObject<SplatViewerHandle | null>;
  tourData: TourData | null;
}

export default function CameraEditor({ splatId, viewerRef, tourData }: Props) {
  const [shots, setShots] = useState<CameraShot[]>([]);
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const [previewIdx, setPreviewIdx] = useState(0);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load existing saved cameras on mount
  useEffect(() => {
    getCameras(splatId)
      .then((data) => {
        if (data.cameras?.length) {
          setShots(
            data.cameras.map((c, i) => ({
              position: c.position,
              forward: c.forward,
              up: c.up,
              label: `Shot ${i + 1}`,
            }))
          );
        }
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, [splatId]);

  // ── Edit mode actions ──────────────────────────────────────────────────────

  const addShot = useCallback(() => {
    const cam = viewerRef.current?.getCurrentCamera();
    if (!cam) return;
    setShots((prev) => [
      ...prev,
      {
        position: cam.position,
        forward: cam.forward,
        up: cam.up,
        label: `Shot ${prev.length + 1}`,
      },
    ]);
    setMessage(null);
  }, [viewerRef]);

  const updateShot = useCallback((idx: number) => {
    const cam = viewerRef.current?.getCurrentCamera();
    if (!cam) return;
    setShots((prev) =>
      prev.map((s, i) =>
        i === idx ? { ...s, position: cam.position, forward: cam.forward, up: cam.up } : s
      )
    );
    setMessage("Updated " + shots[idx]?.label);
  }, [viewerRef, shots]);

  const removeShot = useCallback((idx: number) => {
    setShots((prev) => prev.filter((_, i) => i !== idx));
    setMessage(null);
  }, []);

  const moveShot = useCallback((idx: number, dir: -1 | 1) => {
    setShots((prev) => {
      const next = [...prev];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  }, []);

  const flyToShot = useCallback((shot: CameraShot) => {
    viewerRef.current?.navigateToCamera(shot.position, shot.forward);
  }, [viewerRef]);

  const handleSave = useCallback(async () => {
    if (!shots.length) {
      setMessage("Add at least one shot first");
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      await saveCameras(splatId, {
        cameras: shots.map((s) => ({
          position: [...s.position],
          forward: [...s.forward],
          up: [...s.up],
        })),
        fovY: 0.66,
      });
      setMessage("Saved!");
    } catch (e: any) {
      setMessage("Save failed: " + (e.body || e.message));
    } finally {
      setSaving(false);
    }
  }, [shots, splatId]);

  // ── Preview mode ───────────────────────────────────────────────────────────

  const startPreview = useCallback(() => {
    if (!shots.length) return;
    setMode("preview");
    setPreviewIdx(0);
    viewerRef.current?.navigateToCamera(shots[0].position, shots[0].forward);
  }, [shots, viewerRef]);

  const stopPreview = useCallback(() => {
    setMode("edit");
    if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
    viewerRef.current?.enableFreeCamera();
  }, [viewerRef]);

  // Auto-advance in preview mode
  useEffect(() => {
    if (mode !== "preview" || !shots.length) return;
    previewTimerRef.current = setTimeout(() => {
      const next = (previewIdx + 1) % shots.length;
      setPreviewIdx(next);
      viewerRef.current?.navigateToCamera(shots[next].position, shots[next].forward);
    }, 4000);
    return () => { if (previewTimerRef.current) clearTimeout(previewTimerRef.current); };
  }, [mode, previewIdx, shots, viewerRef]);

  const previewGoTo = useCallback((idx: number) => {
    if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
    setPreviewIdx(idx);
    viewerRef.current?.navigateToCamera(shots[idx].position, shots[idx].forward);
  }, [shots, viewerRef]);

  // ── Render ─────────────────────────────────────────────────────────────────

  if (!loaded) return null;

  return (
    <div className="absolute top-16 right-4 z-30 w-72">
      <Card className="shadow-xl border-border/50 bg-background/95 backdrop-blur-md">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">Camera Editor</CardTitle>
            {shots.length > 0 && (
              <div className="flex rounded-lg bg-muted p-0.5 text-xs">
                <button
                  onClick={mode === "preview" ? stopPreview : undefined}
                  className={`px-2 py-0.5 rounded-md transition-colors ${mode === "edit" ? "bg-background shadow-sm font-medium" : "text-muted-foreground hover:text-foreground"}`}
                >
                  Edit
                </button>
                <button
                  onClick={mode === "edit" ? startPreview : undefined}
                  className={`px-2 py-0.5 rounded-md transition-colors ${mode === "preview" ? "bg-background shadow-sm font-medium" : "text-muted-foreground hover:text-foreground"}`}
                >
                  Preview
                </button>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {mode === "edit" ? (
            <>
              <Button variant="outline" size="sm" className="w-full" onClick={addShot}>
                + Capture Current View
              </Button>

              {shots.length > 0 && (
                <div className="space-y-1.5 max-h-72 overflow-y-auto">
                  {shots.map((shot, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-1 rounded-lg bg-muted/50 px-2 py-1.5 text-xs group"
                    >
                      <button
                        onClick={() => flyToShot(shot)}
                        className="flex-1 truncate font-medium text-left hover:text-primary transition-colors"
                        title="Click to fly to this shot"
                      >
                        {shot.label}
                      </button>
                      <button
                        onClick={() => updateShot(i)}
                        className="text-muted-foreground hover:text-primary p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                        aria-label="Update with current view"
                        title="Replace with current view"
                      >
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                          <path d="M2 10L10 2M10 2H5M10 2V7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </button>
                      <button
                        onClick={() => moveShot(i, -1)}
                        disabled={i === 0}
                        className="text-muted-foreground hover:text-foreground disabled:opacity-30 p-0.5"
                        aria-label="Move up"
                      >
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                          <path d="M6 3L3 6H9L6 3Z" fill="currentColor" />
                        </svg>
                      </button>
                      <button
                        onClick={() => moveShot(i, 1)}
                        disabled={i === shots.length - 1}
                        className="text-muted-foreground hover:text-foreground disabled:opacity-30 p-0.5"
                        aria-label="Move down"
                      >
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                          <path d="M6 9L9 6H3L6 9Z" fill="currentColor" />
                        </svg>
                      </button>
                      <button
                        onClick={() => removeShot(i)}
                        className="text-muted-foreground hover:text-destructive p-0.5"
                        aria-label="Remove shot"
                      >
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                          <path d="M3 3L9 9M9 3L3 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {shots.length > 0 && (
                <Button size="sm" className="w-full" onClick={handleSave} loading={saving}>
                  Save Cameras
                </Button>
              )}
            </>
          ) : (
            /* Preview mode */
            <div className="space-y-2">
              <div className="flex items-center gap-1 overflow-x-auto scrollbar-hide">
                {shots.map((shot, i) => (
                  <button
                    key={i}
                    onClick={() => previewGoTo(i)}
                    className={`flex-shrink-0 px-2 py-1 rounded-lg text-xs font-medium transition-all ${
                      i === previewIdx
                        ? "bg-foreground text-background"
                        : "text-muted-foreground hover:text-foreground hover:bg-accent"
                    }`}
                  >
                    {shot.label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground text-center">
                Playing {previewIdx + 1} / {shots.length}
              </p>
            </div>
          )}

          {message && (
            <p className={`text-xs ${message.startsWith("Save failed") ? "text-destructive" : "text-muted-foreground"}`}>
              {message}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

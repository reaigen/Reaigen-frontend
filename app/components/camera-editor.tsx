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
  fov: number;
  label: string;
}

interface Props {
  splatId: number;
  viewerRef: RefObject<SplatViewerHandle | null>;
  tourData: TourData | null;
  defaultMode?: "edit" | "preview";
  onSaved?: () => void;
}

export default function CameraEditor({ splatId, viewerRef, tourData, defaultMode = "edit", onSaved }: Props) {
  const [shots, setShots] = useState<CameraShot[]>([]);
  const [mode, setMode] = useState<"edit" | "preview">(defaultMode);
  const [previewIdx, setPreviewIdx] = useState(0);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [looping, setLooping] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [sceneFov, setSceneFov] = useState<number>(65);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearMessageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load existing saved cameras on mount
  useEffect(() => {
    getCameras(splatId)
      .then((data) => {
        if (data.cameras?.length) {
          const loaded = data.cameras.map((c, i) => ({
            position: c.position,
            forward: c.forward,
            up: c.up ?? [0, 1, 0],
            fov: Number(c.fov ?? data.fovY ?? 0.66),
            label: `Shot ${i + 1}`,
          }));
          setShots(loaded);
          setSelectedIdx(0);
          // Start in preview mode — fly to first shot but don't auto-loop
          if (defaultMode === "preview" && loaded.length > 0) {
            setMode("preview");
            setPreviewIdx(0);
          }
        }
        if (data.sceneFov) {
          setSceneFov(data.sceneFov);
          viewerRef.current?.setFov(data.sceneFov);
        }
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, [splatId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup preview timer on unmount
  useEffect(() => {
    return () => {
      if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
      if (clearMessageTimerRef.current) clearTimeout(clearMessageTimerRef.current);
    };
  }, []);

  const setTransientMessage = useCallback((next: string | null, ms = 2200) => {
    if (clearMessageTimerRef.current) clearTimeout(clearMessageTimerRef.current);
    setMessage(next);
    if (next) {
      clearMessageTimerRef.current = setTimeout(() => setMessage(null), ms);
    }
  }, []);

  const goToLocalShot = useCallback((idx: number, preview = false) => {
    const shot = shots[idx];
    if (!shot) return;
    setSelectedIdx(idx);
    setPreviewIdx(idx);
    if (preview) setMode("preview");
    viewerRef.current?.navigateToCamera(shot.position, shot.forward);
  }, [shots, viewerRef]);

  useEffect(() => {
    if (!loaded || !shots.length) return;
    if (defaultMode === "preview" && selectedIdx === 0) {
      viewerRef.current?.navigateToCamera(shots[0].position, shots[0].forward, true);
    }
  }, [defaultMode, loaded, selectedIdx, shots, viewerRef]);

  // ── Edit mode actions ──────────────────────────────────────────────────────

  const addShot = useCallback(() => {
    const cam = viewerRef.current?.getCurrentCamera();
    if (!cam) return;
    setShots((prev) => {
      const next = [
        ...prev,
        {
          position: cam.position,
          forward: cam.forward,
          up: cam.up,
          fov: cam.fov,
          label: `Shot ${prev.length + 1}`,
        },
      ];
      const nextIdx = next.length - 1;
      setSelectedIdx(nextIdx);
      setPreviewIdx(nextIdx);
      return next;
    });
    setMode("edit");
    setIsCollapsed(false);
    setTransientMessage("Camera captured");
  }, [viewerRef, setTransientMessage]);

  const [updatedIdx, setUpdatedIdx] = useState<number | null>(null);

  const updateShot = useCallback((idx: number) => {
    const cam = viewerRef.current?.getCurrentCamera();
    if (!cam) return;
    setShots((prev) =>
      prev.map((s, i) =>
        i === idx ? { ...s, position: cam.position, forward: cam.forward, up: cam.up, fov: cam.fov } : s
      )
    );
    setUpdatedIdx(idx);
    setSelectedIdx(idx);
    setPreviewIdx(idx);
    setTimeout(() => setUpdatedIdx(null), 1500);
    setTransientMessage("Camera updated");
  }, [viewerRef, setTransientMessage]);

  const removeShot = useCallback((idx: number) => {
    setShots((prev) => {
      const next = prev.filter((_, i) => i !== idx).map((s, i) => ({ ...s, label: `Shot ${i + 1}` }));
      if (!next.length) {
        setSelectedIdx(null);
        setPreviewIdx(0);
        setMode("edit");
        setLooping(false);
      } else {
        const nextIdx = Math.max(0, Math.min(idx, next.length - 1));
        setSelectedIdx(nextIdx);
        setPreviewIdx(nextIdx);
      }
      return next;
    });
    setTransientMessage("Camera removed");
  }, []);

  const moveShot = useCallback((idx: number, dir: -1 | 1) => {
    setShots((prev) => {
      const next = [...prev];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[idx], next[target]] = [next[target], next[idx]];
      if (selectedIdx === idx) setSelectedIdx(target);
      else if (selectedIdx === target) setSelectedIdx(idx);
      if (previewIdx === idx) setPreviewIdx(target);
      else if (previewIdx === target) setPreviewIdx(idx);
      // Renumber labels after reorder
      return next.map((s, i) => ({ ...s, label: `Shot ${i + 1}` }));
    });
    setTransientMessage("Order updated", 1400);
  }, [previewIdx, selectedIdx, setTransientMessage]);

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
          fov: s.fov,
        })),
        fovY: shots[0]?.fov ?? 0.66,
        sceneFov,
      });
      setTransientMessage("Saved!");
      onSaved?.();
    } catch (e: any) {
      setMessage("Save failed: " + (e.body || e.message));
    } finally {
      setSaving(false);
    }
  }, [shots, splatId, sceneFov, setTransientMessage, onSaved]);

  // ── Preview mode ───────────────────────────────────────────────────────────

  const startPreview = useCallback(() => {
    if (!shots.length) return;
    setMode("preview");
    const targetIdx = selectedIdx ?? 0;
    setPreviewIdx(targetIdx);
    viewerRef.current?.navigateToCamera(shots[targetIdx].position, shots[targetIdx].forward);
  }, [selectedIdx, shots, viewerRef]);

  const stopPreview = useCallback(() => {
    setMode("edit");
    setLooping(false);
    if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
    viewerRef.current?.enableFreeCamera();
  }, [viewerRef]);

  // Auto-advance only when looping is enabled
  useEffect(() => {
    if (mode !== "preview" || !looping || !shots.length) return;
    previewTimerRef.current = setTimeout(() => {
      const next = (previewIdx + 1) % shots.length;
      setPreviewIdx(next);
      setSelectedIdx(next);
      viewerRef.current?.navigateToCamera(shots[next].position, shots[next].forward);
    }, 4000);
    return () => { if (previewTimerRef.current) clearTimeout(previewTimerRef.current); };
  }, [mode, looping, previewIdx, shots, viewerRef]);

  const previewGoTo = useCallback((idx: number) => {
    if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
    goToLocalShot(idx, true);
  }, [goToLocalShot]);

  // ── Render ─────────────────────────────────────────────────────────────────

  if (!loaded) return null;

  // ── Preview mode: compact floating pill ─────────────────────────────────
  if (mode === "preview") {
    return (
      <div className="absolute right-2 top-4 z-30 sm:right-4">
        <div className="flex items-center gap-1 bg-black/50 backdrop-blur-md rounded-full px-1 py-1 shadow-lg">
          {/* Play / Pause */}
          <button
            onClick={() => setLooping((v) => !v)}
            className={`p-1.5 rounded-full transition-colors ${
              looping ? "bg-white/20 text-white" : "text-white/70 hover:text-white hover:bg-white/10"
            }`}
            title={looping ? "Pause auto-play" : "Auto-play"}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              {looping ? (
                <>
                  <rect x="3.5" y="3" width="2.5" height="8" rx="0.5" fill="currentColor" />
                  <rect x="8" y="3" width="2.5" height="8" rx="0.5" fill="currentColor" />
                </>
              ) : (
                <path d="M4 2.5L11.5 7L4 11.5V2.5Z" fill="currentColor" />
              )}
            </svg>
          </button>

          {/* Shot dots */}
          {shots.length > 1 && (
            <div className="flex items-center gap-1 px-1">
              {shots.map((_, i) => (
                <button
                  key={i}
                  onClick={() => previewGoTo(i)}
                  className={`w-1.5 h-1.5 rounded-full transition-all ${
                    i === previewIdx ? "bg-white scale-125" : "bg-white/40 hover:bg-white/60"
                  }`}
                  aria-label={`Shot ${i + 1}`}
                />
              ))}
            </div>
          )}

          {/* Divider */}
          <div className="w-px h-4 bg-white/20" />

          {/* Edit button */}
          <button
            onClick={stopPreview}
            className="px-2 py-1 text-[11px] font-medium text-white/80 hover:text-white rounded-full hover:bg-white/10 transition-colors"
          >
            Edit
          </button>

          <div className="hidden sm:block pl-1 pr-2 text-[11px] font-medium text-white/60">
            {previewIdx + 1} / {shots.length}
          </div>
        </div>
      </div>
    );
  }

  // ── Edit mode: full panel ───────────────────────────────────────────────
  return (
    <div className="absolute left-2 right-2 top-16 z-30 sm:left-auto sm:right-4 sm:w-72">
      <Card className="max-h-[calc(100dvh-5.5rem)] overflow-hidden border-border/50 bg-background/95 shadow-xl backdrop-blur-md">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-sm">Camera Editor</CardTitle>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Capture exact view, direction, and FOV.
              </p>
            </div>
            <div className="flex items-center gap-2">
              {shots.length > 0 && (
                <button
                  onClick={startPreview}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  Preview
                </button>
              )}
              <button
                onClick={() => setIsCollapsed((v) => !v)}
                className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-foreground/[0.04] hover:text-foreground"
                aria-label={isCollapsed ? "Expand camera editor" : "Collapse camera editor"}
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className={`transition-transform ${isCollapsed ? "rotate-180" : ""}`}>
                  <path d="M4 6L8 10L12 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
          </div>
        </CardHeader>
        {!isCollapsed && (
        <CardContent className="space-y-3 overflow-y-auto pb-4">
          <Button variant="outline" size="sm" className="w-full" onClick={addShot}>
            + Capture Current View
          </Button>

          <div className="rounded-xl bg-muted/45 px-3 py-2">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[11px] font-medium text-foreground/70">
                {selectedIdx != null ? `Selected: Shot ${selectedIdx + 1}` : "No shot selected"}
              </span>
              <span className="text-[11px] text-muted-foreground">
                {shots.length} total
              </span>
            </div>
            {selectedIdx != null && (
              <p className="mt-1 text-[10px] text-muted-foreground">
                Order matters. Shared tour plays from Shot 1 to Shot {shots.length}.
              </p>
            )}
          </div>

          {/* Scene FOV */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-xs text-muted-foreground">Scene FOV</label>
              <span className="text-xs font-mono tabular-nums">{sceneFov}°</span>
            </div>
            <input
              type="range"
              min={30}
              max={120}
              step={1}
              value={sceneFov}
              onChange={(e) => {
                const v = Number(e.target.value);
                setSceneFov(v);
                viewerRef.current?.setFov(v);
              }}
              className="w-full h-1.5 bg-muted rounded-full appearance-none cursor-pointer accent-primary"
            />
            <div className="flex justify-between text-[10px] text-muted-foreground/60">
              <span>Tight</span>
              <span>Wide</span>
            </div>
          </div>

          {shots.length > 0 && (
            <div className="max-h-[38dvh] space-y-1.5 overflow-y-auto sm:max-h-72">
              {shots.map((shot, i) => (
                <div
                  key={i}
                  className={`rounded-xl px-2.5 py-2 text-xs transition-colors ${
                    updatedIdx === i
                      ? "bg-emerald-500/10 ring-1 ring-emerald-500/30"
                      : selectedIdx === i
                        ? "bg-foreground/[0.06] ring-1 ring-foreground/10"
                        : "bg-muted/50"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <button
                      onClick={() => {
                        setSelectedIdx(i);
                        flyToShot(shot);
                      }}
                      className="flex items-center gap-2 font-medium text-left hover:text-primary transition-colors"
                    >
                      <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-background px-1.5 text-[10px] font-semibold text-foreground/65">
                        {i + 1}
                      </span>
                      <span>{shot.label}</span>
                    </button>
                    <div className="flex items-center gap-0.5">
                      <button
                        onClick={() => moveShot(i, -1)}
                        disabled={i === 0}
                        className="text-muted-foreground hover:text-foreground disabled:opacity-30 p-0.5"
                      >
                        <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M6 3L3 6H9L6 3Z" fill="currentColor" /></svg>
                      </button>
                      <button
                        onClick={() => moveShot(i, 1)}
                        disabled={i === shots.length - 1}
                        className="text-muted-foreground hover:text-foreground disabled:opacity-30 p-0.5"
                      >
                        <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M6 9L9 6H3L6 9Z" fill="currentColor" /></svg>
                      </button>
                      <button
                        onClick={() => removeShot(i)}
                        className="text-muted-foreground hover:text-destructive p-0.5 ml-1"
                      >
                        <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M3 3L9 9M9 3L3 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
                      </button>
                    </div>
                  </div>
                  <div className="mt-1 flex items-center gap-1.5">
                    {selectedIdx === i && (
                      <span className="rounded-full bg-foreground px-2 py-0.5 text-[10px] font-medium text-background">
                        Selected
                      </span>
                    )}
                    {previewIdx === i && (
                      <span className="rounded-full bg-background px-2 py-0.5 text-[10px] font-medium text-foreground/65">
                        Preview start
                      </span>
                    )}
                  </div>
                  <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                    <button
                      onClick={() => goToLocalShot(i)}
                      className="h-7 rounded-md bg-foreground/[0.04] text-[11px] font-medium text-foreground/65 transition-colors hover:bg-foreground/[0.08] hover:text-foreground"
                    >
                      Jump to shot
                    </button>
                    <button
                      onClick={() => updateShot(i)}
                      className="h-7 rounded-md bg-foreground/[0.06] text-[11px] font-medium text-foreground/60 transition-colors hover:bg-foreground/[0.1] hover:text-foreground"
                    >
                      {updatedIdx === i ? "Updated" : "Use current view"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {shots.length > 0 && (
            <Button size="sm" className="w-full" onClick={handleSave} loading={saving}>
              Save Cameras
            </Button>
          )}

          {message && (
            <p className={`text-xs ${message.startsWith("Save failed") ? "text-destructive" : "text-muted-foreground"}`}>
              {message}
            </p>
          )}
        </CardContent>
        )}
      </Card>
    </div>
  );
}

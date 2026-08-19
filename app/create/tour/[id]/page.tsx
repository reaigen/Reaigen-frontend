"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import CameraEditor from "../../../components/camera-editor";
import { useAuth } from "../../../components/hooks/use-auth";
import {
  ArrowLeftIcon,
  CameraIcon,
  CheckIcon,
  CloseIcon,
  EyeClosedIcon,
  EyeOpenIcon,
  FrameIcon,
  GridIcon,
  MoveIcon,
  OrbitIcon,
  PlusIcon,
  RotateIcon,
  ScaleIcon,
  SelectIcon,
  TechnicalIcon,
  TourIcon,
  UploadIcon,
  VersionsIcon,
} from "../../../components/icons";
import { PageLoading } from "../../../components/page-loading";
import { ReaigenLoadingMark } from "../../../components/reaigen-loading-mark";
import type { SplatViewerHandle } from "../../../components/splat-viewer";
import {
  ApiError,
  getWebTourAssetStatus,
  getWebTourWorkspace,
  saveWebTourThumbnail,
  saveWebTourWorkspace,
  uploadWebTourAsset,
  type WebSceneTransform,
  type WebTourWorkspace,
  type WebTourWorkspaceNode,
} from "../../../lib/api/client";
import { useWebAuthoringAccess } from "../../../components/hooks/use-web-authoring-access";
import { useConfirm } from "../../../lib/ui/confirm-dialog";
import { getUserLanguage, t } from "../../../lib/i18n";
import type {
  CameraData,
  GlobalSceneTransform,
  SavedCamera,
  SpatialCameraMode,
  SpatialTransformTool,
} from "../../../lib/tour-types";
import {
  clampSceneScaleComponent,
  sceneScaleMagnitude,
} from "../../../lib/global-scene-transform";
import { selectTourThumbnailCamera } from "../../../lib/tour-thumbnail-camera";
import type {
  SplatPruneMask,
  SplatSelectionOperation,
  SplatSelectionStats,
  SplatSelectionTool,
} from "../../../lib/splat-editing";
import { AdjustmentSlider } from "../../../lib/ui/adjustment-slider";
import { Button } from "../../../lib/ui/button";
import { Input } from "../../../lib/ui/input";
import { cn } from "../../../lib/utils";

function EditorViewportLoading() {
  return (
    <div
      className="absolute inset-0 z-40 flex items-center justify-center bg-background text-foreground"
      role="status"
      aria-live="polite"
      aria-label="Reaigen"
    >
      <ReaigenLoadingMark />
    </div>
  );
}

const SplatViewer = dynamic(
  () => import("../../../components/splat-viewer"),
  {
    ssr: false,
    loading: EditorViewportLoading,
  },
);

function runtimeTransform(transform: WebSceneTransform): GlobalSceneTransform {
  const scale3 = transform.scale3 ?? [transform.scale, transform.scale, transform.scale];
  return {
    version: 1,
    coordinateSpace: "reaigen_y_up",
    rotationDeg: transform.rotationDeg,
    translation: transform.translation,
    scale3,
    scale: sceneScaleMagnitude(scale3),
  };
}

function workspaceTransform(transform: GlobalSceneTransform): WebSceneTransform {
  const scale3 = transform.scale3
    ? [...transform.scale3] as [number, number, number]
    : [transform.scale, transform.scale, transform.scale] as [number, number, number];
  return {
    rotationDeg: [...transform.rotationDeg],
    translation: [...transform.translation],
    scale3,
    scale: sceneScaleMagnitude(scale3),
  };
}

function formatBytes(value: number, lang: string) {
  return new Intl.NumberFormat(lang, {
    style: "unit",
    unit: value >= 1024 ** 3 ? "gigabyte" : "megabyte",
    unitDisplay: "short",
    maximumFractionDigits: 1,
  }).format(value / (value >= 1024 ** 3 ? 1024 ** 3 : 1024 ** 2));
}

function hasActualFileDrag(dataTransfer: DataTransfer): boolean {
  if (dataTransfer.files.length > 0) return true;
  return Array.from(dataTransfer.items).some((item) => item.kind === "file");
}

type LocalPreview = {
  url: string;
  sourceFormat: "ply" | "sog";
};

function formatTransformValue(value: number): string {
  return Number(value.toFixed(4)).toString();
}

function TransformNumberField({
  axis,
  label,
  value,
  step,
  normalize = (next) => next,
  onBegin,
  onChange,
}: {
  axis: string;
  label: string;
  value: number;
  step: number;
  normalize?: (value: number) => number;
  onBegin: () => void;
  onChange: (value: number) => void;
}) {
  const [text, setText] = useState(() => formatTransformValue(value));
  const focusedRef = useRef(false);
  const wheelAccumulatorRef = useRef(0);
  const wheelGestureActiveRef = useRef(false);
  const wheelGestureTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!focusedRef.current) setText(formatTransformValue(value));
  }, [value]);

  useEffect(() => () => {
    if (wheelGestureTimerRef.current != null) {
      window.clearTimeout(wheelGestureTimerRef.current);
    }
  }, []);

  const commit = (raw: string, settle: boolean) => {
    const trimmed = raw.trim();
    const numericValue = trimmed === "" ? Number.NaN : Number(trimmed);
    if (!Number.isFinite(numericValue)) {
      if (settle) setText(formatTransformValue(value));
      return;
    }
    const next = normalize(numericValue);
    onChange(next);
    if (settle || next !== numericValue) setText(formatTransformValue(next));
  };

  const increment = (direction: 1 | -1, multiplier: number, count = 1) => {
    const parsed = Number(text);
    const base = Number.isFinite(parsed) ? parsed : value;
    const next = normalize(Number(
      (base + direction * step * multiplier * count).toFixed(6),
    ));
    setText(formatTransformValue(next));
    onChange(next);
  };

  return (
    <label className="relative">
      <span className={cn(
        "pointer-events-none absolute left-2 top-1/2 z-10 -translate-y-1/2 text-[10px] font-bold",
        axis === "X" ? "text-red-600" : axis === "Y" ? "text-green-600" : "text-blue-600",
      )}>
        {axis}
      </span>
      <Input
        type="text"
        inputMode="decimal"
        value={text}
        onFocus={(event) => {
          focusedRef.current = true;
          onBegin();
          event.currentTarget.select();
        }}
        onChange={(event) => {
          const raw = event.target.value;
          setText(raw);
          commit(raw, false);
        }}
        onBlur={(event) => {
          focusedRef.current = false;
          commit(event.currentTarget.value, true);
        }}
        onWheel={(event) => {
          event.preventDefault();
          event.stopPropagation();

          const rawDelta = event.deltaY !== 0 ? event.deltaY : event.deltaX;
          if (rawDelta === 0) return;
          const previous = wheelAccumulatorRef.current;
          if (previous !== 0 && Math.sign(previous) !== Math.sign(rawDelta)) {
            wheelAccumulatorRef.current = 0;
          }
          // A mouse-wheel notch is commonly ±100 while a trackpad emits many
          // small deltas. Cap each event and accumulate to make both devices
          // produce one deliberate DCC-style parameter step.
          wheelAccumulatorRef.current += Math.sign(rawDelta) * Math.min(
            Math.abs(rawDelta),
            24,
          );
          if (wheelGestureTimerRef.current != null) {
            window.clearTimeout(wheelGestureTimerRef.current);
          }
          wheelGestureTimerRef.current = window.setTimeout(() => {
            wheelGestureActiveRef.current = false;
            wheelAccumulatorRef.current = 0;
            wheelGestureTimerRef.current = null;
          }, 280);
          const stepCount = Math.floor(Math.abs(wheelAccumulatorRef.current) / 24);
          if (stepCount < 1) return;

          if (!wheelGestureActiveRef.current) {
            onBegin();
            wheelGestureActiveRef.current = true;
          }
          const direction: 1 | -1 = wheelAccumulatorRef.current < 0 ? 1 : -1;
          wheelAccumulatorRef.current -= Math.sign(
            wheelAccumulatorRef.current,
          ) * stepCount * 24;
          const multiplier = event.shiftKey ? 10 : event.altKey ? 0.1 : 1;
          increment(direction, multiplier, stepCount);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setText(formatTransformValue(value));
            event.currentTarget.blur();
            return;
          }
          if (event.key === "Enter") {
            event.currentTarget.blur();
            return;
          }
          if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
          event.preventDefault();
          const multiplier = event.shiftKey ? 10 : event.altKey ? 0.1 : 1;
          const direction: 1 | -1 = event.key === "ArrowUp" ? 1 : -1;
          increment(direction, multiplier);
        }}
        className="h-9 rounded-lg border-border/75 bg-background/75 py-1 pl-5 pr-2 text-right text-[12px] tabular-nums shadow-none hover:cursor-ns-resize hover:border-foreground/25 focus-visible:border-foreground/35 focus-visible:ring-1"
        aria-label={`${label} ${axis}`}
      />
    </label>
  );
}

export default function WebTourEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const tourId = Number(id);
  const { isAuthenticated, isLoading, user } = useAuth();
  const { allowed, loading: accessLoading } = useWebAuthoringAccess(isAuthenticated);
  const { confirm, dialog: confirmDialog } = useConfirm();
  const router = useRouter();
  const viewerRef = useRef<SplatViewerHandle | null>(null);
  // Spinoff draws the Gaussians (auto backend: WebGPU, or its WebGL2
  // fallback); Babylon keeps the gizmos, grid and selection. Scenes Spinoff
  // cannot represent (prune masks, compositions, incompatible transforms)
  // already fall back to Babylon's own decode via spinoffEligible.
  // ?renderer=spark opts back for comparison.
  const [sparkRenderer] = useState(
    () => typeof window !== "undefined"
      && new URLSearchParams(window.location.search).get("renderer") === "spark",
  );
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [workspace, setWorkspace] = useState<WebTourWorkspace | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tool, setTool] = useState<SpatialTransformTool>("select");
  const [transformSpace, setTransformSpace] = useState<"world" | "local">("world");
  const [snapEnabled, setSnapEnabled] = useState(false);
  const [draftTransform, setDraftTransform] = useState<GlobalSceneTransform | null>(null);
  const [draftTransformNodeId, setDraftTransformNodeId] = useState<string | null>(null);
  const [transformDirty, setTransformDirty] = useState(false);
  const [workspaceDirty, setWorkspaceDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewerFailed, setViewerFailed] = useState(false);
  // The viewer already reports why a scene failed; the page used to discard it
  // and show only a generic message, which made every load failure -- CORS,
  // a malformed archive, a GPU limit -- look identical and undiagnosable.
  const [viewerErrorDetail, setViewerErrorDetail] = useState<string | null>(null);
  const [viewerReloadKey, setViewerReloadKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadName, setUploadName] = useState("");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [dragActive, setDragActive] = useState(false);
  const [showGrid, setShowGrid] = useState(true);
  const [cameraMode, setCameraMode] = useState<SpatialCameraMode>("orbit");
  const [scenePanelOpen, setScenePanelOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [cameraEditorOpen, setCameraEditorOpen] = useState(false);
  const [pruneEditorOpen, setPruneEditorOpen] = useState(false);
  const [splatSelectionTool, setSplatSelectionTool] = useState<SplatSelectionTool>("brush");
  const [splatSelectionOperation, setSplatSelectionOperation] =
    useState<SplatSelectionOperation>("replace");
  const [splatBrushRadius, setSplatBrushRadius] = useState(36);
  const [splatSelectionStats, setSplatSelectionStats] = useState<SplatSelectionStats>({
    total: 0,
    selected: 0,
    remaining: 0,
    pruned: 0,
    dirty: false,
  });
  const [pendingPruneMasks, setPendingPruneMasks] =
    useState<Record<string, SplatPruneMask>>({});
  const [compactLayout, setCompactLayout] = useState(false);
  const [historyAvailability, setHistoryAvailability] = useState({ undo: false, redo: false });
  const [localPreviews, setLocalPreviews] = useState<Record<string, LocalPreview>>({});
  const localPreviewsRef = useRef<Record<string, LocalPreview>>({});
  const saveEditorRef = useRef<(exitAfterSave: boolean) => Promise<boolean>>(async () => false);
  const undoTransformRef = useRef<() => void>(() => undefined);
  const redoTransformRef = useRef<() => void>(() => undefined);
  const transformUndoRef = useRef<Record<string, GlobalSceneTransform[]>>({});
  const transformRedoRef = useRef<Record<string, GlobalSceneTransform[]>>({});
  const autoGroundedNodesRef = useRef(new Set<string>());
  const workspaceRef = useRef<WebTourWorkspace | null>(null);
  const draftTransformRef = useRef<GlobalSceneTransform | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  const pendingPruneMasksRef = useRef<Record<string, SplatPruneMask>>({});
  const thumbnailCaptureRef = useRef<Promise<unknown>>(Promise.resolve());
  // Two components author this workspace: the page's Save (and ⌘S) and the
  // camera editor's debounced autosave. Both PATCH the same revisioned
  // endpoint, so overlapping requests made the loser's base_revision stale
  // and the backend answered 409 for an edit that did save — the user saw
  // "could not be saved" over persisted work. Every save runs through this
  // queue and reads workspaceRef only once the previous response has landed.
  const workspaceSaveQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  // Workspace revision whose missing cover we have already tried to backfill,
  // so a viewer remount cannot retry the render on a loop.
  const coverBackfillRef = useRef<number | null>(null);
  const fileDragDepthRef = useRef(0);
  const fileDragWatchdogRef = useRef<number | null>(null);

  const clearFileDrag = useCallback(() => {
    if (fileDragWatchdogRef.current != null) {
      window.clearTimeout(fileDragWatchdogRef.current);
      fileDragWatchdogRef.current = null;
    }
    fileDragDepthRef.current = 0;
    setDragActive(false);
  }, []);

  const armFileDragWatchdog = useCallback(() => {
    if (fileDragWatchdogRef.current != null) {
      window.clearTimeout(fileDragWatchdogRef.current);
    }
    fileDragWatchdogRef.current = window.setTimeout(clearFileDrag, 650);
  }, [clearFileDrag]);

  useEffect(() => {
    clearFileDrag();
    const clearOnVisibilityChange = () => {
      if (document.visibilityState !== "visible") clearFileDrag();
    };
    const clearOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") clearFileDrag();
    };
    window.addEventListener("pageshow", clearFileDrag);
    window.addEventListener("pagehide", clearFileDrag);
    window.addEventListener("blur", clearFileDrag);
    window.addEventListener("dragend", clearFileDrag);
    window.addEventListener("pointerdown", clearFileDrag, true);
    window.addEventListener("pointerup", clearFileDrag, true);
    window.addEventListener("keydown", clearOnEscape, true);
    document.addEventListener("visibilitychange", clearOnVisibilityChange);
    return () => {
      window.removeEventListener("pageshow", clearFileDrag);
      window.removeEventListener("pagehide", clearFileDrag);
      window.removeEventListener("blur", clearFileDrag);
      window.removeEventListener("dragend", clearFileDrag);
      window.removeEventListener("pointerdown", clearFileDrag, true);
      window.removeEventListener("pointerup", clearFileDrag, true);
      window.removeEventListener("keydown", clearOnEscape, true);
      document.removeEventListener("visibilitychange", clearOnVisibilityChange);
      if (fileDragWatchdogRef.current != null) {
        window.clearTimeout(fileDragWatchdogRef.current);
        fileDragWatchdogRef.current = null;
      }
      fileDragDepthRef.current = 0;
    };
  }, [clearFileDrag]);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) router.replace("/");
  }, [isAuthenticated, isLoading, router]);

  // The editor is internal authoring tooling, and the backend already treats it
  // that way: every endpoint this page calls sits behind CanAuthorWebScenes.
  // Without a matching check the page loaded, mounted the viewer, and only
  // failed once a request came back 403 — so an agent who found the URL got a
  // seemingly working editor that could not save. Send them back to their tours
  // instead, where there is something to act on.
  useEffect(() => {
    if (!isLoading && isAuthenticated && !accessLoading && !allowed) {
      router.replace("/tours");
    }
  }, [accessLoading, allowed, isAuthenticated, isLoading, router]);

  const reload = useCallback(async () => {
    const value = await getWebTourWorkspace(tourId);
    setWorkspace(value);
    setSelectedId((current) => (
      current && value.nodes.some((node) => node.id === current)
        ? current
        : value.nodes[0]?.id ?? null
    ));
    return value;
  }, [tourId]);

  useEffect(() => {
    // Wait for the authoring check before asking for the workspace. Firing
    // regardless meant an account without access got a guaranteed 403, which
    // this page renders as "failed to load" — a misleading error for what is
    // really a permission the user simply does not have, and it would flash
    // before the redirect above could run.
    if (!isAuthenticated || !allowed || !Number.isFinite(tourId)) return;
    setLoading(true);
    reload()
      .catch(() => setError("load"))
      .finally(() => setLoading(false));
  }, [allowed, isAuthenticated, reload, tourId]);

  const selected = useMemo(
    () => workspace?.nodes.find((node) => node.id === selectedId) ?? null,
    [selectedId, workspace],
  );
  const selectedAssetUrl = selected
    ? localPreviews[selected.id]?.url ?? selected.asset.url
    : null;
  const selectedPruneMask = selected
    ? pendingPruneMasks[selected.id] ?? selected.prune
    : null;
  const hasPendingPruneMasks = Object.keys(pendingPruneMasks).length > 0;
  const compositionAssets = useMemo(
    () => (workspace?.nodes ?? [])
      .filter((node) => (
        node.id !== selectedId
        && node.visible
        && Boolean(localPreviews[node.id]?.url ?? node.asset.url)
      ))
      .map((node) => ({
        id: node.id,
        url: localPreviews[node.id]?.url ?? node.asset.url!,
        visible: node.visible,
        transform: runtimeTransform(node.transform),
        pruneMask: pendingPruneMasks[node.id] ?? node.prune,
      })),
    [localPreviews, pendingPruneMasks, selectedId, workspace],
  );
  const selectedNodeId = selected?.id ?? null;
  const selectedTransform = selected?.transform ?? null;
  const viewportTransform = draftTransformNodeId === selectedNodeId
    ? draftTransform
    : selectedTransform
      ? runtimeTransform(selectedTransform)
      : null;
  const selectedRenderable = Boolean(
    selected
    && selected.visible
    && selectedAssetUrl
    && viewportTransform,
  );
  const selectedAssetFailed = selected?.asset.conversion?.status === "failed";

  useEffect(() => {
    setViewerFailed(false);
  }, [selectedAssetUrl, selectedNodeId]);

  useEffect(() => {
    workspaceRef.current = workspace;
    draftTransformRef.current = draftTransform;
    selectedIdRef.current = selectedId;
  }, [draftTransform, selectedId, workspace]);

  useEffect(() => {
    pendingPruneMasksRef.current = pendingPruneMasks;
  }, [pendingPruneMasks]);

  const stageCurrentPruneDraft = useCallback((closeEditor = true) => {
    if (splatSelectionStats.dirty) {
      if (!selected?.asset.fingerprint) return false;
      const prune = viewerRef.current?.exportPruneMask(selected.asset.fingerprint);
      if (!prune) return false;
      const next = {
        ...pendingPruneMasksRef.current,
        [selected.id]: prune,
      };
      pendingPruneMasksRef.current = next;
      setPendingPruneMasks(next);
      viewerRef.current?.markSplatPruneSaved();
    }
    if (closeEditor) setPruneEditorOpen(false);
    return true;
  }, [selected, splatSelectionStats.dirty]);

  const requestClosePruneEditor = useCallback(() => {
    stageCurrentPruneDraft(true);
  }, [stageCurrentPruneDraft]);

  useEffect(() => {
    if (!selectedTransform) {
      setDraftTransform(null);
      setDraftTransformNodeId(null);
      return;
    }
    setDraftTransform(runtimeTransform(selectedTransform));
    setDraftTransformNodeId(selectedNodeId);
    setTransformDirty(false);
  }, [selectedNodeId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selectedTransform || transformDirty) return;
    setDraftTransform(runtimeTransform(selectedTransform));
    setDraftTransformNodeId(selectedNodeId);
  }, [selectedNodeId, selectedTransform, transformDirty]);

  useEffect(() => {
    setHistoryAvailability({
      undo: Boolean(selectedId && transformUndoRef.current[selectedId]?.length),
      redo: Boolean(selectedId && transformRedoRef.current[selectedId]?.length),
    });
  }, [selectedId]);

  useEffect(() => {
    if (
      workspaceDirty
      || transformDirty
      || !workspace?.nodes.some((node) => node.asset.conversion?.status === "running")
    ) return;
    const timer = window.setInterval(() => {
      const active = workspace.nodes.filter((node) => node.asset.conversion?.status === "running");
      void Promise.all(active.map((node) => getWebTourAssetStatus(tourId, node.splat_id)))
        .then(() => reload())
        .catch(() => undefined);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [reload, tourId, transformDirty, workspace, workspaceDirty]);

  useEffect(() => {
    if (
      !workspaceDirty
      && !transformDirty
      && !splatSelectionStats.dirty
      && !hasPendingPruneMasks
    ) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [
    hasPendingPruneMasks,
    splatSelectionStats.dirty,
    transformDirty,
    workspaceDirty,
  ]);

  useEffect(() => {
    localPreviewsRef.current = localPreviews;
  }, [localPreviews]);

  useEffect(() => () => {
    Object.values(localPreviewsRef.current).forEach((preview) => {
      URL.revokeObjectURL(preview.url);
    });
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const syncLayout = () => {
      const compact = media.matches;
      setCompactLayout(compact);
      // Desktop starts with both authoring sidebars available. Phone starts
      // with a clean viewport and opens one intentional sheet at a time.
      setScenePanelOpen(!compact);
      setInspectorOpen(!compact);
    };
    syncLayout();
    media.addEventListener("change", syncLayout);
    return () => media.removeEventListener("change", syncLayout);
  }, []);

  useEffect(() => {
    // Non-uniform scale is authored as TRS, so its axes are necessarily local.
    // Reflect that constraint in the control instead of showing World while
    // Babylon correctly falls back to Local.
    if (tool === "scale" && transformSpace !== "local") {
      setTransformSpace("local");
    }
  }, [tool, transformSpace]);

  useEffect(() => {
    const handleEditorShortcut = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target?.isContentEditable
        || target?.tagName === "INPUT"
        || target?.tagName === "TEXTAREA"
        || target?.tagName === "SELECT"
      ) return;
      const key = event.key.toLowerCase();
      if ((event.metaKey || event.ctrlKey) && key === "z") {
        event.preventDefault();
        if (event.shiftKey) redoTransformRef.current();
        else undoTransformRef.current();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && key === "s") {
        event.preventDefault();
        stageCurrentPruneDraft(false);
        void saveEditorRef.current(false);
        return;
      }
      // Plain-key tools must not shadow browser chords (⌘F find, ⌘G, …).
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (key === "1") setTool("select");
      else if (key === "2") setTool("move");
      else if (key === "3") setTool("rotate");
      else if (key === "4") setTool("scale");
      // F (frame) and V (orbit/fly) belong to the viewer's own key handler —
      // adding them here made V toggle twice per press and cancel itself.
      else if (key === "g") setShowGrid((value) => !value);
      else if (key === "escape") {
        // One layer per press, like a DCC: the armed surface closes first,
        // then the tool disarms. Everything at once made Escape feel like a
        // reset button that threw away panel state the user still wanted.
        if (pruneEditorOpen) requestClosePruneEditor();
        else if (cameraEditorOpen) setCameraEditorOpen(false);
        else if (tool !== "select") setTool("select");
        else return;
      } else {
        return;
      }
      event.preventDefault();
    };
    window.addEventListener("keydown", handleEditorShortcut);
    return () => window.removeEventListener("keydown", handleEditorShortcut);
  }, [
    cameraEditorOpen,
    pruneEditorOpen,
    requestClosePruneEditor,
    stageCurrentPruneDraft,
    tool,
  ]);

  useEffect(() => {
    if (!workspace) return;
    setLocalPreviews((current) => {
      let changed = false;
      const next = { ...current };
      for (const node of workspace.nodes) {
        const preview = next[node.id];
        if (
          preview
          && node.asset.format === "sog"
        ) {
          URL.revokeObjectURL(preview.url);
          delete next[node.id];
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [workspace]);

  const lang = getUserLanguage(user?.localization);

  // Both exits from the editor ask the same question, so they ask it in one
  // place — the header's back button and the one on the viewer-failure panel
  // had drifted to separate copies of the same guard.
  const confirmLeave = useCallback(() => confirm({
    title: t("webEditor.unsavedLeave", lang),
    confirmLabel: t("webEditor.unsavedLeaveAction", lang),
    cancelLabel: t("common.cancel", lang),
    destructive: true,
  }), [confirm, lang]);

  const captureAutomaticThumbnail = useCallback((workspaceRevision: number) => {
    const task = thumbnailCaptureRef.current
      .catch(() => undefined)
      .then(async () => {
        const current = workspaceRef.current;
        if (
          !current
          || current.revision !== workspaceRevision
          || (
            current.thumbnail_revision === workspaceRevision
            && current.thumbnail_renderer_version === 2
          )
        ) return null;
        const thumbnailCamera = selectTourThumbnailCamera(current.cameras);
        if (!thumbnailCamera) return null;
        let imageData: string | null | undefined = null;
        for (let attempt = 0; attempt < 3 && !imageData; attempt += 1) {
          imageData = await viewerRef.current?.captureThumbnail(
            thumbnailCamera.camera,
          );
          if (!imageData && attempt < 2) {
            await new Promise<void>((resolve) => {
              window.setTimeout(resolve, 240 * (attempt + 1));
            });
          }
        }
        if (!imageData) return null;
        try {
          const updated = await saveWebTourThumbnail(
            tourId,
            workspaceRevision,
            imageData,
            thumbnailCamera.cameraId,
          );
          if (workspaceRef.current?.revision === updated.revision) {
            workspaceRef.current = updated;
            setWorkspace(updated);
          }
          return updated;
        } catch {
          // A cover is a best-effort derivative. Workspace saving must remain
          // available if rendering or object storage is temporarily offline.
          return null;
        }
      });
    thumbnailCaptureRef.current = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  }, [tourId]);

  // A tour imported from iOS is never saved through this editor, so the
  // save-triggered capture above never runs for it and its row keeps the
  // placeholder icon forever. Backfill the one case that cannot resolve
  // itself: a tour that has cameras but no cover at all. Stale covers are
  // left to the save path, which knows the edit that invalidated them.
  const backfillMissingCover = useCallback(() => {
    const current = workspaceRef.current;
    if (!current || current.thumbnail_url) return;
    if (coverBackfillRef.current === current.revision) return;
    if (!selectTourThumbnailCamera(current.cameras)) return;
    const revision = current.revision;
    coverBackfillRef.current = revision;
    // onReady already waits for the Gaussian to settle; this margin is for the
    // first interactive frames, since capture borrows the live camera.
    window.setTimeout(() => {
      if (workspaceRef.current?.revision !== revision) return;
      void captureAutomaticThumbnail(revision);
    }, 600);
  }, [captureAutomaticThumbnail]);

  const uploadFile = async (file: File) => {
    const extension = file.name.split(".").pop()?.toLowerCase();
    if (extension !== "ply" && extension !== "sog") {
      setError(t("webEditor.invalidFormat", lang));
      return;
    }
    if (file.size <= 0 || file.size > 10 * 1024 ** 3) {
      setError(t("webEditor.invalidFileSize", lang));
      return;
    }
    if (!stageCurrentPruneDraft(true)) {
      setError(t("webEditor.saveFailed", lang));
      return;
    }
    const localWorkspace = workspaceRef.current;
    const localSelectedId = selectedIdRef.current;
    const localTransform = draftTransformRef.current;
    const localNodes = new Map(
      (localWorkspace?.nodes ?? []).map((node) => [
        node.id,
        node.id === localSelectedId && localTransform
          ? { ...node, transform: workspaceTransform(localTransform) }
          : node,
      ]),
    );
    setUploading(true);
    setError(null);
    setUploadName(file.name);
    setUploadProgress(0);
    try {
      const value = await uploadWebTourAsset(tourId, file, setUploadProgress);
      const merged = {
        ...value,
        nodes: value.nodes.map((node) => {
          const local = localNodes.get(node.id);
          return local ? {
            ...node,
            name: local.name,
            visible: local.visible,
            transform: local.transform,
          } : node;
        }),
      };
      workspaceRef.current = merged;
      setWorkspace(merged);
      setTransformDirty(false);
      if (transformDirty) setWorkspaceDirty(true);
      const addedNode = value.nodes.at(-1);
      // A confirmed SOG must immediately use Reaigen's fingerprinted range
      // URL. A blob URL has no .sog suffix and previously selected Babylon's
      // full-archive fallback, so a fresh Splatfiction import looked different
      // until the editor was reloaded. PLY keeps its local preview while the
      // backend conversion runs.
      if (addedNode && extension === "ply") {
        const preview: LocalPreview = {
          url: URL.createObjectURL(file),
          sourceFormat: extension,
        };
        setLocalPreviews((current) => {
          const previous = current[addedNode.id];
          if (previous) URL.revokeObjectURL(previous.url);
          return { ...current, [addedNode.id]: preview };
        });
      }
      setSelectedId(addedNode?.id ?? null);
    } catch {
      setError(t("webEditor.uploadFailed", lang));
    } finally {
      setUploading(false);
      setUploadName("");
      setUploadProgress(0);
    }
  };

  const updateNode = (
    nodeId: string,
    update: (node: WebTourWorkspaceNode) => WebTourWorkspaceNode,
  ) => {
    setWorkspaceDirty(true);
    setWorkspace((current) => current ? {
      ...current,
      nodes: current.nodes.map((node) => node.id === nodeId ? update(node) : node),
    } : current);
  };

  const selectNode = (nodeId: string) => {
    // The right rail belongs to one surface at a time. Picking a node is a
    // request for its properties, so the camera panel yields; previously the
    // inspector stayed suppressed behind the open camera editor and the click
    // appeared to do nothing.
    setCameraEditorOpen(false);
    if (nodeId === selectedId) {
      if (compactLayout) setScenePanelOpen(false);
      setInspectorOpen(true);
      return;
    }
    stageCurrentPruneDraft(true);
    if (selectedId && draftTransform) {
      setWorkspace((current) => current ? {
        ...current,
        nodes: current.nodes.map((node) => node.id === selectedId ? {
          ...node,
          transform: workspaceTransform(draftTransform),
        } : node),
      } : current);
      if (transformDirty) setWorkspaceDirty(true);
    }
    setTransformDirty(false);
    setSelectedId(nodeId);
    if (compactLayout) setScenePanelOpen(false);
    setInspectorOpen(true);
  };

  const enqueueWorkspaceSave = useCallback(<T,>(task: () => Promise<T>): Promise<T> => {
    const run = workspaceSaveQueueRef.current.then(task, task);
    workspaceSaveQueueRef.current = run.then(() => undefined, () => undefined);
    return run;
  }, []);

  const saveEditorEdits = async (exitAfterSave: boolean): Promise<boolean> => {
    if (!(workspaceRef.current ?? workspace) || saving) return false;
    setSaving(true);
    setError(null);
    try {
      if (!stageCurrentPruneDraft(false)) {
        throw new Error("The local prune draft could not be prepared.");
      }
      const saved = await enqueueWorkspaceSave(() => {
        // Read the workspace inside the queue: a camera autosave ahead of us
        // may have just bumped the revision this request must build on.
        const currentWorkspace = workspaceRef.current;
        if (!currentWorkspace) throw new Error("Workspace is not loaded");
        const pendingPrunes = pendingPruneMasksRef.current;
        const hasChanges = (
          workspaceDirty
          || transformDirty
          || Object.keys(pendingPrunes).length > 0
        );
        if (!hasChanges) return Promise.resolve(currentWorkspace);
        const nodes = currentWorkspace.nodes.map((node) => ({
          id: node.id,
          name: node.name,
          visible: node.visible,
          transform: node.id === selected?.id && draftTransform
            ? workspaceTransform(draftTransform)
            : node.transform,
          prune: pendingPrunes[node.id] ?? node.prune ?? null,
        }));
        return saveWebTourWorkspace(tourId, {
          base_revision: currentWorkspace.revision,
          name: currentWorkspace.name,
          nodes,
          cameras: currentWorkspace.cameras as unknown as Array<Record<string, unknown>>,
        });
      });
      // The write has landed. Everything below is local bookkeeping, and it
      // must not be able to report a failed save: a throw here previously
      // surfaced "workspace could not be saved" for a workspace that was
      // already persisted, which is worse than useless — it tells the user to
      // redo work the server has.
      workspaceRef.current = saved;
      setWorkspace(saved);
      try {
        const savedSelected = saved.nodes.find((node) => node.id === selected?.id);
        if (savedSelected) setDraftTransform(runtimeTransform(savedSelected.transform));
        pendingPruneMasksRef.current = {};
        setPendingPruneMasks({});
        viewerRef.current?.markSplatPruneSaved();
        setTransformDirty(false);
        setWorkspaceDirty(false);
        void captureAutomaticThumbnail(saved.revision);
      } catch (error) {
        console.error("[REAI] workspace saved, post-save bookkeeping failed:", error);
      }
      if (exitAfterSave) router.push(`/draft/${saved.draft_id}`);
      return true;
    } catch (error) {
      // A bare catch made this undiagnosable: the reason never reached anyone.
      console.error("[REAI] workspace save failed:", error);
      // With same-tab saves serialized, a 409 now means another session
      // really did edit this tour — say that instead of the generic line,
      // which reads as data loss when the other session's save went through.
      setError(
        error instanceof ApiError && error.status === 409
          ? t("webEditor.saveConflict", lang)
          : t("webEditor.saveFailed", lang),
      );
      return false;
    } finally {
      setSaving(false);
    }
  };
  useEffect(() => {
    saveEditorRef.current = saveEditorEdits;
  });

  const resetTransform = (part: "translation" | "rotationDeg" | "scale" | "all") => {
    pushTransformHistory();
    setTransformDirty(true);
    setWorkspaceDirty(true);
    setDraftTransform((current) => {
      if (!current) return current;
      if (part === "translation") return { ...current, translation: [0, 0, 0] };
      if (part === "rotationDeg") return { ...current, rotationDeg: [0, 0, 0] };
      if (part === "scale") return { ...current, scale: 1, scale3: [1, 1, 1] };
      return {
        ...current,
        translation: [0, 0, 0],
        rotationDeg: [0, 0, 0],
        scale3: [1, 1, 1],
        scale: 1,
      };
    });
  };

  const copyTransform = (value: GlobalSceneTransform): GlobalSceneTransform => ({
    ...value,
    translation: [...value.translation],
    rotationDeg: [...value.rotationDeg],
    scale3: value.scale3 ? [...value.scale3] : [value.scale, value.scale, value.scale],
  });

  function pushTransformHistory() {
    if (!selectedId || !draftTransform) return;
    const undo = transformUndoRef.current[selectedId] ?? [];
    const snapshot = copyTransform(draftTransform);
    const previous = undo.at(-1);
    if (
      previous
      && JSON.stringify(previous) === JSON.stringify(snapshot)
    ) return;
    transformUndoRef.current[selectedId] = [...undo.slice(-49), snapshot];
    transformRedoRef.current[selectedId] = [];
    setHistoryAvailability({ undo: true, redo: false });
  }

  const undoTransform = () => {
    if (!selectedId || !draftTransform) return;
    const undo = transformUndoRef.current[selectedId] ?? [];
    const previous = undo.at(-1);
    if (!previous) return;
    const redo = transformRedoRef.current[selectedId] ?? [];
    transformUndoRef.current[selectedId] = undo.slice(0, -1);
    transformRedoRef.current[selectedId] = [...redo, copyTransform(draftTransform)];
    setDraftTransform(copyTransform(previous));
    setTransformDirty(true);
    setWorkspaceDirty(true);
    setHistoryAvailability({
      undo: transformUndoRef.current[selectedId].length > 0,
      redo: true,
    });
  };

  const redoTransform = () => {
    if (!selectedId || !draftTransform) return;
    const redo = transformRedoRef.current[selectedId] ?? [];
    const next = redo.at(-1);
    if (!next) return;
    const undo = transformUndoRef.current[selectedId] ?? [];
    transformRedoRef.current[selectedId] = redo.slice(0, -1);
    transformUndoRef.current[selectedId] = [...undo, copyTransform(draftTransform)];
    setDraftTransform(copyTransform(next));
    setTransformDirty(true);
    setWorkspaceDirty(true);
    setHistoryAvailability({
      undo: true,
      redo: transformRedoRef.current[selectedId].length > 0,
    });
  };

  useEffect(() => {
    undoTransformRef.current = undoTransform;
    redoTransformRef.current = redoTransform;
  });

  const finishTour = async () => {
    await saveEditorEdits(true);
  };

  const stageWorkspaceCameras = useCallback((cameraData: CameraData) => {
    const current = workspaceRef.current;
    if (!current) return;
    const next: WebTourWorkspace = {
      ...current,
      cameras: (cameraData.cameras ?? []) as unknown as Array<Record<string, unknown>>,
    };
    workspaceRef.current = next;
    setWorkspace(next);
    setWorkspaceDirty(true);
  }, []);

  const saveWorkspaceCameras = async (cameraData: CameraData): Promise<CameraData> => {
    if (!workspaceRef.current) throw new Error("Workspace is not loaded");
    const saved = await enqueueWorkspaceSave(() => {
      // Same queue as the page's Save: revision is read once the save ahead
      // of this one has answered, so the two paths can no longer 409 each
      // other out of a base_revision they both started from.
      const currentWorkspace = workspaceRef.current;
      if (!currentWorkspace) throw new Error("Workspace is not loaded");
      const currentSelectedId = selectedIdRef.current;
      const currentTransform = draftTransformRef.current;
      const nodes = currentWorkspace.nodes.map((node) => ({
        id: node.id,
        name: node.name,
        visible: node.visible,
        transform: node.id === currentSelectedId && currentTransform
          ? workspaceTransform(currentTransform)
          : node.transform,
      }));
      return saveWebTourWorkspace(tourId, {
        base_revision: currentWorkspace.revision,
        name: currentWorkspace.name,
        nodes,
        cameras: cameraData.cameras as unknown as Array<Record<string, unknown>>,
      });
    });
    workspaceRef.current = saved;
    setWorkspace(saved);
    setTransformDirty(false);
    setWorkspaceDirty(false);
    if (!splatSelectionStats.dirty && !hasPendingPruneMasks) {
      void captureAutomaticThumbnail(saved.revision);
    }
    return {
      ...cameraData,
      cameras: saved.cameras as unknown as SavedCamera[],
      sceneRevision: saved.revision,
      source: "web-tour-workspace",
    };
  };

  // Hold the loader rather than rendering a frame of the editor while the
  // access check or the redirect above is still in flight.
  if (isLoading || accessLoading || loading || !user || !allowed) return <PageLoading />;

  if (error === "load" || !workspace) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/30 p-6">
        <div className="text-center">
          <p className="text-sm text-muted-foreground">{t("webEditor.loadFailed", lang)}</p>
          <Button className="mt-4" variant="outline" onClick={() => router.push("/tours")}>
            {t("common.back", lang)}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <main
      className={
        // w-full, not w-screen: 100vw includes the scrollbar gutter that
        // `html { scrollbar-gutter: stable }` reserves, so on browsers with
        // classic scrollbars the page rendered wider than the viewport and
        // the right dock, Save cluster and status readouts were clamped.
        "relative h-[100dvh] w-full overflow-hidden bg-background text-foreground"
      }
      onDragEnter={(event) => {
        if (uploading || !hasActualFileDrag(event.dataTransfer)) {
          clearFileDrag();
          return;
        }
        event.preventDefault();
        fileDragDepthRef.current += 1;
        setDragActive(true);
        armFileDragWatchdog();
      }}
      onDragOver={(event) => {
        if (uploading || !hasActualFileDrag(event.dataTransfer)) {
          clearFileDrag();
          return;
        }
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        if (fileDragDepthRef.current < 1) fileDragDepthRef.current = 1;
        if (!dragActive) setDragActive(true);
        armFileDragWatchdog();
      }}
      onDragLeave={(event) => {
        if (!dragActive && !hasActualFileDrag(event.dataTransfer)) return;
        event.preventDefault();
        fileDragDepthRef.current = Math.max(0, fileDragDepthRef.current - 1);
        if (fileDragDepthRef.current === 0) {
          clearFileDrag();
        } else {
          armFileDragWatchdog();
        }
      }}
      onDrop={(event) => {
        if (!hasActualFileDrag(event.dataTransfer)) return;
        event.preventDefault();
        clearFileDrag();
        const file = event.dataTransfer.files[0];
        if (file && !uploading) void uploadFile(file);
      }}
    >
      {selectedRenderable && selectedAssetUrl && selected && viewportTransform ? (
        <SplatViewer
          key={`${selected.id}:${selectedAssetUrl}:${viewerReloadKey}`}
          ref={viewerRef}
          // Cover rendering is normally scheduled after an explicit save. It
          // used to be unsafe here too: capture borrows the live camera, and
          // running it right after the first frame moved the Gaussian sort to
          // a hidden pose and could leave a healthy scene blank. Two things
          // make the backfill safe now — onReady fires only after
          // settleHiddenGaussian, and captureThumbnail forces and awaits the
          // restored-camera sort before resuming the render loop. It still
          // only runs for a tour that has no cover at all.
          onReady={() => {
            setViewerFailed(false);
            setViewerErrorDetail(null);
            backfillMissingCover();
          }}
          onRetry={() => setViewerReloadKey((value) => value + 1)}
          onCancel={() => router.push(`/draft/${workspace.draft_id}`)}
          gaussianRenderer={sparkRenderer ? "spark" : "spinoff"}
          splatUrl={selectedAssetUrl}
          splatId={selected.splat_id}
          outputsVersion={selected.asset.fingerprint}
          initialPruneMask={selectedPruneMask}
          globalSceneTransform={viewportTransform}
          spatialNavigation
          spatialTransformTool={tool}
          spatialTransformSpace={transformSpace}
          spatialTransformSnap={snapEnabled}
          onSpatialTransformStart={pushTransformHistory}
          onSpatialTransformChange={(transform) => {
            setDraftTransform(transform);
            setTransformDirty(true);
            setWorkspaceDirty(true);
          }}
          splatSelectionTool={pruneEditorOpen ? splatSelectionTool : "none"}
          splatSelectionOperation={splatSelectionOperation}
          splatBrushRadius={splatBrushRadius}
          onSplatSelectionChange={setSplatSelectionStats}
          onSceneFrame={(frame) => {
            if (
              autoGroundedNodesRef.current.has(selected.id)
            ) return undefined;
            autoGroundedNodesRef.current.add(selected.id);
            const current = viewportTransform;
            const isFreshIdentityTransform = (
              current.translation.every((value) => Math.abs(value) < 1e-6)
              && current.rotationDeg.every((value) => Math.abs(value) < 1e-6)
              && Math.abs(current.scale - 1) < 1e-6
              && (current.scale3 ?? [1, 1, 1]).every(
                (value) => Math.abs(value - 1) < 1e-6,
              )
            );
            if (!isFreshIdentityTransform || Math.abs(frame.floorY) < 0.005) {
              return undefined;
            }
            const groundedTransform: GlobalSceneTransform = {
              ...current,
              translation: [0, Number((-frame.floorY).toFixed(4)), 0],
            };
            draftTransformRef.current = groundedTransform;
            setDraftTransformNodeId(selected.id);
            setDraftTransform(groundedTransform);
            setTransformDirty(true);
            setWorkspaceDirty(true);
            return groundedTransform;
          }}
          compositionAssets={compositionAssets}
          showSpatialGrid={showGrid}
          spatialCameraMode={cameraMode}
          onSpatialCameraModeChange={setCameraMode}
          lang={lang}
          onError={(msg) => {
            setViewerFailed(true);
            setViewerErrorDetail(msg ?? null);
            if (msg) console.error("[REAI] splat viewer failed:", msg);
          }}
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center bg-background">
          <div className="max-w-sm px-6 text-center">
            {selected && !selected.visible ? (
              <EyeClosedIcon size={28} className="mx-auto text-foreground/30" />
            ) : selected ? (
              <TourIcon size={28} className="mx-auto text-foreground/30" />
            ) : (
              <UploadIcon size={28} className="mx-auto text-foreground/30" />
            )}
            <h1 className="mt-4 text-xl font-semibold">
              {selected && !selected.visible
                ? t("webEditor.hiddenTitle", lang)
                : selectedAssetFailed
                  ? t("webEditor.assetLoadFailed", lang)
                  : selected
                    ? t("webEditor.assetPreparing", lang)
                    : t("webEditor.emptyTitle", lang)}
            </h1>
            <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
              {selected && !selected.visible
                ? t("webEditor.hiddenDescription", lang)
                : selectedAssetFailed
                  ? t("webEditor.assetFailedHint", lang)
                  : selected
                    ? t("webEditor.assetPreparingHint", lang)
                    : t("webEditor.emptyDescription", lang)}
            </p>
            {selected && !selected.visible ? (
              <Button
                className="mt-5"
                onClick={() => updateNode(selected.id, (node) => ({
                  ...node,
                  visible: true,
                }))}
              >
                <EyeOpenIcon size={14} />
                {t("common.show", lang)}
              </Button>
            ) : !selected || selectedAssetFailed ? (
              <Button className="mt-5" onClick={() => fileInputRef.current?.click()}>
                <PlusIcon size={14} />
                {t("webEditor.addSplat", lang)}
              </Button>
            ) : null}
          </div>
        </div>
      )}

      {/* Application frame, not windows: the title row is a solid strip fused
          to the viewport's top edge, the way the Splatfiction studio anchors
          its chrome. Floating capsules over the scene are reserved for the
          tool rail and the view cluster. */}
      <header className="absolute inset-x-0 top-0 z-30 flex h-12 items-center justify-between gap-2 border-b border-border/70 bg-card/95 px-2 backdrop-blur-xl sm:px-3">
        <div className="flex h-11 min-w-0 flex-1 items-center gap-1 md:flex-none">
          <button
            type="button"
            onClick={async () => {
              if (
                (
                  workspaceDirty
                  || transformDirty
                  || splatSelectionStats.dirty
                  || hasPendingPruneMasks
                )
                && !(await confirmLeave())
              ) return;
              router.push(`/draft/${workspace.draft_id}`);
            }}
            aria-label={t("common.back", lang)}
            className="floating-icon-button-sm text-foreground/55 hover:bg-foreground/[0.06] hover:text-foreground"
          >
            <ArrowLeftIcon size={15} />
          </button>
          <span className="mx-0.5 h-5 w-px shrink-0 bg-border/70" />
          <span className="flex min-w-0 items-center gap-1.5 px-2 pr-2.5">
            <span className="max-w-[7.5rem] truncate text-[11px] font-semibold sm:max-w-[12rem]">
              {workspace.name}
            </span>
            {workspaceDirty || transformDirty || splatSelectionStats.dirty || hasPendingPruneMasks ? (
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500"
                title={splatSelectionStats.dirty
                  ? t("webEditor.pruneUnsaved", lang)
                  : t("spatialEditor.unsavedTransform", lang)}
              />
            ) : null}
          </span>
          <span className="ml-auto flex shrink-0 items-center gap-0.5 md:hidden">
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              aria-label={t("webEditor.addSplat", lang)}
              title={t("webEditor.addSplat", lang)}
            >
              <PlusIcon size={13} />
            </Button>
            <Button
              size="sm"
              onClick={() => { void finishTour(); }}
              loading={saving}
              title={t("webEditor.saveTour", lang)}
            >
              <CheckIcon size={13} />
              {t("common.save", lang)}
            </Button>
          </span>
        </div>
        <div className="hidden h-11 shrink-0 items-center gap-0.5 md:flex">
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            aria-label={t("webEditor.addSplat", lang)}
            title={t("webEditor.addSplat", lang)}
          >
            <PlusIcon size={13} />
          </Button>
          <Button
            size="sm"
            onClick={() => { void finishTour(); }}
            loading={saving}
            title={t("webEditor.saveTour", lang)}
          >
            <CheckIcon size={13} />
            {t("common.save", lang)}
          </Button>
        </div>
      </header>

      <input
        ref={fileInputRef}
        type="file"
        accept=".ply,.sog"
        aria-label={t("webEditor.addSplat", lang)}
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void uploadFile(file);
        }}
      />

      {/* On desktop this is a docked column, fused to the header and status
          strips — square, shadowless, edge-to-edge — not a floating card.
          Phones keep the bottom sheet. */}
      <aside data-testid="tour-editor-scene-panel" className={cn(
        "floating-panel absolute inset-x-3 bottom-[calc(5.25rem+env(safe-area-inset-bottom,0px))] z-30 max-h-[45dvh] overflow-hidden transition-[transform,opacity] duration-200 md:inset-x-auto md:bottom-7 md:left-0 md:top-12 md:z-20 md:max-h-none md:w-[16.5rem] md:rounded-none md:border-y-0 md:border-l-0 md:border-r md:bg-card md:shadow-none md:backdrop-blur-none",
        !scenePanelOpen
          && "pointer-events-none translate-y-[calc(100%+6rem)] opacity-0 md:translate-y-0 md:-translate-x-full md:opacity-100",
      )}>
        <div aria-hidden="true" className="mx-auto mt-2 h-1 w-9 rounded-full bg-foreground/15 md:hidden" />
        <div className="flex items-center justify-between border-b border-border/65 px-3 py-2.5">
          <span>
            <span className="block text-[12px] font-semibold">{t("webEditor.sceneGraph", lang)}</span>
            <span className="block text-[10px] text-muted-foreground">
              {workspace.nodes.length} {t("webEditor.nodes", lang)}
            </span>
          </span>
          <span className="flex items-center gap-1">
            <button
              type="button"
              className="floating-icon-button-sm text-foreground/45 hover:bg-foreground/[0.06] hover:text-foreground"
              onClick={() => fileInputRef.current?.click()}
              aria-label={t("webEditor.addSplat", lang)}
            >
              <PlusIcon size={12} />
            </button>
            <button
              type="button"
              className="floating-icon-button-sm text-foreground/45 hover:bg-foreground/[0.06] hover:text-foreground"
              onClick={() => setScenePanelOpen(false)}
              aria-label={t("common.close", lang)}
            >
              <CloseIcon size={11} />
            </button>
          </span>
        </div>
        <div className="max-h-[calc(45dvh-3.75rem)] overflow-y-auto p-2 md:max-h-[calc(100dvh-8.5rem)]">
          <div className="flex items-center gap-2 border-b border-border/50 px-2 py-2 text-[11px] font-semibold">
            <TourIcon size={12} />
            /World
            <span className="ml-auto text-[10px] font-normal text-muted-foreground">USD</span>
          </div>
          <div className="ml-3 border-l border-foreground/[0.1] pl-1.5 pt-1">
            {workspace.nodes.map((node) => (
              <div
                key={node.id}
                className={cn(
                  "group flex min-h-9 w-full items-center gap-1.5 rounded-md px-1 py-1 text-left transition-colors",
                  node.id === selectedId
                    ? "bg-foreground/[0.09] text-foreground"
                    : "text-foreground/65 hover:bg-foreground/[0.06] hover:text-foreground",
                )}
              >
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    if (node.id === selectedId && node.visible) {
                      stageCurrentPruneDraft(true);
                      setCameraEditorOpen(false);
                      setTool("select");
                    }
                    updateNode(node.id, (current) => ({ ...current, visible: !current.visible }));
                  }}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-foreground/65 hover:bg-foreground/[0.06] hover:text-foreground"
                  aria-label={node.visible ? t("common.hide", lang) : t("common.show", lang)}
                >
                  {node.visible ? <EyeOpenIcon size={12} /> : <EyeClosedIcon size={12} />}
                </button>
                <button
                  type="button"
                  onClick={() => selectNode(node.id)}
                  className="flex min-h-9 min-w-0 flex-1 items-center truncate text-left text-[11px] font-medium"
                >
                  {node.name}
                </button>
                <span className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  node.asset.conversion?.status === "running"
                    ? "animate-pulse bg-amber-500"
                    : node.asset.conversion?.status === "failed"
                      ? "bg-red-500"
                    : "bg-emerald-500",
                )} />
              </div>
            ))}
            <button
              type="button"
              disabled={!selectedRenderable}
              onClick={() => {
                setCameraEditorOpen(true);
                if (compactLayout) {
                  setScenePanelOpen(false);
                  setInspectorOpen(false);
                }
              }}
              className={cn(
                "mt-1 flex min-h-9 w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[11px] font-medium transition-colors disabled:opacity-40",
                cameraEditorOpen
                  ? "bg-foreground/[0.09] text-foreground"
                  : "text-foreground/65 hover:bg-foreground/[0.06] hover:text-foreground",
              )}
            >
              <CameraIcon size={13} />
              <span className="min-w-0 flex-1">{t("webEditor.cameras", lang)}</span>
              <span className="rounded-md bg-foreground/[0.055] px-1.5 py-0.5 text-[10px] tabular-nums">
                {workspace.cameras.length}
              </span>
            </button>
          </div>
        </div>
      </aside>

      {!scenePanelOpen && (!compactLayout || !inspectorOpen) ? (
        <button
          type="button"
          data-testid="tour-editor-scene-open"
          onClick={() => {
            if (pruneEditorOpen) requestClosePruneEditor();
            setCameraEditorOpen(false);
            setInspectorOpen(false);
            setScenePanelOpen(true);
          }}
          className="floating-panel floating-control absolute left-3 top-20 z-20 h-10 gap-2 px-3 text-foreground/60 shadow-control sm:left-4 md:top-[3.75rem] md:h-[var(--floating-control)] md:w-[var(--floating-control)] md:px-0"
          aria-label={t("webEditor.sceneGraph", lang)}
        >
          <TourIcon size={14} />
          <span className="text-[10px] md:hidden">{t("webEditor.sceneGraph", lang)}</span>
        </button>
      ) : null}

      {selected && draftTransform && inspectorOpen && !cameraEditorOpen && (!compactLayout || !scenePanelOpen) ? (
        <section data-testid="tour-editor-inspector-panel" className="floating-panel absolute inset-x-3 bottom-[calc(5.25rem+env(safe-area-inset-bottom,0px))] z-30 max-h-[56dvh] overflow-y-auto p-3 md:inset-x-auto md:bottom-7 md:right-0 md:top-12 md:z-20 md:max-h-none md:w-[19.5rem] md:rounded-none md:border-y-0 md:border-l md:border-r-0 md:bg-card md:shadow-none md:backdrop-blur-none">
          <div aria-hidden="true" className="mx-auto mb-2 h-1 w-9 rounded-full bg-foreground/15 md:hidden" />
          <div className="flex items-center justify-between gap-3 border-b border-border/60 pb-2.5">
            <span className="min-w-0">
              <span className="block text-[11px] font-semibold uppercase tracking-[0.11em] text-foreground/65">
                {t("spatialEditor.inspector", lang)}
              </span>
              <span className="mt-0.5 block truncate font-mono text-[10px] text-muted-foreground">
                {selected.prim_path}
              </span>
            </span>
            <span className="flex items-center gap-1">
              <span className="rounded-md bg-foreground/[0.055] px-2 py-1 text-[10px] font-medium uppercase tracking-[0.08em] text-foreground/55">
                {selected.asset.format ?? "…"}
              </span>
              <button
                type="button"
                className="floating-icon-button-sm text-foreground/45 hover:bg-foreground/[0.06] hover:text-foreground"
                onClick={() => setInspectorOpen(false)}
                aria-label={t("common.close", lang)}
              >
                <CloseIcon size={11} />
              </button>
            </span>
          </div>
          <Input
            value={selected.name}
            onChange={(event) => {
              const name = event.target.value;
              updateNode(selected.id, (node) => ({ ...node, name }));
            }}
            className="mt-2.5 h-9 rounded-lg border-border/75 bg-background/75 px-3 text-[11px] font-semibold shadow-none focus-visible:ring-1"
            aria-label={t("webEditor.sceneGraph", lang)}
          />
          <div className="mt-2 grid grid-cols-2 rounded-lg border border-border/60 bg-foreground/[0.025] p-0.5">
            {(["world", "local"] as const).map((space) => (
              <button
                key={space}
                type="button"
                disabled={tool === "scale" && space === "world"}
                aria-pressed={transformSpace === space}
                onClick={() => setTransformSpace(space)}
                className={cn(
                  "h-9 rounded-md text-[11px] font-medium transition-colors",
                  transformSpace === space
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                  tool === "scale" && space === "world"
                    && "cursor-not-allowed opacity-35 hover:text-muted-foreground",
                )}
              >
                {t(space === "world" ? "spatialEditor.worldSpace" : "spatialEditor.localSpace", lang)}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setSnapEnabled((value) => !value)}
            aria-pressed={snapEnabled}
            className={cn(
              "mt-1.5 flex h-9 w-full items-center justify-between rounded-lg border px-2.5 text-[11px] font-medium transition-colors",
              snapEnabled
                ? "bg-foreground text-background"
                : "border-border/60 bg-transparent text-muted-foreground hover:bg-foreground/[0.035] hover:text-foreground",
            )}
          >
            <span>{t("spatialEditor.snap", lang)}</span>
            <span className="font-mono text-[10px] opacity-70">
              {tool === "rotate" ? "5°" : tool === "scale" ? "0.05×" : "0.10 m"}
            </span>
          </button>
          <div className="mt-2.5 overflow-hidden rounded-xl border border-border/65 bg-card/55">
            {([
              ["translation", t("spatialEditor.position", lang), draftTransform.translation, 0.05],
              ["rotationDeg", t("spatialEditor.rotation", lang), draftTransform.rotationDeg, 1],
            ] as const).map(([key, label, values, step]) => (
              <div key={key} className="border-b border-border/55 p-2.5">
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-[11px] font-semibold">{label}</span>
                  <button
                    type="button"
                    onClick={() => resetTransform(key)}
                    className="min-h-9 rounded-md px-2 text-[10px] font-medium text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground"
                  >
                    {t("spatialEditor.reset", lang)}
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-1">
                  {values.map((value, index) => {
                    const axis = ["X", "Y", "Z"][index];
                    return (
                      <TransformNumberField
                        key={axis}
                        axis={axis}
                        label={label}
                        value={value}
                        step={step}
                        onBegin={pushTransformHistory}
                        onChange={(numericValue) => {
                          const next = [...values] as [number, number, number];
                          next[index] = numericValue;
                          setTransformDirty(true);
                          setWorkspaceDirty(true);
                          setDraftTransform((current) => current ? { ...current, [key]: next } : current);
                        }}
                      />
                    );
                  })}
                </div>
              </div>
            ))}
            <div className="border-b border-border/55 p-2.5">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[11px] font-semibold">{t("spatialEditor.scale", lang)}</span>
                <button
                  type="button"
                  onClick={() => resetTransform("scale")}
                  className="min-h-9 rounded-md px-2 text-[10px] font-medium text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground"
                >
                  {t("spatialEditor.reset", lang)}
                </button>
              </div>
              <div className="grid grid-cols-3 gap-1">
                {(draftTransform.scale3 ?? [
                  draftTransform.scale,
                  draftTransform.scale,
                  draftTransform.scale,
                ]).map((value, index) => {
                  const axis = ["X", "Y", "Z"][index];
                  return (
                    <TransformNumberField
                      key={axis}
                      axis={axis}
                      label={t("spatialEditor.scale", lang)}
                      value={value}
                      step={0.05}
                      normalize={clampSceneScaleComponent}
                      onBegin={pushTransformHistory}
                      onChange={(numericValue) => {
                        const nextScale = [...(draftTransform.scale3 ?? [
                          draftTransform.scale,
                          draftTransform.scale,
                          draftTransform.scale,
                        ])] as [number, number, number];
                        nextScale[index] = numericValue;
                        setTransformDirty(true);
                        setWorkspaceDirty(true);
                        setDraftTransform((current) => current ? {
                          ...current,
                          scale3: nextScale,
                          scale: sceneScaleMagnitude(nextScale),
                        } : current);
                      }}
                    />
                  );
                })}
              </div>
            </div>
            <div className="flex items-center justify-between gap-2 px-2.5 py-2">
              <button
                type="button"
                onClick={() => resetTransform("all")}
                className="min-h-9 rounded-md px-2 text-[10px] font-medium text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground"
              >
                {t("spatialEditor.resetAll", lang)}
              </button>
              <span className={cn(
                "flex items-center gap-1.5 text-[10px]",
                workspaceDirty || transformDirty ? "text-amber-700" : "text-muted-foreground",
              )}>
                <span className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  workspaceDirty || transformDirty ? "bg-amber-500" : "bg-emerald-500",
                )} />
                {workspaceDirty || transformDirty
                  ? t("spatialEditor.unsavedTransform", lang)
                  : t("spatialEditor.savedTransform", lang)}
              </span>
            </div>
          </div>
        </section>
      ) : null}

      {selected && !inspectorOpen && !cameraEditorOpen && (!compactLayout || !scenePanelOpen) ? (
        <button
          type="button"
          data-testid="tour-editor-inspector-open"
          onClick={() => {
            if (pruneEditorOpen) requestClosePruneEditor();
            setScenePanelOpen(false);
            setInspectorOpen(true);
          }}
          className="floating-panel floating-control absolute right-3 top-20 z-20 h-10 gap-2 px-3 text-foreground/60 shadow-control sm:right-4 md:top-[3.75rem] md:h-[var(--floating-control)] md:w-[var(--floating-control)] md:px-0"
          aria-label={t("spatialEditor.inspector", lang)}
        >
          <TechnicalIcon size={14} />
          <span className="text-[10px] md:hidden">{t("spatialEditor.inspector", lang)}</span>
        </button>
      ) : null}

      {pruneEditorOpen && selected ? (
        <section className={cn(
          "floating-panel absolute bottom-20 left-3 z-30 w-[min(23rem,calc(100vw-1.5rem))] overflow-hidden p-3 shadow-control sm:left-4 md:bottom-[2.5rem]",
          scenePanelOpen ? "md:left-[21.75rem]" : "md:left-[4.5rem]",
        )}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-[11px] font-semibold">{t("webEditor.splatEditing", lang)}</h2>
              <p className="mt-0.5 text-[9px] text-muted-foreground">
                {t("webEditor.splatEditingHint", lang)}
              </p>
            </div>
            <button
              type="button"
              className="floating-icon-button-sm text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground"
              onClick={requestClosePruneEditor}
              aria-label={t("common.close", lang)}
            >
              <CloseIcon size={13} />
            </button>
          </div>

          <div className="mt-3 grid grid-cols-3 gap-1">
            {([
              ["brush", t("webEditor.brush", lang)],
              ["lasso", t("webEditor.lasso", lang)],
              ["box", t("webEditor.box", lang)],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setSplatSelectionTool(value)}
                className={cn(
                  "h-8 rounded-xl text-[10px] font-medium transition-colors",
                  splatSelectionTool === value
                    ? "bg-foreground text-background"
                    : "bg-foreground/[0.045] text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="mt-2 grid grid-cols-3 gap-1">
            {([
              ["replace", t("webEditor.replaceSelection", lang)],
              ["add", t("webEditor.addSelection", lang)],
              ["subtract", t("webEditor.subtractSelection", lang)],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setSplatSelectionOperation(value)}
                className={cn(
                  "h-7 rounded-lg text-[9px] font-medium transition-colors",
                  splatSelectionOperation === value
                    ? "bg-foreground/[0.12] text-foreground"
                    : "text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {splatSelectionTool === "brush" ? (
            <div className="mt-2">
              <AdjustmentSlider
                label={t("webEditor.brushSize", lang)}
                value={splatBrushRadius}
                min={8}
                max={120}
                step={1}
                origin={36}
                displayValue={`${splatBrushRadius} px`}
                resetLabel={t("draft.media.resetEdits", lang)}
                onChange={setSplatBrushRadius}
              />
            </div>
          ) : null}

          <div className="mt-3 grid grid-cols-3 gap-1 rounded-xl bg-foreground/[0.04] p-2 text-center">
            <div>
              <div className="text-[11px] font-semibold tabular-nums">
                {splatSelectionStats.selected.toLocaleString(lang)}
              </div>
              <div className="text-[8px] text-muted-foreground">{t("webEditor.selected", lang)}</div>
            </div>
            <div>
              <div className="text-[11px] font-semibold tabular-nums">
                {splatSelectionStats.remaining.toLocaleString(lang)}
              </div>
              <div className="text-[8px] text-muted-foreground">{t("webEditor.remaining", lang)}</div>
            </div>
            <div>
              <div className="text-[11px] font-semibold tabular-nums">
                {splatSelectionStats.pruned.toLocaleString(lang)}
              </div>
              <div className="text-[8px] text-muted-foreground">{t("webEditor.pruned", lang)}</div>
            </div>
          </div>

          <div className="mt-2 grid grid-cols-2 gap-1">
            <Button
              type="button"
              variant="outline"
              className="h-8 text-[9px]"
              disabled={splatSelectionStats.selected < 1}
              onClick={() => viewerRef.current?.clearSplatSelection()}
            >
              {t("webEditor.clearSelection", lang)}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-8 text-[9px]"
              disabled={splatSelectionStats.remaining < 1}
              onClick={() => viewerRef.current?.invertSplatSelection()}
            >
              {t("webEditor.invertSelection", lang)}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-8 text-[9px]"
              disabled={splatSelectionStats.selected < 1}
              onClick={() => viewerRef.current?.pruneSelectedSplats()}
            >
              {t("webEditor.pruneSelected", lang)}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-8 text-[9px]"
              disabled={
                splatSelectionStats.selected < 1
                || splatSelectionStats.selected === splatSelectionStats.remaining
              }
              onClick={() => viewerRef.current?.pruneUnselectedSplats()}
            >
              {t("webEditor.keepSelected", lang)}
            </Button>
          </div>

          <div className="mt-2 flex gap-1">
            <Button
              type="button"
              variant="ghost"
              className="h-8 flex-1 text-[9px]"
              disabled={!splatSelectionStats.dirty}
              onClick={() => viewerRef.current?.undoSplatPrune()}
            >
              <VersionsIcon size={12} />
              {t("webEditor.undoPrune", lang)}
            </Button>
            <Button
              type="button"
              className="h-8 flex-[1.4] text-[9px]"
              onClick={() => stageCurrentPruneDraft(true)}
            >
              <CheckIcon size={12} />
              {t("webEditor.keepPruneDraft", lang)}
            </Button>
          </div>
          <p className="mt-2 text-center text-[8px] leading-relaxed text-muted-foreground">
            {t("webEditor.prunePreviewOnly", lang)}
          </p>
        </section>
      ) : null}

      {selectedRenderable && !cameraEditorOpen ? (
        <nav className="floating-toolbar scrollbar-hide absolute bottom-[calc(0.75rem+env(safe-area-inset-bottom,0px))] left-1/2 z-30 max-w-[calc(100vw-1rem)] -translate-x-1/2 overflow-x-auto md:hidden">
          {([
            ["select", TechnicalIcon, "spatialEditor.selectTool"],
            ["move", MoveIcon, "spatialEditor.moveTool"],
            ["rotate", RotateIcon, "spatialEditor.rotateTool"],
            ["scale", ScaleIcon, "spatialEditor.scale"],
          ] as const).map(([value, Icon, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => {
                if (pruneEditorOpen) requestClosePruneEditor();
                setCameraEditorOpen(false);
                setScenePanelOpen(false);
                setInspectorOpen(false);
                setTool(value);
              }}
              aria-label={t(label, lang)}
              aria-pressed={tool === value}
              className={cn(
                tool === value
                  ? "floating-control min-w-0 gap-1.5 bg-foreground px-3 text-background"
                  : "floating-icon-button text-foreground/55 active:bg-foreground/[0.08]",
              )}
            >
              <Icon size={15} />
              {tool === value ? (
                <span className="text-[10px] font-medium">{t(label, lang)}</span>
              ) : null}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setCameraMode((value) => value === "orbit" ? "fly" : "orbit")}
            aria-label={t(cameraMode === "orbit" ? "spatialEditor.orbit" : "spatialEditor.fly", lang)}
            aria-pressed={cameraMode === "orbit"}
            className="floating-control min-w-0 gap-1.5 bg-card px-2.5 text-foreground/65 active:bg-foreground/[0.08]"
          >
            <OrbitIcon size={15} />
            <span className="text-[9px] font-medium">
              {t(cameraMode === "orbit" ? "spatialEditor.orbit" : "spatialEditor.fly", lang)}
            </span>
          </button>
          <button
            type="button"
            data-testid="tour-editor-camera-open"
            onClick={() => {
              if (pruneEditorOpen) requestClosePruneEditor();
              setScenePanelOpen(false);
              setInspectorOpen(false);
              setCameraEditorOpen(true);
            }}
            aria-label={t("webEditor.cameras", lang)}
            className="floating-icon-button text-foreground/55 active:bg-foreground/[0.08]"
          >
            <CameraIcon size={15} />
          </button>
        </nav>
      ) : null}

      {/* DCC split, after the Splatfiction reference: manipulation lives in a
          vertical rail on the left edge, view controls in a pill at the
          bottom-right, and nothing sits between the author and the scene. The
          rail is icon-only — names and shortcuts ride in the tooltips. */}
      {selectedRenderable ? (
      <nav
        aria-label={t("webEditor.tools", lang)}
        className={cn(
          "floating-toolbar scrollbar-hide absolute top-1/2 z-30 hidden max-h-[calc(100dvh-8rem)] -translate-y-1/2 flex-col overflow-y-auto rounded-[1.4rem] md:flex",
          scenePanelOpen ? "left-[17.5rem]" : "left-3 sm:left-4",
        )}
      >
        <button
          type="button"
          onClick={undoTransform}
          disabled={!historyAvailability.undo}
          title={`${t("common.undo", lang)} · Ctrl/⌘ Z`}
          aria-keyshortcuts="Control+Z Meta+Z"
          className="floating-icon-button text-foreground/50 hover:bg-foreground/[0.06] hover:text-foreground disabled:opacity-25"
        >
          <VersionsIcon size={14} />
        </button>
        <button
          type="button"
          onClick={redoTransform}
          disabled={!historyAvailability.redo}
          title={`${t("common.redo", lang)} · Ctrl/⌘ Shift Z`}
          aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z"
          className="floating-icon-button text-foreground/50 hover:bg-foreground/[0.06] hover:text-foreground disabled:opacity-25"
        >
          <VersionsIcon size={14} className="scale-x-[-1]" />
        </button>
        <span className="my-1 h-px w-6 self-center bg-foreground/[0.1]" />
        {([
          ["select", TechnicalIcon, "spatialEditor.selectTool", "1"],
          ["move", MoveIcon, "spatialEditor.moveTool", "2"],
          ["rotate", RotateIcon, "spatialEditor.rotateTool", "3"],
          ["scale", ScaleIcon, "spatialEditor.scale", "4"],
        ] as const).map(([value, Icon, label, shortcut]) => (
          <button
            key={value}
            type="button"
            onClick={() => setTool(value)}
            title={`${t(label, lang)} · ${shortcut}`}
            aria-keyshortcuts={shortcut}
            aria-pressed={tool === value}
            className={cn(
              "floating-icon-button",
              tool === value
                ? "bg-foreground text-background"
                : "text-foreground/50 hover:bg-foreground/[0.06] hover:text-foreground",
            )}
          >
            <Icon size={14} />
          </button>
        ))}
        <span className="my-1 h-px w-6 self-center bg-foreground/[0.1]" />
        <button
          type="button"
          data-testid="tour-editor-prune-open"
          disabled={!selected || !selectedAssetUrl}
          onClick={() => {
            if (pruneEditorOpen) {
              requestClosePruneEditor();
              return;
            }
            setTool("select");
            setCameraEditorOpen(false);
            setPruneEditorOpen(true);
            if (compactLayout) {
              setScenePanelOpen(false);
              setInspectorOpen(false);
            }
          }}
          title={t("webEditor.splatEditing", lang)}
          aria-pressed={pruneEditorOpen}
          className={cn(
            "floating-icon-button disabled:opacity-35",
            pruneEditorOpen
              ? "bg-foreground text-background"
              : "text-foreground/50 hover:bg-foreground/[0.06] hover:text-foreground",
          )}
        >
          <SelectIcon size={14} />
        </button>
      </nav>
      ) : null}

      {selectedRenderable ? (
      <nav className={cn(
        "floating-toolbar absolute z-30 hidden md:bottom-[2.5rem] md:flex",
        selected && draftTransform && inspectorOpen && !cameraEditorOpen
          ? "md:right-[20.5rem]"
          : "md:right-3",
      )}>
        <button
          type="button"
          onClick={() => setCameraMode((value) => value === "orbit" ? "fly" : "orbit")}
          title={`${t(cameraMode === "orbit" ? "spatialEditor.orbit" : "spatialEditor.fly", lang)} · V`}
          aria-pressed={cameraMode === "orbit"}
          aria-keyshortcuts="V"
          className="floating-control gap-2 bg-card px-3 text-foreground shadow-control hover:bg-foreground/[0.06]"
        >
          <OrbitIcon size={14} />
          <span className="hidden text-[10px] font-medium xl:inline">
            {t(cameraMode === "orbit" ? "spatialEditor.orbit" : "spatialEditor.fly", lang)}
          </span>
        </button>
        <button
          type="button"
          onClick={() => setShowGrid((value) => !value)}
          title={`${t("spatialEditor.grid", lang)} · G`}
          aria-pressed={showGrid}
          aria-keyshortcuts="G"
          className={cn(
            "floating-icon-button",
            showGrid
              ? "bg-foreground text-background"
              : "text-foreground/50 hover:bg-foreground/[0.06]",
          )}
        >
          <GridIcon size={14} />
        </button>
        <button
          type="button"
          onClick={() => viewerRef.current?.frameScene()}
          title={`${t("spatialEditor.frame", lang)} · F`}
          aria-keyshortcuts="F"
          className="floating-icon-button text-foreground/50 hover:bg-foreground/[0.06]"
        >
          <FrameIcon size={14} />
        </button>
        <span className="mx-1 h-6 w-px bg-foreground/[0.1]" />
        <button
          type="button"
          data-testid="tour-editor-camera-open"
          disabled={!selected || !selectedAssetUrl}
          onClick={() => {
            if (pruneEditorOpen) requestClosePruneEditor();
            setCameraEditorOpen((value) => {
              const next = !value;
              if (next) {
                setPruneEditorOpen(false);
                if (compactLayout) {
                  setScenePanelOpen(false);
                  setInspectorOpen(false);
                }
              }
              return next;
            });
          }}
          title={t("webEditor.cameras", lang)}
          className={cn(
            "floating-icon-button disabled:opacity-35",
            cameraEditorOpen
              ? "bg-foreground text-background"
              : "text-foreground/50 hover:bg-foreground/[0.06]",
          )}
        >
          <CameraIcon size={14} />
        </button>
      </nav>
      ) : null}

      {/* Status strip: the frame's bottom edge carries the passive readouts
          (nav hints, scene counts, world orientation) that used to float over
          the scene as their own capsules. */}
      <footer className="pointer-events-none absolute inset-x-0 bottom-0 z-20 hidden h-7 items-center gap-4 border-t border-border/70 bg-card/95 px-3 text-[10px] font-medium text-muted-foreground backdrop-blur-xl md:flex">
        {selectedRenderable ? (
          <span className="hidden truncate lg:block">{t("webEditor.navHints", lang)}</span>
        ) : null}
        <span className="ml-auto flex shrink-0 items-center gap-4">
          <span className="tabular-nums">
            {workspace.nodes.length} {t("webEditor.nodes", lang)} · {workspace.cameras.length} {t("webEditor.cameras", lang)}
          </span>
          <span className="flex items-center gap-1.5 text-[9px] font-semibold">
            <span>Y up</span>
            <span className="text-[#ff334f]">X</span>
            <span className="text-[#18d968]">Y</span>
            <span className="text-[#2f8cff]">Z</span>
          </span>
        </span>
      </footer>

      {selected && selectedAssetUrl ? (
        <div className={cameraEditorOpen && selected.visible ? undefined : "hidden"}>
          <CameraEditor
            splatId={selected.splat_id}
            viewerRef={viewerRef}
            initialCameras={{
              cameras: workspace.cameras as unknown as SavedCamera[],
              sceneRevision: workspace.revision,
              source: "web-tour-workspace",
            }}
            sceneTransform={draftTransform ?? undefined}
            onChange={stageWorkspaceCameras}
            saveHandler={saveWorkspaceCameras}
            appearance="workspace"
            defaultMode="preview"
            isOpen={cameraEditorOpen && selected.visible}
            lang={lang}
          />
        </div>
      ) : null}

      {dragActive && !uploading ? (
        <div className="pointer-events-none absolute inset-3 z-40 rounded-[1.5rem] border-2 border-dashed border-foreground/25">
          <div className="floating-capsule absolute left-1/2 top-20 flex min-h-10 w-max max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-2.5 !bg-card/95 px-4 shadow-elevated">
            <UploadIcon size={15} className="shrink-0 text-foreground/50" />
            <span className="truncate text-[11px] font-semibold">
              {t("webEditor.dropTitle", lang)}
            </span>
            <span className="hidden text-[9px] text-muted-foreground sm:inline">
              .PLY / .SOG · {formatBytes(10 * 1024 ** 3, lang)}
            </span>
          </div>
        </div>
      ) : null}

      {uploading ? (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/82 p-6 backdrop-blur-md">
          <div className="floating-panel w-full max-w-md p-7 text-center">
            <UploadIcon size={26} className="mx-auto text-foreground/45" />
            <h2 className="mt-4 text-lg font-semibold">
              {t("webEditor.uploading", lang)}
            </h2>
            <p className="mt-2 truncate text-[12px] text-muted-foreground">
              {uploadName} · {Math.round(uploadProgress * 100)}%
            </p>
            <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-foreground/[0.08]">
              <div
                className="h-full rounded-full bg-foreground transition-[width]"
                style={{ width: `${Math.max(2, uploadProgress * 100)}%` }}
              />
            </div>
          </div>
        </div>
      ) : null}

      {viewerFailed ? (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/72 p-6 backdrop-blur-sm">
          <div
            role="alert"
            className="floating-panel w-full max-w-sm p-6 text-center shadow-elevated"
          >
            <p className="text-[13px] font-medium">
              {t("webEditor.assetLoadFailed", lang)}
            </p>
            {viewerErrorDetail ? (
              /* Verbatim and selectable: this is the one string that says which
                 stage failed, and it needs to survive being copied into a bug
                 report. */
              <p className="mt-2 select-text break-words font-mono text-[11px] leading-relaxed text-foreground/55">
                {viewerErrorDetail}
              </p>
            ) : null}
            <div className="mt-5 flex justify-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={async () => {
                  if (
                    (
                      workspaceDirty
                      || transformDirty
                      || splatSelectionStats.dirty
                      || hasPendingPruneMasks
                    )
                    && !(await confirmLeave())
                  ) return;
                  router.push(`/draft/${workspace.draft_id}`);
                }}
              >
                {t("common.back", lang)}
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  setViewerFailed(false);
                  setViewerErrorDetail(null);
                  setViewerReloadKey((value) => value + 1);
                }}
              >
                {t("common.tryAgain", lang)}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {error && error !== "load" ? (
        <div role="alert" className="floating-capsule absolute left-1/2 top-20 z-50 flex -translate-x-1/2 items-center gap-2 px-4 text-[11px] font-medium text-destructive shadow-control">
          {error}
          <button type="button" onClick={() => setError(null)} aria-label={t("common.dismiss", lang)}>
            <CloseIcon size={11} />
          </button>
        </div>
      ) : null}

      {confirmDialog}
    </main>
  );
}

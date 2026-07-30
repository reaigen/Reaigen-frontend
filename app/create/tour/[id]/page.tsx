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
import type { SplatViewerHandle } from "../../../components/splat-viewer";
import {
  getWebTourAssetStatus,
  getWebTourWorkspace,
  replaceWebTourAsset,
  saveWebTourThumbnail,
  saveWebTourWorkspace,
  uploadWebTourAsset,
  type WebSceneTransform,
  type WebTourWorkspace,
  type WebTourWorkspaceNode,
} from "../../../lib/api/client";
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
import type {
  SplatSelectionOperation,
  SplatSelectionStats,
  SplatSelectionTool,
} from "../../../lib/splat-editing";
import { Button } from "../../../lib/ui/button";
import { Input } from "../../../lib/ui/input";
import { cn } from "../../../lib/utils";

const SplatViewer = dynamic(() => import("../../../components/splat-viewer"), { ssr: false });

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

type LocalPreview = {
  url: string;
  sourceFormat: "ply" | "sog";
};

type PruneConfirmation = "save" | "discard" | null;
type PruneSaveStage = "idle" | "exporting" | "uploading" | "finalizing";

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

  useEffect(() => {
    if (!focusedRef.current) setText(formatTransformValue(value));
  }, [value]);

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

  return (
    <label className="relative">
      <span className={cn(
        "pointer-events-none absolute left-2 top-1/2 z-10 -translate-y-1/2 text-[8px] font-bold",
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
          const parsed = Number(text);
          const base = Number.isFinite(parsed) ? parsed : value;
          const multiplier = event.shiftKey ? 10 : event.altKey ? 0.1 : 1;
          const direction = event.key === "ArrowUp" ? 1 : -1;
          const next = normalize(base + direction * step * multiplier);
          setText(formatTransformValue(next));
          onChange(next);
        }}
        className="h-9 rounded-xl border-border/65 bg-card pl-6 pr-2 text-right text-[11px] tabular-nums shadow-control"
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
  const router = useRouter();
  const viewerRef = useRef<SplatViewerHandle | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [workspace, setWorkspace] = useState<WebTourWorkspace | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tool, setTool] = useState<SpatialTransformTool>("select");
  const [transformSpace, setTransformSpace] = useState<"world" | "local">("world");
  const [snapEnabled, setSnapEnabled] = useState(false);
  const [draftTransform, setDraftTransform] = useState<GlobalSceneTransform | null>(null);
  const [transformDirty, setTransformDirty] = useState(false);
  const [workspaceDirty, setWorkspaceDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadName, setUploadName] = useState("");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [dragActive, setDragActive] = useState(false);
  const [showGrid, setShowGrid] = useState(true);
  const [cameraMode, setCameraMode] = useState<SpatialCameraMode>("orbit");
  const [scenePanelOpen, setScenePanelOpen] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [showNavigationHint, setShowNavigationHint] = useState(true);
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
  const [committingPrune, setCommittingPrune] = useState(false);
  const [pruneUploadProgress, setPruneUploadProgress] = useState(0);
  const [pruneConfirmation, setPruneConfirmation] = useState<PruneConfirmation>(null);
  const [pruneSaveStage, setPruneSaveStage] = useState<PruneSaveStage>("idle");
  const [pruneSaveNotice, setPruneSaveNotice] = useState<string | null>(null);
  const [compactLayout, setCompactLayout] = useState(false);
  const [historyAvailability, setHistoryAvailability] = useState({ undo: false, redo: false });
  const [localPreviews, setLocalPreviews] = useState<Record<string, LocalPreview>>({});
  const localPreviewsRef = useRef<Record<string, LocalPreview>>({});
  const persistWorkspaceRef = useRef<() => Promise<boolean>>(async () => false);
  const undoTransformRef = useRef<() => void>(() => undefined);
  const redoTransformRef = useRef<() => void>(() => undefined);
  const transformUndoRef = useRef<Record<string, GlobalSceneTransform[]>>({});
  const transformRedoRef = useRef<Record<string, GlobalSceneTransform[]>>({});
  const autoGroundedNodesRef = useRef(new Set<string>());
  const workspaceRef = useRef<WebTourWorkspace | null>(null);
  const draftTransformRef = useRef<GlobalSceneTransform | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  const pruneCommitLockRef = useRef(false);
  const thumbnailCaptureRef = useRef<Promise<unknown>>(Promise.resolve());

  const requestClosePruneEditor = useCallback(() => {
    if (committingPrune) return;
    if (splatSelectionStats.dirty) {
      setPruneConfirmation("discard");
      return;
    }
    setPruneConfirmation(null);
    setPruneEditorOpen(false);
  }, [committingPrune, splatSelectionStats.dirty]);

  const discardPruneChanges = useCallback(() => {
    if (committingPrune) return;
    viewerRef.current?.resetSplatPrune();
    setPruneConfirmation(null);
    setPruneEditorOpen(false);
  }, [committingPrune]);

  useEffect(() => {
    if (!pruneSaveNotice) return;
    const timer = window.setTimeout(() => setPruneSaveNotice(null), 4500);
    return () => window.clearTimeout(timer);
  }, [pruneSaveNotice]);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) router.replace("/");
  }, [isAuthenticated, isLoading, router]);

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
    if (!isAuthenticated || !Number.isFinite(tourId)) return;
    setLoading(true);
    reload()
      .catch(() => setError("load"))
      .finally(() => setLoading(false));
  }, [isAuthenticated, reload, tourId]);

  const selected = useMemo(
    () => workspace?.nodes.find((node) => node.id === selectedId) ?? null,
    [selectedId, workspace],
  );
  const selectedAssetUrl = selected
    ? localPreviews[selected.id]?.url ?? selected.asset.url
    : null;
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
      })),
    [localPreviews, selectedId, workspace],
  );
  const selectedNodeId = selected?.id ?? null;
  const selectedTransform = selected?.transform ?? null;

  useEffect(() => {
    workspaceRef.current = workspace;
    draftTransformRef.current = draftTransform;
    selectedIdRef.current = selectedId;
  }, [draftTransform, selectedId, workspace]);

  useEffect(() => {
    if (!selectedTransform) {
      setDraftTransform(null);
      return;
    }
    setDraftTransform(runtimeTransform(selectedTransform));
    setTransformDirty(false);
  }, [selectedNodeId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selectedTransform || transformDirty) return;
    setDraftTransform(runtimeTransform(selectedTransform));
  }, [selectedTransform, transformDirty]);

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
      && !committingPrune
    ) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [
    committingPrune,
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
    setShowNavigationHint(true);
    const timer = window.setTimeout(() => setShowNavigationHint(false), 7000);
    return () => window.clearTimeout(timer);
  }, [cameraMode]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const syncLayout = () => setCompactLayout(media.matches);
    syncLayout();
    media.addEventListener("change", syncLayout);
    return () => media.removeEventListener("change", syncLayout);
  }, []);

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
        if (pruneEditorOpen && splatSelectionStats.dirty) {
          setPruneConfirmation("save");
        } else {
          void persistWorkspaceRef.current();
        }
        return;
      }
      if (key === "1") setTool("select");
      else if (key === "2") setTool("move");
      else if (key === "3") setTool("rotate");
      else if (key === "4") setTool("scale");
      else if (key === "g") setShowGrid((value) => !value);
      else if (key === "escape") {
        setTool("select");
        setCameraEditorOpen(false);
        if (pruneConfirmation && !committingPrune) {
          setPruneConfirmation(null);
        } else if (pruneEditorOpen) {
          requestClosePruneEditor();
        }
      } else {
        return;
      }
      event.preventDefault();
    };
    window.addEventListener("keydown", handleEditorShortcut);
    return () => window.removeEventListener("keydown", handleEditorShortcut);
  }, [
    committingPrune,
    pruneConfirmation,
    pruneEditorOpen,
    requestClosePruneEditor,
    splatSelectionStats.dirty,
  ]);

  useEffect(() => {
    if (!workspace) return;
    setLocalPreviews((current) => {
      let changed = false;
      const next = { ...current };
      for (const node of workspace.nodes) {
        const preview = next[node.id];
        if (
          preview?.sourceFormat === "ply"
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

  const captureAutomaticThumbnail = useCallback((workspaceRevision: number) => {
    const task = thumbnailCaptureRef.current
      .catch(() => undefined)
      .then(async () => {
        const current = workspaceRef.current;
        if (
          !current
          || current.revision !== workspaceRevision
          || current.thumbnail_revision === workspaceRevision
        ) return null;
        const imageData = await viewerRef.current?.captureThumbnail();
        if (!imageData) return null;
        try {
          const updated = await saveWebTourThumbnail(
            tourId,
            workspaceRevision,
            imageData,
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
    setUploading(true);
    setError(null);
    setUploadName(file.name);
    setUploadProgress(0);
    try {
      const value = await uploadWebTourAsset(tourId, file, setUploadProgress);
      setWorkspace(value);
      setTransformDirty(false);
      setWorkspaceDirty(false);
      const addedNode = value.nodes.at(-1);
      if (addedNode) {
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
    if (nodeId === selectedId) return;
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

  const persistWorkspace = async (): Promise<boolean> => {
    if (!workspace) return false;
    setSaving(true);
    setError(null);
    try {
      const nodes = workspace.nodes.map((node) => ({
        id: node.id,
        name: node.name,
        visible: node.visible,
        transform: node.id === selected?.id && draftTransform
          ? workspaceTransform(draftTransform)
          : node.transform,
      }));
      const saved = await saveWebTourWorkspace(tourId, {
        base_revision: workspace.revision,
        name: workspace.name,
        nodes,
      });
      workspaceRef.current = saved;
      setWorkspace(saved);
      const savedSelected = saved.nodes.find((node) => node.id === selected?.id);
      if (savedSelected) setDraftTransform(runtimeTransform(savedSelected.transform));
      setTransformDirty(false);
      setWorkspaceDirty(false);
      await captureAutomaticThumbnail(saved.revision);
      return true;
    } catch {
      setError(t("webEditor.saveFailed", lang));
      return false;
    } finally {
      setSaving(false);
    }
  };
  useEffect(() => {
    persistWorkspaceRef.current = persistWorkspace;
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
    if (!workspace) return;
    if (splatSelectionStats.dirty) {
      setPruneEditorOpen(true);
      setPruneConfirmation("save");
      return;
    }
    const draftId = workspace.draft_id;
    const saved = (workspaceDirty || transformDirty)
      ? await persistWorkspace()
      : true;
    if (saved) {
      if (!workspaceDirty && !transformDirty) {
        await captureAutomaticThumbnail(workspace.revision);
      }
      router.push(`/draft/${draftId}`);
    }
  };

  const commitPrunedAsset = async () => {
    if (
      !selected
      || !splatSelectionStats.dirty
      || splatSelectionStats.remaining < 1
      || committingPrune
      || pruneCommitLockRef.current
    ) return;
    pruneCommitLockRef.current = true;
    setCommittingPrune(true);
    setPruneSaveStage("exporting");
    setPruneUploadProgress(0.04);
    setError(null);
    try {
      const baseName = selected.name.replace(/\.(ply|sog)$/i, "").trim() || "scene";
      const file = await viewerRef.current?.exportPrunedPly(`${baseName}-edited.ply`);
      if (!file) throw new Error("The edited splat is unavailable.");
      setPruneSaveStage("uploading");
      setPruneUploadProgress(0.08);
      const saved = await replaceWebTourAsset(
        tourId,
        selected.splat_id,
        file,
        {
          originalCount: splatSelectionStats.total,
          remainingCount: splatSelectionStats.remaining,
        },
        (fraction) => {
          setPruneUploadProgress(0.08 + Math.min(1, fraction) * 0.84);
          if (fraction >= 1) setPruneSaveStage("finalizing");
        },
      );
      setPruneSaveStage("finalizing");
      setPruneUploadProgress(0.96);
      setWorkspace(saved);
      const preview: LocalPreview = {
        url: URL.createObjectURL(file),
        sourceFormat: "ply",
      };
      setLocalPreviews((current) => {
        const previous = current[selected.id];
        if (previous) URL.revokeObjectURL(previous.url);
        return { ...current, [selected.id]: preview };
      });
      setTransformDirty(false);
      setWorkspaceDirty(false);
      setPruneUploadProgress(1);
      setPruneSaveNotice(t("webEditor.pruneSaved", lang));
      setPruneConfirmation(null);
      setPruneEditorOpen(false);
      setSplatSelectionStats({
        total: splatSelectionStats.remaining,
        selected: 0,
        remaining: splatSelectionStats.remaining,
        pruned: 0,
        dirty: false,
      });
    } catch {
      setError(t("webEditor.pruneSaveFailed", lang));
      setPruneSaveStage("idle");
      setPruneUploadProgress(0);
    } finally {
      pruneCommitLockRef.current = false;
      setCommittingPrune(false);
    }
  };

  const saveWorkspaceCameras = async (cameraData: CameraData): Promise<CameraData> => {
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
    const saved = await saveWebTourWorkspace(tourId, {
      base_revision: currentWorkspace.revision,
      name: currentWorkspace.name,
      nodes,
      cameras: cameraData.cameras as unknown as Array<Record<string, unknown>>,
    });
    workspaceRef.current = saved;
    setWorkspace(saved);
    setTransformDirty(false);
    setWorkspaceDirty(false);
    void captureAutomaticThumbnail(saved.revision);
    return {
      ...cameraData,
      cameras: saved.cameras as unknown as SavedCamera[],
      sceneRevision: saved.revision,
      source: "web-tour-workspace",
    };
  };

  if (isLoading || loading || !user) return <PageLoading />;

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
      className="relative h-[100dvh] w-screen overflow-hidden bg-background text-foreground"
      onDragEnter={(event) => {
        event.preventDefault();
        if (!uploading) setDragActive(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setDragActive(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragActive(false);
        const file = event.dataTransfer.files[0];
        if (file && !uploading) void uploadFile(file);
      }}
    >
      {selectedAssetUrl && selected?.visible && draftTransform ? (
        <SplatViewer
          key={`${selected.id}:${selectedAssetUrl}`}
          ref={viewerRef}
          onReady={() => {
            const revision = workspaceRef.current?.revision;
            if (revision == null) return;
            window.setTimeout(() => {
              void captureAutomaticThumbnail(revision);
            }, 700);
          }}
          splatUrl={selectedAssetUrl}
          splatId={selected.splat_id}
          globalSceneTransform={draftTransform}
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
              !selectedId
              || autoGroundedNodesRef.current.has(selectedId)
            ) return;
            autoGroundedNodesRef.current.add(selectedId);
            setDraftTransform((current) => {
              if (!current) return current;
              const isFreshIdentityTransform = (
                current.translation.every((value) => Math.abs(value) < 1e-6)
                && current.rotationDeg.every((value) => Math.abs(value) < 1e-6)
                && Math.abs(current.scale - 1) < 1e-6
                && (current.scale3 ?? [1, 1, 1]).every(
                  (value) => Math.abs(value - 1) < 1e-6,
                )
              );
              if (!isFreshIdentityTransform || Math.abs(frame.floorY) < 0.005) {
                return current;
              }
              setTransformDirty(true);
              setWorkspaceDirty(true);
              window.requestAnimationFrame(() => {
                window.requestAnimationFrame(() => {
                  viewerRef.current?.frameScene(true);
                });
              });
              return {
                ...current,
                translation: [0, Number((-frame.floorY).toFixed(4)), 0],
              };
            });
          }}
          compositionAssets={compositionAssets}
          showSpatialGrid={showGrid}
          spatialCameraMode={cameraMode}
          onSpatialCameraModeChange={setCameraMode}
          lang={lang}
          onError={() => setError(t("webEditor.assetLoadFailed", lang))}
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center bg-background">
          <div className="max-w-sm px-6 text-center">
            <UploadIcon size={28} className="mx-auto text-foreground/30" />
            <h1 className="mt-4 text-xl font-semibold">{t("webEditor.emptyTitle", lang)}</h1>
            <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
              {t("webEditor.emptyDescription", lang)}
            </p>
            <Button className="mt-5" onClick={() => fileInputRef.current?.click()}>
              <PlusIcon size={14} />
              {t("webEditor.addSplat", lang)}
            </Button>
          </div>
        </div>
      )}

      <header className="floating-panel floating-header pointer-events-none absolute inset-x-3 top-3 z-30 mx-auto flex max-w-[48rem] items-center justify-between gap-3 px-2">
        <div className="pointer-events-auto flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={() => {
              if (
                (workspaceDirty || transformDirty || splatSelectionStats.dirty)
                && !window.confirm(t("webEditor.unsavedLeave", lang))
              ) return;
              router.push(`/draft/${workspace.draft_id}`);
            }}
            aria-label={t("common.back", lang)}
            className="floating-icon-button-sm text-foreground/55 hover:bg-foreground/[0.06] hover:text-foreground"
          >
            <ArrowLeftIcon size={15} />
          </button>
          <div className="min-w-0 border-l border-border/70 px-3 py-1">
            <span className="flex items-center gap-2">
              <span className="truncate text-[12px] font-semibold sm:max-w-[18rem]">{workspace.name}</span>
              <span className="rounded-full bg-foreground/[0.07] px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-[0.1em] text-foreground/50">
                {t("spatialEditor.rnd", lang)}
              </span>
            </span>
            <span className="mt-0.5 block text-[9px] text-muted-foreground">
              {workspace.usd.rootLayer ?? "workspace.usda"} · r{workspace.revision}
            </span>
          </div>
        </div>
        <div className="pointer-events-auto flex items-center gap-2">
          <span className={cn(
            "hidden items-center gap-1.5 px-1 text-[10px] font-medium md:flex",
            workspaceDirty || transformDirty || splatSelectionStats.dirty
              ? "text-amber-700"
              : "text-foreground/45",
          )}>
            <span className={cn(
              "h-1.5 w-1.5 rounded-full",
              workspaceDirty || transformDirty || splatSelectionStats.dirty
                ? "bg-amber-500"
                : "bg-emerald-500",
            )} />
            {splatSelectionStats.dirty
              ? t("webEditor.pruneUnsaved", lang)
              : workspaceDirty || transformDirty
                ? t("spatialEditor.unsavedTransform", lang)
                : t("spatialEditor.savedTransform", lang)}
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            <PlusIcon size={13} />
            <span className="hidden sm:inline">{t("webEditor.addSplat", lang)}</span>
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => { void persistWorkspace(); }}
            loading={saving}
            disabled={!workspaceDirty && !transformDirty}
            title={`${t("spatialEditor.applyTransform", lang)} · Ctrl/⌘ S`}
          >
            <CheckIcon size={13} />
            <span className="hidden md:inline">{t("spatialEditor.applyTransform", lang)}</span>
          </Button>
          <Button
            size="sm"
            onClick={() => { void finishTour(); }}
            loading={saving}
          >
            <CheckIcon size={13} />
            {t("webEditor.saveTour", lang)}
          </Button>
        </div>
      </header>

      <input
        ref={fileInputRef}
        type="file"
        accept=".ply,.sog"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void uploadFile(file);
        }}
      />

      {selectedAssetUrl && (showNavigationHint || selected?.asset.conversion?.status === "running") ? (
        <div className="pointer-events-none absolute left-1/2 top-20 z-20 flex -translate-x-1/2 flex-col items-center gap-1.5">
          {showNavigationHint ? (
          <div className="floating-capsule flex min-h-9 items-center px-4 text-[10px] font-medium text-foreground/55 shadow-control">
            {t(cameraMode === "orbit" ? "webEditor.orbitHint" : "webEditor.flyHint", lang)}
          </div>
          ) : null}
          {selected?.asset.conversion?.status === "running" ? (
            <div className="floating-capsule flex min-h-8 items-center border-amber-500/20 bg-amber-50/95 px-3 text-[9px] font-medium text-amber-800 shadow-control">
              {t("webEditor.convertingHint", lang)}
            </div>
          ) : null}
        </div>
      ) : null}

      <aside className={cn(
        "floating-panel absolute left-3 top-20 z-20 max-h-[calc(100dvh-10rem)] w-[min(17rem,calc(100vw-1.5rem))] overflow-hidden transition-transform sm:left-4",
        !scenePanelOpen && "-translate-x-[calc(100%+1rem)]",
      )}>
        <div className="flex items-center justify-between border-b border-border/65 px-4 py-3">
          <span>
            <span className="block text-[12px] font-semibold">{t("webEditor.sceneGraph", lang)}</span>
            <span className="block text-[9px] text-muted-foreground">
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
        <div className="max-h-[calc(100dvh-14rem)] overflow-y-auto p-2">
          <div className="flex items-center gap-2 rounded-[1rem] bg-foreground/[0.045] px-3 py-2.5 text-[11px] font-semibold">
            <TourIcon size={12} />
            /World
            <span className="ml-auto text-[9px] font-normal text-muted-foreground">USD</span>
          </div>
          <div className="ml-4 border-l border-foreground/[0.1] pl-2 pt-1">
            {workspace.nodes.map((node) => (
              <div
                key={node.id}
                className={cn(
                  "group flex w-full items-center gap-2 rounded-xl px-2.5 py-2.5 text-left transition-colors",
                  node.id === selectedId
                    ? "bg-foreground text-background"
                    : "text-foreground/65 hover:bg-foreground/[0.06] hover:text-foreground",
                )}
              >
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    updateNode(node.id, (current) => ({ ...current, visible: !current.visible }));
                  }}
                  className="flex shrink-0 items-center justify-center rounded-md p-1"
                  aria-label={node.visible ? t("common.hide", lang) : t("common.show", lang)}
                >
                  {node.visible ? <EyeOpenIcon size={12} /> : <EyeClosedIcon size={12} />}
                </button>
                <button
                  type="button"
                  onClick={() => selectNode(node.id)}
                  className="min-w-0 flex-1 truncate text-left text-[11px] font-medium"
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
              disabled={!selected || !selectedAssetUrl}
              onClick={() => {
                setCameraEditorOpen(true);
                if (compactLayout) setScenePanelOpen(false);
              }}
              className={cn(
                "mt-1 flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-[11px] font-medium transition-colors disabled:opacity-40",
                cameraEditorOpen
                  ? "bg-foreground text-background"
                  : "text-foreground/65 hover:bg-foreground/[0.06] hover:text-foreground",
              )}
            >
              <CameraIcon size={13} />
              <span className="min-w-0 flex-1">{t("webEditor.cameras", lang)}</span>
              <span className="rounded-full bg-foreground/[0.07] px-2 py-0.5 text-[9px] tabular-nums">
                {workspace.cameras.length}
              </span>
            </button>
          </div>
        </div>
      </aside>

      {!scenePanelOpen ? (
        <button
          type="button"
          onClick={() => setScenePanelOpen(true)}
          className="floating-panel floating-icon-button absolute left-3 top-20 z-20 text-foreground/60 shadow-control sm:left-4"
          aria-label={t("webEditor.sceneGraph", lang)}
        >
          <TourIcon size={14} />
        </button>
      ) : null}

      {selected && draftTransform && inspectorOpen && !cameraEditorOpen && (!compactLayout || !scenePanelOpen) ? (
        <section className="floating-panel absolute right-3 top-20 z-20 max-h-[calc(100dvh-10rem)] w-[min(20rem,calc(100vw-1.5rem))] overflow-y-auto p-3 sm:right-4">
          <div className="flex items-center justify-between gap-3">
            <span className="min-w-0">
              <span className="block text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                {t("spatialEditor.inspector", lang)}
              </span>
              <span className="block truncate font-mono text-[9px] text-muted-foreground">{selected.prim_path}</span>
            </span>
            <span className="flex items-center gap-1">
              <span className="rounded-full bg-foreground/[0.06] px-2 py-1 text-[9px] uppercase tracking-[0.08em] text-foreground/45">
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
            className="mt-3 h-10 rounded-xl border-border/70 bg-card px-3 text-[12px] font-semibold shadow-control"
            aria-label={t("webEditor.sceneGraph", lang)}
          />
          <div className="mt-2 grid grid-cols-2 rounded-xl bg-foreground/[0.045] p-1">
            {(["world", "local"] as const).map((space) => (
              <button
                key={space}
                type="button"
                onClick={() => setTransformSpace(space)}
                className={cn(
                  "h-8 rounded-lg text-[10px] font-medium transition-colors",
                  transformSpace === space
                    ? "bg-card text-foreground shadow-control"
                    : "text-muted-foreground hover:text-foreground",
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
              "mt-2 flex h-9 w-full items-center justify-between rounded-xl px-3 text-[10px] font-medium transition-colors",
              snapEnabled
                ? "bg-foreground text-background"
                : "bg-foreground/[0.045] text-muted-foreground hover:text-foreground",
            )}
          >
            <span>{t("spatialEditor.snap", lang)}</span>
            <span className="font-mono text-[9px] opacity-65">
              {tool === "rotate" ? "5°" : tool === "scale" ? "0.05×" : "0.10 m"}
            </span>
          </button>
          <div className="mt-3 space-y-3">
            {([
              ["translation", t("spatialEditor.position", lang), draftTransform.translation, 0.05],
              ["rotationDeg", t("spatialEditor.rotation", lang), draftTransform.rotationDeg, 1],
            ] as const).map(([key, label, values, step]) => (
              <div key={key} className="rounded-[1rem] bg-foreground/[0.035] p-2.5">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[10px] font-semibold">{label}</span>
                  <button
                    type="button"
                    onClick={() => resetTransform(key)}
                    className="rounded-full px-2 py-1 text-[9px] font-medium text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground"
                  >
                    {t("spatialEditor.reset", lang)}
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-1.5">
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
            <div className="rounded-[1rem] bg-foreground/[0.035] p-2.5">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[10px] font-semibold">{t("spatialEditor.scale", lang)}</span>
                <button
                  type="button"
                  onClick={() => resetTransform("scale")}
                  className="rounded-full px-2 py-1 text-[9px] font-medium text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground"
                >
                  {t("spatialEditor.reset", lang)}
                </button>
              </div>
              <div className="grid grid-cols-3 gap-1.5">
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
            <div className="flex items-center justify-between gap-2 border-t border-border/60 px-1 pt-3">
              <button
                type="button"
                onClick={() => resetTransform("all")}
                className="text-[10px] font-medium text-muted-foreground hover:text-foreground"
              >
                {t("spatialEditor.resetAll", lang)}
              </button>
              <span className="text-[9px] text-muted-foreground">
                {workspaceDirty || transformDirty ? t("spatialEditor.unsavedTransform", lang) : t("spatialEditor.savedTransform", lang)}
              </span>
            </div>
          </div>
        </section>
      ) : null}

      {selected && !inspectorOpen && !cameraEditorOpen ? (
        <button
          type="button"
          onClick={() => setInspectorOpen(true)}
          className="floating-panel floating-icon-button absolute right-3 top-20 z-20 text-foreground/60 shadow-control sm:right-4"
          aria-label={t("spatialEditor.inspector", lang)}
        >
          <TechnicalIcon size={14} />
        </button>
      ) : null}

      {pruneEditorOpen && selected ? (
        <section className="floating-panel absolute bottom-20 left-3 z-30 w-[min(23rem,calc(100vw-1.5rem))] overflow-hidden p-3 shadow-control sm:left-4">
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

          {pruneConfirmation ? (
            <div
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="prune-confirmation-title"
              className="absolute inset-0 z-10 flex flex-col justify-center bg-card/98 p-4 backdrop-blur-sm"
            >
              <p
                id="prune-confirmation-title"
                className="text-[13px] font-semibold"
              >
                {t(
                  pruneConfirmation === "save"
                    ? "webEditor.savePrunedTitle"
                    : "webEditor.discardPruneTitle",
                  lang,
                )}
              </p>
              {pruneConfirmation === "save" ? (
                <>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                    {splatSelectionStats.pruned.toLocaleString(lang)}{" "}
                    {t("webEditor.pointsRemoved", lang)} ·{" "}
                    {splatSelectionStats.remaining.toLocaleString(lang)}{" "}
                    {t("webEditor.pointsRemain", lang)} ·{" "}
                    {splatSelectionStats.total > 0
                      ? Math.round(
                          (splatSelectionStats.pruned / splatSelectionStats.total) * 100,
                        )
                      : 0}
                    %
                  </p>
                  <p className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/[0.08] p-3 text-[10px] leading-relaxed text-amber-800">
                    {t("webEditor.savePrunedWarning", lang)}
                  </p>
                </>
              ) : (
                <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                  {t("webEditor.discardPruneWarning", lang)}
                </p>
              )}

              {committingPrune ? (
                <div className="mt-4" aria-live="polite">
                  <div className="flex items-center justify-between text-[10px] font-medium">
                    <span>
                      {t(
                        pruneSaveStage === "exporting"
                          ? "webEditor.pruneExporting"
                          : pruneSaveStage === "finalizing"
                            ? "webEditor.pruneFinalizing"
                            : "webEditor.pruneUploading",
                        lang,
                      )}
                    </span>
                    <span className="tabular-nums">
                      {Math.round(pruneUploadProgress * 100)}%
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-foreground/[0.08]">
                    <div
                      className="h-full rounded-full bg-foreground transition-[width] duration-200"
                      style={{ width: `${Math.max(4, pruneUploadProgress * 100)}%` }}
                    />
                  </div>
                </div>
              ) : null}

              <div className="mt-4 grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={committingPrune}
                  onClick={() => setPruneConfirmation(null)}
                >
                  {t("common.cancel", lang)}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  loading={committingPrune}
                  onClick={() => {
                    if (pruneConfirmation === "save") {
                      void commitPrunedAsset();
                    } else {
                      discardPruneChanges();
                    }
                  }}
                >
                  {t(
                    pruneConfirmation === "save"
                      ? "webEditor.savePrunedConfirm"
                      : "webEditor.discardPrune",
                    lang,
                  )}
                </Button>
              </div>
            </div>
          ) : null}

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
            <label className="mt-3 flex items-center gap-3 text-[9px] text-muted-foreground">
              <span className="shrink-0">{t("webEditor.brushSize", lang)}</span>
              <input
                type="range"
                min={8}
                max={120}
                step={1}
                value={splatBrushRadius}
                onChange={(event) => setSplatBrushRadius(Number(event.target.value))}
                className="min-w-0 flex-1 accent-foreground"
              />
              <span className="w-8 text-right tabular-nums">{splatBrushRadius}</span>
            </label>
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
              disabled={!splatSelectionStats.dirty || committingPrune}
              onClick={() => setPruneConfirmation("save")}
            >
              <CheckIcon size={12} />
              {t("webEditor.savePruned", lang)}
            </Button>
          </div>
          <p className="mt-2 text-center text-[8px] leading-relaxed text-muted-foreground">
            {t("webEditor.prunePreviewOnly", lang)}
          </p>
        </section>
      ) : null}

      <nav className="floating-toolbar scrollbar-hide absolute bottom-4 left-1/2 z-30 max-w-[calc(100vw-1rem)] -translate-x-1/2 overflow-x-auto">
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
        <span className="mx-1 h-6 w-px bg-foreground/[0.1]" />
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
            className={cn(
              tool === value
                ? "floating-control gap-2 bg-foreground px-3 text-background"
                : "floating-icon-button text-foreground/50 hover:bg-foreground/[0.06] hover:text-foreground",
            )}
          >
            <Icon size={14} />
            {tool === value ? (
              <span className="hidden text-[10px] font-medium sm:inline">{t(label, lang)}</span>
            ) : null}
          </button>
        ))}
        <span className="mx-1 h-6 w-px bg-foreground/[0.1]" />
        <button
          type="button"
          disabled={!selected || !selectedAssetUrl}
          onClick={() => {
            if (pruneEditorOpen) {
              requestClosePruneEditor();
              return;
            }
            setTool("select");
            setCameraEditorOpen(false);
            setPruneConfirmation(null);
            setPruneEditorOpen(true);
            if (compactLayout) setScenePanelOpen(false);
          }}
          title={t("webEditor.splatEditing", lang)}
          className={cn(
            "floating-control gap-2 px-3 disabled:opacity-35",
            pruneEditorOpen
              ? "bg-foreground text-background"
              : "bg-card text-foreground shadow-control hover:bg-foreground/[0.06]",
          )}
        >
          <SelectIcon size={14} />
          <span className="hidden text-[10px] font-medium xl:inline">
            {t("webEditor.prune", lang)}
          </span>
        </button>
        <button
          type="button"
          onClick={() => setCameraMode((value) => value === "orbit" ? "fly" : "orbit")}
          title={t(cameraMode === "orbit" ? "spatialEditor.orbit" : "spatialEditor.fly", lang)}
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
          title={t("spatialEditor.grid", lang)}
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
          title={t("spatialEditor.frame", lang)}
          aria-keyshortcuts="F"
          className="floating-icon-button text-foreground/50 hover:bg-foreground/[0.06]"
        >
          <FrameIcon size={14} />
        </button>
        <span className="mx-1 h-6 w-px bg-foreground/[0.1]" />
        <button
          type="button"
          disabled={!selected || !selectedAssetUrl}
          onClick={() => {
            if (pruneEditorOpen && splatSelectionStats.dirty) {
              requestClosePruneEditor();
              return;
            }
            setCameraEditorOpen((value) => {
              const next = !value;
              if (next) {
                setPruneEditorOpen(false);
                if (compactLayout) setScenePanelOpen(false);
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

      <div className="floating-capsule pointer-events-none absolute bottom-4 right-3 z-20 hidden min-h-9 items-center gap-2 px-3 text-[9px] font-semibold shadow-control sm:flex sm:right-4">
        <span className="text-muted-foreground">Y up</span>
        <span className="text-[#ff334f]">X</span>
        <span className="text-[#18d968]">Y</span>
        <span className="text-[#2f8cff]">Z</span>
      </div>

      {cameraEditorOpen && selected && selectedAssetUrl ? (
        <CameraEditor
          splatId={selected.splat_id}
          viewerRef={viewerRef}
          initialCameras={{
            cameras: workspace.cameras as unknown as SavedCamera[],
            sceneRevision: workspace.revision,
            source: "web-tour-workspace",
          }}
          sceneTransform={draftTransform ?? undefined}
          saveHandler={saveWorkspaceCameras}
          appearance="workspace"
          defaultMode="edit"
          lang={lang}
        />
      ) : null}

      {(dragActive || uploading) ? (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/82 p-6 backdrop-blur-md">
          <div className="floating-panel w-full max-w-md p-7 text-center">
            <UploadIcon size={26} className="mx-auto text-foreground/45" />
            <h2 className="mt-4 text-lg font-semibold">
              {uploading ? t("webEditor.uploading", lang) : t("webEditor.dropTitle", lang)}
            </h2>
            <p className="mt-2 truncate text-[12px] text-muted-foreground">
              {uploading
                ? `${uploadName} · ${Math.round(uploadProgress * 100)}%`
                : t("webEditor.dropDescription", lang)}
            </p>
            {uploading ? (
              <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-foreground/[0.08]">
                <div
                  className="h-full rounded-full bg-foreground transition-[width]"
                  style={{ width: `${Math.max(2, uploadProgress * 100)}%` }}
                />
              </div>
            ) : (
              <p className="mt-4 text-[10px] text-muted-foreground">
                .PLY / .SOG · {formatBytes(10 * 1024 ** 3, lang)}
              </p>
            )}
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

      {pruneSaveNotice ? (
        <div
          role="status"
          className="floating-capsule absolute bottom-20 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 border-emerald-500/20 bg-emerald-50/95 px-4 text-[11px] font-medium text-emerald-800 shadow-control"
        >
          <CheckIcon size={13} />
          {pruneSaveNotice}
          <button
            type="button"
            onClick={() => setPruneSaveNotice(null)}
            aria-label={t("common.dismiss", lang)}
          >
            <CloseIcon size={11} />
          </button>
        </div>
      ) : null}
    </main>
  );
}

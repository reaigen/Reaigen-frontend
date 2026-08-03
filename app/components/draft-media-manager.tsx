"use client";
/* eslint-disable @next/next/no-img-element -- owner media uses short-lived signed URLs */

import * as React from "react";
import { motion } from "framer-motion";
import {
  cleanplateDraftImages,
  editDraftImage,
  generateDraftImageHdr,
  getMediaVersions,
  listDraftUploads,
  manageMediaVersion,
  updateDraftUpload,
  updateDraftGallery,
  uploadDraftPhoto,
  type MediaVersionGroup,
  type ReaiImageEditOperations,
} from "../lib/api/client";
import { getSafeApiErrorMessage } from "../lib/api/error-message";
import { formatDate, t, type LocaleKey } from "../lib/i18n";
import type { DraftDetailItem, DraftUpload } from "../lib/tour-types";
import { Button } from "../lib/ui/button";
import { Tabs, TabsList, TabsTrigger } from "../lib/ui/tabs";
import { cn } from "../lib/utils";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  DragHandleIcon,
  EditIcon,
  EyeClosedIcon,
  EyeOpenIcon,
  ImageIcon,
  StarIcon,
  UploadIcon,
  VersionsIcon,
  VideoIcon,
} from "./icons";
import { DraftImageEditor } from "./draft-image-editor";
import { SidePanel } from "./side-panel";
import { StatusPill } from "./status-pill";
import {
  MediaVersionCard,
  MediaVersionCreationPanel,
  type MediaAction,
  type MediaVersionCreateKind,
  type MediaVersionCreateRequest,
} from "./draft-version-manager";

type MediaFilter = "gallery" | "hidden";
type MediaKind = "image" | "video";
type MediaManagerView = "gallery" | "versions" | "editor";
type ConfirmAction = { kind: "hide"; groupId: string } | null;

interface MediaGroup {
  id: string;
  versions: DraftUpload[];
  active: DraftUpload;
  kind: MediaKind;
  visible: boolean;
}

interface PendingUpload {
  id: string;
  name: string;
  url: string;
  file: File;
  state: "queued" | "uploading" | "failed";
}

interface PointerReorderSession {
  id: string;
  pointerId: number;
  startOrder: string[];
  startX: number;
  startY: number;
  moved: boolean;
}

const MAX_FILES_PER_PICK = 30;
const MAX_BROWSER_PHOTO_BYTES = 49 * 1024 * 1024;
const NON_GALLERY_ROLES = new Set([
  "floorplan",
  "processed_roomplan",
  "splat",
  "scan",
  "room_splat",
  "scan_bundle",
  "model",
]);
const PHOTO_EXTENSION_RE = /\.(?:jpe?g|png|webp|heic|heif|tiff?|bmp)$/i;

function isPhotoFile(file: File) {
  return file.type.startsWith("image/") || PHOTO_EXTENSION_RE.test(file.name);
}

function mediaKind(upload: DraftUpload): MediaKind | null {
  const mime = (upload.mime_type || "").toLowerCase();
  const role = (upload.role || "").toLowerCase();
  if (NON_GALLERY_ROLES.has(role)) return null;
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  return null;
}

function versionNumber(upload: DraftUpload) {
  return Number.isFinite(upload.version) ? Number(upload.version) : 1;
}

function buildMediaGroups(uploads: DraftUpload[]): MediaGroup[] {
  const byAsset = new Map<string, DraftUpload[]>();
  for (const upload of uploads) {
    if (!mediaKind(upload) || !upload.file_url) continue;
    const key = upload.logical_asset_id || `upload-${upload.id}`;
    const versions = byAsset.get(key) ?? [];
    versions.push(upload);
    byAsset.set(key, versions);
  }

  return [...byAsset.entries()]
    .flatMap(([id, unsortedVersions]) => {
      const versions = [...unsortedVersions].sort((left, right) => (
        versionNumber(right) - versionNumber(left)
        || new Date(right.uploaded_at || 0).getTime() - new Date(left.uploaded_at || 0).getTime()
        || right.id - left.id
      ));
      const active = versions.find((version) => version.is_master && !version.is_deleted)
        ?? versions.find((version) => !version.is_deleted)
        ?? versions[0];
      const kind = mediaKind(active);
      if (!active || !kind) return [];
      return [{
        id,
        versions,
        active,
        kind,
        visible: active.is_gallery_visible !== false
          && versions.some((version) => version.is_master && !version.is_deleted),
      } satisfies MediaGroup];
    })
    .sort((left, right) => (
      (left.active.sort_order ?? 0) - (right.active.sort_order ?? 0)
      || new Date(left.active.uploaded_at || 0).getTime() - new Date(right.active.uploaded_at || 0).getTime()
      || left.active.id - right.active.id
    ));
}

function keepUsefulFilter(groups: MediaGroup[], current: MediaFilter): MediaFilter {
  const hasVisible = groups.some((group) => group.visible);
  const hasHidden = groups.some((group) => !group.visible);
  if (current === "gallery" && hasVisible) return current;
  if (current === "hidden" && hasHidden) return current;
  return hasVisible ? "gallery" : "hidden";
}

function mergeVersionState(uploads: DraftUpload[], groups: MediaVersionGroup[] | null) {
  if (!groups) return uploads;
  const versionById = new Map(groups.flatMap((group) => group.versions.map((version) => [version.id, version] as const)));
  return uploads.map((upload) => {
    const state = versionById.get(upload.id);
    if (!state) return upload;
    return {
      ...upload,
      logical_asset_id: state.logical_asset_id || upload.logical_asset_id,
      version: state.version,
      is_master: state.is_master,
      is_deleted: state.is_deleted,
      status: state.status || upload.status,
      file_url: state.file_url || upload.file_url,
      uploaded_at: state.uploaded_at || upload.uploaded_at,
      source_upload_id: state.source_upload_id,
      supersedes: state.supersedes_id,
    };
  });
}

function formatBytes(bytes: number, lang: string) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / (1024 ** unit);
  return `${new Intl.NumberFormat(lang || "en", { maximumFractionDigits: value >= 10 ? 0 : 1 }).format(value)} ${units[unit]}`;
}

function mediaGroupLabel(kind: MediaKind, index: number, lang: string) {
  return `${t(kind === "video" ? "draft.media.video" : "draft.media.photo", lang)} ${index + 1}`;
}

function MediaVisual({ upload, alt, className }: { upload: DraftUpload; alt: string; className?: string }) {
  if (mediaKind(upload) === "video") {
    return (
      <video
        src={upload.file_url}
        muted
        playsInline
        preload="metadata"
        className={cn("h-full w-full bg-black object-cover", className)}
        aria-label={alt}
      />
    );
  }
  return <img src={upload.file_url} alt={alt} className={cn("h-full w-full object-cover", className)} />;
}

function LoadingMark({ label }: { label: string }) {
  return (
    <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/48 px-2 text-center text-white backdrop-blur-[1px]">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/35 border-t-white" aria-hidden="true" />
      <span className="text-[10px] font-semibold">{label}</span>
    </span>
  );
}

function MediaManagerSkeleton() {
  return (
    <div className="media-manager-layout" aria-hidden="true">
      <section className="media-manager-grid min-w-0">
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            key={index}
            className="floating-panel-shape overflow-hidden border border-border/65 bg-card"
          >
            <div className="aspect-[4/3] animate-pulse bg-muted/60 motion-reduce:animate-none" />
            <div className="space-y-2 px-3 py-3">
              <div className="h-3 w-2/3 rounded-full bg-muted/70" />
              <div className="h-3 w-1/3 rounded-full bg-muted/45" />
            </div>
          </div>
        ))}
      </section>
      <aside className="floating-panel-shape media-manager-inspector overflow-hidden border border-border/65 bg-card">
        <div className="aspect-[4/3] animate-pulse bg-muted/60 motion-reduce:animate-none" />
        <div className="space-y-3 p-4">
          <div className="h-4 w-2/3 rounded-full bg-muted/70" />
          <div className="h-3 w-1/2 rounded-full bg-muted/45" />
          <div className="h-10 rounded-full bg-muted/55" />
        </div>
      </aside>
    </div>
  );
}

function VersionManagerSkeleton() {
  return (
    <div className="grid gap-4 min-[760px]:grid-cols-2" aria-hidden="true">
      {Array.from({ length: 2 }).map((_, index) => (
        <div
          key={index}
          className="floating-panel-shape overflow-hidden border border-border/65 bg-card"
        >
          <div className="aspect-[16/9] animate-pulse bg-muted/60 motion-reduce:animate-none" />
          <div className="space-y-3 p-4">
            <div className="h-4 w-1/2 rounded-full bg-muted/70" />
            <div className="h-3 w-3/4 rounded-full bg-muted/45" />
            <div className="h-11 rounded-full bg-muted/55" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function DraftMediaManager({
  open,
  onOpenChange,
  draft,
  lang,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draft: DraftDetailItem;
  lang: string;
  onChanged?: () => void | Promise<void>;
}) {
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const versionFileInputRef = React.useRef<HTMLInputElement>(null);
  const contentRef = React.useRef<HTMLDivElement>(null);
  const uploadDragDepth = React.useRef(0);
  const loadSequence = React.useRef(0);
  const panelOpenRef = React.useRef(open);
  const versionRefreshTimers = React.useRef<number[]>([]);
  const pointerReorder = React.useRef<PointerReorderSession | null>(null);
  const pendingUrls = React.useRef(new Set<string>());
  const reorderIdsRef = React.useRef<string[]>([]);
  const hasLoadedMedia = React.useRef(false);
  const [uploads, setUploads] = React.useState<DraftUpload[]>([]);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [filter, setFilter] = React.useState<MediaFilter>("gallery");
  const [loading, setLoading] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [pending, setPending] = React.useState<PendingUpload[]>([]);
  const [draggingId, setDraggingId] = React.useState<string | null>(null);
  const [reorderIds, setReorderIds] = React.useState<string[]>([]);
  const [reorderMode, setReorderMode] = React.useState(false);
  const [versionActionsAvailable, setVersionActionsAvailable] = React.useState<boolean | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [errorCanRetryLoad, setErrorCanRetryLoad] = React.useState(false);
  const [confirmAction, setConfirmAction] = React.useState<ConfirmAction>(null);
  const [view, setView] = React.useState<MediaManagerView>("gallery");
  const [versionGroups, setVersionGroups] = React.useState<MediaVersionGroup[]>([]);
  const [selectedVersionIds, setSelectedVersionIds] = React.useState<Record<string, number>>({});
  const [versionCandidate, setVersionCandidate] = React.useState<MediaAction>(null);
  const [versionCreateRequest, setVersionCreateRequest] = React.useState<MediaVersionCreateRequest | null>(null);
  const [versionBusy, setVersionBusy] = React.useState(false);
  const [versionNotice, setVersionNotice] = React.useState<string | null>(null);
  const [uploadDropActive, setUploadDropActive] = React.useState(false);
  const [undoOrderIds, setUndoOrderIds] = React.useState<string[] | null>(null);
  const [versionUploadTargetId, setVersionUploadTargetId] = React.useState<string | null>(null);
  const [replacingId, setReplacingId] = React.useState<string | null>(null);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  const groups = React.useMemo(() => buildMediaGroups(uploads), [uploads]);
  const visibleGroups = React.useMemo(() => groups.filter((group) => group.visible), [groups]);
  const hiddenGroups = React.useMemo(() => groups.filter((group) => !group.visible), [groups]);
  const filteredGroups = filter === "gallery" ? visibleGroups : hiddenGroups;
  const selected = filteredGroups.find((group) => group.id === selectedId) ?? filteredGroups[0] ?? null;
  const editingGroup = groups.find((group) => group.id === editingId) ?? null;
  const activeReorderIds = reorderIds.length ? reorderIds : visibleGroups.map((group) => group.id);
  const reorderSelectedIndex = selected ? activeReorderIds.indexOf(selected.id) : -1;
  const confirmGroup = confirmAction ? groups.find((group) => group.id === confirmAction.groupId) ?? null : null;
  const coverId = visibleGroups.find((group) => group.kind === "image")?.id ?? null;
  const orderedVersionGroups = React.useMemo(() => versionGroups
    .map((group, index) => ({ group, index }))
    .sort((left, right) => {
      if (!selected?.id) return left.index - right.index;
      if (left.group.logical_asset_id === selected.id) return -1;
      if (right.group.logical_asset_id === selected.id) return 1;
      return left.index - right.index;
    }), [selected?.id, versionGroups]);

  const applyVersionGroups = React.useCallback((nextGroups: MediaVersionGroup[]) => {
    setVersionGroups(nextGroups);
    setSelectedVersionIds((current) => Object.fromEntries(nextGroups.flatMap((group) => {
      const currentSelection = group.versions.find((version) => version.id === current[group.logical_asset_id]);
      const preferred = currentSelection
        ?? group.versions.find((version) => version.is_master)
        ?? group.versions.find((version) => !version.is_deleted)
        ?? group.versions[0];
      return preferred ? [[group.logical_asset_id, preferred.id]] : [];
    })));
  }, []);

  const releasePendingUrl = React.useCallback((url: string) => {
    URL.revokeObjectURL(url);
    pendingUrls.current.delete(url);
  }, []);

  React.useEffect(() => () => {
    pendingUrls.current.forEach((url) => URL.revokeObjectURL(url));
    pendingUrls.current.clear();
    versionRefreshTimers.current.forEach((timer) => window.clearTimeout(timer));
    versionRefreshTimers.current = [];
  }, []);

  const loadMedia = React.useCallback(async (showLoader = true) => {
    const sequence = ++loadSequence.current;
    if (showLoader && !hasLoadedMedia.current) setLoading(true);
    setError(null);
    setErrorCanRetryLoad(false);
    try {
      const versionRequest = getMediaVersions(draft.id, { fresh: true }).then((result) => result.groups);
      const allUploads = await listDraftUploads(draft.id, { includeDeleted: true, fresh: true });
      if (sequence !== loadSequence.current) return;
      setVersionActionsAvailable(null);
      const nextUploads = mergeVersionState(allUploads, null);
      const nextGroups = buildMediaGroups(nextUploads);
      hasLoadedMedia.current = true;
      setUploads(nextUploads);
      setSelectedId((current) => nextGroups.some((group) => group.id === current) ? current : nextGroups[0]?.id ?? null);
      setFilter((current) => keepUsefulFilter(nextGroups, current));
      if (showLoader) setLoading(false);

      // Version state enriches the already-visible grid; a temporary tool
      // outage must never hold the current gallery behind this request.
      void versionRequest.then((versionResult) => {
        if (sequence !== loadSequence.current) return;
        setVersionActionsAvailable(true);
        applyVersionGroups(versionResult);
        const enrichedUploads = mergeVersionState(allUploads, versionResult);
        const enrichedGroups = buildMediaGroups(enrichedUploads);
        setUploads(enrichedUploads);
        setSelectedId((current) => enrichedGroups.some((group) => group.id === current) ? current : enrichedGroups[0]?.id ?? null);
        setFilter((current) => keepUsefulFilter(enrichedGroups, current));
      }).catch((reason) => {
        if (sequence !== loadSequence.current) return;
        setVersionActionsAvailable(false);
        setError(getSafeApiErrorMessage(reason, lang));
      });
    } catch (nextError) {
      if (sequence === loadSequence.current) {
        setError(getSafeApiErrorMessage(nextError, lang));
        setErrorCanRetryLoad(true);
      }
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, [applyVersionGroups, draft.id, lang]);

  React.useEffect(() => {
    panelOpenRef.current = open;
  }, [open]);

  React.useEffect(() => {
    hasLoadedMedia.current = false;
    setUploads([]);
    setSelectedId(null);
    setLoading(false);
  }, [draft.id]);

  // The panel stays mounted while closed. Mark its first open as loading in a
  // layout effect so the empty state never flashes for one frame before the
  // request effect starts.
  React.useLayoutEffect(() => {
    if (open && !hasLoadedMedia.current) setLoading(true);
  }, [draft.id, open]);

  React.useEffect(() => {
    if (!open) return;
    setView("gallery");
    setReorderMode(false);
    setDraggingId(null);
    setReorderIds([]);
    reorderIdsRef.current = [];
    setConfirmAction(null);
    setVersionCandidate(null);
    setVersionCreateRequest(null);
    setVersionNotice(null);
    setUploadDropActive(false);
    uploadDragDepth.current = 0;
    setUndoOrderIds(null);
    setVersionUploadTargetId(null);
    setReplacingId(null);
    setEditingId(null);
    setNotice(null);
    void loadMedia();
  }, [loadMedia, open]);

  React.useEffect(() => {
    if (open) return;
    versionRefreshTimers.current.forEach((timer) => window.clearTimeout(timer));
    versionRefreshTimers.current = [];
  }, [open]);

  const notifyChanged = React.useCallback(async () => {
    await onChanged?.();
    window.dispatchEvent(new CustomEvent("reai-media-updated", { detail: { draftId: draft.id } }));
  }, [draft.id, onChanged]);

  const changeVisibleOrder = React.useCallback(async (nextVisible: MediaGroup[]) => {
    if (nextVisible.length < 2) return false;
    setBusy(true);
    setError(null);
    setErrorCanRetryLoad(false);
    const orderByAsset = new Map(nextVisible.map((group, index) => [group.id, index]));
    setUploads((current) => current.map((upload) => {
      const assetId = upload.logical_asset_id || `upload-${upload.id}`;
      const sortOrder = orderByAsset.get(assetId);
      return sortOrder === undefined ? upload : { ...upload, sort_order: sortOrder };
    }));
    try {
      const logicalItems = nextVisible.flatMap((group, sortOrder) => (
        group.active.logical_asset_id
          ? [{
              logical_asset_id: group.active.logical_asset_id,
              sort_order: sortOrder,
            }]
          : []
      ));
      const legacyUploads = nextVisible.flatMap((group, sortOrder) => (
        group.active.logical_asset_id ? [] : [{ id: group.active.id, sortOrder }]
      ));
      if (logicalItems.length) await updateDraftGallery(draft.id, logicalItems);
      if (legacyUploads.length) {
        await Promise.all(legacyUploads.map(({ id, sortOrder }) => (
          updateDraftUpload(id, { sort_order: sortOrder })
        )));
      }
      await loadMedia(false);
      await notifyChanged();
      return true;
    } catch (nextError) {
      await loadMedia(false);
      setError(getSafeApiErrorMessage(nextError, lang));
      setErrorCanRetryLoad(false);
      return false;
    } finally {
      setBusy(false);
    }
  }, [draft.id, lang, loadMedia, notifyChanged]);

  const makeCover = React.useCallback(async (group: MediaGroup) => {
    if (group.kind !== "image" || !group.visible) return;
    setSelectedId(group.id);
    const next = [group, ...visibleGroups.filter((candidate) => candidate.id !== group.id)];
    await changeVisibleOrder(next);
  }, [changeVisibleOrder, visibleGroups]);

  const updateReorderIds = React.useCallback((nextIds: string[]) => {
    reorderIdsRef.current = nextIds;
    setReorderIds(nextIds);
  }, []);

  const commitReorderIds = React.useCallback(async (nextIds: string[]) => {
    const byId = new Map(visibleGroups.map((group) => [group.id, group]));
    const nextGroups = nextIds.map((id) => byId.get(id)).filter((group): group is MediaGroup => Boolean(group));
    if (
      nextGroups.length !== visibleGroups.length
      || nextGroups.every((group, index) => group.id === visibleGroups[index]?.id)
    ) return;
    const previousIds = visibleGroups.map((group) => group.id);
    const saved = await changeVisibleOrder(nextGroups);
    if (saved) setUndoOrderIds(previousIds);
  }, [changeVisibleOrder, visibleGroups]);

  const undoReorder = React.useCallback(async () => {
    if (!undoOrderIds) return;
    const byId = new Map(visibleGroups.map((group) => [group.id, group]));
    const previousGroups = undoOrderIds.map((id) => byId.get(id)).filter((group): group is MediaGroup => Boolean(group));
    setUndoOrderIds(null);
    if (previousGroups.length !== visibleGroups.length) return;
    updateReorderIds(undoOrderIds);
    await changeVisibleOrder(previousGroups);
  }, [changeVisibleOrder, undoOrderIds, updateReorderIds, visibleGroups]);

  React.useEffect(() => {
    if (!undoOrderIds) return;
    const timeout = window.setTimeout(() => setUndoOrderIds(null), 7000);
    return () => window.clearTimeout(timeout);
  }, [undoOrderIds]);

  const previewReorderAt = React.useCallback((sourceId: string, targetId: string) => {
    if (sourceId === targetId) return;
    const current = reorderIdsRef.current;
    const sourceIndex = current.indexOf(sourceId);
    const targetIndex = current.indexOf(targetId);
    if (sourceIndex < 0 || targetIndex < 0) return;
    const next = [...current];
    const [moved] = next.splice(sourceIndex, 1);
    next.splice(targetIndex, 0, moved);
    updateReorderIds(next);
  }, [updateReorderIds]);

  const beginPointerReorder = React.useCallback((
    event: React.PointerEvent<HTMLButtonElement>,
    id: string,
  ) => {
    if (busy) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    pointerReorder.current = {
      id,
      pointerId: event.pointerId,
      startOrder: [...reorderIdsRef.current],
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
    setSelectedId(id);
    setDraggingId(id);
  }, [busy]);

  const previewReorderFromPoint = React.useCallback((sourceId: string, clientX: number, clientY: number) => {
    const cards = Array.from(
      contentRef.current?.querySelectorAll<HTMLElement>("[data-reorder-id]") ?? [],
    );
    let nearest: { id: string; distance: number } | null = null;
    for (const card of cards) {
      const id = card.dataset.reorderId;
      if (!id) continue;
      const bounds = card.getBoundingClientRect();
      const centerX = bounds.left + bounds.width / 2;
      const centerY = bounds.top + bounds.height / 2;
      const distance = Math.hypot(clientX - centerX, clientY - centerY);
      if (!nearest || distance < nearest.distance) nearest = { id, distance };
    }
    if (nearest) previewReorderAt(sourceId, nearest.id);
  }, [previewReorderAt]);

  const continuePointerReorder = React.useCallback((
    event: React.PointerEvent<HTMLButtonElement>,
  ) => {
    const session = pointerReorder.current;
    if (!session || session.pointerId !== event.pointerId) return;
    event.preventDefault();

    if (!session.moved) {
      session.moved = Math.hypot(event.clientX - session.startX, event.clientY - session.startY) >= 7;
    }
    if (session.moved) previewReorderFromPoint(session.id, event.clientX, event.clientY);

    const scroller = contentRef.current;
    if (!scroller) return;
    const bounds = scroller.getBoundingClientRect();
    const edge = Math.min(88, bounds.height * 0.16);
    if (event.clientY < bounds.top + edge) {
      const strength = (bounds.top + edge - event.clientY) / edge;
      scroller.scrollTop -= Math.max(4, Math.round(18 * strength));
    } else if (event.clientY > bounds.bottom - edge) {
      const strength = (event.clientY - (bounds.bottom - edge)) / edge;
      scroller.scrollTop += Math.max(4, Math.round(18 * strength));
    }
  }, [previewReorderFromPoint]);

  const finalizePointerReorder = React.useCallback((pointerId: number, cancelled: boolean) => {
    const session = pointerReorder.current;
    if (!session || session.pointerId !== pointerId) return;
    pointerReorder.current = null;
    setDraggingId(null);
    if (cancelled) {
      updateReorderIds(session.startOrder);
      return;
    }
    void commitReorderIds(reorderIdsRef.current);
  }, [commitReorderIds, updateReorderIds]);

  const finishPointerReorder = React.useCallback((
    event: React.PointerEvent<HTMLButtonElement>,
    cancelled: boolean,
  ) => {
    const session = pointerReorder.current;
    if (!session || session.pointerId !== event.pointerId) return;
    event.preventDefault();
    if (!session.moved) {
      session.moved = Math.hypot(event.clientX - session.startX, event.clientY - session.startY) >= 7;
    }
    if (!cancelled && session.moved) {
      previewReorderFromPoint(session.id, event.clientX, event.clientY);
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    finalizePointerReorder(event.pointerId, cancelled);
  }, [finalizePointerReorder, previewReorderFromPoint]);

  React.useEffect(() => {
    if (!draggingId) return;
    const handlePointerUp = (event: PointerEvent) => {
      const session = pointerReorder.current;
      if (!session || session.pointerId !== event.pointerId) return;
      if (!session.moved) {
        session.moved = Math.hypot(event.clientX - session.startX, event.clientY - session.startY) >= 7;
      }
      if (session.moved) previewReorderFromPoint(session.id, event.clientX, event.clientY);
      finalizePointerReorder(event.pointerId, false);
    };
    const handlePointerCancel = (event: PointerEvent) => {
      finalizePointerReorder(event.pointerId, true);
    };
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerCancel);
    return () => {
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerCancel);
    };
  }, [draggingId, finalizePointerReorder, previewReorderFromPoint]);

  const moveReorderItem = React.useCallback((id: string, offset: -1 | 1) => {
    const current = reorderIdsRef.current;
    const sourceIndex = current.indexOf(id);
    const targetIndex = sourceIndex + offset;
    if (sourceIndex < 0 || targetIndex < 0 || targetIndex >= current.length) return;
    const next = [...current];
    const [moved] = next.splice(sourceIndex, 1);
    next.splice(targetIndex, 0, moved);
    updateReorderIds(next);
    void commitReorderIds(next);
  }, [commitReorderIds, updateReorderIds]);

  React.useEffect(() => {
    if (!reorderMode || draggingId || busy) return;
    const persistedIds = visibleGroups.map((group) => group.id);
    if (
      persistedIds.length !== reorderIdsRef.current.length
      || persistedIds.some((id, index) => reorderIdsRef.current[index] !== id)
    ) {
      updateReorderIds(persistedIds);
    }
  }, [busy, draggingId, reorderMode, updateReorderIds, visibleGroups]);

  const hideSelected = React.useCallback(async () => {
    const targetGroup = confirmAction ? groups.find((group) => group.id === confirmAction.groupId) : null;
    if (!targetGroup || !targetGroup.active.logical_asset_id) return;
    setBusy(true);
    setError(null);
    setErrorCanRetryLoad(false);
    try {
      await updateDraftGallery(draft.id, [{
        logical_asset_id: targetGroup.active.logical_asset_id,
        visible: false,
      }]);
      setConfirmAction(null);
      await loadMedia(false);
      await notifyChanged();
    } catch (nextError) {
      setError(getSafeApiErrorMessage(nextError, lang));
      setErrorCanRetryLoad(false);
    } finally {
      setBusy(false);
    }
  }, [confirmAction, draft.id, groups, lang, loadMedia, notifyChanged]);

  const showGroup = React.useCallback(async (group: MediaGroup) => {
    if (!group.active.logical_asset_id) return;
    setSelectedId(group.id);
    setBusy(true);
    setError(null);
    setErrorCanRetryLoad(false);
    try {
      await updateDraftGallery(draft.id, [{
        logical_asset_id: group.active.logical_asset_id,
        visible: true,
      }]);
      await loadMedia(false);
      await notifyChanged();
    } catch (nextError) {
      setError(getSafeApiErrorMessage(nextError, lang));
      setErrorCanRetryLoad(false);
    } finally {
      setBusy(false);
    }
  }, [draft.id, lang, loadMedia, notifyChanged]);

  const uploadFiles = React.useCallback(async (chosen: File[]) => {
    if (!chosen.length) return;

    const files = chosen.slice(0, MAX_FILES_PER_PICK);
    const invalid = files.find((file) => !isPhotoFile(file));
    const oversized = files.find((file) => file.size > MAX_BROWSER_PHOTO_BYTES);
    if (invalid) {
      setError(t("draft.media.photosOnly", lang));
      setErrorCanRetryLoad(false);
      return;
    }
    if (oversized) {
      setError(t("draft.media.fileTooLarge", lang));
      setErrorCanRetryLoad(false);
      return;
    }
    if (chosen.length > MAX_FILES_PER_PICK) setError(t("draft.media.tooMany", lang));
    else setError(null);
    setErrorCanRetryLoad(false);

    const items = files.map((file, index) => {
      const url = URL.createObjectURL(file);
      pendingUrls.current.add(url);
      return { file, item: { id: `${Date.now()}-${index}-${file.name}`, name: `${t("draft.media.photo", lang)} ${index + 1}`, url, file, state: "queued" as const } };
    });
    setPending((current) => [...current, ...items.map(({ item }) => item)]);
    setBusy(true);
    let nextSortOrder = Math.max(-1, ...groups.map((group) => group.active.sort_order ?? 0)) + 1;
    let successCount = 0;
    let failureMessage: string | null = null;

    for (const { file, item } of items) {
      setPending((current) => current.map((pendingItem) => pendingItem.id === item.id ? { ...pendingItem, state: "uploading" } : pendingItem));
      try {
        await uploadDraftPhoto(draft.id, file, nextSortOrder++);
        successCount += 1;
        releasePendingUrl(item.url);
        setPending((current) => current.filter((pendingItem) => pendingItem.id !== item.id));
      } catch (nextError) {
        setPending((current) => current.map((pendingItem) => pendingItem.id === item.id ? { ...pendingItem, state: "failed" } : pendingItem));
        failureMessage = failureMessage ?? getSafeApiErrorMessage(nextError, lang, "draft.media.uploadFailed");
      }
    }

    if (successCount > 0) {
      setFilter("gallery");
      await loadMedia(false);
      await notifyChanged();
    }
    if (failureMessage) {
      setError(failureMessage);
      setErrorCanRetryLoad(false);
    }
    setBusy(false);
  }, [draft.id, groups, lang, loadMedia, notifyChanged, releasePendingUrl]);

  const handleFiles = React.useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const chosen = Array.from(event.target.files ?? []);
    event.target.value = "";
    void uploadFiles(chosen);
  }, [uploadFiles]);

  const requestVersionUpload = React.useCallback((group: MediaGroup) => {
    if (busy || group.kind !== "image" || !group.active.logical_asset_id) return;
    setSelectedId(group.id);
    setVersionUploadTargetId(group.id);
    setNotice(null);
    setError(null);
    window.requestAnimationFrame(() => versionFileInputRef.current?.click());
  }, [busy]);

  const handleVersionFile = React.useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";
    const target = groups.find((group) => group.id === versionUploadTargetId) ?? null;
    setVersionUploadTargetId(null);
    if (!file || !target || !target.active.logical_asset_id) return;
    if (!isPhotoFile(file)) {
      setError(t("draft.media.photosOnly", lang));
      setErrorCanRetryLoad(false);
      return;
    }
    if (file.size > MAX_BROWSER_PHOTO_BYTES) {
      setError(t("draft.media.fileTooLarge", lang));
      setErrorCanRetryLoad(false);
      return;
    }

    setBusy(true);
    setReplacingId(target.id);
    setError(null);
    setNotice(null);
    setErrorCanRetryLoad(false);
    try {
      await uploadDraftPhoto(draft.id, file, target.active.sort_order ?? 0, {
        logicalAssetId: target.active.logical_asset_id,
        supersedesId: target.active.id,
      });
      await loadMedia(false);
      setSelectedId(target.id);
      setNotice(t("draft.media.versionUploaded", lang));
      await notifyChanged();
    } catch (nextError) {
      setError(getSafeApiErrorMessage(nextError, lang, "draft.media.uploadFailed"));
      setErrorCanRetryLoad(false);
    } finally {
      setReplacingId(null);
      setBusy(false);
    }
  }, [draft.id, groups, lang, loadMedia, notifyChanged, versionUploadTargetId]);

  const retryPending = React.useCallback(async (item: PendingUpload) => {
    setBusy(true);
    setError(null);
    setErrorCanRetryLoad(false);
    setPending((current) => current.map((pendingItem) => pendingItem.id === item.id ? { ...pendingItem, state: "uploading" } : pendingItem));
    try {
      const sortOrder = Math.max(-1, ...groups.map((group) => group.active.sort_order ?? 0)) + 1;
      await uploadDraftPhoto(draft.id, item.file, sortOrder);
      releasePendingUrl(item.url);
      setPending((current) => current.filter((pendingItem) => pendingItem.id !== item.id));
      setFilter("gallery");
      await loadMedia(false);
      await notifyChanged();
    } catch (nextError) {
      setPending((current) => current.map((pendingItem) => pendingItem.id === item.id ? { ...pendingItem, state: "failed" } : pendingItem));
      setError(getSafeApiErrorMessage(nextError, lang, "draft.media.uploadFailed"));
      setErrorCanRetryLoad(false);
    } finally {
      setBusy(false);
    }
  }, [draft.id, groups, lang, loadMedia, notifyChanged, releasePendingUrl]);

  const retryLoad = () => void loadMedia();
  const requestUpload = () => fileInputRef.current?.click();
  const switchView = (nextView: MediaManagerView) => {
    setView(nextView);
    setReorderMode(false);
    setDraggingId(null);
    setReorderIds([]);
    reorderIdsRef.current = [];
    setConfirmAction(null);
    setVersionCandidate(null);
    setVersionCreateRequest(null);
    if (nextView !== "editor") setEditingId(null);
    window.requestAnimationFrame(() => contentRef.current?.scrollTo({ top: 0, behavior: "smooth" }));
  };

  const openImageEditor = (group: MediaGroup) => {
    if (busy || group.kind !== "image") return;
    setSelectedId(group.id);
    setEditingId(group.id);
    setError(null);
    setNotice(null);
    switchView("editor");
  };

  const watchEditedVersion = (
    logicalAssetId: string,
    previousVersionIds: Set<number>,
  ) => {
    const delays = [1200, 2200, 3600, 5600, 8200] as const;
    const check = async (index: number) => {
      if (!panelOpenRef.current) return;
      try {
        const result = await getMediaVersions(draft.id, { fresh: true });
        if (!panelOpenRef.current) return;
        applyVersionGroups(result.groups);
        const group = result.groups.find((candidate) => candidate.logical_asset_id === logicalAssetId);
        const created = group?.versions
          .filter((version) => !previousVersionIds.has(version.id))
          .sort((left, right) => right.version - left.version || right.id - left.id)[0];
        if (created) {
          versionRefreshTimers.current.forEach((timer) => window.clearTimeout(timer));
          versionRefreshTimers.current = [];
          setSelectedVersionIds((current) => ({ ...current, [logicalAssetId]: created.id }));
          setVersionNotice(null);
          await loadMedia(false);
          await notifyChanged();
          return;
        }
      } catch {
        // Keep polling through a transient media-version read failure. The
        // normal error surface remains available if the final refresh fails.
      }

      const nextIndex = index + 1;
      if (nextIndex >= delays.length) {
        setVersionNotice(null);
        return;
      }
      const timer = window.setTimeout(() => { void check(nextIndex); }, delays[nextIndex]);
      versionRefreshTimers.current = [timer];
    };
    const timer = window.setTimeout(() => { void check(0); }, delays[0]);
    versionRefreshTimers.current = [timer];
  };

  const saveEditedVersion = async (operations: ReaiImageEditOperations) => {
    if (!editingGroup) return;
    const logicalAssetId = editingGroup.active.logical_asset_id;
    const previousVersionIds = new Set(editingGroup.versions.map((version) => version.id));
    setVersionBusy(true);
    setError(null);
    setVersionNotice(t("reai.mediaCreating", lang));
    setErrorCanRetryLoad(false);
    versionRefreshTimers.current.forEach((timer) => window.clearTimeout(timer));
    versionRefreshTimers.current = [];
    try {
      await editDraftImage(draft.id, editingGroup.active.id, operations);
      setEditingId(null);
      setView("versions");
      await loadMedia(false);
      await notifyChanged();
      if (logicalAssetId) watchEditedVersion(logicalAssetId, previousVersionIds);
      else setVersionNotice(null);
    } catch (nextError) {
      setVersionNotice(null);
      setError(getSafeApiErrorMessage(nextError, lang));
      setErrorCanRetryLoad(false);
    } finally {
      setVersionBusy(false);
    }
  };

  const applyVersionAction = async () => {
    if (!versionCandidate) return;
    setVersionBusy(true);
    setError(null);
    setErrorCanRetryLoad(false);
    try {
      await manageMediaVersion(draft.id, versionCandidate.uploadId, versionCandidate.action);
      setVersionCandidate(null);
      await loadMedia(false);
      await notifyChanged();
    } catch (nextError) {
      setError(getSafeApiErrorMessage(nextError, lang));
      setErrorCanRetryLoad(false);
    } finally {
      setVersionBusy(false);
    }
  };

  const createVersion = async (
    logicalAssetId: string,
    uploadId: number,
    kind: MediaVersionCreateKind,
  ) => {
    setVersionBusy(true);
    setVersionCandidate(null);
    setVersionNotice(t("reai.mediaCreating", lang));
    setError(null);
    setErrorCanRetryLoad(false);
    versionRefreshTimers.current.forEach((timer) => window.clearTimeout(timer));
    versionRefreshTimers.current = [];
    try {
      let createdUploadId: number | null = null;
      if (kind === "enhance") {
        await editDraftImage(draft.id, uploadId, {
          auto_enhance: true,
          auto_white_balance: true,
          normalize_color_profile: true,
        });
      } else if (kind === "cleanplate") {
        const result = await cleanplateDraftImages(draft.id, {
          scope: "selected",
          upload_ids: [uploadId],
        });
        const created = result.results.find((item) => item.status === "completed");
        createdUploadId = created?.generated_upload_id ?? created?.cleaned_upload_id ?? null;
      } else {
        const result = await generateDraftImageHdr(draft.id, uploadId);
        createdUploadId = result.result.generated_upload_id ?? result.result.cleaned_upload_id ?? null;
      }

      if (createdUploadId) {
        setSelectedVersionIds((current) => ({ ...current, [logicalAssetId]: createdUploadId }));
      }
      await loadMedia(false);
      await notifyChanged();

      versionRefreshTimers.current = [1800, 5000, 12000].map((delay, index, delays) => window.setTimeout(() => {
        void loadMedia(false);
        if (index === delays.length - 1) setVersionNotice(null);
      }, delay));
    } catch (nextError) {
      setVersionNotice(null);
      setError(getSafeApiErrorMessage(nextError, lang));
      setErrorCanRetryLoad(false);
    } finally {
      setVersionBusy(false);
    }
  };

  const selectedLabel = selected
    ? mediaGroupLabel(selected.kind, Math.max(0, groups.findIndex((group) => group.id === selected.id)), lang)
    : "";

  const renderHideConfirmation = (className?: string) => confirmAction?.kind === "hide" ? (
    <div className={cn("floating-panel p-3.5", className)}>
      <div className="min-w-0">
        <p className="text-[13px] font-semibold">{t("draft.media.hideConfirm", lang)}</p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
          {t("draft.media.hideConfirmHint", lang)}
        </p>
        {confirmGroup ? (
          <p className="mt-1 truncate text-[10px] text-muted-foreground/75">
            {mediaGroupLabel(confirmGroup.kind, Math.max(0, groups.findIndex((group) => group.id === confirmGroup.id)), lang)}
          </p>
        ) : null}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button type="button" variant="outline" size="sm" className="w-full" onClick={() => setConfirmAction(null)} disabled={busy}>
          {t("common.cancel", lang)}
        </Button>
        <Button type="button" variant="default" size="sm" className="w-full" onClick={() => void hideSelected()} loading={busy}>
          <EyeClosedIcon size={15} /> {t("draft.media.hide", lang)}
        </Button>
      </div>
    </div>
  ) : null;

  return (
    <SidePanel
      open={open}
      onOpenChange={onOpenChange}
      title={t(view === "gallery" ? "draft.media.title" : view === "editor" ? "draft.media.editPhoto" : "reai.mediaVersions", lang)}
      description={draft.title || t("dashboard.untitled", lang)}
      headerMode="editor"
      className="sm:max-w-[920px]"
      contentClassName="media-manager-workspace"
      contentRef={contentRef}
      closeIcon={view === "gallery" ? "close" : "back"}
      onBack={view === "gallery" ? undefined : () => switchView("gallery")}
      lang={lang}
      headerAction={view === "gallery" ? (
        <Button type="button" variant="outline" size="sm" className="floating-control h-auto border-border/65 !bg-card/75 px-3 backdrop-blur-xl" onClick={requestUpload} disabled={busy}>
          <UploadIcon size={15} />
          <span className="hidden min-[390px]:inline">{t("draft.media.add", lang)}</span>
        </Button>
      ) : undefined}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif,image/tiff,image/bmp"
        multiple
        className="sr-only"
        onChange={(event) => void handleFiles(event)}
      />
      <input
        ref={versionFileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif,image/tiff,image/bmp"
        className="sr-only"
        onChange={(event) => void handleVersionFile(event)}
      />

      {view === "editor" ? (
        editingGroup ? (
          <>
            {error ? (
              <div role="alert" className="floating-panel-shape mb-4 flex items-start justify-between gap-3 border border-red-500/20 bg-red-500/[0.055] px-4 py-3 text-[11px] leading-relaxed text-red-800">
                <span>{error}</span>
                <Button type="button" variant="ghost" size="xs" onClick={() => setError(null)} className="shrink-0 text-red-900 hover:bg-red-500/10 hover:text-red-900">
                  {t("common.dismiss", lang)}
                </Button>
              </div>
            ) : null}
            <DraftImageEditor
              upload={editingGroup.active}
              label={mediaGroupLabel(editingGroup.kind, Math.max(0, groups.findIndex((group) => group.id === editingGroup.id)), lang)}
              lang={lang}
              busy={versionBusy}
              onCancel={() => switchView("gallery")}
              onSave={saveEditedVersion}
            />
          </>
        ) : (
          <div className="floating-panel-shape border border-dashed border-border/70 bg-card px-6 py-14 text-center">
            <ImageIcon size={23} className="mx-auto text-foreground/25" />
            <Button type="button" variant="outline" size="sm" className="mt-4" onClick={() => switchView("gallery")}>
              {t("common.back", lang)}
            </Button>
          </div>
        )
      ) : null}

      {view === "versions" ? (
        <div className="relative">
          {error ? (
            <div role="alert" className="floating-panel-shape mb-4 flex items-start justify-between gap-3 border border-red-500/20 bg-red-500/[0.055] px-4 py-3 text-[11px] leading-relaxed text-red-800">
              <span>{error}</span>
              <Button type="button" variant="ghost" size="xs" onClick={() => setError(null)} className="shrink-0 text-red-900 hover:bg-red-500/10 hover:text-red-900">
                {t("common.dismiss", lang)}
              </Button>
            </div>
          ) : null}

          {versionNotice ? (
            <div
              className="floating-capsule absolute right-0 top-0 z-20 flex max-w-[min(24rem,100%)] items-center gap-3 !bg-card/90 px-3.5 text-[11px] text-foreground/70"
              role="status"
              aria-live="polite"
            >
              <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-foreground/15 border-t-foreground/65" aria-hidden="true" />
              <span>{versionNotice}</span>
            </div>
          ) : null}

          {versionActionsAvailable === null ? (
            <div role="status" aria-label={t("draft.media.loading", lang)} aria-busy="true">
              <VersionManagerSkeleton />
            </div>
          ) : versionActionsAvailable === false ? (
            <div className="floating-panel-shape border border-dashed border-border/70 bg-card px-6 py-14 text-center">
              <VersionsIcon size={23} className="mx-auto text-foreground/25" />
              <Button type="button" variant="outline" size="sm" className="mt-4" onClick={() => void loadMedia(false)}>
                {t("common.tryAgain", lang)}
              </Button>
            </div>
          ) : orderedVersionGroups.length === 0 ? (
            <div className="floating-panel-shape border border-dashed border-border/70 bg-card px-6 py-14 text-center">
              <ImageIcon size={23} className="mx-auto text-foreground/25" />
              <p className="mt-3 text-[13px] font-semibold">{t("draft.versions.noMediaVersions", lang)}</p>
              <p className="mx-auto mt-1 max-w-sm text-[11px] leading-relaxed text-muted-foreground">{t("reai.mediaVersionsEmpty", lang)}</p>
            </div>
          ) : (
            <>
              <div className="grid items-start gap-4 min-[760px]:grid-cols-2">
                {orderedVersionGroups.map(({ group, index }) => (
                  <MediaVersionCard
                    key={group.logical_asset_id}
                    group={group}
                    groupIndex={index}
                    selectedId={selectedVersionIds[group.logical_asset_id]}
                    lang={lang}
                    dateFormat={undefined}
                    candidate={versionCandidate}
                    busy={versionBusy}
                    onSelect={(id) => {
                      setSelectedVersionIds((current) => ({ ...current, [group.logical_asset_id]: id }));
                      setVersionCandidate(null);
                      setVersionCreateRequest(null);
                    }}
                    onCandidate={(nextCandidate) => {
                      setVersionCandidate(nextCandidate);
                      setVersionCreateRequest(null);
                    }}
                    onCancel={() => setVersionCandidate(null)}
                    onConfirm={() => void applyVersionAction()}
                    onRequestCreate={setVersionCreateRequest}
                  />
                ))}
              </div>
              {versionCreateRequest ? (
                <MediaVersionCreationPanel
                  request={versionCreateRequest}
                  lang={lang}
                  busy={versionBusy}
                  onCancel={() => setVersionCreateRequest(null)}
                  onCreate={(kind) => {
                    const request = versionCreateRequest;
                    setVersionCreateRequest(null);
                    void createVersion(request.logicalAssetId, request.uploadId, kind);
                  }}
                />
              ) : null}
            </>
          )}
        </div>
      ) : null}

      <div
        className={cn("relative min-h-full", view !== "gallery" && "hidden")}
        onDragEnter={(event) => {
          if (!Array.from(event.dataTransfer.types).includes("Files")) return;
          event.preventDefault();
          uploadDragDepth.current += 1;
          setUploadDropActive(true);
        }}
        onDragOver={(event) => {
          if (!Array.from(event.dataTransfer.types).includes("Files")) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }}
        onDragLeave={(event) => {
          if (!Array.from(event.dataTransfer.types).includes("Files")) return;
          event.preventDefault();
          uploadDragDepth.current = Math.max(0, uploadDragDepth.current - 1);
          if (uploadDragDepth.current === 0) setUploadDropActive(false);
        }}
        onDrop={(event) => {
          if (!Array.from(event.dataTransfer.types).includes("Files")) return;
          event.preventDefault();
          uploadDragDepth.current = 0;
          setUploadDropActive(false);
          void uploadFiles(Array.from(event.dataTransfer.files));
        }}
        onKeyDown={(event) => {
          if (event.key !== "Escape" || !reorderMode) return;
          event.preventDefault();
          event.stopPropagation();
          setDraggingId(null);
          setReorderMode(false);
        }}
      >
      {uploadDropActive ? (
        <div className="floating-panel-shape absolute inset-0 z-30 flex min-h-[55vh] items-center justify-center border-2 border-dashed border-foreground/35 bg-background/92 backdrop-blur-sm">
          <div className="text-center">
            <span className="floating-capsule floating-icon-button mx-auto flex items-center justify-center border text-foreground/65">
              <UploadIcon size={20} />
            </span>
            <p className="mt-3 text-[13px] font-semibold">{t("draft.media.dropPhotos", lang)}</p>
          </div>
        </div>
      ) : null}
      {error ? (
        <div role="alert" className="floating-panel-shape mb-4 flex items-start justify-between gap-3 border border-red-500/20 bg-red-500/[0.055] px-4 py-3 text-[11px] leading-relaxed text-red-800">
          <span>{error}</span>
          {loading ? null : (
            <Button type="button" variant="ghost" size="xs" onClick={errorCanRetryLoad ? retryLoad : () => setError(null)} className="shrink-0 text-red-900 hover:bg-red-500/10 hover:text-red-900">
              {t(errorCanRetryLoad ? "common.tryAgain" : "common.dismiss", lang)}
            </Button>
          )}
        </div>
      ) : null}
      {notice ? (
        <div role="status" aria-live="polite" className="floating-panel-shape mb-4 flex items-center justify-between gap-3 border border-emerald-600/15 bg-emerald-500/[0.055] px-4 py-3 text-[11px] text-foreground/75">
          <span className="inline-flex min-w-0 items-center gap-2">
            <CheckIcon size={14} className="shrink-0 text-emerald-700" />
            <span>{notice}</span>
          </span>
          <Button type="button" variant="ghost" size="xs" onClick={() => setNotice(null)} className="shrink-0">
            {t("common.dismiss", lang)}
          </Button>
        </div>
      ) : null}

      <div className="mb-3 flex items-center justify-between gap-3">
        <Tabs
          value={filter}
          onValueChange={(value) => {
            const nextFilter = value as MediaFilter;
            setFilter(nextFilter);
            setReorderMode(false);
            const nextGroups = nextFilter === "gallery" ? visibleGroups : hiddenGroups;
            setSelectedId(nextGroups[0]?.id ?? null);
            setConfirmAction(null);
          }}
          className="min-w-0 flex-1 sm:max-w-[330px]"
        >
          <TabsList className="floating-toolbar grid h-auto w-full grid-cols-2 p-1" aria-label={t("draft.media.filter", lang)}>
          {(["gallery", "hidden"] as const).map((value) => {
            const count = value === "gallery" ? visibleGroups.length : hiddenGroups.length;
            return (
              <TabsTrigger
                key={value}
                value={value}
                className="floating-control-sm h-auto w-full px-3 text-[11px] data-[state=active]:bg-foreground data-[state=active]:text-background data-[state=active]:shadow-control"
              >
                {t(`draft.media.${value}` as LocaleKey, lang)}
                <span className={cn("ml-1.5 tabular-nums", filter === value ? "text-background/60" : "text-foreground/35")}>{count}</span>
              </TabsTrigger>
            );
          })}
          </TabsList>
        </Tabs>
        <div className="grid shrink-0 grid-cols-2 items-center gap-1">
          <Button
            type="button"
            variant={reorderMode ? "default" : "ghost"}
            size="sm"
            className={cn(
              "pen-touch-target px-3",
              (filter !== "gallery" || visibleGroups.length <= 1) && "pointer-events-none invisible",
            )}
            onClick={() => {
              if (!reorderMode) {
                updateReorderIds(visibleGroups.map((group) => group.id));
                setReorderMode(true);
              } else {
                setReorderMode(false);
              }
              setDraggingId(null);
            }}
            aria-hidden={filter !== "gallery" || visibleGroups.length <= 1}
            tabIndex={filter === "gallery" && visibleGroups.length > 1 ? 0 : -1}
            aria-pressed={reorderMode}
            title={`${t(reorderMode ? "draft.media.finishReorder" : "draft.media.reorder", lang)} (A)`}
          >
            {reorderMode ? <CheckIcon size={15} /> : <DragHandleIcon size={15} />}
            <span className="hidden min-[520px]:inline">{t(reorderMode ? "draft.media.finishReorder" : "draft.media.reorder", lang)}</span>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="pen-touch-target px-3"
            onClick={() => switchView("versions")}
            aria-label={t("draft.media.versions", lang)}
            title={`${t("draft.media.versions", lang)} (V)`}
          >
            <VersionsIcon size={15} />
            <span className="hidden min-[620px]:inline">{t("draft.media.versions", lang)}</span>
          </Button>
        </div>
      </div>

      {undoOrderIds ? (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="pointer-events-none absolute inset-x-0 top-14 z-20 flex justify-end"
          role="status"
        >
          <div className="floating-capsule pointer-events-auto flex w-full max-w-sm items-center justify-between gap-3 border !bg-card/90 pl-3 pr-1 text-foreground shadow-control">
            <span className="text-[10px] font-medium">{t("draft.media.orderSaved", lang)}</span>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => void undoReorder()}
              disabled={busy}
              className="px-2.5 text-[10px]"
            >
              {t("draft.media.undoOrder", lang)}
            </Button>
          </div>
        </motion.div>
      ) : null}

      {filter === "hidden" || reorderMode ? (
        <div className="floating-panel-shape mb-4 flex items-center gap-3 border border-border/65 bg-card px-3 py-2.5 shadow-control">
          <span className="floating-capsule floating-icon-button-sm text-foreground/60">
            {filter === "hidden" ? <EyeClosedIcon size={15} /> : <DragHandleIcon size={15} />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold text-foreground/80">
              {t(filter === "hidden" ? "draft.media.hidden" : "draft.media.galleryOrder", lang)}
            </p>
            <p className="mt-0.5 max-w-xl text-[10px] leading-relaxed text-muted-foreground">
              {t(filter === "hidden" ? "draft.media.hiddenHint" : "draft.media.reorderHint", lang)}
            </p>
          </div>
          <span
            role="status"
            className={cn("shrink-0 text-[10px] font-medium text-muted-foreground", !busy && "invisible")}
            aria-hidden={!busy}
          >
            {t("draft.media.saving", lang)}
          </span>
        </div>
      ) : null}

      {reorderMode && selected && reorderSelectedIndex >= 0 ? (
        <div className="floating-panel mb-4 flex flex-col gap-3 p-3 min-[520px]:flex-row min-[520px]:items-center min-[520px]:justify-between">
          <div className="min-w-0">
            <p className="truncate text-[11px] font-semibold text-foreground/80" title={selectedLabel}>{selectedLabel}</p>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              {t("draft.media.position", lang)
                .replace("{current}", String(reorderSelectedIndex + 1))
                .replace("{total}", String(activeReorderIds.length))}
            </p>
          </div>
          <div className="grid shrink-0 grid-cols-2 gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => moveReorderItem(selected.id, -1)}
              disabled={busy || reorderSelectedIndex === 0}
              className="pen-touch-target min-h-11 min-w-0 px-3"
            >
              <ArrowLeftIcon size={14} />
              <span>{t("draft.media.moveEarlier", lang)}</span>
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => moveReorderItem(selected.id, 1)}
              disabled={busy || reorderSelectedIndex === activeReorderIds.length - 1}
              className="pen-touch-target min-h-11 min-w-0 px-3"
            >
              <span>{t("draft.media.moveLater", lang)}</span>
              <ArrowRightIcon size={14} />
            </Button>
          </div>
        </div>
      ) : null}

      {renderHideConfirmation("media-manager-mobile-confirm mb-4")}

      {loading ? (
        <div role="status" aria-label={t("draft.media.loading", lang)} aria-busy="true">
          <MediaManagerSkeleton />
        </div>
      ) : groups.length === 0 && pending.length === 0 ? (
        <div className="flex min-h-[54vh] flex-col items-center justify-center px-6 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-full border border-border/70 bg-card text-foreground/30 shadow-control">
            <ImageIcon size={25} />
          </span>
          <h3 className="mt-4 text-[16px] font-semibold tracking-[-0.02em]">{t("draft.media.emptyTitle", lang)}</h3>
          <p className="mt-1 max-w-sm text-[12px] leading-relaxed text-muted-foreground">{t("draft.media.emptyBody", lang)}</p>
          <Button type="button" className="mt-5" onClick={requestUpload} disabled={busy}>
            <UploadIcon size={16} /> {t("draft.media.addPhotos", lang)}
          </Button>
        </div>
      ) : filter === "hidden" ? (
        hiddenGroups.length > 0 ? (
          <section className="grid gap-2.5" aria-label={t("draft.media.hidden", lang)}>
            {hiddenGroups.map((group, index) => {
              const label = mediaGroupLabel(group.kind, index, lang);
              const restoreDisabled = busy || !group.active.logical_asset_id;
              return (
                <article
                  key={group.id}
                  className="floating-panel flex min-w-0 flex-col overflow-hidden border-border/65 sm:flex-row sm:items-center"
                >
                  <div className="relative aspect-[16/9] w-full shrink-0 overflow-hidden bg-surface-subtle sm:h-24 sm:w-40 sm:aspect-auto">
                    <MediaVisual upload={group.active} alt={label} className="opacity-80" />
                    <StatusPill tone="strong" className="absolute left-2 top-2 border-white/15 bg-black/60 text-[9px] text-white backdrop-blur-xl">
                      <EyeClosedIcon size={11} /> {t("draft.media.hidden", lang)}
                    </StatusPill>
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col gap-3 p-3.5 sm:flex-row sm:items-center sm:justify-between sm:gap-5 sm:px-4 sm:py-3">
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-semibold text-foreground/85" title={label}>{label}</p>
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
                        <span>{group.kind === "video" ? t("draft.media.video", lang) : t("draft.media.photo", lang)}</span>
                        {group.active.file_size ? <span>{formatBytes(group.active.file_size, lang)}</span> : null}
                        {group.active.uploaded_at ? <span>{formatDate(group.active.uploaded_at, undefined, lang)}</span> : null}
                        {group.versions.length > 1 ? <span>{group.versions.length}× {t("draft.media.versions", lang)}</span> : null}
                      </div>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => void showGroup(group)}
                      disabled={restoreDisabled}
                      className="min-h-11 w-full shrink-0 px-4 sm:w-auto"
                    >
                      <EyeOpenIcon size={14} /> {t("draft.media.restoreToGallery", lang)}
                    </Button>
                  </div>
                </article>
              );
            })}
          </section>
        ) : (
          <div className="py-16 text-center text-muted-foreground">
            <EyeOpenIcon size={22} className="mx-auto text-foreground/25" />
            <p className="mt-3 text-[12px] font-medium">{t("draft.media.noHidden", lang)}</p>
          </div>
        )
      ) : (
        <div className={cn("media-manager-layout", reorderMode && "media-manager-layout-reorder")}>
          <section className="min-w-0" aria-label={t("draft.media.title", lang)}>
            {reorderMode ? (
              <div className="media-manager-grid">
                {activeReorderIds.map((groupId, index) => {
                  const group = visibleGroups.find((candidate) => candidate.id === groupId);
                  if (!group) return null;
                  const label = mediaGroupLabel(group.kind, index, lang);
                  const isDragging = draggingId === group.id;
                  const isSelected = selected?.id === group.id;
                  return (
                    <motion.article
                      key={group.id}
                      data-reorder-id={group.id}
                      layout
                      transition={{ layout: { duration: 0.18, ease: "easeOut" } }}
                      animate={isDragging ? { scale: 1.015 } : { scale: 1 }}
                      className={cn(
                        "floating-panel group relative min-w-0 overflow-hidden transition-[border-color,box-shadow,opacity]",
                        isDragging
                          ? "z-10 border-foreground/55 opacity-90 shadow-card ring-2 ring-foreground/10"
                          : isSelected
                            ? "border-foreground ring-2 ring-foreground/10"
                            : "border-border/70 hover:border-foreground/40",
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => setSelectedId(group.id)}
                        onFocus={() => setSelectedId(group.id)}
                        onKeyDown={(event) => {
                          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                          event.preventDefault();
                          void moveReorderItem(group.id, event.key === "ArrowLeft" ? -1 : 1);
                        }}
                        className="relative block aspect-[16/10] w-full overflow-hidden bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                        aria-label={label}
                        aria-pressed={isSelected}
                        aria-keyshortcuts="ArrowLeft ArrowRight"
                      >
                        <MediaVisual upload={group.active} alt="" />
                      </button>
                      {group.id === coverId ? (
                        <StatusPill tone="strong" className="pointer-events-none absolute left-2 top-2 border-white/15 bg-black/65 px-2 text-[9px] text-white backdrop-blur-xl">
                          <StarIcon size={10} /> 1 · {t("draft.media.cover", lang)}
                        </StatusPill>
                      ) : (
                        <StatusPill className="glass-chip pointer-events-none absolute left-2 top-2 min-w-7 justify-center px-2 text-[10px] tabular-nums">
                          {index + 1}
                        </StatusPill>
                      )}
                      <button
                        type="button"
                        onPointerDown={(event) => beginPointerReorder(event, group.id)}
                        onPointerMove={continuePointerReorder}
                        onPointerUp={(event) => finishPointerReorder(event, false)}
                        onPointerCancel={(event) => finishPointerReorder(event, true)}
                        onLostPointerCapture={(event) => finishPointerReorder(event, false)}
                        onContextMenu={(event) => event.preventDefault()}
                        disabled={busy}
                        className="floating-capsule floating-icon-button pen-touch-target absolute right-2 top-2 touch-none select-none text-muted-foreground opacity-90 hover:scale-105 hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing active:scale-95 disabled:opacity-30"
                        aria-label={t("draft.media.dragToMove", lang)}
                        title={t("draft.media.dragToMove", lang)}
                      >
                        <DragHandleIcon size={16} />
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelectedId(group.id)}
                        className="block w-full truncate border-t border-border/55 px-3 py-2.5 text-left text-[10px] font-semibold text-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                        title={label}
                      >
                        {label}
                      </button>
                    </motion.article>
                  );
                })}
              </div>
            ) : (
              <>
            <div className="media-manager-grid">
              {filter === "gallery" ? pending.map((item) => (
                <article key={item.id} className="floating-panel overflow-hidden">
                  <div className="relative aspect-[16/9] overflow-hidden bg-surface-subtle">
                    <img src={item.url} alt={item.name} className="h-full w-full object-cover" />
                    {item.state === "failed" ? (
                      <button
                        type="button"
                        onClick={() => void retryPending(item)}
                        disabled={busy}
                        className="absolute inset-x-2 bottom-2 min-h-10 rounded-full bg-white/92 px-2 py-1.5 text-center text-[10px] font-semibold text-red-700 shadow-control backdrop-blur-xl disabled:opacity-55"
                      >
                        {t("common.tryAgain", lang)}
                      </button>
                    ) : <LoadingMark label={t(item.state === "queued" ? "draft.media.queued" : "draft.media.uploading", lang)} />}
                  </div>
                  <p className="truncate px-3 py-2.5 text-[10px] font-medium text-foreground/65">{item.name}</p>
                </article>
              )) : null}

              {filteredGroups.map((group, index) => {
                const isSelected = selected?.id === group.id;
                const isCover = group.id === coverId;
                const visibleIndex = visibleGroups.findIndex((candidate) => candidate.id === group.id);
                const label = mediaGroupLabel(group.kind, Math.max(0, visibleIndex), lang);
                const galleryActionDisabled = busy || !group.active.logical_asset_id;
                return (
                  <motion.article
                    key={group.id}
                    layout
                    transition={{ layout: { duration: 0.18, ease: "easeOut" } }}
                    className={cn(
                      "floating-panel min-w-0 overflow-hidden transition",
                      isSelected
                        ? "border-foreground ring-1 ring-foreground/15"
                        : isCover
                          ? "border-foreground/35 ring-1 ring-foreground/10"
                          : "border-border/65 hover:border-foreground/30",
                    )}
                  >
                    <div className="relative aspect-[16/9] overflow-hidden bg-surface-subtle">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedId(group.id);
                          if (confirmAction?.groupId !== group.id) setConfirmAction(null);
                        }}
                        onFocus={() => setSelectedId(group.id)}
                        onKeyDown={(event) => {
                          let nextIndex: number | null = null;
                          if (event.key === "ArrowRight") nextIndex = Math.min(filteredGroups.length - 1, index + 1);
                          else if (event.key === "ArrowLeft") nextIndex = Math.max(0, index - 1);
                          else if (event.key === "Home") nextIndex = 0;
                          else if (event.key === "End") nextIndex = filteredGroups.length - 1;
                          else if (event.key.toLowerCase() === "a" && filter === "gallery" && visibleGroups.length > 1) {
                            event.preventDefault();
                            updateReorderIds(visibleGroups.map((candidate) => candidate.id));
                            setReorderMode(true);
                            return;
                          } else if (event.key.toLowerCase() === "v") {
                            event.preventDefault();
                            switchView("versions");
                            return;
                          }
                          if (nextIndex == null || nextIndex === index) return;
                          event.preventDefault();
                          setSelectedId(filteredGroups[nextIndex]?.id ?? null);
                          window.requestAnimationFrame(() => {
                            const nextCard = contentRef.current?.querySelector<HTMLButtonElement>(`[data-media-card-index="${nextIndex}"]`);
                            nextCard?.focus({ preventScroll: false });
                          });
                        }}
                        data-media-card-index={index}
                        aria-keyshortcuts="ArrowLeft ArrowRight Home End A V"
                        className="absolute inset-0 h-full w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                        aria-pressed={isSelected}
                        aria-label={`${label}, ${index + 1}`}
                      >
                        <MediaVisual upload={group.active} alt="" className={cn(!group.visible && "opacity-55 grayscale-[20%]")} />
                      </button>

                      <span className="pointer-events-none absolute left-2 top-2 flex flex-wrap gap-1.5">
                        {isCover ? (
                          <StatusPill tone="strong" className="border-white/15 bg-black/65 text-[9px] text-white backdrop-blur-xl">
                            <StarIcon size={11} /> 1 · {t("draft.media.cover", lang)}
                          </StatusPill>
                        ) : null}
                        {!group.visible ? (
                          <StatusPill tone="strong" className="border-white/15 bg-black/65 text-[9px] text-white">
                            <EyeClosedIcon size={11} /> {t("draft.media.hidden", lang)}
                          </StatusPill>
                        ) : null}
                      </span>
                      {group.visible && !isCover ? (
                        <StatusPill className="glass-chip pointer-events-none absolute right-2 top-2 min-w-7 justify-center px-2 text-[10px] tabular-nums">
                          {visibleIndex + 1}
                        </StatusPill>
                      ) : null}

                    </div>

                    <div className="p-2.5">
                      <div className="media-manager-card-meta mb-2 flex min-w-0 items-center justify-between gap-2 px-0.5">
                        <p className="truncate text-[11px] font-semibold text-foreground/75" title={label}>{label}</p>
                        <span className="flex shrink-0 items-center gap-1.5 text-[9px] text-muted-foreground">
                          {group.kind === "video" ? <VideoIcon size={12} /> : group.versions.length > 1 ? <span>{group.versions.length}×</span> : null}
                        </span>
                      </div>
                      {isSelected && group.kind === "image" ? group.visible ? (
                        <div className="media-manager-card-actions grid grid-cols-2 gap-1.5">
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            onClick={() => openImageEditor(group)}
                            disabled={busy}
                            className="min-h-10 w-full px-2 text-[10px]"
                          >
                            <EditIcon size={13} /> {t("draft.media.editPhoto", lang)}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            onClick={() => requestVersionUpload(group)}
                            disabled={galleryActionDisabled}
                            className="min-h-10 w-full px-2 text-[10px]"
                          >
                            <UploadIcon size={13} /> {t("draft.media.uploadVersion", lang)}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant={isCover ? "default" : "secondary"}
                            onClick={() => void makeCover(group)}
                            disabled={busy || isCover}
                            className={cn(
                              "min-h-10 w-full px-2 text-[10px] disabled:opacity-100",
                              isCover && "bg-foreground text-background",
                            )}
                            aria-label={isCover ? t("draft.media.cover", lang) : t("draft.media.setCover", lang)}
                          >
                            <StarIcon size={13} /> {t(isCover ? "draft.media.cover" : "draft.media.setCoverShort", lang)}
                          </Button>
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={() => {
                              setSelectedId(group.id);
                              setConfirmAction({ kind: "hide", groupId: group.id });
                            }}
                            disabled={galleryActionDisabled}
                            className="min-h-10 w-full px-2 text-[10px]"
                            aria-label={t("draft.media.hideFromGallery", lang)}
                            title={t("draft.media.hideFromGallery", lang)}
                          >
                            <EyeClosedIcon size={13} /> {t("draft.media.hide", lang)}
                          </Button>
                        </div>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => void showGroup(group)}
                          disabled={galleryActionDisabled}
                          className="media-manager-card-actions min-h-10 w-full px-3 text-[11px]"
                        >
                          <EyeOpenIcon size={14} /> {t("draft.media.restoreToGallery", lang)}
                        </Button>
                      ) : null}
                    </div>
                  </motion.article>
                );
              })}

              {filter === "gallery" ? (
                <button
                  type="button"
                  onClick={requestUpload}
                  disabled={busy}
                  className="floating-panel group overflow-hidden border-dashed text-muted-foreground transition-colors hover:border-foreground/35 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                >
                  <span className="flex aspect-[16/9] items-center justify-center bg-surface-subtle/65 transition-colors group-hover:bg-surface-subtle">
                    <span className="floating-capsule floating-icon-button"><UploadIcon size={17} /></span>
                  </span>
                  <span className="block px-3 py-2.5 text-left text-[11px] font-semibold">{t("draft.media.addPhotos", lang)}</span>
                </button>
              ) : null}
            </div>

            {filteredGroups.length === 0 && pending.length === 0 ? (
              <div className="py-16 text-center text-muted-foreground">
                <ImageIcon size={22} className="mx-auto text-foreground/25" />
                <p className="mt-3 text-[12px] font-medium">{t("draft.media.noVisible", lang)}</p>
              </div>
            ) : null}
              </>
            )}
          </section>

          <aside className="floating-panel media-manager-inspector sticky top-0 min-w-0 overflow-hidden">
            {selected ? (
              <>
                <div className="relative aspect-[16/9] overflow-hidden bg-black/[0.035]">
                  <motion.div
                    key={selected.id}
                    initial={{ opacity: 0.45, scale: 1.01 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.18 }}
                    className="absolute inset-0"
                  >
                    <MediaVisual upload={selected.active} alt={selectedLabel} className="object-contain" />
                  </motion.div>
                  {replacingId === selected.id ? <LoadingMark label={t("draft.media.uploadingVersion", lang)} /> : null}
                  {selected.id === coverId ? (
                    <StatusPill tone="strong" className="absolute left-3 top-3 border-white/15 bg-black/55 text-[9px] text-white backdrop-blur-xl">
                      <StarIcon size={11} /> {t("draft.media.cover", lang)}
                    </StatusPill>
                  ) : null}
                </div>
                <div className="p-4">
                  <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    {selected.id === coverId
                      ? t("draft.media.cover", lang)
                      : selected.visible
                        ? t("draft.media.position", lang)
                          .replace("{current}", String(visibleGroups.findIndex((group) => group.id === selected.id) + 1))
                          .replace("{total}", String(visibleGroups.length))
                        : t("draft.media.hidden", lang)}
                  </p>
                  <p className="truncate text-[13px] font-semibold" title={selectedLabel}>{selectedLabel}</p>
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
                    <span>{selected.kind === "video" ? t("draft.media.video", lang) : t("draft.media.photo", lang)}</span>
                    {selected.active.file_size ? <span>{formatBytes(selected.active.file_size, lang)}</span> : null}
                    {selected.active.uploaded_at ? <span>{formatDate(selected.active.uploaded_at, undefined, lang)}</span> : null}
                  </div>
                  {selected.id === coverId ? (
                    <p className="mt-3 text-[10px] leading-relaxed text-muted-foreground">
                      {t("draft.media.primaryPhotoHint", lang)}
                    </p>
                  ) : null}
                  {selected.kind === "image" ? (
                    <div className="mt-4 grid grid-cols-2 gap-2">
                      <Button type="button" variant="secondary" className="w-full px-2.5 text-[10px]" onClick={() => openImageEditor(selected)} disabled={busy}>
                        <EditIcon size={14} /> {t("draft.media.editPhoto", lang)}
                      </Button>
                      <Button type="button" variant="secondary" className="w-full px-2.5 text-[10px]" onClick={() => requestVersionUpload(selected)} disabled={busy || !selected.active.logical_asset_id} title={t("draft.media.uploadVersionHint", lang)}>
                        <UploadIcon size={14} /> {t("draft.media.uploadVersion", lang)}
                      </Button>
                    </div>
                  ) : null}
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => switchView("versions")}
                    className="mt-2 w-full justify-between !bg-card/65 px-3.5 text-left backdrop-blur-xl hover:!bg-card/85"
                  >
                    <span className="inline-flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground">
                      <VersionsIcon size={13} /> {t("draft.media.versions", lang)}
                    </span>
                    <span className="text-[12px] font-semibold tabular-nums">{selected.versions.length}</span>
                  </Button>
                  <div className="mt-4 space-y-2">
                    {selected.visible && selected.kind === "image" && selected.id !== coverId ? (
                      <Button type="button" variant="outline" className="w-full" onClick={() => void makeCover(selected)} disabled={busy}>
                        <StarIcon size={15} /> {t("draft.media.setCover", lang)}
                      </Button>
                    ) : null}
                    {selected.kind === "image" && selected.visible ? (
                      <Button type="button" variant="outline" className="w-full" onClick={() => setConfirmAction({ kind: "hide", groupId: selected.id })} disabled={busy || !selected.active.logical_asset_id}>
                        <EyeClosedIcon size={15} /> {t("draft.media.hideFromGallery", lang)}
                      </Button>
                    ) : selected.kind === "image" ? (
                      <Button type="button" className="w-full" onClick={() => void showGroup(selected)} disabled={busy || !selected.active.logical_asset_id}>
                        <EyeOpenIcon size={15} /> {t("draft.media.restoreToGallery", lang)}
                      </Button>
                    ) : null}
                  </div>
                  {renderHideConfirmation("mt-4")}
                </div>
              </>
            ) : null}
          </aside>
        </div>
      )}
      </div>
    </SidePanel>
  );
}

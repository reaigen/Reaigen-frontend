"use client";
/* eslint-disable @next/next/no-img-element -- owner media uses short-lived signed URLs */

import * as React from "react";
import { motion } from "framer-motion";
import {
  cleanplateDraftImages,
  editDraftImage,
  generateDraftImageHdr,
  getDraftService,
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
import { mediaProxyUrl } from "../lib/image-preview";
import type { DraftDetailItem, DraftUpload } from "../lib/tour-types";
import { Button } from "../lib/ui/button";
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
import { Thumbnail } from "./thumbnail";
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
  if (groups.length === 0) return "gallery";
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
  return (
    <Thumbnail
      src={mediaProxyUrl(upload.id, 1280)}
      fallbackSrc={upload.file_url}
      alt={alt}
      className={cn("absolute inset-0 h-full w-full object-cover", className)}
    />
  );
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
    <div className="flex min-h-[18rem] items-start justify-center pt-10" aria-hidden="true">
      <span className="inline-flex h-11 items-center gap-2.5 rounded-full border border-border/65 bg-card px-4 text-[11px] font-semibold text-muted-foreground">
        <span className="h-3.5 w-3.5 animate-spin rounded-full border border-foreground/18 border-t-foreground/60 motion-reduce:animate-none" />
      </span>
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

export interface DraftMediaManagerHandle {
  requestUpload: () => void;
}

export const DraftMediaManager = React.forwardRef<DraftMediaManagerHandle, {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draft: DraftDetailItem;
  lang: string;
  onChanged?: () => void | Promise<void>;
}>(function DraftMediaManager({
  open,
  onOpenChange,
  draft,
  lang,
  onChanged,
}, ref) {
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
  // The job's own words, kept beside the plain-language error rather than glued
  // onto it: a storage key wrapped over four red lines buries the sentence that
  // actually tells someone what happened.
  const [errorDetail, setErrorDetail] = React.useState<string | null>(null);
  const [errorCanRetryLoad, setErrorCanRetryLoad] = React.useState(false);
  const [confirmAction, setConfirmAction] = React.useState<ConfirmAction>(null);
  const [view, setView] = React.useState<MediaManagerView>("gallery");
  const [versionGroups, setVersionGroups] = React.useState<MediaVersionGroup[]>([]);
  const [selectedVersionIds, setSelectedVersionIds] = React.useState<Record<string, number>>({});
  const [versionCandidate, setVersionCandidate] = React.useState<MediaAction>(null);
  const [versionCreateRequest, setVersionCreateRequest] = React.useState<MediaVersionCreateRequest | null>(null);
  const [versionBusy, setVersionBusy] = React.useState(false);
  // `pending` drives the spinner. A notice that outlives the work it describes
  // needs to stop spinning, or "still running" reads as "still checking".
  const [versionNotice, setVersionNotice] = React.useState<{ text: string; pending: boolean } | null>(null);
  const [uploadDropActive, setUploadDropActive] = React.useState(false);
  const [undoOrderIds, setUndoOrderIds] = React.useState<string[] | null>(null);
  const [versionUploadTargetId, setVersionUploadTargetId] = React.useState<string | null>(null);
  const [, setReplacingId] = React.useState<string | null>(null);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  // Completed actions acknowledge themselves briefly and then leave the
  // workspace. Requiring a separate dismiss click made every upload leave a
  // stale green strip above the gallery for the rest of the session.
  React.useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 3_200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  React.useEffect(() => {
    if (!undoOrderIds) return;
    const timer = window.setTimeout(() => setUndoOrderIds(null), 6_000);
    return () => window.clearTimeout(timer);
  }, [undoOrderIds]);

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
    setFilter("gallery");
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
    // Pending cards only render in the gallery, which is also where these
    // photos land. Switch before the first request rather than after the last
    // one, so uploading from the hidden tab shows the work instead of nothing.
    setFilter("gallery");
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
    if (!chosen.length) return;
    setFilter("gallery");
    if (!panelOpenRef.current) {
      panelOpenRef.current = true;
      onOpenChange(true);
    }
    void uploadFiles(chosen);
  }, [onOpenChange, uploadFiles]);

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
  const requestUpload = React.useCallback(() => {
    setFilter("gallery");
    fileInputRef.current?.click();
  }, []);
  React.useImperativeHandle(ref, () => ({ requestUpload }), [requestUpload]);
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

  // One owner: the detail only ever describes the error beside it, so it lives
  // and dies with it instead of being cleared at a dozen `setError(null)` sites.
  React.useEffect(() => {
    if (!error) setErrorDetail(null);
  }, [error]);

  /** The job's own reason for having produced nothing, or null while it may yet. */
  const editJobVerdict = async (
    serviceId: number | null,
  ): Promise<{ message: string; detail: string | null } | null> => {
    if (!serviceId) return null;
    try {
      const service = await getDraftService(serviceId);
      if (service.status !== "failed" && service.status !== "timeout") return null;
      return {
        message: t("draft.media.editFailed", lang),
        detail: (service.error_message || "").trim() || null,
      };
    } catch {
      // The job record is unreadable; keep polling the version list instead.
      return null;
    }
  };

  const watchEditedVersion = (
    logicalAssetId: string,
    previousVersionIds: Set<number>,
    serviceId: number | null,
  ) => {
    // Denser at the front, and it runs longer at the back. A 12 MP grade takes
    // roughly three and a half seconds, which the old 1.2/2.2/3.6 ladder only
    // noticed on its third tick at seven seconds — twice the wait for no reason.
    // The long tail is affordable now that a failed job is detected outright
    // rather than waited out.
    const delays = [800, 1200, 1800, 2600, 3600, 5000, 7000, 9000] as const;
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

      // No version yet — ask the job itself why. A worker that died leaves the
      // version list looking exactly like a job that is merely slow, which is how
      // a hard failure used to end as a spinner that quietly stopped spinning.
      const verdict = await editJobVerdict(serviceId);
      if (!panelOpenRef.current) return;
      if (verdict) {
        versionRefreshTimers.current.forEach((timer) => window.clearTimeout(timer));
        versionRefreshTimers.current = [];
        setVersionNotice(null);
        setError(verdict.message);
        setErrorDetail(verdict.detail);
        setErrorCanRetryLoad(false);
        return;
      }

      const nextIndex = index + 1;
      if (nextIndex >= delays.length) {
        // Out of patience, not out of hope: the job may still be running, so say
        // so instead of clearing the notice and leaving nothing behind.
        setVersionNotice({ text: t("draft.media.editStillRunning", lang), pending: false });
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
    setNotice(null);
    setVersionNotice({ text: t("reai.mediaCreating", lang), pending: true });
    setErrorCanRetryLoad(false);
    versionRefreshTimers.current.forEach((timer) => window.clearTimeout(timer));
    versionRefreshTimers.current = [];
    try {
      const queued = await editDraftImage(draft.id, editingGroup.active.id, operations);
      setEditingId(null);
      setView("versions");
      await loadMedia(false);
      await notifyChanged();
      if (logicalAssetId) watchEditedVersion(logicalAssetId, previousVersionIds, queued.service_id ?? null);
      else setVersionNotice(null);
    } catch (nextError) {
      setVersionNotice(null);
      setError(getSafeApiErrorMessage(nextError, lang));
      setErrorCanRetryLoad(false);
    } finally {
      setVersionBusy(false);
    }
  };

  const applyVersionAction = async (override?: MediaAction) => {
    const versionCandidateToApply = override ?? versionCandidate;
    if (!versionCandidateToApply) return;
    setVersionBusy(true);
    setError(null);
    setErrorCanRetryLoad(false);
    try {
      await manageMediaVersion(
        draft.id,
        versionCandidateToApply.uploadId,
        versionCandidateToApply.action,
      );
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
    setVersionNotice({ text: t("reai.mediaCreating", lang), pending: true });
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

  // The editor needs a wider stage than the browsing views: at 920px a portrait
  // photo binds on width and strands a band of empty canvas above and below it.
  const panelWidthClass = view === "editor" ? "sm:max-w-[1180px]" : "sm:max-w-[920px]";

  return (
    <>
      {/* Kept mounted while the workspace is closed so the initial empty-state
          CTA can open the native picker directly from its user gesture. */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif,image/tiff,image/bmp"
        multiple
        aria-label={t("draft.media.addPhotos", lang)}
        className="sr-only"
        tabIndex={-1}
        onChange={(event) => void handleFiles(event)}
      />
      <input
        ref={versionFileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif,image/tiff,image/bmp"
        aria-label={t("draft.media.uploadVersion", lang)}
        className="sr-only"
        tabIndex={-1}
        onChange={(event) => void handleVersionFile(event)}
      />
      <SidePanel
      open={open}
      onOpenChange={onOpenChange}
      title={t(view === "gallery" ? "draft.media.title" : view === "editor" ? "draft.media.editPhoto" : "reai.mediaVersions", lang)}
      description={draft.title || t("dashboard.untitled", lang)}
      headerMode="editor"
      className={panelWidthClass}
      contentScrollable={view !== "editor"}
      contentClassName={cn(
        "media-manager-workspace",
        // The editor owns the whole content box and scrolls its own rail, so the
        // page chrome never moves while you grade. Everything else scrolls normally.
        // `sm:px-0` is required as well: an unprefixed `p-0` does not override the
        // panel's `sm:px-6`, which otherwise leaves a bare strip beside the stage.
        view === "editor" && "flex p-0 sm:px-0",
      )}
      contentRef={contentRef}
      closeIcon={view === "gallery" ? "close" : "back"}
      onBack={view === "gallery" ? undefined : () => switchView("gallery")}
      lang={lang}
      headerAction={view === "gallery" ? (
        <Button type="button" variant="default" size="sm" className="floating-control h-auto px-3" onClick={requestUpload} disabled={busy}>
          <UploadIcon size={15} />
          <span className="hidden min-[390px]:inline">{t("draft.media.add", lang)}</span>
        </Button>
      ) : undefined}
    >
      {view === "editor" ? (
        editingGroup ? (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {error ? (
              <div role="alert" className="flex shrink-0 items-start justify-between gap-3 border-b border-red-500/20 bg-red-500/[0.055] px-4 py-3 text-[11px] leading-relaxed text-red-800">
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
              onSave={saveEditedVersion}
            />
          </div>
        ) : (
          <div className="floating-panel-shape m-5 flex-1 border border-dashed border-border/70 bg-card px-6 py-14 text-center">
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
              <span className="min-w-0">
                <span>{error}</span>
                {/* Second line, smaller and quieter: worth relaying to support,
                    never worth reading before the sentence above it. */}
                {errorDetail ? (
                  <span className="mt-1 block break-words text-[10px] leading-relaxed text-red-900/55">
                    {errorDetail}
                  </span>
                ) : null}
              </span>
              <Button type="button" variant="ghost" size="xs" onClick={() => setError(null)} className="shrink-0 text-red-900 hover:bg-red-500/10 hover:text-red-900">
                {t("common.dismiss", lang)}
              </Button>
            </div>
          ) : null}

          {versionNotice ? (
            /*
              In flow, for the same reason as the reorder bar above: pinned to
              the top-right of the versions view it landed on the first version
              card, so the status about a photo covered the photo. It reads as a
              header for the list it precedes instead.
            */
            <div
              className="mb-3 flex min-h-11 max-w-[min(24rem,100%)] items-center gap-3 rounded-full border border-border/65 bg-card px-3.5 text-[11px] text-foreground/70"
              role="status"
              aria-live="polite"
            >
              {versionNotice.pending ? (
                <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-foreground/15 border-t-foreground/65" aria-hidden="true" />
              ) : null}
              <span>{versionNotice.text}</span>
              {versionNotice.pending ? null : (
                <Button type="button" variant="ghost" size="xs" onClick={() => void loadMedia(false)} className="shrink-0">
                  {t("common.tryAgain", lang)}
                </Button>
              )}
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
                      setVersionCreateRequest(null);
                      /*
                        Switching which version is live needs no confirmation
                        step. It is reversible in one tap — the version it
                        replaces stays in this same list, which is what the
                        confirmation's own wording promised — so the prompt
                        asked the user to read two sentences to authorise
                        something they could simply undo. Hiding still asks,
                        because that one removes a version from the gallery.
                      */
                      if (nextCandidate?.action === "promote") {
                        setVersionCandidate(null);
                        void applyVersionAction(nextCandidate);
                        return;
                      }
                      setVersionCandidate(nextCandidate);
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

      <div className="media-manager-command-row mb-4">
        <div className="min-w-0">
          <div className="media-filter-track selection-capsule-track grid h-auto w-full grid-cols-2" role="group" aria-label={t("draft.media.filter", lang)}>
            {(["gallery", "hidden"] as const).map((value) => {
              const count = value === "gallery" ? visibleGroups.length : hiddenGroups.length;
              const active = value === filter;
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    const nextFilter: MediaFilter = value;
                    setFilter(nextFilter);
                    setReorderMode(false);
                    const nextGroups = nextFilter === "gallery" ? visibleGroups : hiddenGroups;
                    setSelectedId(nextGroups[0]?.id ?? null);
                    setConfirmAction(null);
                  }}
                  className={cn(
                    "selection-capsule-item h-auto w-full px-3 text-[12px] tracking-[-0.01em] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30",
                  )}
                >
                  {t(`draft.media.${value}` as LocaleKey, lang)}
                  <span className={cn("ml-1.5 tabular-nums", active ? "text-foreground/45" : "text-foreground/35")}>{count}</span>
                </button>
              );
            })}
          </div>
        </div>
        <div className="media-manager-command-actions shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={cn(
              "h-11 w-11 px-0 min-[520px]:w-auto min-[520px]:px-3",
              reorderMode && "border-foreground/25 bg-foreground/[0.08]",
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
            className="h-11 w-11 px-0 min-[620px]:w-auto min-[620px]:px-3"
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
        /*
          In flow, not pinned. This was `absolute top-14`, which put it over
          whatever happened to sit 56px down — on a phone the instructions card
          directly below, so the undo bar covered the sentence explaining what
          reordering does. Being absolute bought a layout that does not shift
          when the bar appears; covering the text it appears next to is the
          worse half of that trade, and the bar belongs with the list it is
          reporting on anyway.
        */
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-3 flex justify-end"
          role="status"
        >
          <div className="flex min-h-11 w-full max-w-sm items-center justify-between gap-3 rounded-full border border-border/65 bg-card pl-3 pr-1 text-foreground">
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

      {filter === "hidden" ? (
        <div className="floating-panel-shape mb-4 flex items-center gap-3 border border-border/65 bg-card px-3 py-2.5">
          <span className="floating-icon-button-sm bg-surface-subtle text-foreground/60 ring-1 ring-inset ring-border/45">
            <EyeClosedIcon size={15} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold text-foreground/80">{t("draft.media.hidden", lang)}</p>
            <p className="mt-0.5 max-w-xl text-[10px] leading-relaxed text-muted-foreground">
              {t("draft.media.hiddenHint", lang)}
            </p>
          </div>
        </div>
      ) : null}

      {/*
        Reordering is one card, not two. The guidance and the move controls were
        separate panels stacked above the list, so on a phone entering reorder
        mode pushed every photo — the thing being reordered — off the screen
        behind two blocks of chrome. They describe one mode, so they read as one
        card with the selected item on its own row.

        The move buttons are icons alone until there is room for words. "O
        miesto skôr" and "O miesto neskôr" are wide enough that two of them
        filled a phone row on their own, and their arrows already say which way
        each goes; the label is a nicety once the width is free.
      */}
      {reorderMode && selected && reorderSelectedIndex >= 0 ? (
        <div className="floating-toolbar mb-4 flex min-h-13 items-center gap-3 px-3 py-2">
          <DragHandleIcon size={15} className="shrink-0 text-foreground/45" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[11px] font-semibold text-foreground/80" title={selectedLabel}>{selectedLabel}</p>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              {t("draft.media.position", lang)
                .replace("{current}", String(reorderSelectedIndex + 1))
                .replace("{total}", String(activeReorderIds.length))}
            </p>
          </div>
          <span
            role="status"
            className={cn("shrink-0 text-[10px] font-medium text-muted-foreground", !busy && "sr-only")}
          >
            {t("draft.media.saving", lang)}
          </span>
          <div className="flex shrink-0 items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => moveReorderItem(selected.id, -1)}
                  disabled={busy || reorderSelectedIndex === 0}
                  aria-label={t("draft.media.moveEarlier", lang)}
                  title={t("draft.media.moveEarlier", lang)}
                  className="pen-touch-target"
                >
                  <ArrowLeftIcon size={14} />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => moveReorderItem(selected.id, 1)}
                  disabled={busy || reorderSelectedIndex === activeReorderIds.length - 1}
                  aria-label={t("draft.media.moveLater", lang)}
                  title={t("draft.media.moveLater", lang)}
                  className="pen-touch-target"
                >
                  <ArrowRightIcon size={14} />
                </Button>
          </div>
        </div>
      ) : null}

      {!reorderMode && selected ? (
        <section className="media-manager-selection editor-glass-control mb-4 rounded-[1.35rem] border px-3.5 py-3" aria-label={selectedLabel}>
          <div className="min-w-0 px-1 py-0.5">
            <div className="flex min-w-0 items-center gap-2">
              <p className="truncate text-[12px] font-semibold" title={selectedLabel}>{selectedLabel}</p>
              {selected.id === coverId ? (
                <StatusPill className="shrink-0 text-[9px]">
                  <StarIcon size={10} /> {t("draft.media.cover", lang)}
                </StatusPill>
              ) : null}
            </div>
            <p className="mt-0.5 flex flex-wrap gap-x-2 text-[9px] text-muted-foreground">
              <span>{selected.kind === "video" ? t("draft.media.video", lang) : t("draft.media.photo", lang)}</span>
              {selected.active.file_size ? <span>{formatBytes(selected.active.file_size, lang)}</span> : null}
              {selected.active.uploaded_at ? <span>{formatDate(selected.active.uploaded_at, undefined, lang)}</span> : null}
            </p>
          </div>
          <div className="media-manager-selection-actions">
            {selected.kind === "image" ? (
              <>
                <Button data-testid="draft-media-edit-photo" type="button" variant="default" size="sm" className="media-manager-selection-primary" onClick={() => openImageEditor(selected)} disabled={busy}>
                  <EditIcon size={13} /> {t("draft.media.editPhoto", lang)}
                </Button>
                <Button type="button" variant="ghost" size="icon-sm" onClick={() => requestVersionUpload(selected)} disabled={busy || !selected.active.logical_asset_id} aria-label={t("draft.media.uploadVersion", lang)} title={t("draft.media.uploadVersionHint", lang)}>
                  <UploadIcon size={14} />
                </Button>
              </>
            ) : null}
            <Button type="button" variant="ghost" size="sm" className="min-w-12 px-2" onClick={() => switchView("versions")} aria-label={t("draft.media.versions", lang)} title={t("draft.media.versions", lang)}>
              <VersionsIcon size={14} />
              <span className="tabular-nums text-foreground/45">{selected.versions.length}</span>
            </Button>
            {selected.visible && selected.kind === "image" && selected.id !== coverId ? (
              <Button type="button" variant="ghost" size="icon-sm" onClick={() => void makeCover(selected)} disabled={busy} aria-label={t("draft.media.setCover", lang)} title={t("draft.media.setCover", lang)}>
                <StarIcon size={14} />
              </Button>
            ) : null}
            {selected.kind === "image" && selected.visible ? (
              <Button type="button" variant="ghost" size="icon-sm" onClick={() => setConfirmAction({ kind: "hide", groupId: selected.id })} disabled={busy || !selected.active.logical_asset_id} aria-label={t("draft.media.hideFromGallery", lang)} title={t("draft.media.hideFromGallery", lang)}>
                <EyeClosedIcon size={14} />
              </Button>
            ) : selected.kind === "image" ? (
              <Button type="button" size="sm" onClick={() => void showGroup(selected)} disabled={busy || !selected.active.logical_asset_id}>
                <EyeOpenIcon size={14} /> {t("draft.media.restoreToGallery", lang)}
              </Button>
            ) : null}
          </div>
        </section>
      ) : null}

      {renderHideConfirmation("mb-4")}

      {loading ? (
        <div role="status" aria-label={t("draft.media.loading", lang)} aria-busy="true">
          <MediaManagerSkeleton />
        </div>
      ) : groups.length === 0 && pending.length === 0 ? (
        <div className="flex min-h-[54vh] flex-col items-center justify-center px-6 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-surface-subtle text-foreground/30 ring-1 ring-inset ring-border/55">
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
                          ? "z-10 border-foreground/55 opacity-90 shadow-card"
                          : isSelected
                            ? "border-foreground/45 shadow-card"
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
                        <StatusPill className="pointer-events-none absolute left-2 top-2 px-2 text-[9px] shadow-control">
                          <StarIcon size={10} /> 1 · {t("draft.media.cover", lang)}
                        </StatusPill>
                      ) : (
                        <StatusPill className="pointer-events-none absolute left-2 top-2 min-w-7 justify-center px-2 text-[10px] tabular-nums shadow-control">
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
                        className="floating-capsule floating-icon-button pen-touch-target absolute right-2 top-2 touch-none select-none text-muted-foreground opacity-90 transition-colors hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing disabled:opacity-30"
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
                <article key={item.id} className="media-manager-card floating-panel overflow-hidden">
                  <div className="media-manager-card-visual relative overflow-hidden bg-surface-subtle">
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
                  <p className="media-manager-card-footer truncate text-[10px] font-medium text-foreground/65">{item.name}</p>
                </article>
              )) : null}

              {filteredGroups.map((group, index) => {
                const isSelected = selected?.id === group.id;
                const isCover = group.id === coverId;
                const visibleIndex = visibleGroups.findIndex((candidate) => candidate.id === group.id);
                const label = mediaGroupLabel(group.kind, Math.max(0, visibleIndex), lang);
                return (
                  <motion.article
                    key={group.id}
                    className={cn(
                      "media-manager-card floating-panel min-w-0 overflow-hidden transition",
                      isSelected
                        ? "border-foreground/30 shadow-card"
                        : isCover
                          ? "border-foreground/25"
                          : "border-border/65 hover:border-foreground/30",
                    )}
                  >
                    <div className="media-manager-card-visual relative overflow-hidden bg-surface-subtle">
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
                        {!group.visible ? (
                          <StatusPill className="text-[9px] shadow-control">
                            <EyeClosedIcon size={11} /> {t("draft.media.hidden", lang)}
                          </StatusPill>
                        ) : null}
                      </span>
                      {group.visible ? (
                        <StatusPill
                          className={cn(
                            "pointer-events-none absolute right-2 top-2 min-w-7 justify-center px-2 text-[10px] tabular-nums shadow-control",
                          )}
                        >
                          {isCover ? <StarIcon size={10} /> : null}
                          {visibleIndex + 1}
                        </StatusPill>
                      ) : null}

                    </div>

                    <div className="media-manager-card-footer">
                      <div className="media-manager-card-meta flex min-w-0 flex-1 items-center justify-between gap-2">
                        <p className="truncate text-[11px] font-semibold text-foreground/75" title={label}>{label}</p>
                        <span className="flex shrink-0 items-center gap-1.5 text-[9px] text-muted-foreground">
                          {group.kind === "video" ? <VideoIcon size={12} /> : group.versions.length > 1 ? <span>{group.versions.length}×</span> : null}
                        </span>
                      </div>
                    </div>
                  </motion.article>
                );
              })}

              {filter === "gallery" ? (
                <button
                  type="button"
                  onClick={requestUpload}
                  disabled={busy}
                  className="media-manager-card floating-panel group min-w-0 overflow-hidden border-dashed bg-card text-muted-foreground transition-colors hover:border-foreground/30 hover:bg-surface-subtle hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                >
                  <span className="media-manager-card-visual flex items-center justify-center bg-surface-subtle">
                    <span className="floating-icon-button bg-card ring-1 ring-inset ring-border/55"><UploadIcon size={17} /></span>
                  </span>
                  <span className="media-manager-card-footer text-[11px] font-semibold">{t("draft.media.addPhotos", lang)}</span>
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

        </div>
      )}
      </div>
      </SidePanel>
    </>
  );
});

DraftMediaManager.displayName = "DraftMediaManager";

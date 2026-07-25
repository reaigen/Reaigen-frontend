"use client";
/* eslint-disable @next/next/no-img-element -- owner media uses short-lived signed URLs */

import * as React from "react";
import { motion } from "framer-motion";
import {
  cleanplateReaiDraftImages,
  editReaiDraftImage,
  generateReaiDraftImageHdr,
  getAgentMediaVersions,
  listDraftUploads,
  manageAgentMediaVersion,
  reorderDraftUploads,
  uploadDraftPhoto,
  type AgentMediaVersionGroup,
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
  EyeClosedIcon,
  EyeOpenIcon,
  ImageIcon,
  StarIcon,
  UploadIcon,
  VersionsIcon,
  VideoIcon,
} from "./icons";
import { SidePanel } from "./side-panel";
import { StatusPill } from "./status-pill";
import {
  MediaVersionCard,
  type MediaAction,
  type MediaVersionCreateKind,
} from "./draft-version-manager";

type MediaFilter = "gallery" | "hidden";
type MediaKind = "image" | "video";
type MediaManagerView = "gallery" | "versions";
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
        visible: versions.some((version) => version.is_master && !version.is_deleted),
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

function mergeVersionState(uploads: DraftUpload[], groups: AgentMediaVersionGroup[] | null) {
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

function fileLabel(upload: DraftUpload, fallback: string) {
  const name = (upload.file_name || "").trim();
  return name || fallback;
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
  const contentRef = React.useRef<HTMLDivElement>(null);
  const uploadDragDepth = React.useRef(0);
  const loadSequence = React.useRef(0);
  const versionRefreshTimers = React.useRef<number[]>([]);
  const pointerReorder = React.useRef<PointerReorderSession | null>(null);
  const pendingUrls = React.useRef(new Set<string>());
  const reorderIdsRef = React.useRef<string[]>([]);
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
  const [versionGroups, setVersionGroups] = React.useState<AgentMediaVersionGroup[]>([]);
  const [selectedVersionIds, setSelectedVersionIds] = React.useState<Record<string, number>>({});
  const [versionCandidate, setVersionCandidate] = React.useState<MediaAction>(null);
  const [versionBusy, setVersionBusy] = React.useState(false);
  const [versionNotice, setVersionNotice] = React.useState<string | null>(null);
  const [uploadDropActive, setUploadDropActive] = React.useState(false);
  const [undoOrderIds, setUndoOrderIds] = React.useState<string[] | null>(null);

  const groups = React.useMemo(() => buildMediaGroups(uploads), [uploads]);
  const visibleGroups = React.useMemo(() => groups.filter((group) => group.visible), [groups]);
  const hiddenGroups = React.useMemo(() => groups.filter((group) => !group.visible), [groups]);
  const filteredGroups = filter === "gallery" ? visibleGroups : hiddenGroups;
  const selected = filteredGroups.find((group) => group.id === selectedId) ?? filteredGroups[0] ?? null;
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

  const applyVersionGroups = React.useCallback((nextGroups: AgentMediaVersionGroup[]) => {
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
    if (showLoader) setLoading(true);
    setError(null);
    setErrorCanRetryLoad(false);
    try {
      const versionRequest = getAgentMediaVersions(draft.id).then((result) => result.groups).catch(() => null);
      const allUploads = await listDraftUploads(draft.id, { includeDeleted: true, fresh: true });
      if (sequence !== loadSequence.current) return;
      setVersionActionsAvailable(null);
      const nextUploads = mergeVersionState(allUploads, null);
      const nextGroups = buildMediaGroups(nextUploads);
      setUploads(nextUploads);
      setSelectedId((current) => nextGroups.some((group) => group.id === current) ? current : nextGroups[0]?.id ?? null);
      setFilter((current) => keepUsefulFilter(nextGroups, current));
      if (showLoader) setLoading(false);

      // Version state enriches the already-visible grid; it must never hold the
      // current gallery behind an optional Agent-consent request.
      void versionRequest.then((versionResult) => {
        if (sequence !== loadSequence.current) return;
        setVersionActionsAvailable(versionResult !== null);
        applyVersionGroups(versionResult ?? []);
        if (versionResult) {
          const enrichedUploads = mergeVersionState(allUploads, versionResult);
          const enrichedGroups = buildMediaGroups(enrichedUploads);
          setUploads(enrichedUploads);
          setSelectedId((current) => enrichedGroups.some((group) => group.id === current) ? current : enrichedGroups[0]?.id ?? null);
          setFilter((current) => keepUsefulFilter(enrichedGroups, current));
        }
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
    if (!open) return;
    setView("gallery");
    setReorderMode(false);
    setDraggingId(null);
    setReorderIds([]);
    reorderIdsRef.current = [];
    setConfirmAction(null);
    setVersionCandidate(null);
    setVersionNotice(null);
    setUploadDropActive(false);
    uploadDragDepth.current = 0;
    setUndoOrderIds(null);
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
    const ids = nextVisible.map((group) => group.active.id);
    if (ids.length < 2) return false;
    setBusy(true);
    setError(null);
    setErrorCanRetryLoad(false);
    const orderById = new Map(ids.map((id, index) => [id, index]));
    setUploads((current) => current.map((upload) => {
      const sortOrder = orderById.get(upload.id);
      return sortOrder === undefined ? upload : { ...upload, sort_order: sortOrder };
    }));
    try {
      await reorderDraftUploads(ids);
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
  }, [lang, loadMedia, notifyChanged]);

  const makeCover = React.useCallback(async (group: MediaGroup) => {
    if (group.kind !== "image" || !group.visible) return;
    setSelectedId(group.id);
    const next = [group, ...visibleGroups.filter((candidate) => candidate.id !== group.id)];
    await changeVisibleOrder(next);
  }, [changeVisibleOrder, visibleGroups]);

  const moveGroup = React.useCallback(async (group: MediaGroup, offset: -1 | 1) => {
    const sourceIndex = visibleGroups.findIndex((candidate) => candidate.id === group.id);
    if (sourceIndex < 0) return;
    const destination = sourceIndex + offset;
    if (destination < 0 || destination >= visibleGroups.length) return;
    const next = [...visibleGroups];
    const [moved] = next.splice(sourceIndex, 1);
    next.splice(destination, 0, moved);
    setSelectedId(group.id);
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
    };
    setSelectedId(id);
    setDraggingId(id);
  }, [busy]);

  const continuePointerReorder = React.useCallback((
    event: React.PointerEvent<HTMLButtonElement>,
  ) => {
    const session = pointerReorder.current;
    if (!session || session.pointerId !== event.pointerId) return;
    event.preventDefault();

    const target = document
      .elementsFromPoint(event.clientX, event.clientY)
      .map((element) => element.closest<HTMLElement>("[data-reorder-id]"))
      .find((element): element is HTMLElement => Boolean(element));
    const targetId = target?.dataset.reorderId;
    if (targetId) previewReorderAt(session.id, targetId);

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
  }, [previewReorderAt]);

  const finishPointerReorder = React.useCallback((
    event: React.PointerEvent<HTMLButtonElement>,
    cancelled: boolean,
  ) => {
    const session = pointerReorder.current;
    if (!session || session.pointerId !== event.pointerId) return;
    event.preventDefault();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    pointerReorder.current = null;
    setDraggingId(null);
    if (cancelled) {
      updateReorderIds(session.startOrder);
      return;
    }
    void commitReorderIds(reorderIdsRef.current);
  }, [commitReorderIds, updateReorderIds]);

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
    if (!targetGroup || targetGroup.kind !== "image" || !versionActionsAvailable) return;
    setBusy(true);
    setError(null);
    setErrorCanRetryLoad(false);
    try {
      const liveVersions = targetGroup.versions.filter((version) => !version.is_deleted);
      for (const version of liveVersions) {
        await manageAgentMediaVersion(draft.id, version.id, "hide");
      }
      setConfirmAction(null);
      await loadMedia(false);
      await notifyChanged();
    } catch (nextError) {
      setError(getSafeApiErrorMessage(nextError, lang));
      setErrorCanRetryLoad(false);
    } finally {
      setBusy(false);
    }
  }, [confirmAction, draft.id, groups, lang, loadMedia, notifyChanged, versionActionsAvailable]);

  const showGroup = React.useCallback(async (group: MediaGroup) => {
    if (group.kind !== "image" || !versionActionsAvailable) return;
    setSelectedId(group.id);
    setBusy(true);
    setError(null);
    setErrorCanRetryLoad(false);
    try {
      const target = group.versions.find((version) => version.is_master)
        ?? group.versions.find((version) => !version.is_deleted)
        ?? group.versions[0];
      if (target.is_deleted) await manageAgentMediaVersion(draft.id, target.id, "restore");
      await manageAgentMediaVersion(draft.id, target.id, "promote");
      setFilter("gallery");
      await loadMedia(false);
      await notifyChanged();
    } catch (nextError) {
      setError(getSafeApiErrorMessage(nextError, lang));
      setErrorCanRetryLoad(false);
    } finally {
      setBusy(false);
    }
  }, [draft.id, lang, loadMedia, notifyChanged, versionActionsAvailable]);

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
      return { file, item: { id: `${Date.now()}-${index}-${file.name}`, name: file.name, url, file, state: "queued" as const } };
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
    window.requestAnimationFrame(() => contentRef.current?.scrollTo({ top: 0, behavior: "smooth" }));
  };

  const applyVersionAction = async () => {
    if (!versionCandidate) return;
    setVersionBusy(true);
    setError(null);
    setErrorCanRetryLoad(false);
    try {
      await manageAgentMediaVersion(draft.id, versionCandidate.uploadId, versionCandidate.action);
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
        await editReaiDraftImage(draft.id, uploadId, {
          auto_enhance: true,
          auto_white_balance: true,
          normalize_color_profile: true,
        });
      } else if (kind === "cleanplate") {
        const result = await cleanplateReaiDraftImages(draft.id, {
          scope: "selected",
          upload_ids: [uploadId],
        });
        const created = result.results.find((item) => item.status === "completed");
        createdUploadId = created?.generated_upload_id ?? created?.cleaned_upload_id ?? null;
      } else {
        const result = await generateReaiDraftImageHdr(draft.id, uploadId);
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

  const selectedLabel = selected ? fileLabel(
    selected.active,
    selected.kind === "video" ? t("draft.media.video", lang) : t("draft.media.photo", lang),
  ) : "";

  const renderHideConfirmation = (className?: string) => confirmAction?.kind === "hide" ? (
    <div className={cn("editor-glass-surface rounded-[1.5rem] border p-3.5 sm:rounded-2xl", className)}>
      <div className="min-w-0">
        <p className="text-[13px] font-semibold">{t("draft.media.hideConfirm", lang)}</p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
          {t("draft.media.hideConfirmHint", lang)}
        </p>
        {confirmGroup ? (
          <p className="mt-1 truncate text-[10px] text-muted-foreground/75">
            {fileLabel(confirmGroup.active, t("draft.media.photo", lang))}
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
      title={t(view === "gallery" ? "draft.media.title" : "reai.mediaVersions", lang)}
      description={draft.title || t("dashboard.untitled", lang)}
      headerMode="editor"
      className="sm:max-w-[920px]"
      contentClassName="media-manager-workspace"
      contentRef={contentRef}
      closeIcon={view === "versions" ? "back" : "close"}
      onBack={view === "versions" ? () => switchView("gallery") : undefined}
      lang={lang}
      headerAction={view === "gallery" ? (
        <Button type="button" variant="outline" size="sm" className="h-9 border-border/65 !bg-card/75 px-3 backdrop-blur-xl" onClick={requestUpload} disabled={busy}>
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

      {view === "versions" ? (
        <div>
          {error ? (
            <div role="alert" className="mb-4 flex items-start justify-between gap-3 rounded-[1.5rem] border border-red-500/20 bg-red-500/[0.055] px-4 py-3 text-[11px] leading-relaxed text-red-800 sm:rounded-2xl">
              <span>{error}</span>
              <Button type="button" variant="ghost" size="xs" onClick={() => setError(null)} className="shrink-0 text-red-900 hover:bg-red-500/10 hover:text-red-900">
                {t("common.dismiss", lang)}
              </Button>
            </div>
          ) : null}

          {versionNotice ? (
            <div className="editor-glass-control mb-4 flex items-center gap-3 rounded-full border px-3.5 py-2.5 text-[11px] text-foreground/70" role="status" aria-live="polite">
              <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-foreground/15 border-t-foreground/65" aria-hidden="true" />
              <span>{versionNotice}</span>
            </div>
          ) : null}

          {versionActionsAvailable === null ? (
            <div className="flex min-h-[45vh] items-center justify-center" role="status">
              <div className="text-center">
                <span className="mx-auto block h-6 w-6 animate-spin rounded-full border-2 border-foreground/15 border-t-foreground/70" aria-hidden="true" />
                <p className="mt-3 text-[11px] text-muted-foreground">{t("draft.media.loading", lang)}</p>
              </div>
            </div>
          ) : versionActionsAvailable === false ? (
            <div className="rounded-[1.5rem] border border-dashed border-border/70 bg-card px-6 py-14 text-center sm:rounded-2xl">
              <VersionsIcon size={23} className="mx-auto text-foreground/25" />
              <p className="mx-auto mt-3 max-w-sm text-[12px] font-semibold leading-relaxed">{t("draft.versions.agentRequired", lang)}</p>
            </div>
          ) : orderedVersionGroups.length === 0 ? (
            <div className="rounded-[1.5rem] border border-dashed border-border/70 bg-card px-6 py-14 text-center sm:rounded-2xl">
              <ImageIcon size={23} className="mx-auto text-foreground/25" />
              <p className="mt-3 text-[13px] font-semibold">{t("draft.versions.noMediaVersions", lang)}</p>
              <p className="mx-auto mt-1 max-w-sm text-[11px] leading-relaxed text-muted-foreground">{t("reai.mediaVersionsEmpty", lang)}</p>
            </div>
          ) : (
            <div className="grid gap-4 min-[760px]:grid-cols-2">
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
                  }}
                  onCandidate={setVersionCandidate}
                  onCancel={() => setVersionCandidate(null)}
                  onConfirm={() => void applyVersionAction()}
                  onCreate={(uploadId, kind) => void createVersion(group.logical_asset_id, uploadId, kind)}
                />
              ))}
            </div>
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
        <div className="absolute inset-0 z-30 flex min-h-[55vh] items-center justify-center rounded-[1.5rem] border-2 border-dashed border-foreground/35 bg-background/92 backdrop-blur-sm sm:rounded-2xl">
          <div className="text-center">
            <span className="editor-glass-control mx-auto flex h-12 w-12 items-center justify-center rounded-full border text-foreground/65">
              <UploadIcon size={20} />
            </span>
            <p className="mt-3 text-[13px] font-semibold">{t("draft.media.dropPhotos", lang)}</p>
          </div>
        </div>
      ) : null}
      {error ? (
        <div role="alert" className="mb-4 flex items-start justify-between gap-3 rounded-[1.5rem] border border-red-500/20 bg-red-500/[0.055] px-4 py-3 text-[11px] leading-relaxed text-red-800 sm:rounded-2xl">
          <span>{error}</span>
          {loading ? null : (
            <Button type="button" variant="ghost" size="xs" onClick={errorCanRetryLoad ? retryLoad : () => setError(null)} className="shrink-0 text-red-900 hover:bg-red-500/10 hover:text-red-900">
              {t(errorCanRetryLoad ? "common.tryAgain" : "common.dismiss", lang)}
            </Button>
          )}
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
          <TabsList className="editor-glass-control grid h-auto w-full grid-cols-2 border p-1" aria-label={t("draft.media.filter", lang)}>
          {(["gallery", "hidden"] as const).map((value) => {
            const count = value === "gallery" ? visibleGroups.length : hiddenGroups.length;
            return (
              <TabsTrigger
                key={value}
                value={value}
                className="pen-touch-target min-h-11 px-3 text-[11px] font-semibold data-[state=active]:bg-foreground data-[state=active]:text-background data-[state=active]:shadow-control"
              >
                {t(`draft.media.${value}` as LocaleKey, lang)}
                <span className={cn("ml-1.5 tabular-nums", filter === value ? "text-background/60" : "text-foreground/35")}>{count}</span>
              </TabsTrigger>
            );
          })}
          </TabsList>
        </Tabs>
        <div className="flex shrink-0 items-center gap-1">
          {filter === "gallery" && visibleGroups.length > 1 ? (
            <Button
              type="button"
              variant={reorderMode ? "default" : "ghost"}
              size="sm"
              className="pen-touch-target h-11 px-3"
              onClick={() => {
                if (!reorderMode) {
                  updateReorderIds(visibleGroups.map((group) => group.id));
                  setReorderMode(true);
                } else {
                  setReorderMode(false);
                }
                setDraggingId(null);
              }}
              aria-pressed={reorderMode}
              title={`${t(reorderMode ? "draft.media.finishReorder" : "draft.media.reorder", lang)} (A)`}
            >
              {reorderMode ? <CheckIcon size={15} /> : <DragHandleIcon size={15} />}
              <span className="hidden min-[520px]:inline">{t(reorderMode ? "draft.media.finishReorder" : "draft.media.reorder", lang)}</span>
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="pen-touch-target h-11 px-3"
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
          className="mb-3"
          role="status"
        >
          <StatusPill className="editor-glass-control h-auto min-h-8 w-full justify-between gap-3 !bg-card/75 pl-3 pr-1">
            <span className="text-[10px] font-medium">{t("draft.media.orderSaved", lang)}</span>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => void undoReorder()}
              disabled={busy}
              className="h-6 px-2.5 text-[10px]"
            >
              {t("draft.media.undoOrder", lang)}
            </Button>
          </StatusPill>
        </motion.div>
      ) : null}

      {reorderMode || filter === "hidden" || busy ? (
        <div className="mb-4 flex min-h-5 items-start justify-between gap-3 px-1">
          <p className="max-w-xl text-[11px] leading-relaxed text-muted-foreground">
            {t(reorderMode ? "draft.media.reorderHint" : "draft.media.hiddenHint", lang)}
          </p>
          {busy ? <span role="status" className="shrink-0 text-[10px] font-medium text-muted-foreground">{t("draft.media.saving", lang)}</span> : null}
        </div>
      ) : <div className="mb-3" />}

      {reorderMode && selected && reorderSelectedIndex >= 0 ? (
        <div className="editor-glass-surface mb-4 flex flex-col gap-3 rounded-2xl border p-3 min-[520px]:flex-row min-[520px]:items-center min-[520px]:justify-between">
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

      {versionActionsAvailable === false && groups.some((group) => group.kind === "image") ? (
        <div className="editor-glass-surface mb-4 flex items-start gap-3 rounded-[1.5rem] border px-3.5 py-3 text-[10px] leading-relaxed text-muted-foreground sm:rounded-2xl">
          <EyeClosedIcon size={16} className="mt-0.5 shrink-0 text-foreground/45" />
          <span>{t("draft.media.versionAccess", lang)}</span>
        </div>
      ) : null}

      {renderHideConfirmation("media-manager-mobile-confirm mb-4")}

      {loading ? (
        <div className="flex min-h-[54vh] items-center justify-center" role="status">
          <div className="text-center">
            <span className="mx-auto block h-6 w-6 animate-spin rounded-full border-2 border-foreground/15 border-t-foreground/70" aria-hidden="true" />
            <p className="mt-3 text-[11px] text-muted-foreground">{t("draft.media.loading", lang)}</p>
          </div>
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
      ) : (
        <div className={cn("media-manager-layout", reorderMode && "media-manager-layout-reorder")}>
          <section className="min-w-0" aria-label={t("draft.media.title", lang)}>
            {reorderMode ? (
              <div className="media-manager-grid">
                {activeReorderIds.map((groupId, index) => {
                  const group = visibleGroups.find((candidate) => candidate.id === groupId);
                  if (!group) return null;
                  const label = fileLabel(group.active, t(group.kind === "video" ? "draft.media.video" : "draft.media.photo", lang));
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
                        "editor-glass-surface group relative min-w-0 overflow-hidden rounded-[1.5rem] border transition-[border-color,box-shadow,opacity] sm:rounded-2xl",
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
                      <StatusPill className="glass-chip pointer-events-none absolute left-2 top-2 h-7 min-w-7 justify-center px-2 text-[10px] tabular-nums">
                        {index + 1}
                      </StatusPill>
                      {group.id === coverId ? (
                        <StatusPill className="glass-chip pointer-events-none absolute bottom-[2.65rem] left-2 h-7 text-[9px]">
                          <StarIcon size={10} /> {t("draft.media.cover", lang)}
                        </StatusPill>
                      ) : null}
                      <button
                        type="button"
                        onPointerDown={(event) => beginPointerReorder(event, group.id)}
                        onPointerMove={continuePointerReorder}
                        onPointerUp={(event) => finishPointerReorder(event, false)}
                        onPointerCancel={(event) => finishPointerReorder(event, true)}
                        onContextMenu={(event) => event.preventDefault()}
                        disabled={busy}
                        className="editor-control-capsule pen-touch-target absolute right-2 top-2 flex h-11 w-11 touch-none select-none items-center justify-center rounded-full border text-muted-foreground opacity-90 transition-[opacity,transform,color] hover:scale-105 hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing active:scale-95 disabled:opacity-30 sm:h-10 sm:w-10"
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
                <article key={item.id} className="editor-glass-surface overflow-hidden rounded-[1.5rem] border sm:rounded-2xl">
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
                const label = fileLabel(group.active, t(group.kind === "video" ? "draft.media.video" : "draft.media.photo", lang));
                const versionActionDisabled = busy || versionActionsAvailable !== true;
                return (
                  <motion.article
                    key={group.id}
                    layout
                    transition={{ layout: { type: "spring", stiffness: 420, damping: 34 } }}
                    whileHover={{ y: -2 }}
                    className={cn(
                      "editor-glass-surface min-w-0 overflow-hidden rounded-[1.5rem] border transition sm:rounded-2xl",
                      isSelected ? "border-foreground ring-1 ring-foreground/15" : "border-border/65 hover:border-foreground/30",
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
                          <StatusPill className="glass-chip text-[9px]">
                            <StarIcon size={11} /> {t("draft.media.cover", lang)}
                          </StatusPill>
                        ) : null}
                        {!group.visible ? (
                          <StatusPill tone="strong" className="border-white/15 bg-black/65 text-[9px] text-white">
                            <EyeClosedIcon size={11} /> {t("draft.media.hidden", lang)}
                          </StatusPill>
                        ) : null}
                      </span>

                    </div>

                    <div className="p-2.5">
                      <div className="media-manager-card-meta mb-2 flex min-w-0 items-center justify-between gap-2 px-0.5">
                        <p className="truncate text-[11px] font-semibold text-foreground/75" title={label}>{label}</p>
                        <span className="flex shrink-0 items-center gap-1.5 text-[9px] text-muted-foreground">
                          {group.visible ? <span className="tabular-nums">{visibleIndex + 1}</span> : null}
                          {group.kind === "video" ? <VideoIcon size={12} /> : group.versions.length > 1 ? <span>{group.versions.length}×</span> : null}
                        </span>
                      </div>
                      {isSelected && group.kind === "image" ? group.visible ? (
                        <div className="media-manager-card-actions grid grid-cols-2 gap-1.5">
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
                            disabled={versionActionDisabled}
                            className="min-h-10 w-full px-2 text-[10px]"
                            aria-label={t("draft.media.hideFromGallery", lang)}
                            title={versionActionsAvailable === false ? t("draft.media.versionAccess", lang) : t("draft.media.hideFromGallery", lang)}
                          >
                            <EyeClosedIcon size={13} /> {t("draft.media.hide", lang)}
                          </Button>
                        </div>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => void showGroup(group)}
                          disabled={versionActionDisabled}
                          className="media-manager-card-actions min-h-10 w-full px-3 text-[11px]"
                          title={versionActionsAvailable === false ? t("draft.media.versionAccess", lang) : undefined}
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
                  className="editor-glass-surface group overflow-hidden rounded-[1.5rem] border border-dashed text-muted-foreground transition-colors hover:border-foreground/35 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 sm:rounded-2xl"
                >
                  <span className="flex aspect-[16/9] items-center justify-center bg-surface-subtle/65 transition-colors group-hover:bg-surface-subtle">
                    <span className="editor-glass-control flex h-10 w-10 items-center justify-center rounded-full border"><UploadIcon size={17} /></span>
                  </span>
                  <span className="block px-3 py-2.5 text-left text-[11px] font-semibold">{t("draft.media.addPhotos", lang)}</span>
                </button>
              ) : null}
            </div>

            {filteredGroups.length === 0 && pending.length === 0 ? (
              <div className="py-16 text-center text-muted-foreground">
                {filter === "hidden" ? <EyeOpenIcon size={22} className="mx-auto text-foreground/25" /> : <ImageIcon size={22} className="mx-auto text-foreground/25" />}
                <p className="mt-3 text-[12px] font-medium">{t(filter === "hidden" ? "draft.media.noHidden" : "draft.media.noVisible", lang)}</p>
              </div>
            ) : null}
              </>
            )}
          </section>

          <aside className="editor-glass-surface media-manager-inspector sticky top-0 min-w-0 overflow-hidden rounded-[1.5rem] border sm:rounded-2xl">
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
                  {selected.id === coverId ? (
                    <StatusPill tone="strong" className="absolute left-3 top-3 border-white/15 bg-black/55 text-[9px] text-white backdrop-blur-xl">
                      <StarIcon size={11} /> {t("draft.media.cover", lang)}
                    </StatusPill>
                  ) : null}
                </div>
                <div className="p-4">
                  <p className="truncate text-[13px] font-semibold" title={selectedLabel}>{selectedLabel}</p>
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
                    <span>{selected.kind === "video" ? t("draft.media.video", lang) : t("draft.media.photo", lang)}</span>
                    {selected.active.file_size ? <span>{formatBytes(selected.active.file_size, lang)}</span> : null}
                    {selected.active.uploaded_at ? <span>{formatDate(selected.active.uploaded_at, undefined, lang)}</span> : null}
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => switchView("versions")}
                    className="mt-4 w-full justify-between !bg-card/65 px-3.5 text-left backdrop-blur-xl hover:!bg-card/85"
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
                      <Button type="button" variant="outline" className="w-full" onClick={() => setConfirmAction({ kind: "hide", groupId: selected.id })} disabled={busy || versionActionsAvailable !== true}>
                        <EyeClosedIcon size={15} /> {t("draft.media.hideFromGallery", lang)}
                      </Button>
                    ) : selected.kind === "image" ? (
                      <Button type="button" className="w-full" onClick={() => void showGroup(selected)} disabled={busy || versionActionsAvailable !== true}>
                        <EyeOpenIcon size={15} /> {t("draft.media.restoreToGallery", lang)}
                      </Button>
                    ) : null}
                  </div>
                  {versionActionsAvailable === false && selected.kind === "image" ? (
                    <p className="mt-3 text-[10px] leading-relaxed text-muted-foreground">{t("draft.media.versionAccess", lang)}</p>
                  ) : null}
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

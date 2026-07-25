"use client";
/* eslint-disable @next/next/no-img-element -- owner media uses short-lived signed URLs */

import * as React from "react";
import {
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
import { cn } from "../lib/utils";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
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

type MediaFilter = "gallery" | "hidden";
type MediaKind = "image" | "video";
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
  onOpenVersions,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draft: DraftDetailItem;
  lang: string;
  onChanged?: () => void | Promise<void>;
  onOpenVersions: () => void;
}) {
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const loadSequence = React.useRef(0);
  const pendingUrls = React.useRef(new Set<string>());
  const [uploads, setUploads] = React.useState<DraftUpload[]>([]);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [filter, setFilter] = React.useState<MediaFilter>("gallery");
  const [loading, setLoading] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [pending, setPending] = React.useState<PendingUpload[]>([]);
  const [draggingId, setDraggingId] = React.useState<string | null>(null);
  const [versionActionsAvailable, setVersionActionsAvailable] = React.useState<boolean | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [errorCanRetryLoad, setErrorCanRetryLoad] = React.useState(false);
  const [confirmAction, setConfirmAction] = React.useState<ConfirmAction>(null);

  const groups = React.useMemo(() => buildMediaGroups(uploads), [uploads]);
  const visibleGroups = React.useMemo(() => groups.filter((group) => group.visible), [groups]);
  const hiddenGroups = React.useMemo(() => groups.filter((group) => !group.visible), [groups]);
  const filteredGroups = filter === "gallery" ? visibleGroups : hiddenGroups;
  const selected = filteredGroups.find((group) => group.id === selectedId) ?? filteredGroups[0] ?? null;
  const confirmGroup = confirmAction ? groups.find((group) => group.id === confirmAction.groupId) ?? null : null;
  const coverId = visibleGroups.find((group) => group.kind === "image")?.id ?? null;
  const selectedVisibleIndex = selected ? visibleGroups.findIndex((group) => group.id === selected.id) : -1;

  const releasePendingUrl = React.useCallback((url: string) => {
    URL.revokeObjectURL(url);
    pendingUrls.current.delete(url);
  }, []);

  React.useEffect(() => () => {
    pendingUrls.current.forEach((url) => URL.revokeObjectURL(url));
    pendingUrls.current.clear();
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
  }, [draft.id, lang]);

  React.useEffect(() => {
    if (!open) return;
    setConfirmAction(null);
    void loadMedia();
  }, [loadMedia, open]);

  const notifyChanged = React.useCallback(async () => {
    await onChanged?.();
    window.dispatchEvent(new CustomEvent("reai-media-updated", { detail: { draftId: draft.id } }));
  }, [draft.id, onChanged]);

  const changeVisibleOrder = React.useCallback(async (nextVisible: MediaGroup[]) => {
    const ids = nextVisible.map((group) => group.active.id);
    if (ids.length < 2) return;
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
    } catch (nextError) {
      await loadMedia(false);
      setError(getSafeApiErrorMessage(nextError, lang));
      setErrorCanRetryLoad(false);
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

  const dropBefore = React.useCallback(async (targetId: string) => {
    if (!draggingId || draggingId === targetId) return;
    const sourceIndex = visibleGroups.findIndex((group) => group.id === draggingId);
    const targetIndex = visibleGroups.findIndex((group) => group.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0) return;
    const next = [...visibleGroups];
    const [moved] = next.splice(sourceIndex, 1);
    next.splice(targetIndex, 0, moved);
    setDraggingId(null);
    await changeVisibleOrder(next);
  }, [changeVisibleOrder, draggingId, visibleGroups]);

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

  const handleFiles = React.useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const chosen = Array.from(event.target.files ?? []);
    event.target.value = "";
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
  const closeAndOpenVersions = () => {
    onOpenChange(false);
    window.setTimeout(onOpenVersions, 120);
  };

  const selectedLabel = selected ? fileLabel(
    selected.active,
    selected.kind === "video" ? t("draft.media.video", lang) : t("draft.media.photo", lang),
  ) : "";

  const actionFooter = confirmAction?.kind === "hide" ? (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
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
      <div className="grid shrink-0 grid-cols-2 gap-2 sm:flex">
        <Button type="button" variant="outline" size="sm" onClick={() => setConfirmAction(null)} disabled={busy}>
          {t("common.cancel", lang)}
        </Button>
        <Button type="button" variant="default" size="sm" onClick={() => void hideSelected()} loading={busy}>
          <EyeClosedIcon size={15} /> {t("draft.media.hide", lang)}
        </Button>
      </div>
    </div>
  ) : undefined;

  return (
    <SidePanel
      open={open}
      onOpenChange={onOpenChange}
      title={t("draft.media.title", lang)}
      description={draft.title || t("dashboard.untitled", lang)}
      headerMode="editor"
      className="sm:max-w-[920px]"
      contentClassName="media-manager-workspace"
      lang={lang}
      headerAction={(
        <Button type="button" variant="outline" size="sm" className="h-9 px-3" onClick={requestUpload} disabled={busy}>
          <UploadIcon size={15} />
          <span className="hidden min-[390px]:inline">{t("draft.media.add", lang)}</span>
        </Button>
      )}
      footer={actionFooter}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif,image/tiff,image/bmp"
        multiple
        className="sr-only"
        onChange={(event) => void handleFiles(event)}
      />

      {error ? (
        <div role="alert" className="mb-4 flex items-start justify-between gap-3 rounded-2xl border border-red-500/20 bg-red-500/[0.055] px-4 py-3 text-[11px] leading-relaxed text-red-800">
          <span>{error}</span>
          {loading ? null : (
            <button type="button" onClick={errorCanRetryLoad ? retryLoad : () => setError(null)} className="shrink-0 rounded-full px-2 py-1 font-semibold text-red-900 hover:bg-red-500/10">
              {t(errorCanRetryLoad ? "common.tryAgain" : "common.dismiss", lang)}
            </button>
          )}
        </div>
      ) : null}

      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="grid min-w-0 flex-1 grid-cols-2 rounded-full border border-border/70 bg-card p-1 shadow-control sm:max-w-[330px]" role="tablist" aria-label={t("draft.media.filter", lang)}>
          {(["gallery", "hidden"] as const).map((value) => {
            const count = value === "gallery" ? visibleGroups.length : hiddenGroups.length;
            return (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={filter === value}
                onClick={() => {
                  setFilter(value);
                  const nextGroups = value === "gallery" ? visibleGroups : hiddenGroups;
                  setSelectedId(nextGroups[0]?.id ?? null);
                }}
                className={cn(
                  "min-h-10 rounded-full px-3 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-9",
                  filter === value ? "bg-foreground text-background shadow-control" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t(`draft.media.${value}` as LocaleKey, lang)}
                <span className={cn("ml-1.5 tabular-nums", filter === value ? "text-background/60" : "text-foreground/35")}>{count}</span>
              </button>
            );
          })}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-10 shrink-0 px-3 sm:h-9"
          onClick={closeAndOpenVersions}
          aria-label={t("draft.media.versions", lang)}
          title={t("draft.media.versions", lang)}
        >
          <VersionsIcon size={15} />
          <span className="hidden min-[430px]:inline">{t("draft.media.versions", lang)}</span>
        </Button>
      </div>

      <div className="mb-5 flex min-h-5 items-start justify-between gap-3 px-1">
        <p className="max-w-xl text-[11px] leading-relaxed text-muted-foreground">
          {t(filter === "gallery" ? "draft.media.galleryHint" : "draft.media.hiddenHint", lang)}
        </p>
        {busy ? <span role="status" className="shrink-0 text-[10px] font-medium text-muted-foreground">{t("draft.media.saving", lang)}</span> : null}
      </div>

      {versionActionsAvailable === false && groups.some((group) => group.kind === "image") ? (
        <div className="mb-5 flex items-start gap-3 rounded-2xl border border-border/70 bg-surface-subtle px-3.5 py-3 text-[10px] leading-relaxed text-muted-foreground">
          <EyeClosedIcon size={16} className="mt-0.5 shrink-0 text-foreground/45" />
          <span>{t("draft.media.versionAccess", lang)}</span>
        </div>
      ) : null}

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
        <div className="media-manager-layout">
          <section className="min-w-0" aria-label={t("draft.media.title", lang)}>
            <div className="media-manager-grid">
              {filter === "gallery" ? pending.map((item) => (
                <article key={item.id} className="overflow-hidden rounded-2xl border border-border/65 bg-card shadow-control">
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
                  <article
                    key={group.id}
                    className={cn(
                      "min-w-0 overflow-hidden rounded-2xl border bg-card shadow-control transition",
                      isSelected ? "border-foreground/65 ring-2 ring-foreground/10" : "border-border/65 hover:border-foreground/25",
                      draggingId === group.id && "opacity-45",
                    )}
                  >
                    <div className="relative aspect-[16/9] overflow-hidden bg-surface-subtle">
                      <button
                        type="button"
                        onClick={() => setSelectedId(group.id)}
                        draggable={group.visible && !busy}
                        onDragStart={(event) => {
                          setDraggingId(group.id);
                          event.dataTransfer.effectAllowed = "move";
                          event.dataTransfer.setData("text/plain", group.id);
                        }}
                        onDragEnd={() => setDraggingId(null)}
                        onDragOver={(event) => {
                          if (group.visible && draggingId) {
                            event.preventDefault();
                            event.dataTransfer.dropEffect = "move";
                          }
                        }}
                        onDrop={(event) => {
                          event.preventDefault();
                          void dropBefore(group.id);
                        }}
                        className="absolute inset-0 h-full w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring md:cursor-grab md:active:cursor-grabbing"
                        aria-pressed={isSelected}
                        aria-label={`${label}, ${index + 1}`}
                      >
                        <MediaVisual upload={group.active} alt="" className={cn(!group.visible && "opacity-55 grayscale-[20%]")} />
                      </button>

                      <span className="pointer-events-none absolute left-2 top-2 flex flex-wrap gap-1.5">
                        {isCover ? (
                          <span className="inline-flex h-7 items-center gap-1 rounded-full bg-white/94 px-2.5 text-[9px] font-semibold text-black shadow-control backdrop-blur-xl">
                            <StarIcon size={11} /> {t("draft.media.cover", lang)}
                          </span>
                        ) : null}
                        {!group.visible ? (
                          <span className="inline-flex h-7 items-center gap-1 rounded-full bg-black/62 px-2.5 text-[9px] font-semibold text-white shadow-control backdrop-blur-xl">
                            <EyeClosedIcon size={11} /> {t("draft.media.hidden", lang)}
                          </span>
                        ) : null}
                      </span>

                      {group.visible ? (
                        <>
                          <span className="pointer-events-none absolute bottom-2 left-2 flex h-8 min-w-8 items-center justify-center rounded-full bg-black/62 px-2 text-[10px] font-semibold tabular-nums text-white backdrop-blur-xl">
                            {visibleIndex + 1}
                          </span>
                          <span className="media-manager-card-order absolute bottom-2 right-2 flex overflow-hidden rounded-full border border-white/15 bg-black/62 text-white shadow-control backdrop-blur-xl">
                            <button
                              type="button"
                              onClick={() => void moveGroup(group, -1)}
                              disabled={busy || visibleIndex <= 0}
                              className="flex h-10 w-10 items-center justify-center transition-colors hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/70 disabled:opacity-30"
                              aria-label={t("draft.media.moveEarlier", lang)}
                              title={t("draft.media.moveEarlier", lang)}
                            >
                              <ArrowLeftIcon size={15} />
                            </button>
                            <span className="my-2 w-px bg-white/15" aria-hidden="true" />
                            <button
                              type="button"
                              onClick={() => void moveGroup(group, 1)}
                              disabled={busy || visibleIndex < 0 || visibleIndex >= visibleGroups.length - 1}
                              className="flex h-10 w-10 items-center justify-center transition-colors hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/70 disabled:opacity-30"
                              aria-label={t("draft.media.moveLater", lang)}
                              title={t("draft.media.moveLater", lang)}
                            >
                              <ArrowRightIcon size={15} />
                            </button>
                          </span>
                        </>
                      ) : null}
                    </div>

                    <div className="p-2.5">
                      <div className="media-manager-card-meta mb-2 flex min-w-0 items-center justify-between gap-2 px-0.5">
                        <p className="truncate text-[11px] font-semibold text-foreground/75" title={label}>{label}</p>
                        <span className="shrink-0 text-[9px] text-muted-foreground">
                          {group.kind === "video" ? <VideoIcon size={12} /> : group.versions.length > 1 ? `${group.versions.length}×` : null}
                        </span>
                      </div>
                      {group.kind === "image" ? group.visible ? (
                        <div className="media-manager-card-actions grid grid-cols-2 gap-1.5">
                          <button
                            type="button"
                            onClick={() => void makeCover(group)}
                            disabled={busy || isCover}
                            className={cn(
                              "inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl px-2 text-[10px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-100",
                              isCover ? "bg-foreground text-background" : "bg-surface-subtle text-foreground/70 hover:bg-foreground/[0.09]",
                            )}
                            aria-label={isCover ? t("draft.media.cover", lang) : t("draft.media.setCover", lang)}
                          >
                            <StarIcon size={13} /> {t(isCover ? "draft.media.cover" : "draft.media.setCoverShort", lang)}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmAction({ kind: "hide", groupId: group.id })}
                            disabled={versionActionDisabled}
                            className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl bg-surface-subtle px-2 text-[10px] font-semibold text-foreground/70 transition-colors hover:bg-foreground/[0.09] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-45"
                            aria-label={t("draft.media.hideFromGallery", lang)}
                            title={versionActionsAvailable === false ? t("draft.media.versionAccess", lang) : t("draft.media.hideFromGallery", lang)}
                          >
                            <EyeClosedIcon size={13} /> {t("draft.media.hide", lang)}
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void showGroup(group)}
                          disabled={versionActionDisabled}
                          className="media-manager-card-actions inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-xl bg-foreground px-3 text-[11px] font-semibold text-background transition-opacity hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-45"
                          title={versionActionsAvailable === false ? t("draft.media.versionAccess", lang) : undefined}
                        >
                          <EyeOpenIcon size={14} /> {t("draft.media.restoreToGallery", lang)}
                        </button>
                      ) : null}
                    </div>
                  </article>
                );
              })}

              {filter === "gallery" ? (
                <button
                  type="button"
                  onClick={requestUpload}
                  disabled={busy}
                  className="flex min-h-[10rem] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-card text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                >
                  <span className="flex h-11 w-11 items-center justify-center rounded-full bg-surface-subtle"><UploadIcon size={17} /></span>
                  <span className="text-[11px] font-semibold">{t("draft.media.addPhotos", lang)}</span>
                </button>
              ) : null}
            </div>

            {filteredGroups.length === 0 && pending.length === 0 ? (
              <div className="py-16 text-center text-muted-foreground">
                {filter === "hidden" ? <EyeOpenIcon size={22} className="mx-auto text-foreground/25" /> : <ImageIcon size={22} className="mx-auto text-foreground/25" />}
                <p className="mt-3 text-[12px] font-medium">{t(filter === "hidden" ? "draft.media.noHidden" : "draft.media.noVisible", lang)}</p>
              </div>
            ) : null}
          </section>

          <aside className="media-manager-inspector sticky top-0 min-w-0 overflow-hidden rounded-2xl border border-border/70 bg-card shadow-card">
            {selected ? (
              <>
                <div className="relative aspect-[3/2] overflow-hidden bg-black/[0.035]">
                  <MediaVisual upload={selected.active} alt={selectedLabel} className="object-contain" />
                  <div className="absolute left-3 top-3 flex flex-wrap gap-1.5">
                    {selected.id === coverId ? <StatusPill tone="strong">{t("draft.media.cover", lang)}</StatusPill> : null}
                    <StatusPill tone={selected.visible ? "success" : "neutral"} dot>
                      {t(selected.visible ? "draft.media.onDisplay" : "draft.media.hidden", lang)}
                    </StatusPill>
                  </div>
                </div>
                <div className="p-4">
                  <p className="truncate text-[13px] font-semibold" title={selectedLabel}>{selectedLabel}</p>
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
                    <span>{selected.kind === "video" ? t("draft.media.video", lang) : t("draft.media.photo", lang)}</span>
                    {selected.active.file_size ? <span>{formatBytes(selected.active.file_size, lang)}</span> : null}
                    {selected.active.uploaded_at ? <span>{formatDate(selected.active.uploaded_at, undefined, lang)}</span> : null}
                  </div>
                  <div className="mt-4 flex items-center justify-between rounded-xl bg-surface-subtle px-3 py-2.5">
                    <span className="text-[10px] font-medium text-muted-foreground">{t("draft.media.versions", lang)}</span>
                    <span className="text-[12px] font-semibold tabular-nums">{selected.versions.length}</span>
                  </div>
                  <div className="mt-4 space-y-2">
                    {selected.visible && selected.kind === "image" && selected.id !== coverId ? (
                      <Button type="button" variant="outline" className="w-full" onClick={() => void makeCover(selected)} disabled={busy}>
                        <StarIcon size={15} /> {t("draft.media.setCover", lang)}
                      </Button>
                    ) : null}
                    {selected.visible ? (
                      <div className="grid grid-cols-2 gap-2">
                        <Button type="button" variant="outline" size="icon" className="w-full" onClick={() => void moveGroup(selected, -1)} disabled={busy || selectedVisibleIndex <= 0} aria-label={t("draft.media.moveEarlier", lang)} title={t("draft.media.moveEarlier", lang)}>
                          <ArrowLeftIcon size={15} />
                        </Button>
                        <Button type="button" variant="outline" size="icon" className="w-full" onClick={() => void moveGroup(selected, 1)} disabled={busy || selectedVisibleIndex < 0 || selectedVisibleIndex >= visibleGroups.length - 1} aria-label={t("draft.media.moveLater", lang)} title={t("draft.media.moveLater", lang)}>
                          <ArrowRightIcon size={15} />
                        </Button>
                      </div>
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
                </div>
              </>
            ) : null}
          </aside>
        </div>
      )}
    </SidePanel>
  );
}

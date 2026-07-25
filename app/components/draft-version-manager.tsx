"use client";
/* eslint-disable @next/next/no-img-element -- signed media URLs are not stable Next Image sources */

import * as React from "react";
import Link from "next/link";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../lib/ui/tabs";
import { Button } from "../lib/ui/button";
import {
  cleanplateReaiDraftImages,
  editReaiDraftImage,
  generateReaiDraftImageHdr,
  getAgentCreationHistory,
  getAgentMediaVersions,
  getReaiAgentConsent,
  manageAgentMediaVersion,
  restoreAgentCreationRevision,
  setActiveSplat,
  type AgentCreationRevision,
  type AgentMediaVersion,
  type AgentMediaVersionGroup,
} from "../lib/api/client";
import { getSafeApiErrorMessage } from "../lib/api/error-message";
import { formatDate, t, type LocaleKey } from "../lib/i18n";
import type { DraftDetailItem, DraftSplatVersion, SplatsByDraftPayload } from "../lib/tour-types";
import { baseUnitForCategory, resolveUnit, unitLabel, type UnitLookup } from "../lib/unit-catalog";
import { cn } from "../lib/utils";
import { useAuth } from "./hooks/use-auth";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  ChevronDownIcon,
  ClockIcon,
  ExternalLinkIcon,
  ImageIcon,
  PlusIcon,
  TourIcon,
  VersionsIcon,
} from "./icons";
import { SidePanel } from "./side-panel";
import { StatusPill } from "./status-pill";

type VersionTab = "tour" | "listing" | "media";
export type MediaAction = { uploadId: number; action: "promote" | "hide" | "restore" } | null;
export type MediaVersionCreateKind = "enhance" | "cleanplate" | "hdr";
type RevisionChange = { key: string; before: unknown; after: unknown };

const REVISION_FIELD_KEYS: Record<string, LocaleKey> = {
  title: "reai.field.title",
  description: "reai.field.description",
  price: "reai.field.price",
  currency: "reai.field.currency",
  area: "reai.field.area",
  lot_size: "reai.field.lot_size",
  year_built: "reai.field.year_built",
  specs: "reai.field.specs",
  property_type: "reai.attribute.propertyType",
  property_subtype: "reai.attribute.propertySubtype",
  rooms: "reai.attribute.rooms",
  bedrooms: "reai.attribute.bedrooms",
  bathrooms: "reai.attribute.bathrooms",
  toilets: "reai.attribute.toilets",
  cooling_types: "reai.attribute.coolingTypes",
};

/** Translate a backend enum value through i18n, falling back to a humanized value. */
function enumLabel(prefix: string, value: string | null | undefined, lang: string): string | null {
  if (!value) return null;
  const key = `${prefix}.${String(value).toLowerCase()}` as LocaleKey;
  const translated = t(key, lang);
  return translated === key ? humanize(value) : translated;
}

function humanize(value: string) {
  const result = value.replace(/[._-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").trim();
  return result ? result.charAt(0).toUpperCase() + result.slice(1) : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function valuesEqual(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function expandRevisionChange(before: unknown, after: unknown, key: string, depth = 0): RevisionChange[] {
  if (valuesEqual(before, after)) return [];
  if (depth < 2 && (isRecord(before) || isRecord(after))) {
    const beforeRecord = isRecord(before) ? before : {};
    const afterRecord = isRecord(after) ? after : {};
    const keys = new Set([...Object.keys(beforeRecord), ...Object.keys(afterRecord)]);
    return [...keys].flatMap((nestedKey) => expandRevisionChange(
      beforeRecord[nestedKey],
      afterRecord[nestedKey],
      key ? `${key}.${nestedKey}` : nestedKey,
      depth + 1,
    ));
  }
  return [{ key, before, after }];
}

function revisionChanges(revision: AgentCreationRevision): RevisionChange[] {
  return revision.changed_fields.flatMap((field) => expandRevisionChange(
    revision.before_values?.[field],
    revision.after_values?.[field],
    field,
  ));
}

function revisionFieldLabel(path: string, lang: string) {
  const parts = path.split(".");
  const field = parts.at(-1) ?? path;
  const key = REVISION_FIELD_KEYS[field] ?? REVISION_FIELD_KEYS[path];
  return key ? t(key, lang) : humanize(field);
}

function revisionValue(
  field: string,
  value: unknown,
  revision: AgentCreationRevision,
  lang: string,
  units: readonly UnitLookup[],
) {
  if (value === undefined || value === null || value === "") return t("reai.emptyValue", lang);
  if (typeof value === "boolean") return t(value ? "common.yes" : "common.no", lang);
  if (Array.isArray(value)) return value.length ? value.map((item) => humanize(String(item))).join(", ") : t("reai.emptyValue", lang);
  if (isRecord(value)) return t("reai.detailsChanged", lang);
  const number = typeof value === "number" ? value : (
    typeof value === "string" && value.trim() && Number.isFinite(Number(value)) ? Number(value) : null
  );
  if (number != null) {
    const formatted = new Intl.NumberFormat(lang || "en", { maximumFractionDigits: 6 }).format(number);
    const terminal = field.split(".").at(-1) ?? field;
    const areaField = terminal === "area" || terminal === "lot_size" || terminal.endsWith("_area");
    const lengthField = terminal === "plot_width" || terminal === "plot_length" || terminal === "ceiling_height";
    const moneyField = terminal === "price" || field.includes("pricing_extra") || /(?:fee|deposit|advance|fund|heating|water|electricity|waste)$/.test(terminal);
    if (areaField) {
      const lotField = terminal === "lot_size" || terminal === "land_area";
      const rawUnit = lotField
        ? revision.snapshot.lot_size_unit_display ?? revision.snapshot.lot_size_unit_code ?? revision.snapshot.lot_size_unit
        : revision.snapshot.area_unit_display ?? revision.snapshot.area_unit_code ?? revision.snapshot.area_unit;
      const label = unitLabel(resolveUnit(
        units,
        typeof rawUnit === "string" || typeof rawUnit === "number" ? rawUnit : null,
        "AREA",
      ));
      return `${formatted}${label ? ` ${label}` : ""}`;
    }
    if (lengthField) {
      const label = unitLabel(baseUnitForCategory(units, "DISTANCE"));
      return `${formatted}${label ? ` ${label}` : ""}`;
    }
    if (moneyField) {
      const label = unitLabel(resolveUnit(
        units,
        revision.snapshot.currency as string | number | null | undefined,
        "CURRENCY",
      ));
      return `${formatted}${label ? ` ${label}` : ""}`;
    }
    return formatted;
  }
  return String(value).replace(/_/g, " ");
}

function mediaProcessorLabel(version: AgentMediaVersion, lang: string) {
  const processor = version.processor.trim().toLowerCase();
  if (!processor || processor === "original") return t("reai.mediaOriginal", lang);
  if (processor.includes("cleanplate")) return t("reai.mediaProcessor.cleanplate", lang);
  if (processor.includes("retouch")) return t("reai.mediaProcessor.retouch", lang);
  if (processor.includes("hdr")) return t("reai.mediaProcessor.hdr", lang);
  if (processor.includes("local") || processor.includes("grade")) return t("reai.mediaProcessor.localEdit", lang);
  return humanize(version.processor);
}

function mediaOperationLabels(version: AgentMediaVersion, lang: string) {
  return Object.entries(version.operations ?? {})
    .filter(([, value]) => value !== false && value != null)
    .slice(0, 3)
    .map(([key, value]) => {
      const localeKey = `reai.mediaOperation.${key}` as LocaleKey;
      const translated = t(localeKey, lang);
      const label = translated === localeKey ? humanize(key) : translated;
      if (typeof value === "boolean") return label;
      if (key === "motion") return `${label} · ${t(`reai.mediaMotion.${value}` as LocaleKey, lang)}`;
      if (typeof value === "number") return `${label} · ${new Intl.NumberFormat(lang || "en", { maximumFractionDigits: 2 }).format(value)}`;
      return `${label} · ${humanize(String(value))}`;
    });
}

function Working({ lang }: { lang: string }) {
  return (
    <p className="flex items-center justify-center gap-2 py-14 text-center text-[12px] text-muted-foreground" role="status" aria-live="polite">
      <svg className="h-4 w-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
        <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
        <path className="opacity-70" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
      {t("reai.working", lang)}
    </p>
  );
}

function EmptyVersionState({ icon: Icon, title, hint }: { icon: typeof TourIcon; title: string; hint: string }) {
  return (
    <div className="rounded-[1.5rem] border border-dashed border-border/65 bg-card px-6 py-14 text-center sm:rounded-2xl">
      <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-surface-subtle text-foreground/30">
        <Icon size={20} />
      </span>
      <p className="mt-3 text-[14px] font-semibold">{title}</p>
      <p className="mx-auto mt-1 max-w-sm text-[11px] leading-relaxed text-muted-foreground">{hint}</p>
    </div>
  );
}

function parentTourVersions(splats: SplatsByDraftPayload | null): DraftSplatVersion[] {
  return (splats?.splats ?? [])
    .filter((item) => !item.parent_splat_id && !item.room_id)
    .sort((a, b) => new Date(b.created_at ?? b.updated_at ?? 0).getTime() - new Date(a.created_at ?? a.updated_at ?? 0).getTime());
}

function tourReady(item: DraftSplatVersion) {
  return item.status === "completed" && Boolean(
    item.has_sog || item.has_splat || item.has_ply || item.url || Object.keys(item.signed_outputs ?? {}).length,
  );
}

export function DraftVersionManager({
  open,
  onOpenChange,
  draft,
  splats,
  units,
  lang,
  onActiveTourChanged,
  onDraftRestored,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draft: DraftDetailItem;
  splats: SplatsByDraftPayload | null;
  units: readonly UnitLookup[];
  lang: string;
  onActiveTourChanged: (activeSplatId: number | null) => void;
  onDraftRestored: (draft: DraftDetailItem) => void;
}) {
  const { user } = useAuth();
  const dateFormat = user?.localization?.date_format;
  const [activeTab, setActiveTab] = React.useState<VersionTab>("tour");
  const [agentEnabled, setAgentEnabled] = React.useState<boolean | null>(null);
  const [history, setHistory] = React.useState<AgentCreationRevision[]>([]);
  const [media, setMedia] = React.useState<AgentMediaVersionGroup[]>([]);
  const [selectedMedia, setSelectedMedia] = React.useState<Record<string, number>>({});
  const [expandedRevision, setExpandedRevision] = React.useState<number | null>(null);
  const [loadingAgentData, setLoadingAgentData] = React.useState(false);
  const [agentDataError, setAgentDataError] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [tourCandidate, setTourCandidate] = React.useState<number | "auto" | null>(null);
  const [tourBusy, setTourBusy] = React.useState(false);
  const [restoreCandidate, setRestoreCandidate] = React.useState<number | null>(null);
  const [restoreBusy, setRestoreBusy] = React.useState(false);
  const [mediaCandidate, setMediaCandidate] = React.useState<MediaAction>(null);
  const [mediaBusy, setMediaBusy] = React.useState(false);
  const [mediaNotice, setMediaNotice] = React.useState<string | null>(null);
  const mediaRefreshTimers = React.useRef<number[]>([]);

  const versions = parentTourVersions(splats);
  const activeTourId = splats?.parent_splat_id ?? null;
  const automaticTourSelection = activeTourId == null;
  const sortedHistory = React.useMemo(
    () => [...history].sort((a, b) => b.sequence - a.sequence || new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
    [history],
  );

  const applyMediaGroups = React.useCallback((groups: AgentMediaVersionGroup[]) => {
    setMedia(groups);
    setSelectedMedia((current) => Object.fromEntries(groups.flatMap((group) => {
      const currentSelection = group.versions.find((version) => version.id === current[group.logical_asset_id]);
      const preferred = currentSelection
        ?? group.versions.find((version) => version.is_master)
        ?? group.versions.find((version) => !version.is_deleted)
        ?? group.versions[0];
      return preferred ? [[group.logical_asset_id, preferred.id]] : [];
    })));
  }, []);

  const loadAgentData = React.useCallback(async () => {
    setLoadingAgentData(true);
    setAgentDataError(null);
    try {
      const consent = await getReaiAgentConsent();
      setAgentEnabled(consent.consented);
      if (!consent.consented) {
        setHistory([]);
        applyMediaGroups([]);
        return;
      }
      const [historyResult, mediaResult] = await Promise.all([
        getAgentCreationHistory(draft.id),
        getAgentMediaVersions(draft.id),
      ]);
      setHistory(historyResult.revisions);
      applyMediaGroups(mediaResult.groups);
    } catch (reason) {
      setAgentEnabled(null);
      setAgentDataError(getSafeApiErrorMessage(reason, lang));
    } finally {
      setLoadingAgentData(false);
    }
  }, [applyMediaGroups, draft.id, lang]);

  React.useEffect(() => {
    if (!open) return;
    setActiveTab("tour");
    setTourCandidate(null);
    setRestoreCandidate(null);
    setMediaCandidate(null);
    setMediaNotice(null);
    setExpandedRevision(null);
    setActionError(null);
    void loadAgentData();
  }, [open, loadAgentData]);

  React.useEffect(() => {
    if (open) return;
    mediaRefreshTimers.current.forEach((timer) => window.clearTimeout(timer));
    mediaRefreshTimers.current = [];
  }, [open]);

  React.useEffect(() => () => {
    mediaRefreshTimers.current.forEach((timer) => window.clearTimeout(timer));
    mediaRefreshTimers.current = [];
  }, []);

  const activateTour = async () => {
    if (tourCandidate == null) return;
    setTourBusy(true);
    setActionError(null);
    try {
      const result = await setActiveSplat(draft.id, tourCandidate === "auto" ? null : tourCandidate);
      onActiveTourChanged(result.active_splat_id);
      setTourCandidate(null);
    } catch (reason) {
      setActionError(getSafeApiErrorMessage(reason, lang));
    } finally {
      setTourBusy(false);
    }
  };

  const restoreRevision = async (revisionId: number) => {
    setRestoreBusy(true);
    setActionError(null);
    try {
      const result = await restoreAgentCreationRevision(draft.id, revisionId);
      onDraftRestored(result.draft);
      setRestoreCandidate(null);
      await loadAgentData();
    } catch (reason) {
      setActionError(getSafeApiErrorMessage(reason, lang));
    } finally {
      setRestoreBusy(false);
    }
  };

  const applyMediaAction = async () => {
    if (!mediaCandidate) return;
    setMediaBusy(true);
    setActionError(null);
    try {
      await manageAgentMediaVersion(draft.id, mediaCandidate.uploadId, mediaCandidate.action);
      const result = await getAgentMediaVersions(draft.id);
      applyMediaGroups(result.groups);
      setMediaCandidate(null);
    } catch (reason) {
      setActionError(getSafeApiErrorMessage(reason, lang));
    } finally {
      setMediaBusy(false);
    }
  };

  const createMediaVersion = async (
    logicalAssetId: string,
    uploadId: number,
    kind: MediaVersionCreateKind,
  ) => {
    setMediaBusy(true);
    setMediaCandidate(null);
    setMediaNotice(t("reai.mediaCreating", lang));
    setActionError(null);
    mediaRefreshTimers.current.forEach((timer) => window.clearTimeout(timer));
    mediaRefreshTimers.current = [];
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

      const refresh = async () => {
        const result = await getAgentMediaVersions(draft.id);
        applyMediaGroups(result.groups);
      };
      await refresh();
      if (createdUploadId) {
        setSelectedMedia((current) => ({ ...current, [logicalAssetId]: createdUploadId as number }));
      }
      mediaRefreshTimers.current = [1800, 5000, 12000].map((delay, index, delays) => window.setTimeout(() => {
        void refresh().catch(() => undefined);
        if (index === delays.length - 1) setMediaNotice(null);
      }, delay));
    } catch (reason) {
      setMediaNotice(null);
      setActionError(getSafeApiErrorMessage(reason, lang));
    } finally {
      setMediaBusy(false);
    }
  };

  const agentUnavailable = agentEnabled === false && !loadingAgentData;
  const agentDataFailed = agentEnabled === null && Boolean(agentDataError) && !loadingAgentData;
  const visibleError = actionError ?? (activeTab === "tour" ? null : agentDataError);

  return (
    <SidePanel
      open={open}
      onOpenChange={onOpenChange}
      title={t("draft.versions.title", lang)}
      description={draft.title}
      headerMode="editor"
      className="sm:max-w-[700px]"
      lang={lang}
    >
      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as VersionTab)}>
        <div className="mb-1">
          <TabsList className="grid h-11 w-full grid-cols-3 rounded-full border border-border/60 bg-card p-1 shadow-control">
            <VersionTabTrigger value="tour" icon={TourIcon} label={t("draft.versions.tour", lang)} count={versions.length} />
            <VersionTabTrigger value="listing" icon={VersionsIcon} label={t("draft.versions.listing", lang)} count={history.length} />
            <VersionTabTrigger value="media" icon={ImageIcon} label={t("draft.versions.media", lang)} count={media.length} />
          </TabsList>
        </div>

        {visibleError ? (
          <div role="alert" className="mt-4 flex items-center justify-between gap-3 rounded-2xl border border-destructive/20 bg-destructive/[0.045] px-4 py-3 text-[12px] text-destructive">
            <p className="min-w-0 leading-relaxed">{visibleError}</p>
            {agentDataFailed && activeTab !== "tour" ? <Button type="button" variant="outline" size="xs" className="shrink-0" onClick={() => void loadAgentData()}>{t("common.tryAgain", lang)}</Button> : null}
          </div>
        ) : null}

        <TabsContent value="tour" className="mt-3 space-y-3">
          {versions.length === 0 ? (
            <EmptyVersionState icon={TourIcon} title={t("draft.versions.noTours", lang)} hint={t("tours.emptyHint", lang)} />
          ) : (
            <>
              <div className="flex min-h-8 items-center justify-between gap-3 px-0.5">
                <p className="text-[12px] font-medium text-muted-foreground">
                  <span className="font-semibold tabular-nums text-foreground/70">{versions.length}</span> {t("draft.versions.tourVersions", lang)}
                </p>
                {versions.length > 1 ? automaticTourSelection ? (
                  <StatusPill><CheckIcon size={11} />{t("draft.versions.useNewest", lang)}</StatusPill>
                ) : (
                  <Button type="button" variant="outline" size="xs" disabled={tourBusy} onClick={() => setTourCandidate("auto")}>{t("draft.versions.useNewest", lang)}</Button>
                ) : null}
              </div>

              {tourCandidate === "auto" ? (
                <ConfirmationCard
                  message={t("draft.versions.autoConfirm", lang)}
                  cancelLabel={t("shares.cancel", lang)}
                  confirmLabel={t("draft.versions.useNewest", lang)}
                  busy={tourBusy}
                  onCancel={() => setTourCandidate(null)}
                  onConfirm={() => void activateTour()}
                />
              ) : null}

              <div className="space-y-2.5">
                {versions.map((version, index) => {
                  const id = version.splat_id ?? version.id;
                  const active = id === activeTourId || (automaticTourSelection && index === 0 && tourReady(version));
                  const ready = tourReady(version);
                  const date = formatDate(version.processing_completed_at ?? version.created_at ?? version.updated_at, dateFormat, lang);
                  return (
                    <article key={id} className={cn(
                      "overflow-hidden rounded-[1.5rem] border bg-card p-3 shadow-control sm:rounded-2xl",
                      active ? "border-foreground/20 ring-1 ring-foreground/[0.04]" : "border-border/60",
                    )}>
                      <div className="flex items-stretch gap-3">
                        <div className="relative h-24 w-[7.5rem] shrink-0 overflow-hidden rounded-[1rem] bg-surface-subtle sm:w-36 sm:rounded-xl">
                          {version.thumbnail_url ? (
                            <img src={version.thumbnail_url} alt="" loading="lazy" className="h-full w-full object-cover" />
                          ) : (
                            <TourIcon size={22} className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-foreground/20" />
                          )}
                          {ready ? (
                            <Link href={`/tour/${id}`} aria-label={t("tours.open", lang)} className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full border border-white/20 bg-black/55 text-white backdrop-blur-md transition-colors hover:bg-black/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">
                              <ExternalLinkIcon size={13} />
                            </Link>
                          ) : null}
                        </div>
                        <div className="min-w-0 flex-1 py-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-[14px] font-semibold tracking-[-0.01em]">{t("draft.versions.scan", lang)} {versions.length - index}</h3>
                            {active ? <StatusPill tone="strong"><CheckIcon size={11} />{t("draft.versions.live", lang)}</StatusPill> : null}
                            {!ready ? <StatusPill tone={version.status === "failed" ? "danger" : "warning"}>{enumLabel("dashboard.status", version.status, lang)}</StatusPill> : null}
                          </div>
                          <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                            {[enumLabel("enum.scan", version.scan_type, lang), date].filter(Boolean).join(" · ")}
                          </p>
                          {version.delivery_versions_count && version.delivery_versions_count > 1 ? (
                            <p className="mt-1 text-[11px] text-muted-foreground">{version.delivery_versions_count} {t("tours.versions", lang)}</p>
                          ) : null}
                          {!active && ready ? (
                            <Button type="button" variant="outline" size="xs" className="mt-3" disabled={tourBusy} onClick={() => setTourCandidate(id)}>{t("draft.versions.makeLive", lang)}</Button>
                          ) : null}
                        </div>
                      </div>
                      {tourCandidate === id ? (
                        <div className="mt-3 border-t border-border/45 pt-3">
                          <ConfirmationCard
                            compact
                            message={t("draft.versions.liveConfirm", lang)}
                            cancelLabel={t("shares.cancel", lang)}
                            confirmLabel={t("draft.versions.makeLive", lang)}
                            busy={tourBusy}
                            onCancel={() => setTourCandidate(null)}
                            onConfirm={() => void activateTour()}
                          />
                        </div>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            </>
          )}
        </TabsContent>

        <TabsContent value="listing" className="mt-3">
          {loadingAgentData ? <Working lang={lang} /> : agentUnavailable ? (
            <AgentRequired lang={lang} />
          ) : agentDataFailed ? null : sortedHistory.length === 0 ? (
            <EmptyVersionState icon={VersionsIcon} title={t("draft.versions.noListingHistory", lang)} hint={t("reai.historyEmpty", lang)} />
          ) : (
            <>
              <div className="mb-5 flex items-start gap-3 rounded-2xl bg-surface-subtle px-4 py-3 text-foreground/60">
                <ClockIcon size={16} className="mt-0.5 shrink-0" />
                <p className="text-[11px] leading-relaxed">{t("reai.historySafety", lang)}</p>
              </div>
              <div className="relative ml-3 border-l border-border/55 pl-5 sm:ml-4 sm:pl-6">
                {sortedHistory.map((revision, index) => {
                  const current = index === 0;
                  const expanded = expandedRevision === revision.id;
                  const changes = revisionChanges(revision);
                  const displayFields = changes.length
                    ? changes.map((change) => change.key)
                    : revision.changed_fields;
                  return (
                    <article key={revision.id} className="relative pb-4 last:pb-0">
                      <span className={cn(
                        "absolute -left-[25px] top-6 h-2.5 w-2.5 rounded-full ring-4 ring-background sm:-left-[29px]",
                        current ? "bg-foreground" : "bg-border",
                      )} />
                      <div className={cn(
                        "overflow-hidden rounded-[1.5rem] border bg-card shadow-control sm:rounded-2xl",
                        current ? "border-foreground/20" : "border-border/60",
                      )}>
                        <button
                          type="button"
                          onClick={() => setExpandedRevision(expanded ? null : revision.id)}
                          className="w-full p-4 text-left transition-colors hover:bg-foreground/[0.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:p-5"
                          aria-expanded={expanded}
                        >
                          <span className="flex items-start justify-between gap-3">
                            <span className="min-w-0">
                              <span className="flex flex-wrap items-center gap-2">
                                <span className="text-[13px] font-semibold">{t("common.version", lang)} {revision.sequence}</span>
                                {current ? <StatusPill tone="strong">{t("reai.currentVersion", lang)}</StatusPill> : null}
                              </span>
                              <span className="mt-1 block text-[11px] font-medium text-foreground/55">{t(`reai.history.${revision.source}` as LocaleKey, lang)}</span>
                              <span className="mt-0.5 block text-[11px] text-muted-foreground">{formatDate(revision.created_at, dateFormat, lang)}</span>
                            </span>
                            <ChevronDownIcon size={15} className={cn("mt-1 shrink-0 text-foreground/40 transition-transform", expanded && "rotate-180")} />
                          </span>
                          {displayFields.length ? (
                            <span className="mt-3 flex flex-wrap gap-1.5">
                              {[...new Set(displayFields.map((field) => revisionFieldLabel(field, lang)))].slice(0, 4).map((field) => (
                                <span key={field} className="rounded-full border border-border/45 bg-surface-subtle px-2.5 py-1 text-[10px] font-medium text-foreground/55">{field}</span>
                              ))}
                              {displayFields.length > 4 ? <span className="rounded-full px-2 py-1 text-[10px] font-semibold text-muted-foreground">+{displayFields.length - 4}</span> : null}
                            </span>
                          ) : null}
                        </button>

                        {expanded ? (
                          <div className="border-t border-border/45 bg-surface-subtle/35 p-4 sm:p-5">
                            {changes.length ? (
                              <div className="space-y-2.5">
                                {changes.slice(0, 10).map((change) => (
                                  <div key={change.key} className="rounded-2xl border border-border/45 bg-card p-3">
                                    <p className="text-[11px] font-semibold text-foreground/70">{revisionFieldLabel(change.key, lang)}</p>
                                    <div className="mt-2 grid grid-cols-[minmax(0,1fr)_1rem_minmax(0,1fr)] items-start gap-2">
                                      <div className="min-w-0">
                                        <p className="text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{t("reai.historyBefore", lang)}</p>
                                        <p className="mt-1 line-clamp-3 break-words text-[11px] leading-relaxed text-foreground/60">{revisionValue(change.key, change.before, revision, lang, units)}</p>
                                      </div>
                                      <ArrowRightIcon size={13} className="mt-5 text-foreground/25" />
                                      <div className="min-w-0">
                                        <p className="text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{t("reai.historyAfter", lang)}</p>
                                        <p className="mt-1 line-clamp-3 break-words text-[11px] font-medium leading-relaxed text-foreground/80">{revisionValue(change.key, change.after, revision, lang, units)}</p>
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className="text-[11px] text-muted-foreground">{t("reai.detailsChanged", lang)}</p>
                            )}

                            {!current ? (
                              <div className="mt-4 flex justify-end">
                                <Button type="button" variant="outline" size="sm" disabled={restoreBusy} onClick={() => setRestoreCandidate(revision.id)}>{t("reai.restore", lang)}</Button>
                              </div>
                            ) : null}

                            {restoreCandidate === revision.id ? (
                              <div className="mt-3">
                                <ConfirmationCard
                                  compact
                                  message={t("reai.restoreConfirm", lang)}
                                  cancelLabel={t("reai.restoreCancel", lang)}
                                  confirmLabel={t("reai.restore", lang)}
                                  busy={restoreBusy}
                                  onCancel={() => setRestoreCandidate(null)}
                                  onConfirm={() => void restoreRevision(revision.id)}
                                />
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    </article>
                  );
                })}
              </div>
            </>
          )}
        </TabsContent>

        <TabsContent value="media" className="mt-3">
          {loadingAgentData ? <Working lang={lang} /> : agentUnavailable ? (
            <AgentRequired lang={lang} />
          ) : agentDataFailed ? null : media.length === 0 ? (
            <EmptyVersionState icon={ImageIcon} title={t("draft.versions.noMediaVersions", lang)} hint={t("reai.mediaVersionsEmpty", lang)} />
          ) : (
            <>
              <p className="mb-4 flex items-start gap-2.5 rounded-2xl bg-surface-subtle px-4 py-3 text-[11px] leading-relaxed text-foreground/60">
                <CheckIcon size={14} className="mt-0.5 shrink-0" />
                {t("reai.mediaVersionsSafety", lang)}
              </p>
              {mediaNotice ? (
                <div className="editor-glass-control mb-4 flex items-center gap-3 rounded-full border px-3.5 py-2.5 text-[11px] text-foreground/70" role="status" aria-live="polite">
                  <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-foreground/15 border-t-foreground/65" aria-hidden="true" />
                  <span>{mediaNotice}</span>
                </div>
              ) : null}
              <div className="grid gap-4 lg:grid-cols-2">
                {media.map((group, groupIndex) => (
                  <MediaVersionCard
                    key={group.logical_asset_id}
                    group={group}
                    groupIndex={groupIndex}
                    selectedId={selectedMedia[group.logical_asset_id]}
                    lang={lang}
                    dateFormat={dateFormat}
                    candidate={mediaCandidate}
                    busy={mediaBusy}
                    onSelect={(id) => {
                      setSelectedMedia((current) => ({ ...current, [group.logical_asset_id]: id }));
                      setMediaCandidate(null);
                    }}
                    onCandidate={setMediaCandidate}
                    onCancel={() => setMediaCandidate(null)}
                    onConfirm={() => void applyMediaAction()}
                    onCreate={(uploadId, kind) => void createMediaVersion(group.logical_asset_id, uploadId, kind)}
                  />
                ))}
              </div>
            </>
          )}
        </TabsContent>
      </Tabs>
    </SidePanel>
  );
}

function VersionTabTrigger({
  value,
  icon: Icon,
  label,
  count,
}: {
  value: VersionTab;
  icon: typeof TourIcon;
  label: string;
  count: number;
}) {
  return (
    <TabsTrigger value={value} className="group h-9 gap-1.5 px-2 text-[11px] data-[state=active]:bg-foreground data-[state=active]:text-background data-[state=active]:shadow-sm sm:text-[12px]">
      <Icon size={14} />
      <span>{label}</span>
      {count > 0 ? <span className="hidden min-w-5 rounded-full bg-foreground/[0.07] px-1.5 py-0.5 text-[9px] font-semibold tabular-nums group-data-[state=active]:bg-background/15 min-[430px]:inline-flex">{count}</span> : null}
    </TabsTrigger>
  );
}

function ConfirmationCard({
  message,
  cancelLabel,
  confirmLabel,
  busy,
  onCancel,
  onConfirm,
  compact = false,
}: {
  message: string;
  cancelLabel: string;
  confirmLabel: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  compact?: boolean;
}) {
  return (
    <div className={cn(
      "rounded-[1.5rem] border border-border/65 bg-card sm:rounded-2xl",
      compact ? "p-3" : "p-4 shadow-card",
    )}>
      <p className="text-[11px] leading-relaxed text-foreground/65">{message}</p>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" size="xs" className="pen-touch-target" disabled={busy} onClick={onCancel}>{cancelLabel}</Button>
        <Button type="button" size="xs" className="pen-touch-target" loading={busy} onClick={onConfirm}>{confirmLabel}</Button>
      </div>
    </div>
  );
}

export function MediaVersionCard({
  group,
  groupIndex,
  selectedId,
  lang,
  dateFormat,
  candidate,
  busy,
  onSelect,
  onCandidate,
  onCancel,
  onConfirm,
  onCreate,
}: {
  group: AgentMediaVersionGroup;
  groupIndex: number;
  selectedId: number | undefined;
  lang: string;
  dateFormat: string | null | undefined;
  candidate: MediaAction;
  busy: boolean;
  onSelect: (id: number) => void;
  onCandidate: (candidate: Exclude<MediaAction, null>) => void;
  onCancel: () => void;
  onConfirm: () => void;
  onCreate?: (uploadId: number, kind: MediaVersionCreateKind) => void;
}) {
  const [createOpen, setCreateOpen] = React.useState(false);
  const [createKind, setCreateKind] = React.useState<MediaVersionCreateKind>("enhance");
  const versions = [...group.versions].sort((a, b) => a.version - b.version);
  const selected = versions.find((version) => version.id === selectedId)
    ?? versions.find((version) => version.is_master)
    ?? versions.find((version) => !version.is_deleted)
    ?? versions[0];
  if (!selected) return null;
  const selectedIndex = versions.findIndex((version) => version.id === selected.id);
  const older = selectedIndex > 0 ? versions[selectedIndex - 1] : null;
  const newer = selectedIndex < versions.length - 1 ? versions[selectedIndex + 1] : null;
  const operations = mediaOperationLabels(selected, lang);
  const selectedCandidate = candidate?.uploadId === selected.id ? candidate : null;

  return (
    <section className="editor-glass-surface overflow-hidden rounded-[1.5rem] border sm:rounded-2xl">
      <div className="relative aspect-[16/9] overflow-hidden bg-surface-subtle">
        {selected.file_url ? (
          <img src={selected.file_url} alt="" loading="lazy" className={cn("h-full w-full object-cover transition-opacity", selected.is_deleted && "opacity-65")} />
        ) : (
          <ImageIcon size={25} className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-foreground/20" />
        )}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/65 via-black/0 to-black/25" />
        <StatusPill className="absolute left-3 top-3 border-white/20 bg-black/45 text-[9px] text-white backdrop-blur-md">
          {t("reai.mediaVersionPosition", lang)
            .replace("{current}", String(selectedIndex + 1))
            .replace("{total}", String(versions.length))}
        </StatusPill>
        <div className="absolute right-3 top-3 flex flex-wrap justify-end gap-1.5">
          {selected.is_master ? <StatusPill className="glass-chip text-[9px]">{t("reai.mediaCurrent", lang)}</StatusPill> : null}
          {selected.is_deleted ? <StatusPill tone="strong" className="border-white/15 bg-black/60 text-[9px] text-white">{t("reai.mediaHidden", lang)}</StatusPill> : null}
        </div>
        <div className="absolute inset-x-3 bottom-3 flex items-end justify-between gap-3 text-white">
          <div className="min-w-0">
            <p className="text-[13px] font-semibold">v{selected.version}</p>
            <p className="mt-0.5 truncate text-[10px] text-white/75">{selected.file_name || t("reai.mediaAsset", lang).replace("{number}", String(groupIndex + 1))}</p>
            <p className="mt-0.5 text-[9px] text-white/55">{formatDate(selected.uploaded_at, dateFormat, lang)}</p>
          </div>
          <div className="editor-control-capsule pointer-events-auto flex shrink-0 overflow-hidden rounded-full border">
            <button
              type="button"
              className="pen-touch-target flex h-11 w-11 items-center justify-center text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-30 sm:h-9 sm:w-9"
              disabled={busy || !older}
              onClick={() => older && onSelect(older.id)}
              aria-label={t("reai.mediaPreviousVersion", lang)}
            >
              <ArrowLeftIcon size={14} />
            </button>
            <span className="h-5 w-px self-center bg-border/70" aria-hidden="true" />
            <button
              type="button"
              className="pen-touch-target flex h-11 w-11 items-center justify-center text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-30 sm:h-9 sm:w-9"
              disabled={busy || !newer}
              onClick={() => newer && onSelect(newer.id)}
              aria-label={t("reai.mediaNextVersion", lang)}
            >
              <ArrowRightIcon size={14} />
            </button>
          </div>
        </div>
      </div>

      {versions.length > 1 ? (
        <div className="flex gap-2 overflow-x-auto border-b border-border/45 p-3 scrollbar-thin" aria-label={t("reai.mediaVersions", lang)}>
          {versions.map((version) => {
            const active = version.id === selected.id;
            return (
              <button
                key={version.id}
                type="button"
                disabled={busy}
                onClick={() => onSelect(version.id)}
                className={cn(
                  "relative h-14 w-20 shrink-0 overflow-hidden rounded-md border-2 bg-surface-subtle transition-[border-color,opacity,transform] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                  active ? "border-foreground" : "border-transparent opacity-65 hover:opacity-100",
                  version.is_deleted && "opacity-45",
                )}
                aria-label={`${t("common.version", lang)} ${version.version}`}
                aria-pressed={active}
              >
                {version.file_url ? <img src={version.file_url} alt="" loading="lazy" className="h-full w-full object-cover" /> : <ImageIcon size={14} className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-foreground/20" />}
                <span className="absolute bottom-1 left-1 rounded-sm bg-black/70 px-1.5 py-0.5 text-[8px] font-semibold text-white">v{version.version}</span>
                {version.is_master ? <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-white ring-2 ring-black/40" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}

      <div className="p-3.5">
        <p className="mb-3 truncate text-[10px] text-muted-foreground" title={[mediaProcessorLabel(selected, lang), ...operations].join(" · ")}>
          {[mediaProcessorLabel(selected, lang), ...operations].join(" · ")}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {onCreate && !selected.is_deleted ? (
            <Button
              type="button"
              variant="outline"
              size="xs"
              className="editor-glass-control pen-touch-target"
              disabled={busy}
              aria-expanded={createOpen}
              onClick={() => {
                setCreateOpen((current) => !current);
                onCancel();
              }}
            >
              <PlusIcon size={13} />
              {t("reai.mediaNewVersion", lang)}
            </Button>
          ) : null}
          {!selected.is_deleted && !selected.is_master ? (
            <Button type="button" size="xs" className="pen-touch-target" disabled={busy} onClick={() => onCandidate({ uploadId: selected.id, action: "promote" })}>{t("reai.mediaUseVersion", lang)}</Button>
          ) : null}
          {!selected.is_deleted ? (
            <Button type="button" variant="outline" size="xs" className="pen-touch-target" disabled={busy} onClick={() => onCandidate({ uploadId: selected.id, action: "hide" })}>{t("reai.mediaHide", lang)}</Button>
          ) : (
            <Button type="button" size="xs" className="pen-touch-target" disabled={busy} onClick={() => onCandidate({ uploadId: selected.id, action: "restore" })}>{t("reai.mediaRestore", lang)}</Button>
          )}
        </div>

        {createOpen && onCreate ? (
          <div className="mt-3 overflow-hidden rounded-2xl border border-border/55 bg-background/45">
            <div className="border-b border-border/45 px-3.5 py-3">
              <p className="text-[12px] font-semibold">{t("reai.mediaCreateQuestion", lang)}</p>
              <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
                {t("reai.mediaCreateFrom", lang).replace("{version}", String(selected.version))}
              </p>
            </div>
            <div role="radiogroup" aria-label={t("reai.mediaCreateQuestion", lang)}>
              {([
                ["enhance", "reai.mediaCreateEnhance", "reai.mediaCreateEnhanceHint"],
                ["cleanplate", "reai.mediaCreateCleanplate", "reai.mediaCreateCleanplateHint"],
                ["hdr", "reai.mediaCreateHdr", "reai.mediaCreateHdrHint"],
              ] as const).map(([kind, labelKey, hintKey], index) => {
                const active = createKind === kind;
                return (
              <button
                key={kind}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={busy}
                className={cn(
                  "group flex w-full items-start gap-3 px-3.5 py-3 text-left transition-colors hover:bg-foreground/[0.045] disabled:opacity-50",
                  index > 0 && "border-t border-border/40",
                  active && "bg-foreground/[0.045]",
                )}
                onClick={() => setCreateKind(kind)}
              >
                <span className={cn(
                  "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors",
                  active
                    ? "border-foreground bg-foreground text-background"
                    : "border-border/80 bg-card text-transparent group-hover:border-foreground/45",
                )}>
                  <CheckIcon size={11} />
                </span>
                <span className="min-w-0">
                  <span className="block text-[11px] font-semibold">{t(labelKey, lang)}</span>
                  <span className="mt-1 block text-[10px] leading-relaxed text-muted-foreground">{t(hintKey, lang)}</span>
                </span>
              </button>
                );
              })}
            </div>
            <div className="border-t border-border/45 bg-card/45 p-3">
              <p className="mb-2.5 flex items-start gap-2 text-[9px] leading-relaxed text-muted-foreground">
                <CheckIcon size={12} className="mt-0.5 shrink-0 text-foreground/60" />
                {t("reai.mediaCreateHint", lang)}
              </p>
              <Button
                type="button"
                size="sm"
                className="w-full"
                loading={busy}
                onClick={() => {
                  setCreateOpen(false);
                  onCreate(selected.id, createKind);
                }}
              >
                {t("reai.mediaCreateAction", lang)}
                <ArrowRightIcon size={14} />
              </Button>
            </div>
          </div>
        ) : null}

        {selectedCandidate ? (
          <div className="mt-3 border-t border-border/45 pt-3">
            <ConfirmationCard
              compact
              message={selectedCandidate.action === "hide" ? t("reai.mediaHideConfirm", lang) : t("reai.mediaActionConfirm", lang)}
              cancelLabel={t("shares.cancel", lang)}
              confirmLabel={t("common.confirm", lang)}
              busy={busy}
              onCancel={onCancel}
              onConfirm={onConfirm}
            />
          </div>
        ) : null}
      </div>
    </section>
  );
}

function AgentRequired({ lang }: { lang: string }) {
  return (
    <div className="rounded-[1.5rem] border border-dashed border-border/65 bg-card px-6 py-12 text-center sm:rounded-2xl">
      <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-surface-subtle text-foreground/30"><VersionsIcon size={20} /></span>
      <p className="mx-auto mt-3 max-w-sm text-[12px] font-semibold leading-relaxed">{t("draft.versions.agentRequired", lang)}</p>
      <Link href="/settings#reai" className="mt-4 inline-flex rounded-full border border-border/70 px-3.5 py-2 text-[11px] font-semibold transition-colors hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{t("settings.tab.reai", lang)}</Link>
    </div>
  );
}

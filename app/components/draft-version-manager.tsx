"use client";

import * as React from "react";
import Link from "next/link";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../lib/ui/tabs";
import { Button } from "../lib/ui/button";
import {
  getAgentCreationHistory,
  getAgentMediaVersions,
  getReaiAgentConsent,
  manageAgentMediaVersion,
  restoreAgentCreationRevision,
  setActiveSplat,
  type AgentCreationRevision,
  type AgentMediaVersionGroup,
} from "../lib/api/client";
import { getSafeApiErrorMessage } from "../lib/api/error-message";
import { formatDate, t, type LocaleKey } from "../lib/i18n";
import type { DraftDetailItem, DraftSplatVersion, SplatsByDraftPayload } from "../lib/tour-types";
import { cn } from "../lib/utils";
import { useAuth } from "./hooks/use-auth";
import { CheckIcon, ExternalLinkIcon, ImageIcon, TourIcon, VersionsIcon } from "./icons";
import { SidePanel } from "./side-panel";
import { StatusPill } from "./status-pill";

type MediaAction = { uploadId: number; action: "promote" | "hide" | "restore" } | null;

/** Translate a backend enum value through i18n, falling back to a humanized value. */
function enumLabel(prefix: string, value: string | null | undefined, lang: string): string | null {
  if (!value) return null;
  const key = `${prefix}.${String(value).toLowerCase()}` as LocaleKey;
  const translated = t(key, lang);
  return translated === key ? String(value).replace(/_/g, " ") : translated;
}

function Working({ lang }: { lang: string }) {
  return (
    <p className="flex items-center justify-center gap-2 py-10 text-center text-[11px] text-muted-foreground" role="status" aria-live="polite">
      <svg className="h-3.5 w-3.5 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
      {t("reai.working", lang)}
    </p>
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
  lang,
  onActiveTourChanged,
  onDraftRestored,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draft: DraftDetailItem;
  splats: SplatsByDraftPayload | null;
  lang: string;
  onActiveTourChanged: (activeSplatId: number | null) => void;
  onDraftRestored: (draft: DraftDetailItem) => void;
}) {
  const { user } = useAuth();
  const dateFormat = user?.localization?.date_format;
  const [activeTab, setActiveTab] = React.useState("tour");
  const [agentEnabled, setAgentEnabled] = React.useState<boolean | null>(null);
  const [history, setHistory] = React.useState<AgentCreationRevision[]>([]);
  const [media, setMedia] = React.useState<AgentMediaVersionGroup[]>([]);
  const [loadingAgentData, setLoadingAgentData] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [tourCandidate, setTourCandidate] = React.useState<number | "auto" | null>(null);
  const [tourBusy, setTourBusy] = React.useState(false);
  const [restoreCandidate, setRestoreCandidate] = React.useState<number | null>(null);
  const [restoreBusy, setRestoreBusy] = React.useState(false);
  const [mediaCandidate, setMediaCandidate] = React.useState<MediaAction>(null);
  const [mediaBusy, setMediaBusy] = React.useState(false);

  const versions = parentTourVersions(splats);
  const activeTourId = splats?.parent_splat_id ?? null;

  const loadAgentData = React.useCallback(async () => {
    setLoadingAgentData(true);
    setError(null);
    try {
      const consent = await getReaiAgentConsent();
      setAgentEnabled(consent.consented);
      if (!consent.consented) {
        setHistory([]);
        setMedia([]);
        return;
      }
      const [historyResult, mediaResult] = await Promise.all([
        getAgentCreationHistory(draft.id),
        getAgentMediaVersions(draft.id),
      ]);
      setHistory(historyResult.revisions);
      setMedia(mediaResult.groups);
    } catch (reason) {
      setError(getSafeApiErrorMessage(reason, lang));
    } finally {
      setLoadingAgentData(false);
    }
  }, [draft.id, lang]);

  React.useEffect(() => {
    if (!open) return;
    setActiveTab("tour");
    setTourCandidate(null);
    setRestoreCandidate(null);
    setMediaCandidate(null);
    void loadAgentData();
  }, [open, loadAgentData]);

  const activateTour = async () => {
    if (tourCandidate == null) return;
    setTourBusy(true);
    setError(null);
    try {
      const result = await setActiveSplat(draft.id, tourCandidate === "auto" ? null : tourCandidate);
      onActiveTourChanged(result.active_splat_id);
      setTourCandidate(null);
    } catch (reason) {
      setError(getSafeApiErrorMessage(reason, lang));
    } finally {
      setTourBusy(false);
    }
  };

  const restoreRevision = async (revisionId: number) => {
    setRestoreBusy(true);
    setError(null);
    try {
      const result = await restoreAgentCreationRevision(draft.id, revisionId);
      onDraftRestored(result.draft);
      setRestoreCandidate(null);
      await loadAgentData();
    } catch (reason) {
      setError(getSafeApiErrorMessage(reason, lang));
    } finally {
      setRestoreBusy(false);
    }
  };

  const applyMediaAction = async () => {
    if (!mediaCandidate) return;
    setMediaBusy(true);
    setError(null);
    try {
      await manageAgentMediaVersion(draft.id, mediaCandidate.uploadId, mediaCandidate.action);
      const result = await getAgentMediaVersions(draft.id);
      setMedia(result.groups);
      setMediaCandidate(null);
    } catch (reason) {
      setError(getSafeApiErrorMessage(reason, lang));
    } finally {
      setMediaBusy(false);
    }
  };

  const agentUnavailable = agentEnabled === false && !loadingAgentData;

  return (
    <SidePanel
      open={open}
      onOpenChange={onOpenChange}
      title={t("draft.versions.title", lang)}
      description={draft.title}
      className="sm:max-w-[580px]"
      lang={lang}
    >
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-3 rounded-xl bg-foreground/[0.045] p-1">
          <TabsTrigger value="tour" className="gap-1.5 text-[11px]"><TourIcon size={14} />{t("draft.versions.tour", lang)}</TabsTrigger>
          <TabsTrigger value="listing" className="gap-1.5 text-[11px]"><VersionsIcon size={14} />{t("draft.versions.listing", lang)}</TabsTrigger>
          <TabsTrigger value="media" className="gap-1.5 text-[11px]"><ImageIcon size={14} />{t("draft.versions.media", lang)}</TabsTrigger>
        </TabsList>

        {error ? <p role="alert" className="mt-4 rounded-xl border border-destructive/20 bg-destructive/[0.04] px-3 py-2.5 text-[11px] text-destructive">{error}</p> : null}

        <TabsContent value="tour" className="mt-5 space-y-3">
          {versions.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border/60 px-5 py-12 text-center">
              <TourIcon size={22} className="mx-auto text-foreground/25" />
              <p className="mt-3 text-[13px] font-semibold">{t("draft.versions.noTours", lang)}</p>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{t("tours.emptyHint", lang)}</p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-3 pb-1">
                <p className="text-[11px] text-muted-foreground">{versions.length} {t("draft.versions.tourVersions", lang)}</p>
                {versions.length > 1 ? (
                  <Button type="button" variant="outline" size="xs" onClick={() => setTourCandidate("auto")}>
                    {t("draft.versions.useNewest", lang)}
                  </Button>
                ) : null}
              </div>
              <div className="overflow-hidden rounded-xl border border-border/60 bg-surface">
                {versions.map((version, index) => {
                  const id = version.splat_id ?? version.id;
                  const active = id === activeTourId;
                  const ready = tourReady(version);
                  return (
                    <article key={id} className={cn("p-4", index > 0 && "border-t border-border/40")}>
                      <div className="flex items-start gap-3">
                        <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", active ? "bg-foreground text-background" : "bg-foreground/[0.05] text-foreground/45")}><TourIcon size={17} /></div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-[12px] font-semibold">{t("draft.versions.scan", lang)} {versions.length - index}</p>
                            {active ? <StatusPill tone="strong"><CheckIcon size={11} />{t("draft.versions.live", lang)}</StatusPill> : null}
                            {!ready ? <StatusPill tone={version.status === "failed" ? "danger" : "warning"}>{enumLabel("dashboard.status", version.status, lang)}</StatusPill> : null}
                          </div>
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            {[enumLabel("enum.scan", version.scan_type, lang), formatDate(version.processing_completed_at ?? version.created_at ?? version.updated_at, dateFormat, lang)].filter(Boolean).join(" · ")}
                          </p>
                          {version.delivery_versions_count && version.delivery_versions_count > 1 ? <p className="mt-1 text-[11px] text-muted-foreground">{version.delivery_versions_count} {t("tours.versions", lang)}</p> : null}
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          {ready ? (
                            <Link href={`/tour/${id}`} aria-label={t("tours.open", lang)} className="flex h-8 w-8 items-center justify-center rounded-lg text-foreground/45 transition-colors hover:bg-foreground/[0.04] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"><ExternalLinkIcon size={14} /></Link>
                          ) : null}
                          {!active && ready ? <Button type="button" variant="outline" size="xs" onClick={() => setTourCandidate(id)}>{t("draft.versions.makeLive", lang)}</Button> : null}
                        </div>
                      </div>
                      {tourCandidate === id ? (
                        <div className="mt-3 rounded-xl border border-border/60 bg-surface p-3">
                          <p className="text-[11px] leading-relaxed text-foreground/65">{t("draft.versions.liveConfirm", lang)}</p>
                          <div className="mt-3 flex justify-end gap-2">
                            <Button type="button" variant="ghost" size="xs" onClick={() => setTourCandidate(null)}>{t("shares.cancel", lang)}</Button>
                            <Button type="button" size="xs" loading={tourBusy} onClick={() => void activateTour()}>{t("draft.versions.makeLive", lang)}</Button>
                          </div>
                        </div>
                      ) : null}
                    </article>
                  );
                })}
              </div>
              {tourCandidate === "auto" ? (
                <div className="rounded-xl border border-border/60 bg-surface p-3">
                  <p className="text-[11px] leading-relaxed text-foreground/65">{t("draft.versions.autoConfirm", lang)}</p>
                  <div className="mt-3 flex justify-end gap-2">
                    <Button type="button" variant="ghost" size="xs" onClick={() => setTourCandidate(null)}>{t("shares.cancel", lang)}</Button>
                    <Button type="button" size="xs" loading={tourBusy} onClick={() => void activateTour()}>{t("draft.versions.useNewest", lang)}</Button>
                  </div>
                </div>
              ) : null}
            </>
          )}
        </TabsContent>

        <TabsContent value="listing" className="mt-5">
          {loadingAgentData ? <Working lang={lang} /> : agentUnavailable ? (
            <AgentRequired lang={lang} />
          ) : history.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border/60 px-5 py-12 text-center">
              <VersionsIcon size={22} className="mx-auto text-foreground/25" />
              <p className="mt-3 text-[13px] font-semibold">{t("draft.versions.noListingHistory", lang)}</p>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{t("reai.historyEmpty", lang)}</p>
            </div>
          ) : (
            <div className="relative ml-2 border-l border-border/60 pl-5">
              {history.map((revision, index) => (
                <article key={revision.id} className="relative pb-6 last:pb-0">
                  <span className={cn("absolute -left-[25px] top-1 h-2 w-2 rounded-full ring-4 ring-background", index === 0 ? "bg-foreground" : "bg-border")} />
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-[11px] font-semibold">{t(`reai.history.${revision.source}` as LocaleKey, lang)}</p>
                        {index === 0 ? <StatusPill>{t("reai.currentVersion", lang)}</StatusPill> : null}
                      </div>
                      <p className="mt-1 text-[11px] text-muted-foreground">{formatDate(revision.created_at, dateFormat, lang)}</p>
                      {revision.changed_fields.length ? <div className="mt-2 flex flex-wrap gap-1">{revision.changed_fields.map((field) => <span key={field} className="rounded-full bg-foreground/[0.045] px-2 py-0.5 text-[11px] text-foreground/55">{field.replaceAll("_", " ")}</span>)}</div> : null}
                    </div>
                    {index > 0 ? <Button type="button" variant="outline" size="xs" onClick={() => setRestoreCandidate(revision.id)}>{t("reai.restore", lang)}</Button> : null}
                  </div>
                  {restoreCandidate === revision.id ? (
                    <div className="mt-3 rounded-xl border border-border/60 bg-surface p-3">
                      <p className="text-[11px] leading-relaxed text-foreground/65">{t("reai.restoreConfirm", lang)}</p>
                      <div className="mt-3 flex justify-end gap-2">
                        <Button type="button" variant="ghost" size="xs" onClick={() => setRestoreCandidate(null)}>{t("reai.restoreCancel", lang)}</Button>
                        <Button type="button" size="xs" loading={restoreBusy} onClick={() => void restoreRevision(revision.id)}>{t("reai.restore", lang)}</Button>
                      </div>
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="media" className="mt-5">
          {loadingAgentData ? <Working lang={lang} /> : agentUnavailable ? (
            <AgentRequired lang={lang} />
          ) : media.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border/60 px-5 py-12 text-center">
              <ImageIcon size={22} className="mx-auto text-foreground/25" />
              <p className="mt-3 text-[13px] font-semibold">{t("draft.versions.noMediaVersions", lang)}</p>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{t("reai.mediaVersionsEmpty", lang)}</p>
            </div>
          ) : (
            <div className="space-y-4">
              {media.map((group, groupIndex) => (
                <section key={group.logical_asset_id} className="overflow-hidden rounded-xl border border-border/60 bg-surface">
                  <div className="border-b border-border/40 px-4 py-2.5 text-[11px] font-semibold text-foreground/55">{t("reai.mediaAsset", lang).replace("{number}", String(groupIndex + 1))}</div>
                  <div className="divide-y divide-border/40">
                    {group.versions.map((version) => (
                      <article key={version.id} className={cn("p-3", version.is_deleted && "opacity-60")}>
                        <div className="flex gap-3">
                          <div className="relative h-14 w-20 shrink-0 overflow-hidden rounded-lg bg-foreground/[0.05]">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            {version.file_url ? <img src={version.file_url} alt="" className="h-full w-full object-cover" /> : <ImageIcon size={18} className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-foreground/20" />}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="text-[11px] font-semibold">v{version.version}</span>
                              {version.is_master ? <StatusPill tone="strong">{t("reai.mediaCurrent", lang)}</StatusPill> : null}
                              {version.is_deleted ? <StatusPill>{t("reai.mediaHidden", lang)}</StatusPill> : null}
                            </div>
                            <p className="mt-1 truncate text-[11px] text-muted-foreground">{version.processor === "original" ? t("reai.mediaOriginal", lang) : version.processor}</p>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {!version.is_deleted && !version.is_master ? <Button type="button" variant="outline" size="xs" onClick={() => setMediaCandidate({ uploadId: version.id, action: "promote" })}>{t("reai.mediaUseVersion", lang)}</Button> : null}
                              {!version.is_deleted ? <Button type="button" variant="outline" size="xs" onClick={() => setMediaCandidate({ uploadId: version.id, action: "hide" })}>{t("reai.mediaHide", lang)}</Button> : null}
                              {version.is_deleted ? <Button type="button" variant="outline" size="xs" onClick={() => setMediaCandidate({ uploadId: version.id, action: "restore" })}>{t("reai.mediaRestore", lang)}</Button> : null}
                            </div>
                          </div>
                        </div>
                        {mediaCandidate?.uploadId === version.id ? (
                          <div className="mt-3 rounded-xl border border-border/60 bg-surface p-3">
                            <p className="text-[11px] leading-relaxed text-foreground/65">{mediaCandidate.action === "hide" ? t("reai.mediaHideConfirm", lang) : t("reai.mediaActionConfirm", lang)}</p>
                            <div className="mt-2 flex justify-end gap-2">
                              <Button type="button" variant="ghost" size="xs" onClick={() => setMediaCandidate(null)}>{t("shares.cancel", lang)}</Button>
                              <Button type="button" size="xs" loading={mediaBusy} onClick={() => void applyMediaAction()}>{t("common.confirm", lang)}</Button>
                            </div>
                          </div>
                        ) : null}
                      </article>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </SidePanel>
  );
}

function AgentRequired({ lang }: { lang: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border/60 px-5 py-10 text-center">
      <VersionsIcon size={21} className="mx-auto text-foreground/25" />
      <p className="mt-3 text-[12px] font-semibold">{t("draft.versions.agentRequired", lang)}</p>
      <Link href="/settings#reai" className="mt-3 inline-flex text-[11px] font-semibold underline underline-offset-4">{t("settings.tab.reai", lang)}</Link>
    </div>
  );
}

"use client";

import * as React from "react";
import Link from "next/link";
import {
  getDraftTourAssets,
  updateDraftTourPublication,
} from "../lib/api/client";
import { getSafeApiErrorMessage } from "../lib/api/error-message";
import type {
  DraftTourAsset,
  DraftTourAssetsPayload,
  DraftTourPublicationSelection,
} from "../lib/tour-types";
import { Button } from "../lib/ui/button";
import { Switch } from "../lib/ui/switch";
import { cn } from "../lib/utils";
import {
  CheckIcon,
  ClockIcon,
  ExternalLinkIcon,
  InfoIcon,
  TourIcon,
} from "./icons";
import { SidePanel } from "./side-panel";
import { StatusPill } from "./status-pill";

type Target = "web" | "ios";

interface Selection {
  web: boolean;
  ios: boolean;
  isPrimary: boolean;
  sortOrder: number;
}

const COPY = {
  en: {
    title: "Virtual tours",
    ready: "Ready to share",
    readyToPublish: "Ready for publishing",
    preparing: "Preparing",
    needsDelivery: "Publishing setup required",
    none: "No tour yet",
    summary: (published: number, ready: number, total: number) => (
      total === 0
        ? "No tour uploaded from the iPhone app yet"
        : `${published} published · ${ready} ready · ${total} total`
    ),
    primary: "Default tour",
    view: "Open tour",
    manage: "Tours & delivery",
    mobileSourceTitle: "New tours come from the mobile app",
    mobileSourceHint: "Capture on iPhone or iPad. After a reliable upload and backend validation, each scan appears here automatically as a separate tour.",
    panelTitle: "Tours & delivery",
    panelDescription: "Publish one or more ready tours and choose the default clients see first.",
    captured: "Tour assets",
    web: "Web",
    webHint: "Visible in shared web listings",
    ios: "iPhone & iPad",
    iosHint: "Available in the iOS delivery",
    makePrimary: "Use as default",
    primaryBadge: "Default",
    pending: "Waiting for mobile upload",
    processing: "Processing",
    failed: "Needs attention",
    deliveryPending: "Publishing not ready",
    hidden: "Not published",
    published: "Published",
    shareTitle: "Update active shares",
    shareHint: "Existing links move to this exact publication revision.",
    save: "Publish selection",
    saved: "Tour delivery was published as a new immutable revision.",
    empty: "Create the first scan in the iPhone app.",
    retry: "Try again",
    usdHealthy: "USD hierarchy healthy",
    usdInvalid: "USD validation failed",
    revision: (value: number) => `Revision ${value}`,
    reasonInitial: "Initial capture",
    reasonRenovation: "After renovation",
    reasonRescan: "Rescan",
    reasonImported: "Imported",
    reasonOther: "Capture",
    waitingForMobile: "Waiting for the iPhone upload to land. This entry will update automatically.",
    processingHint: "The backend is processing and validating this tour. Delivery controls unlock when it is ready.",
    deliveryPendingHint: "The tour reconstruction exists, but a validated product delivery has not been published yet.",
    failedHint: "This tour could not be prepared. Review the processing result before trying again from the mobile app.",
  },
  sk: {
    title: "Virtuálne prehliadky",
    ready: "Pripravené na zdieľanie",
    readyToPublish: "Pripravené na zverejnenie",
    preparing: "Pripravuje sa",
    needsDelivery: "Vyžaduje nastavenie zverejnenia",
    none: "Zatiaľ bez prehliadky",
    summary: (published: number, ready: number, total: number) => (
      total === 0
        ? "Zatiaľ nebola nahraná žiadna prehliadka z aplikácie pre iPhone"
        : `${published} zverejnených · ${ready} pripravených · ${total} celkom`
    ),
    primary: "Predvolená prehliadka",
    view: "Otvoriť prehliadku",
    manage: "Prehliadky a doručenie",
    mobileSourceTitle: "Nové prehliadky vznikajú v mobilnej aplikácii",
    mobileSourceHint: "Snímanie spustíte na iPhone alebo iPade. Po spoľahlivom nahratí a kontrole backendom sa tu každé snímanie automaticky zobrazí ako samostatná prehliadka.",
    panelTitle: "Prehliadky a doručenie",
    panelDescription: "Zverejnite jednu alebo viac pripravených prehliadok a vyberte predvolenú pre klientov.",
    captured: "Prehliadky",
    web: "Web",
    webHint: "Viditeľná v zdieľaných webových ponukách",
    ios: "iPhone a iPad",
    iosHint: "Dostupná v iOS doručení",
    makePrimary: "Nastaviť ako predvolenú",
    primaryBadge: "Predvolená",
    pending: "Čaká na nahratie z mobilu",
    processing: "Spracúva sa",
    failed: "Vyžaduje pozornosť",
    deliveryPending: "Zverejnenie nie je pripravené",
    hidden: "Nezverejnená",
    published: "Zverejnená",
    shareTitle: "Aktualizovať aktívne zdieľania",
    shareHint: "Existujúce odkazy prejdú na túto presnú verziu publikácie.",
    save: "Zverejniť výber",
    saved: "Doručenie prehliadok bolo uložené ako nová nemenná verzia.",
    empty: "Prvé snímanie vytvorte v aplikácii pre iPhone.",
    retry: "Skúsiť znova",
    usdHealthy: "USD hierarchia je v poriadku",
    usdInvalid: "Kontrola USD zlyhala",
    revision: (value: number) => `Verzia ${value}`,
    reasonInitial: "Prvé snímanie",
    reasonRenovation: "Po rekonštrukcii",
    reasonRescan: "Nové snímanie",
    reasonImported: "Importovaná",
    reasonOther: "Snímanie",
    waitingForMobile: "Čaká na dokončenie nahrávania z iPhonu. Stav sa potom aktualizuje automaticky.",
    processingHint: "Backend prehliadku spracúva a kontroluje. Nastavenia doručenia sa sprístupnia, keď bude pripravená.",
    deliveryPendingHint: "Rekonštrukcia prehliadky existuje, ale overené produktové doručenie ešte nebolo zverejnené.",
    failedHint: "Prehliadku sa nepodarilo pripraviť. Pred opakovaním v mobilnej aplikácii skontrolujte výsledok spracovania.",
  },
} as const;

function copyFor(lang: string) {
  return lang.toLowerCase().startsWith("sk") ? COPY.sk : COPY.en;
}

function isReady(asset: DraftTourAsset) {
  return Boolean(
    asset.source_splat_id
      && asset.is_product_published
      && asset.latest_delivery_version?.is_published,
  );
}

function selectionSignature(values: Record<number, Selection>) {
  return JSON.stringify(
    Object.entries(values)
      .map(([id, value]) => [Number(id), value] as const)
      .sort(([left], [right]) => left - right),
  );
}

function reasonLabel(asset: DraftTourAsset, text: ReturnType<typeof copyFor>) {
  switch (asset.capture_reason) {
    case "initial": return text.reasonInitial;
    case "renovation": return text.reasonRenovation;
    case "rescan": return text.reasonRescan;
    case "imported": return text.reasonImported;
    default: return text.reasonOther;
  }
}

function dateLabel(value: string, lang: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(lang, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

export function DraftTourAssetsPanel({
  draftId,
  lang,
  onPrimaryChanged,
}: {
  draftId: number;
  lang: string;
  onPrimaryChanged?: (splatId: number | null) => void;
}) {
  const text = copyFor(lang);
  const [open, setOpen] = React.useState(false);
  const [payload, setPayload] = React.useState<DraftTourAssetsPayload | null>(null);
  const [selections, setSelections] = React.useState<Record<number, Selection>>({});
  const [baseline, setBaseline] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [applyToShares, setApplyToShares] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  const applyPayload = React.useCallback((next: DraftTourAssetsPayload) => {
    const mapped = Object.fromEntries(next.assets.map((asset, index) => [
      asset.id,
      {
        web: asset.publication.targets.includes("web"),
        ios: asset.publication.targets.includes("ios"),
        isPrimary: asset.publication.is_primary,
        sortOrder: asset.publication.sort_order ?? next.assets.length + index,
      } satisfies Selection,
    ]));
    setPayload(next);
    setSelections(mapped);
    setBaseline(selectionSignature(mapped));
  }, []);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      applyPayload(await getDraftTourAssets(draftId));
    } catch (reason) {
      setError(getSafeApiErrorMessage(reason, lang));
    } finally {
      setLoading(false);
    }
  }, [applyPayload, draftId, lang]);

  React.useEffect(() => {
    void load();
  }, [load]);

  React.useEffect(() => {
    if (open) void load();
  }, [load, open]);

  const readyAssets = React.useMemo(
    () => payload?.assets.filter(isReady) ?? [],
    [payload?.assets],
  );
  const visibleAssets = React.useMemo(
    () => readyAssets.filter((asset) => {
      const selection = selections[asset.id];
      return Boolean(selection?.web || selection?.ios);
    }),
    [readyAssets, selections],
  );
  const primaryAsset = React.useMemo(
    () => readyAssets.find((asset) => selections[asset.id]?.isPrimary) ?? null,
    [readyAssets, selections],
  );
  const usdHealthy = payload?.publication?.usd.validation.valid === true;
  const changed = baseline !== selectionSignature(selections);

  const normalizePrimary = React.useCallback((
    next: Record<number, Selection>,
    preferredId?: number,
  ) => {
    const visible = Object.entries(next)
      .filter(([, value]) => value.web || value.ios)
      .sort(([, left], [, right]) => left.sortOrder - right.sortOrder)
      .map(([id]) => Number(id));
    const current = visible.find((id) => next[id]?.isPrimary);
    const primaryId = preferredId && visible.includes(preferredId)
      ? preferredId
      : current ?? visible[0];
    return Object.fromEntries(Object.entries(next).map(([id, value]) => [
      Number(id),
      { ...value, isPrimary: primaryId != null && Number(id) === primaryId },
    ]));
  }, []);

  const setTarget = (assetId: number, target: Target, enabled: boolean) => {
    setNotice(null);
    setSelections((current) => {
      const next = {
        ...current,
        [assetId]: {
          ...current[assetId],
          [target]: enabled,
        },
      };
      return normalizePrimary(next, enabled ? assetId : undefined);
    });
  };

  const setPrimary = (assetId: number) => {
    setNotice(null);
    setSelections((current) => normalizePrimary(current, assetId));
  };

  const save = async () => {
    if (saving || !changed) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const entries: DraftTourPublicationSelection[] = Object.entries(selections)
        .filter(([, value]) => value.web || value.ios)
        .sort(([, left], [, right]) => left.sortOrder - right.sortOrder)
        .map(([id, value], index) => ({
          tour_id: Number(id),
          targets: [
            ...(value.web ? ["web" as const] : []),
            ...(value.ios ? ["ios" as const] : []),
          ],
          is_primary: value.isPrimary,
          sort_order: index,
        }));
      const result = await updateDraftTourPublication(
        draftId,
        entries,
        applyToShares,
      );
      applyPayload(result);
      const newPrimary = result.assets.find((asset) => asset.publication.is_primary);
      onPrimaryChanged?.(newPrimary?.source_splat_id ?? null);
      setNotice(text.saved);
    } catch (caught) {
      setError(getSafeApiErrorMessage(caught, lang));
    } finally {
      setSaving(false);
    }
  };

  const statusText = primaryAsset
    ? text.ready
    : readyAssets.length > 0
      ? text.readyToPublish
      : payload?.assets.some((asset) => (
          asset.source_splat_id != null && asset.status === "completed"
        ))
        ? text.needsDelivery
      : payload?.assets.length
        ? text.preparing
        : text.none;

  return (
    <section className="mt-8 overflow-hidden rounded-[1.75rem] border border-border/70 bg-card shadow-card sm:rounded-[2rem]">
      <div className="p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <span className={cn(
            "flex h-11 w-11 shrink-0 items-center justify-center rounded-full",
            primaryAsset ? "bg-emerald-500/10 text-emerald-600" : "bg-foreground/[0.05] text-foreground/45",
          )}>
            {primaryAsset ? <CheckIcon size={19} /> : <TourIcon size={19} />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="text-[18px] font-semibold tracking-[-0.02em]">{text.title}</h2>
                <p className={cn(
                  "mt-0.5 text-[13px] font-medium",
                  primaryAsset ? "text-emerald-600" : "text-muted-foreground",
                )}>
                  {statusText}
                </p>
              </div>
              {payload?.publication ? (
                <StatusPill tone={usdHealthy ? "success" : "danger"} dot>
                  {text.revision(payload.publication.revision)}
                </StatusPill>
              ) : null}
            </div>
            <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
              {text.summary(
                visibleAssets.length,
                readyAssets.length,
                payload?.assets.length ?? 0,
              )}
            </p>
          </div>
        </div>

        {primaryAsset ? (
          <div className="mt-5 flex items-center gap-3 border-t border-border/60 pt-5">
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-medium text-muted-foreground">{text.primary}</p>
              <p className="mt-0.5 truncate text-[14px] font-semibold">{primaryAsset.name}</p>
            </div>
            {primaryAsset.source_splat_id ? (
              <Button asChild size="sm">
                <Link href={`/tour/${primaryAsset.source_splat_id}?tourId=${primaryAsset.id}`}>
                  <ExternalLinkIcon size={14} />
                  {text.view}
                </Link>
              </Button>
            ) : null}
          </div>
        ) : null}

        <div className="mt-5">
          <Button className="w-full" onClick={() => setOpen(true)}>
            <TourIcon size={15} />
            {text.manage}
          </Button>
          <p className="mt-3 flex items-start gap-2 text-[11px] leading-relaxed text-muted-foreground">
            <InfoIcon size={14} className="mt-0.5 shrink-0" />
            <span>{text.mobileSourceHint}</span>
          </p>
        </div>
      </div>

      <SidePanel
        open={open}
        onOpenChange={setOpen}
        title={text.panelTitle}
        description={text.panelDescription}
        lang={lang}
        footer={(
          <div className="flex w-full items-center justify-between gap-3">
            <div className="min-w-0 text-[11px] text-muted-foreground">
              {payload?.publication
                ? (usdHealthy ? text.usdHealthy : text.usdInvalid)
                : text.summary(
                    visibleAssets.length,
                    readyAssets.length,
                    payload?.assets.length ?? 0,
                  )}
            </div>
            <Button
              size="sm"
              loading={saving}
              disabled={!changed || saving || loading}
              onClick={() => { void save(); }}
            >
              {text.save}
            </Button>
          </div>
        )}
      >
        <div className="space-y-5 p-5 sm:p-6">
          <div className="rounded-2xl border border-border/70 bg-foreground/[0.025] p-4">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-card text-foreground/55">
                <InfoIcon size={15} />
              </span>
              <div>
                <p className="text-[13px] font-semibold">{text.mobileSourceTitle}</p>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                  {text.mobileSourceHint}
                </p>
              </div>
            </div>
          </div>

          {notice ? (
            <div role="status" className="rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.06] px-4 py-3 text-[12px] leading-relaxed text-emerald-800">
              {notice}
            </div>
          ) : null}
          {error ? (
            <div role="alert" className="rounded-2xl border border-red-500/20 bg-red-500/[0.05] px-4 py-3 text-[12px] leading-relaxed text-red-700">
              {error}
            </div>
          ) : null}

          <div>
            <h3 className="mb-3 text-[12px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              {text.captured}
            </h3>

            {loading ? (
              <div className="flex justify-center py-14">
                <span className="h-5 w-5 animate-spin rounded-full border-2 border-foreground/15 border-t-foreground/60" />
              </div>
            ) : !payload?.assets.length ? (
              <div className="rounded-2xl border border-dashed border-border p-8 text-center text-[12px] text-muted-foreground">
                {text.empty}
              </div>
            ) : (
              <div className="space-y-3">
                {payload.assets.map((asset) => {
                  const ready = isReady(asset);
                  const selection = selections[asset.id];
                  const visible = Boolean(selection?.web || selection?.ios);
                  const status = ready
                    ? (visible ? text.published : text.hidden)
                    : asset.status === "failed"
                      ? text.failed
                      : asset.status === "processing"
                        ? text.processing
                        : asset.source_splat_id && asset.status === "completed"
                          ? text.deliveryPending
                          : text.pending;
                  const pendingHint = asset.status === "failed"
                    ? text.failedHint
                    : asset.source_splat_id && asset.status === "completed"
                      ? text.deliveryPendingHint
                      : asset.status === "processing"
                        ? text.processingHint
                        : text.waitingForMobile;
                  return (
                    <article key={asset.id} className="rounded-2xl border border-border/70 bg-card p-4">
                      <div className="flex items-start gap-3">
                        <span className={cn(
                          "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
                          ready ? "bg-emerald-500/10 text-emerald-600" : "bg-foreground/[0.05] text-foreground/45",
                        )}>
                          {ready ? <TourIcon size={16} /> : <ClockIcon size={16} />}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0">
                              <h4 className="truncate text-[14px] font-semibold">{asset.name}</h4>
                              <p className="mt-0.5 text-[11px] text-muted-foreground">
                                {reasonLabel(asset, text)} · {dateLabel(asset.captured_at, lang)}
                              </p>
                            </div>
                            <StatusPill
                              tone={asset.status === "failed" ? "danger" : ready && visible ? "success" : "neutral"}
                              dot
                            >
                              {status}
                            </StatusPill>
                          </div>

                          {ready ? (
                            <div className="mt-4 space-y-3 border-t border-border/55 pt-4">
                              <label className="flex items-center gap-3">
                                <span className="min-w-0 flex-1">
                                  <span className="block text-[12px] font-semibold">{text.web}</span>
                                  <span className="block text-[10px] text-muted-foreground">{text.webHint}</span>
                                </span>
                                <Switch
                                  size="sm"
                                  checked={selection?.web ?? false}
                                  onCheckedChange={(checked) => setTarget(asset.id, "web", checked)}
                                  aria-label={`${text.web}: ${asset.name}`}
                                />
                              </label>
                              <label className="flex items-center gap-3">
                                <span className="min-w-0 flex-1">
                                  <span className="block text-[12px] font-semibold">{text.ios}</span>
                                  <span className="block text-[10px] text-muted-foreground">{text.iosHint}</span>
                                </span>
                                <Switch
                                  size="sm"
                                  checked={selection?.ios ?? false}
                                  onCheckedChange={(checked) => setTarget(asset.id, "ios", checked)}
                                  aria-label={`${text.ios}: ${asset.name}`}
                                />
                              </label>
                              {visible ? (
                                <button
                                  type="button"
                                  role="radio"
                                  aria-checked={selection?.isPrimary ?? false}
                                  onClick={() => setPrimary(asset.id)}
                                  className="flex w-full items-center gap-2 rounded-xl bg-foreground/[0.035] px-3 py-2.5 text-left text-[12px] font-semibold"
                                >
                                  <span className={cn(
                                    "flex h-4 w-4 items-center justify-center rounded-full border",
                                    selection?.isPrimary
                                      ? "border-emerald-600 bg-emerald-600 text-white"
                                      : "border-foreground/25",
                                  )}>
                                    {selection?.isPrimary ? <CheckIcon size={10} /> : null}
                                  </span>
                                  {text.makePrimary}
                                  {selection?.isPrimary ? (
                                    <span className="ml-auto text-[10px] text-emerald-600">{text.primaryBadge}</span>
                                  ) : null}
                                </button>
                              ) : null}
                              {asset.source_splat_id ? (
                                <Button asChild variant="outline" size="sm" className="w-full">
                                  <Link href={`/tour/${asset.source_splat_id}?tourId=${asset.id}`}>
                                    <ExternalLinkIcon size={13} />
                                    {text.view}
                                  </Link>
                                </Button>
                              ) : null}
                            </div>
                          ) : (
                            <p className="mt-3 rounded-xl bg-foreground/[0.035] px-3 py-2.5 text-[11px] leading-relaxed text-muted-foreground">
                              {pendingHint}
                            </p>
                          )}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>

          <label className="flex items-center gap-3 rounded-2xl border border-border/70 bg-card p-4">
            <span className="min-w-0 flex-1">
              <span className="block text-[12px] font-semibold">{text.shareTitle}</span>
              <span className="mt-0.5 block text-[10px] leading-relaxed text-muted-foreground">{text.shareHint}</span>
            </span>
            <Switch
              size="sm"
              checked={applyToShares}
              onCheckedChange={setApplyToShares}
              aria-label={text.shareTitle}
            />
          </label>
        </div>
      </SidePanel>
    </section>
  );
}

"use client";

import * as React from "react";
import Link from "next/link";
import {
  getDraftTourAssets,
  removeDraftTourAsset,
  updateDraftTourPublication,
} from "../lib/api/client";
import { getSafeApiErrorMessage } from "../lib/api/error-message";
import type {
  DraftSplatVersion,
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
  PlayIcon,
  TrashIcon,
  TourIcon,
} from "./icons";
import { SidePanel } from "./side-panel";
import { StatusPill } from "./status-pill";
import { Thumbnail } from "./thumbnail";

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
    summary: (published: number, ready: number, previewable: number, total: number) => (
      total === 0
        ? "Tours from the mobile app appear here automatically"
        : published > 0
          ? `Available to clients · ${published}`
          : ready > 0
            ? `Ready to publish · ${ready}`
            : previewable > 0
              ? `Preview available · ${previewable}`
              : `Being prepared · ${total}`
    ),
    view: "Open tour",
    manage: "Manage tours",
    manageShort: "Manage",
    more: (value: number) => `+${value} more in tour manager`,
    panelTitle: "Tours & delivery",
    panelDescription: "Publish one or more ready tours and choose the default clients see first.",
    captured: "Tour assets",
    web: "Web",
    webHint: "Visible in shared web listings",
    ios: "iPhone & iPad",
    iosHint: "Available in the iOS delivery",
    makePrimary: "Use as default",
    primaryBadge: "Default",
    preview: "Preview tour",
    pending: "Waiting for mobile upload",
    reserved: "Scan not started",
    uploading: "Uploading from iPhone",
    queued: "Upload landed · waiting to process",
    processing: "Processing",
    failed: "Needs attention",
    deliveryPending: "Publishing not ready",
    hidden: "Not published",
    published: "Published",
    shareTitle: "Update active shares",
    shareHint: "Existing links move to this exact publication revision.",
    save: "Publish selection",
    saved: "Tour delivery was published as a new immutable revision.",
    emptyTitle: "No virtual tour yet",
    empty: "Capture the property in the Reaigen iPhone or iPad app. The tour will appear here after its upload is validated.",
    retry: "Try again",
    usdHealthy: "Delivery verified",
    usdInvalid: "Delivery needs attention",
    reasonInitial: "Initial capture",
    reasonRenovation: "After renovation",
    reasonRescan: "Rescan",
    reasonImported: "Imported",
    reasonOther: "Capture",
    waitingForMobile: "Waiting for the iPhone upload to land. This entry will update automatically.",
    reservedHint: "This is an empty capture placeholder. Continue it in the iPhone app or remove it here.",
    uploadingHint: "The iPhone is sending this capture. You can leave this page; progress updates automatically.",
    queuedHint: "The complete upload has landed safely and is waiting for processing.",
    processingHint: "The backend is processing and validating this tour. Delivery controls unlock when it is ready.",
    deliveryPendingHint: "The tour reconstruction exists, but a validated product delivery has not been published yet.",
    failedHint: "This tour could not be prepared. Review the processing result before trying again from the mobile app.",
    progress: (value: number) => `${Math.round(value)}% complete`,
    removePlaceholder: "Remove placeholder",
    cancelAndRemove: "Cancel & remove",
    archiveTour: "Archive tour",
    removeConfirmTitle: "Remove this tour?",
    removeConfirmCancel: "Keep tour",
    removeConfirm: (kind: "cancel" | "archive") => (
      kind === "cancel"
        ? "Uploading or processing will stop where possible. The audit record remains recoverable."
        : "The tour will disappear from this listing workspace. Its audit record remains recoverable."
    ),
    saveBeforeRemove: "Save or undo delivery changes before removing a tour.",
    removed: "The tour was removed safely.",
  },
  sk: {
    title: "Virtuálne prehliadky",
    summary: (published: number, ready: number, previewable: number, total: number) => (
      total === 0
        ? "Prehliadky z mobilnej aplikácie sa tu zobrazia automaticky"
        : published > 0
          ? `Dostupné pre klientov · ${published}`
          : ready > 0
            ? `Pripravené na zverejnenie · ${ready}`
            : previewable > 0
              ? `Náhľad je dostupný · ${previewable}`
              : `Pripravuje sa · ${total}`
    ),
    view: "Otvoriť prehliadku",
    manage: "Spravovať prehliadky",
    manageShort: "Spravovať",
    more: (value: number) => `+${value} ďalších v správe prehliadok`,
    panelTitle: "Prehliadky a doručenie",
    panelDescription: "Zverejnite jednu alebo viac pripravených prehliadok a vyberte predvolenú pre klientov.",
    captured: "Prehliadky",
    web: "Web",
    webHint: "Viditeľná v zdieľaných webových ponukách",
    ios: "iPhone a iPad",
    iosHint: "Dostupná v iOS doručení",
    makePrimary: "Nastaviť ako predvolenú",
    primaryBadge: "Predvolená",
    preview: "Zobraziť náhľad",
    pending: "Čaká na nahratie z mobilu",
    reserved: "Skenovanie sa nezačalo",
    uploading: "Nahráva sa z iPhonu",
    queued: "Nahratie dorazilo · čaká na spracovanie",
    processing: "Spracúva sa",
    failed: "Vyžaduje pozornosť",
    deliveryPending: "Zverejnenie nie je pripravené",
    hidden: "Nezverejnená",
    published: "Zverejnená",
    shareTitle: "Aktualizovať aktívne zdieľania",
    shareHint: "Existujúce odkazy prejdú na túto presnú verziu publikácie.",
    save: "Zverejniť výber",
    saved: "Doručenie prehliadok bolo uložené ako nová nemenná verzia.",
    emptyTitle: "Zatiaľ bez virtuálnej prehliadky",
    empty: "Nehnuteľnosť nasnímajte v aplikácii Reaigen pre iPhone alebo iPad. Po overení nahrávania sa prehliadka zobrazí tu.",
    retry: "Skúsiť znova",
    usdHealthy: "Doručenie je overené",
    usdInvalid: "Doručenie vyžaduje pozornosť",
    reasonInitial: "Prvé snímanie",
    reasonRenovation: "Po rekonštrukcii",
    reasonRescan: "Nové snímanie",
    reasonImported: "Importovaná",
    reasonOther: "Snímanie",
    waitingForMobile: "Čaká na dokončenie nahrávania z iPhonu. Stav sa potom aktualizuje automaticky.",
    reservedHint: "Toto je prázdne rezervované snímanie. Pokračujte v aplikácii pre iPhone alebo ho tu odstráňte.",
    uploadingHint: "iPhone odosiela snímanie. Túto stránku môžete zavrieť; priebeh sa aktualizuje automaticky.",
    queuedHint: "Celé nahratie bezpečne dorazilo a čaká na spracovanie.",
    processingHint: "Backend prehliadku spracúva a kontroluje. Nastavenia doručenia sa sprístupnia, keď bude pripravená.",
    deliveryPendingHint: "Rekonštrukcia prehliadky existuje, ale overené produktové doručenie ešte nebolo zverejnené.",
    failedHint: "Prehliadku sa nepodarilo pripraviť. Pred opakovaním v mobilnej aplikácii skontrolujte výsledok spracovania.",
    progress: (value: number) => `Dokončené na ${Math.round(value)} %`,
    removePlaceholder: "Odstrániť rezerváciu",
    cancelAndRemove: "Zrušiť a odstrániť",
    archiveTour: "Archivovať prehliadku",
    removeConfirmTitle: "Odstrániť túto prehliadku?",
    removeConfirmCancel: "Ponechať prehliadku",
    removeConfirm: (kind: "cancel" | "archive") => (
      kind === "cancel"
        ? "Nahrávanie alebo spracovanie sa podľa možnosti zastaví. Záznam zostane obnoviteľný."
        : "Prehliadka zmizne z pracovného priestoru inzerátu. Záznam zostane obnoviteľný."
    ),
    saveBeforeRemove: "Pred odstránením prehliadky uložte alebo zrušte zmeny doručenia.",
    removed: "Prehliadka bola bezpečne odstránená.",
  },
} as const;

function copyFor(lang: string) {
  return lang.toLowerCase().startsWith("sk") ? COPY.sk : COPY.en;
}

function isReady(asset: DraftTourAsset) {
  if (asset.lifecycle) return asset.lifecycle.can_publish;
  return Boolean(
    asset.source_splat_id
      && asset.is_product_published
      && asset.latest_delivery_version?.is_published,
  );
}

function isRenderableSplat(splat: DraftSplatVersion | undefined) {
  return Boolean(
    splat
      && splat.status.toLowerCase() === "completed"
      && (
        splat.has_sog
        || splat.has_splat
        || splat.has_ply
        || splat.url
        || splat.format
        || splat.available_formats?.length
        || Object.keys(splat.signed_outputs ?? {}).length
      ),
  );
}

function canPreviewOnWeb(
  asset: DraftTourAsset,
  splat: DraftSplatVersion | undefined,
) {
  if (asset.lifecycle) {
    return asset.lifecycle.can_preview
      && asset.lifecycle.preview_targets.includes("web");
  }
  return asset.source_splat_id != null && isRenderableSplat(splat);
}

function assetStatus(
  asset: DraftTourAsset,
  selection: Selection | undefined,
  text: ReturnType<typeof copyFor>,
) {
  const ready = isReady(asset);
  const visible = Boolean(selection?.web || selection?.ios);
  if (ready) {
    return {
      ready,
      visible,
      label: visible ? text.published : text.hidden,
      tone: visible ? "success" as const : "neutral" as const,
      hint: null,
    };
  }
  const lifecycle = asset.lifecycle?.state;
  if (lifecycle === "failed" || asset.status === "failed") {
    return {
      ready,
      visible,
      label: text.failed,
      tone: "danger" as const,
      hint: text.failedHint,
    };
  }
  if (lifecycle === "uploading") {
    return {
      ready,
      visible,
      label: text.uploading,
      tone: "warning" as const,
      hint: text.uploadingHint,
    };
  }
  if (lifecycle === "queued") {
    return {
      ready,
      visible,
      label: text.queued,
      tone: "warning" as const,
      hint: text.queuedHint,
    };
  }
  if (lifecycle === "processing" || asset.status === "processing") {
    return {
      ready,
      visible,
      label: text.processing,
      tone: "warning" as const,
      hint: text.processingHint,
    };
  }
  if (
    lifecycle === "preview"
    || (asset.source_splat_id && asset.status === "completed")
  ) {
    return {
      ready,
      visible,
      label: text.deliveryPending,
      tone: "warning" as const,
      hint: text.deliveryPendingHint,
    };
  }
  if (lifecycle === "reserved") {
    return {
      ready,
      visible,
      label: text.reserved,
      tone: "neutral" as const,
      hint: text.reservedHint,
    };
  }
  return {
    ready,
    visible,
    label: text.pending,
    tone: "neutral" as const,
    hint: text.waitingForMobile,
  };
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
  splats = [],
  onPrimaryChanged,
}: {
  draftId: number;
  lang: string;
  splats?: DraftSplatVersion[];
  onPrimaryChanged?: (splatId: number | null) => void;
}) {
  const text = copyFor(lang);
  const [open, setOpen] = React.useState(false);
  const [payload, setPayload] = React.useState<DraftTourAssetsPayload | null>(null);
  const [selections, setSelections] = React.useState<Record<number, Selection>>({});
  const [baseline, setBaseline] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [removingId, setRemovingId] = React.useState<number | null>(null);
  const [confirmRemoveId, setConfirmRemoveId] = React.useState<number | null>(null);
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
  const splatsById = React.useMemo(() => new Map(
    splats.map((splat) => [splat.splat_id ?? splat.id, splat] as const),
  ), [splats]);
  const previewableAssets = React.useMemo(
    () => payload?.assets.filter((asset) => canPreviewOnWeb(
      asset,
      asset.source_splat_id
        ? splatsById.get(asset.source_splat_id)
        : undefined,
    )) ?? [],
    [payload?.assets, splatsById],
  );
  const thumbnailsBySplatId = React.useMemo(() => new Map(
    [...splatsById].flatMap(([splatId, splat]) => {
      const thumbnail = splat.signed_outputs?.thumbnail ?? splat.thumbnail_url;
      return thumbnail ? [[splatId, thumbnail] as const] : [];
    }),
  ), [splatsById]);
  const orderedAssets = React.useMemo(() => (
    [...(payload?.assets ?? [])].sort((left, right) => {
      const leftSelection = selections[left.id];
      const rightSelection = selections[right.id];
      const leftPrimary = leftSelection?.isPrimary ? 1 : 0;
      const rightPrimary = rightSelection?.isPrimary ? 1 : 0;
      if (leftPrimary !== rightPrimary) return rightPrimary - leftPrimary;
      const leftReady = isReady(left) ? 1 : 0;
      const rightReady = isReady(right) ? 1 : 0;
      if (leftReady !== rightReady) return rightReady - leftReady;
      const leftLanded = left.source_splat_id ? 1 : 0;
      const rightLanded = right.source_splat_id ? 1 : 0;
      if (leftLanded !== rightLanded) return rightLanded - leftLanded;
      return new Date(right.captured_at).getTime() - new Date(left.captured_at).getTime();
    })
  ), [payload?.assets, selections]);
  const overviewAssets = orderedAssets.slice(0, 3);
  const remainingAssets = Math.max(0, orderedAssets.length - overviewAssets.length);
  const usdHealthy = payload?.publication?.usd.validation.valid === true;
  const changed = baseline !== selectionSignature(selections);
  const hasActiveAssets = payload?.assets.some((asset) => (
    ["uploading", "queued", "processing"].includes(
      asset.lifecycle?.state ?? "",
    )
  )) ?? false;

  React.useEffect(() => {
    if (!hasActiveAssets || changed || saving || removingId != null) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void getDraftTourAssets(draftId)
        .then(applyPayload)
        .catch(() => {
          // Keep the last authoritative state during a transient poll error.
        });
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [
    applyPayload,
    changed,
    draftId,
    hasActiveAssets,
    removingId,
    saving,
  ]);

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

  const removeTour = async (asset: DraftTourAsset) => {
    if (!asset.lifecycle?.can_remove || removingId != null) return;
    setRemovingId(asset.id);
    setError(null);
    setNotice(null);
    try {
      const result = await removeDraftTourAsset(draftId, asset.id);
      applyPayload(result);
      setConfirmRemoveId(null);
      setNotice(text.removed);
    } catch (caught) {
      setError(getSafeApiErrorMessage(caught, lang));
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <section className="mt-8">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-[14px] font-semibold">
            <TourIcon size={16} className="text-foreground/55" />
            <span>{text.title}</span>
          </h2>
          <p className="ml-6 mt-1 truncate text-[11px] text-muted-foreground">
            {text.summary(
              visibleAssets.length,
              readyAssets.length,
              previewableAssets.length,
              payload?.assets.length ?? 0,
            )}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0"
          onClick={() => setOpen(true)}
        >
          <TourIcon size={14} />
          <span className="sm:hidden">{text.manageShort}</span>
          <span className="hidden sm:inline">{text.manage}</span>
        </Button>
      </div>

      {loading && !payload ? (
        <div className="overflow-hidden rounded-[1.5rem] border border-border/70 bg-card shadow-card sm:rounded-2xl">
          {Array.from({ length: 2 }).map((_, index) => (
            <div
              key={index}
              className={cn(
                "grid animate-pulse grid-cols-[88px_minmax(0,1fr)] gap-3 p-4 sm:grid-cols-[132px_minmax(0,1fr)] sm:gap-4",
                index === 0 && "border-b border-border/55",
              )}
            >
              <div className="aspect-[16/10] rounded-xl bg-muted/55" />
              <div className="flex min-w-0 flex-col justify-center gap-2">
                <div className="h-3 w-2/3 rounded bg-muted/60" />
                <div className="h-2.5 w-1/2 rounded bg-muted/40" />
              </div>
            </div>
          ))}
        </div>
      ) : error && !payload ? (
        <div className="flex items-center gap-3 rounded-[1.5rem] border border-red-500/20 bg-card p-4 shadow-card sm:rounded-2xl">
          <InfoIcon size={18} className="shrink-0 text-red-600" />
          <p className="min-w-0 flex-1 text-[12px] text-muted-foreground">{error}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => { void load(); }}>
            {text.retry}
          </Button>
        </div>
      ) : !payload?.assets.length ? (
        <div className="flex items-start gap-3 rounded-[1.5rem] border border-dashed border-border bg-card p-5 sm:items-center sm:rounded-2xl">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-foreground/[0.045] text-foreground/45">
            <TourIcon size={18} />
          </span>
          <div className="min-w-0">
            <h3 className="text-[13px] font-semibold">{text.emptyTitle}</h3>
            <p className="mt-1 max-w-2xl text-[11px] leading-relaxed text-muted-foreground">
              {text.empty}
            </p>
          </div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-[1.5rem] border border-border/70 bg-card shadow-card sm:rounded-2xl">
          {overviewAssets.map((asset, index) => {
            const selection = selections[asset.id];
            const state = assetStatus(asset, selection, text);
            const thumbnail = asset.source_splat_id
              ? thumbnailsBySplatId.get(asset.source_splat_id)
              : null;
            const canPreview = canPreviewOnWeb(
              asset,
              asset.source_splat_id
                ? splatsById.get(asset.source_splat_id)
                : undefined,
            );
            return (
              <article
                key={asset.id}
                className={cn(
                  "grid grid-cols-[88px_minmax(0,1fr)] gap-3 p-4 sm:grid-cols-[132px_minmax(0,1fr)] sm:gap-4 sm:p-5",
                  index < overviewAssets.length - 1 && "border-b border-border/55",
                )}
              >
                <div className="relative aspect-[16/10] overflow-hidden rounded-xl bg-surface-subtle ring-1 ring-inset ring-border/45">
                  {thumbnail ? (
                    <Thumbnail
                      src={thumbnail}
                      alt={asset.name}
                      className="absolute inset-0 h-full w-full object-cover"
                      priority={index === 0}
                    />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center text-foreground/20">
                      {state.ready ? <TourIcon size={28} /> : <ClockIcon size={24} />}
                    </div>
                  )}
                </div>

                <div className="min-w-0 self-center">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="truncate text-[13px] font-semibold sm:text-[14px]">{asset.name}</h3>
                      <p className="mt-0.5 truncate text-[10px] text-muted-foreground sm:text-[11px]">
                        {reasonLabel(asset, text)} · {dateLabel(asset.captured_at, lang)}
                      </p>
                    </div>
                    <StatusPill tone={state.tone} dot className="shrink-0">
                      {state.label}
                    </StatusPill>
                  </div>

                  <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                    {selection?.isPrimary ? (
                      <StatusPill tone="strong">{text.primaryBadge}</StatusPill>
                    ) : null}
                    {selection?.web ? <StatusPill>{text.web}</StatusPill> : null}
                    {selection?.ios ? <StatusPill>{text.ios}</StatusPill> : null}
                    {state.ready && !state.visible ? (
                      <span className="text-[10px] text-muted-foreground">{text.hidden}</span>
                    ) : null}
                  </div>

                  {state.hint ? (
                    <p className="mt-2 line-clamp-2 text-[10px] leading-relaxed text-muted-foreground sm:text-[11px]">
                      {state.hint}
                    </p>
                  ) : null}

                  {asset.lifecycle?.progress_pct != null ? (
                    <div className="mt-2" aria-label={text.progress(asset.lifecycle.progress_pct)}>
                      <div className="h-1.5 overflow-hidden rounded-full bg-foreground/10">
                        <div
                          className="h-full rounded-full bg-foreground/65 transition-[width] duration-500"
                          style={{ width: `${asset.lifecycle.progress_pct}%` }}
                        />
                      </div>
                      <p className="mt-1 text-[9px] font-medium text-muted-foreground">
                        {text.progress(asset.lifecycle.progress_pct)}
                      </p>
                    </div>
                  ) : null}

                  {asset.source_splat_id && (state.ready || canPreview) ? (
                    <Button asChild variant="ghost" size="xs" className="mt-2 -ml-2">
                      <Link href={state.ready
                        ? `/tour/${asset.source_splat_id}?tourId=${asset.id}`
                        : `/tour/${asset.source_splat_id}`}
                      >
                        <PlayIcon size={13} />
                        {state.ready ? text.view : text.preview}
                      </Link>
                    </Button>
                  ) : null}
                </div>
              </article>
            );
          })}
          {remainingAssets > 0 ? (
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="flex w-full items-center justify-center border-t border-border/55 bg-surface-subtle px-4 py-3 text-[11px] font-semibold text-foreground/65 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              {text.more(remainingAssets)}
            </button>
          ) : null}
        </div>
      )}

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
                    previewableAssets.length,
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
              <div className="rounded-2xl border border-dashed border-border p-7 text-center">
                <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-foreground/[0.045] text-foreground/45">
                  <TourIcon size={18} />
                </span>
                <h4 className="mt-3 text-[13px] font-semibold">{text.emptyTitle}</h4>
                <p className="mx-auto mt-1 max-w-sm text-[11px] leading-relaxed text-muted-foreground">
                  {text.empty}
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {orderedAssets.map((asset) => {
                  const selection = selections[asset.id];
                  const state = assetStatus(asset, selection, text);
                  const thumbnail = asset.source_splat_id
                    ? thumbnailsBySplatId.get(asset.source_splat_id)
                    : null;
                  const canPreview = canPreviewOnWeb(
                    asset,
                    asset.source_splat_id
                      ? splatsById.get(asset.source_splat_id)
                      : undefined,
                  );
                  return (
                    <article key={asset.id} className="rounded-2xl border border-border/70 bg-card p-4">
                      <div className="flex items-start gap-3">
                        <div className="relative mt-0.5 h-11 w-[4.4rem] shrink-0 overflow-hidden rounded-xl bg-surface-subtle ring-1 ring-inset ring-border/45">
                          {thumbnail ? (
                            <Thumbnail
                              src={thumbnail}
                              alt={asset.name}
                              className="absolute inset-0 h-full w-full object-cover"
                            />
                          ) : (
                            <div className="absolute inset-0 flex items-center justify-center text-foreground/25">
                              {state.ready ? <TourIcon size={18} /> : <ClockIcon size={17} />}
                            </div>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0">
                              <h4 className="truncate text-[14px] font-semibold">{asset.name}</h4>
                              <p className="mt-0.5 text-[11px] text-muted-foreground">
                                {reasonLabel(asset, text)} · {dateLabel(asset.captured_at, lang)}
                              </p>
                            </div>
                            <StatusPill
                              tone={state.tone}
                              dot
                            >
                              {state.label}
                            </StatusPill>
                          </div>

                          {state.ready ? (
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
                              {state.visible ? (
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
                            <div className="mt-3">
                              <p className="rounded-xl bg-foreground/[0.035] px-3 py-2.5 text-[11px] leading-relaxed text-muted-foreground">
                                {state.hint}
                              </p>
                              {asset.lifecycle?.progress_pct != null ? (
                                <div className="mt-3">
                                  <div
                                    role="progressbar"
                                    aria-valuemin={0}
                                    aria-valuemax={100}
                                    aria-valuenow={asset.lifecycle.progress_pct}
                                    aria-label={text.progress(asset.lifecycle.progress_pct)}
                                    className="h-2 overflow-hidden rounded-full bg-foreground/10"
                                  >
                                    <div
                                      className="h-full rounded-full bg-foreground/70 transition-[width] duration-500"
                                      style={{ width: `${asset.lifecycle.progress_pct}%` }}
                                    />
                                  </div>
                                  <p className="mt-1.5 text-[10px] font-medium text-muted-foreground">
                                    {text.progress(asset.lifecycle.progress_pct)}
                                  </p>
                                </div>
                              ) : null}
                              {canPreview && asset.source_splat_id ? (
                                <Button asChild variant="outline" size="sm" className="mt-3 w-full">
                                  <Link href={`/tour/${asset.source_splat_id}`}>
                                    <ExternalLinkIcon size={13} />
                                    {text.preview}
                                  </Link>
                                </Button>
                              ) : null}
                            </div>
                          )}

                          {asset.lifecycle?.can_remove ? (
                            <div className="mt-3 border-t border-border/55 pt-3">
                              {confirmRemoveId === asset.id ? (
                                <div className="rounded-xl border border-red-500/20 bg-red-500/[0.045] p-3">
                                  <p className="text-[12px] font-semibold text-red-700">
                                    {text.removeConfirmTitle}
                                  </p>
                                  <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
                                    {text.removeConfirm(
                                      asset.lifecycle.removal_kind ?? "archive",
                                    )}
                                  </p>
                                  {changed ? (
                                    <p className="mt-2 text-[10px] font-medium text-amber-700">
                                      {text.saveBeforeRemove}
                                    </p>
                                  ) : null}
                                  <div className="mt-3 grid gap-2">
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="xs"
                                      className="h-auto min-h-9 w-full justify-center whitespace-normal py-2 text-center leading-tight"
                                      disabled={removingId === asset.id}
                                      onClick={() => setConfirmRemoveId(null)}
                                    >
                                      {text.removeConfirmCancel}
                                    </Button>
                                    <Button
                                      type="button"
                                      variant="destructive"
                                      size="xs"
                                      className="h-auto min-h-9 w-full justify-center whitespace-normal py-2 text-center leading-tight"
                                      loading={removingId === asset.id}
                                      disabled={changed}
                                      onClick={() => { void removeTour(asset); }}
                                    >
                                      <TrashIcon size={13} />
                                      {asset.lifecycle.removal_kind === "cancel"
                                        ? text.cancelAndRemove
                                        : text.archiveTour}
                                    </Button>
                                  </div>
                                </div>
                              ) : (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="xs"
                                  className="text-red-700 hover:bg-red-500/[0.07] hover:text-red-800"
                                  onClick={() => setConfirmRemoveId(asset.id)}
                                >
                                  <TrashIcon size={13} />
                                  {asset.lifecycle.state === "reserved"
                                    ? text.removePlaceholder
                                    : asset.lifecycle.removal_kind === "cancel"
                                      ? text.cancelAndRemove
                                      : text.archiveTour}
                                </Button>
                              )}
                            </div>
                          ) : null}
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

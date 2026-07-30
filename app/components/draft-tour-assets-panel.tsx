"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  createWebTour,
  getDraftTourAssets,
  hasWebCreationAccess,
  renameDraftTourAsset,
  removeDraftTourAsset,
  updateDraftTourPublication,
} from "../lib/api/client";
import { getSafeApiErrorMessage } from "../lib/api/error-message";
import { t } from "../lib/i18n";
import type {
  DraftSplatVersion,
  DraftTourAsset,
  DraftTourAssetsPayload,
  DraftTourPublicationSelection,
} from "../lib/tour-types";
import { Button } from "../lib/ui/button";
import { CollectionLoading } from "./collection-loading";
import { Switch } from "../lib/ui/switch";
import { cn } from "../lib/utils";
import {
  CheckIcon,
  ClockIcon,
  CloseIcon,
  EditIcon,
  ExternalLinkIcon,
  InfoIcon,
  PlayIcon,
  PlusIcon,
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
    viewShort: "Open",
    previewShort: "Preview",
    editorShort: "Editor",
    manage: "Manage tours",
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
    saveShort: "Publish",
    saveChanges: "Save changes",
    unpublish: "Unpublish",
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
    editName: "Rename tour",
    namePlaceholder: "Tour name",
    saveName: "Save name",
    cancelName: "Cancel",
    renamed: "Tour name was saved.",
    nameRequired: "Enter a tour name.",
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
    viewShort: "Otvoriť",
    previewShort: "Náhľad",
    editorShort: "Editor",
    manage: "Spravovať prehliadky",
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
    saveShort: "Zverejniť",
    saveChanges: "Uložiť zmeny",
    unpublish: "Zrušiť zverejnenie",
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
    editName: "Premenovať prehliadku",
    namePlaceholder: "Názov prehliadky",
    saveName: "Uložiť názov",
    cancelName: "Zrušiť",
    renamed: "Názov prehliadky bol uložený.",
    nameRequired: "Zadajte názov prehliadky.",
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
  lang: string,
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
  if (asset.editor_workspace && !asset.source_splat_id) {
    return {
      ready,
      visible,
      label: t("webEditor.workspaceDraft", lang),
      tone: "neutral" as const,
      hint: t("webEditor.workspaceDraftHint", lang),
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

function reasonLabel(asset: DraftTourAsset, lang: string) {
  const labels = {
    en: {
      initial: "Initial capture",
      renovation: "After renovation",
      rescan: "Fresh rescan",
      imported: "Imported",
      other: "Capture",
    },
    sk: {
      initial: "Prvé snímanie",
      renovation: "Po rekonštrukcii",
      rescan: "Nové preskenovanie",
      imported: "Importovaná",
      other: "Snímanie",
    },
    cs: {
      initial: "První nasnímání",
      renovation: "Po rekonstrukci",
      rescan: "Nové skenování",
      imported: "Importovaná",
      other: "Snímání",
    },
    de: {
      initial: "Erste Aufnahme",
      renovation: "Nach der Renovierung",
      rescan: "Neue Aufnahme",
      imported: "Importiert",
      other: "Aufnahme",
    },
  } as const;
  const copy = labels[lang.slice(0, 2).toLowerCase() as keyof typeof labels]
    ?? labels.en;
  return copy[asset.capture_reason as keyof typeof copy] ?? copy.other;
}

function hasGeneratedTourName(asset: DraftTourAsset) {
  if (asset.name_is_custom === true) return false;
  if (asset.name_is_custom === false) return true;
  const value = asset.name.trim();
  return /^(?:(?:new\s+)?virtual tour|initial capture|after renovation|rescan|imported tour)(?:\s*[·-]\s*\d{4}-\d{2}-\d{2})?$/i.test(value);
}

function assetDisplayName(
  asset: DraftTourAsset,
  lang: string,
) {
  const value = asset.name.trim();
  return value && !hasGeneratedTourName(asset)
    ? value
    : reasonLabel(asset, lang);
}

function assetSubtitle(
  asset: DraftTourAsset,
  lang: string,
) {
  const date = dateLabel(asset.captured_at, lang);
  return hasGeneratedTourName(asset)
    ? date
    : `${reasonLabel(asset, lang)} · ${date}`;
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
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [payload, setPayload] = React.useState<DraftTourAssetsPayload | null>(null);
  const [selections, setSelections] = React.useState<Record<number, Selection>>({});
  const [baseline, setBaseline] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [editingNameId, setEditingNameId] = React.useState<number | null>(null);
  const [nameDraft, setNameDraft] = React.useState("");
  const [nameBaseline, setNameBaseline] = React.useState("");
  const [renamingId, setRenamingId] = React.useState<number | null>(null);
  const [removingId, setRemovingId] = React.useState<number | null>(null);
  const [confirmRemoveId, setConfirmRemoveId] = React.useState<number | null>(null);
  const [applyToShares, setApplyToShares] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [canCreateInWeb, setCanCreateInWeb] = React.useState(false);
  const [creatingInWeb, setCreatingInWeb] = React.useState(false);

  React.useEffect(() => {
    let active = true;
    void hasWebCreationAccess()
      .then((allowed) => {
        if (active) setCanCreateInWeb(allowed);
      })
      .catch(() => {
        if (active) setCanCreateInWeb(false);
      });
    return () => { active = false; };
  }, []);

  const createInWeb = React.useCallback(async () => {
    setCreatingInWeb(true);
    setError(null);
    try {
      const workspace = await createWebTour({ draft_id: draftId });
      router.push(`/create/tour/${workspace.tour_id}`);
    } catch (reason) {
      setError(getSafeApiErrorMessage(reason, lang));
      setCreatingInWeb(false);
    }
  }, [draftId, lang, router]);

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
  const selectedVisibleCount = Object.values(selections).filter(
    (selection) => selection.web || selection.ios,
  ).length;
  const isUnpublishing = Boolean(
    changed
    && payload?.publication?.entries.length
    && selectedVisibleCount === 0,
  );
  const panelSummary = payload?.publication
    ? (usdHealthy ? text.usdHealthy : text.usdInvalid)
    : text.summary(
        visibleAssets.length,
        readyAssets.length,
        previewableAssets.length,
        payload?.assets.length ?? 0,
      );
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

  const beginRename = (asset: DraftTourAsset) => {
    const displayName = assetDisplayName(asset, lang);
    setEditingNameId(asset.id);
    setNameDraft(displayName);
    setNameBaseline(displayName);
    setError(null);
    setNotice(null);
  };

  const cancelRename = () => {
    if (renamingId != null) return;
    setEditingNameId(null);
    setNameDraft("");
    setNameBaseline("");
  };

  const saveName = async (asset: DraftTourAsset) => {
    const name = nameDraft.trim();
    if (!name) {
      setError(text.nameRequired);
      return;
    }
    if (name === nameBaseline) {
      cancelRename();
      return;
    }
    setRenamingId(asset.id);
    setError(null);
    setNotice(null);
    try {
      applyPayload(await renameDraftTourAsset(draftId, asset.id, name));
      setEditingNameId(null);
      setNameDraft("");
      setNameBaseline("");
      setNotice(text.renamed);
    } catch (caught) {
      setError(getSafeApiErrorMessage(caught, lang));
    } finally {
      setRenamingId(null);
    }
  };

  return (
    <section className="mt-5 overflow-hidden rounded-[1.5rem] border border-border/70 bg-card shadow-card sm:mt-8 sm:rounded-2xl">
      <header className="flex items-center gap-3 border-b border-border/60 px-3.5 py-3 sm:justify-between sm:px-5 sm:py-4">
        <button
          type="button"
          disabled={!payload?.assets.length}
          onClick={() => setOpen(true)}
          className="-m-1 flex min-w-0 flex-1 items-center gap-3 rounded-xl p-1 text-left transition-colors enabled:hover:bg-foreground/[0.035] disabled:cursor-default"
          aria-label={payload?.assets.length ? text.manage : undefined}
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-foreground/[0.045] text-foreground/55 sm:h-9 sm:w-9">
            <TourIcon size={17} />
          </span>
          <div className="min-w-0">
            <h2 className="text-[14px] font-semibold">{text.title}</h2>
            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
              {text.summary(
                visibleAssets.length,
                readyAssets.length,
                previewableAssets.length,
                payload?.assets.length ?? 0,
              )}
            </p>
          </div>
        </button>
        <div className="flex shrink-0 items-center gap-1.5">
          {payload?.assets.length ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="hidden h-9 sm:inline-flex"
              onClick={() => setOpen(true)}
            >
              <TourIcon size={14} />
              {text.manage}
            </Button>
          ) : null}
          {canCreateInWeb ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 w-9 shrink-0 px-0 sm:w-auto sm:px-3"
              loading={creatingInWeb}
              onClick={() => { void createInWeb(); }}
              aria-label={t("webCreate.tourAction", lang)}
              title={t("webCreate.tourAction", lang)}
            >
              <PlusIcon size={14} />
              <span className="hidden sm:inline">{t("webCreate.tourAction", lang)}</span>
            </Button>
          ) : null}
        </div>
      </header>

      {loading && !payload ? (
        <CollectionLoading label={t("common.loading", lang)} className="min-h-28 pt-7" />
      ) : error && !payload ? (
        <div className="flex items-center gap-3 p-4 sm:px-5">
          <InfoIcon size={18} className="shrink-0 text-destructive" />
          <p className="min-w-0 flex-1 text-[12px] text-muted-foreground">{error}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => { void load(); }}>
            {text.retry}
          </Button>
        </div>
      ) : !payload?.assets.length ? (
        <div className="flex items-start gap-3 p-5 sm:items-center">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-foreground/[0.045] text-foreground/45">
            <TourIcon size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-[13px] font-semibold">{text.emptyTitle}</h3>
            <p className="mt-1 max-w-2xl text-[11px] leading-relaxed text-muted-foreground">
              {text.empty}
            </p>
          </div>
        </div>
      ) : (
        <div className="divide-y divide-border/55">
          {overviewAssets.map((asset, index) => {
            const selection = selections[asset.id];
            const state = assetStatus(asset, selection, text, lang);
            const displayName = assetDisplayName(asset, lang);
            const thumbnail = asset.thumbnail_url;
            const canPreview = canPreviewOnWeb(
              asset,
              asset.source_splat_id
                ? splatsById.get(asset.source_splat_id)
                : undefined,
            );
            const canOpen = Boolean(
              asset.source_splat_id && (state.ready || canPreview),
            );
            const canEdit = Boolean(
              asset.editor_workspace || (canCreateInWeb && asset.source_splat_id),
            );
            return (
              <article
                key={asset.id}
                className="grid grid-cols-[82px_minmax(0,1fr)] gap-3 p-3.5 sm:grid-cols-[108px_minmax(0,1fr)_auto] sm:items-center sm:gap-4 sm:px-5 sm:py-4"
              >
                <div className="relative aspect-[16/10] overflow-hidden rounded-xl bg-surface-subtle ring-1 ring-inset ring-border/45">
                  {thumbnail ? (
                    <Thumbnail
                      src={thumbnail}
                      alt={displayName}
                      className="absolute inset-0 h-full w-full object-cover"
                      priority={index === 0}
                    />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center text-foreground/20">
                      {state.ready ? <TourIcon size={24} /> : <ClockIcon size={21} />}
                    </div>
                  )}
                </div>

                <div className="min-w-0 self-center">
                  <div className="flex min-w-0 items-center gap-1">
                    <h3 className="min-w-0 flex-1 truncate text-[13px] font-semibold sm:text-[14px]">{displayName}</h3>
                    <button
                      type="button"
                      aria-label={`${text.editName}: ${displayName}`}
                      title={text.editName}
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-foreground/35 transition-colors hover:bg-foreground/[0.055] hover:text-foreground"
                      onClick={() => {
                        beginRename(asset);
                        setOpen(true);
                      }}
                    >
                      <EditIcon size={12} />
                    </button>
                  </div>
                  <p className="truncate text-[10px] text-muted-foreground sm:text-[11px]">
                    {assetSubtitle(asset, lang)}
                  </p>

                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <StatusPill tone={state.tone} dot className="shrink-0">
                      {state.label}
                    </StatusPill>
                    {(selection?.isPrimary || selection?.web || selection?.ios) ? (
                      <>
                        {selection?.isPrimary ? (
                          <StatusPill tone="strong">{text.primaryBadge}</StatusPill>
                        ) : null}
                        {selection?.web ? <StatusPill>{text.web}</StatusPill> : null}
                        {selection?.ios ? <StatusPill>{text.ios}</StatusPill> : null}
                      </>
                    ) : null}
                  </div>

                  {state.hint ? (
                    <p className="mt-2 line-clamp-1 text-[10px] leading-relaxed text-muted-foreground sm:text-[11px]">
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
                    </div>
                  ) : null}
                </div>

                {(canOpen || canEdit) ? (
                  <div className="col-span-2 grid grid-cols-2 gap-2 sm:col-span-1 sm:flex sm:flex-nowrap sm:justify-end sm:pt-0">
                    {canEdit ? (
                      <Button
                        asChild
                        variant="outline"
                        size="sm"
                        className={cn(
                          "order-2 w-full sm:order-1 sm:w-auto",
                          !canOpen && "col-span-2",
                        )}
                      >
                        <Link href={`/create/tour/${asset.id}`} aria-label={t("webCreate.openEditor", lang)}>
                          <EditIcon size={13} />
                          <span className="sm:hidden">{text.editorShort}</span>
                          <span className="hidden sm:inline">{t("webCreate.openEditor", lang)}</span>
                        </Link>
                      </Button>
                    ) : null}
                    {canOpen && asset.source_splat_id ? (
                      <Button
                        asChild
                        size="sm"
                        className={cn(
                          "order-1 w-full sm:order-2 sm:w-auto",
                          !canEdit && "col-span-2",
                        )}
                      >
                        <Link href={state.ready
                          ? `/tour/${asset.source_splat_id}?tourId=${asset.id}`
                          : `/tour/${asset.source_splat_id}`}
                          aria-label={state.ready ? text.view : text.preview}
                        >
                          <PlayIcon size={13} />
                          <span className="sm:hidden">
                            {state.ready ? text.viewShort : text.previewShort}
                          </span>
                          <span className="hidden sm:inline">
                            {state.ready ? text.view : text.preview}
                          </span>
                        </Link>
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </article>
            );
          })}
          {remainingAssets > 0 ? (
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="flex w-full items-center justify-center bg-surface-subtle px-4 py-3 text-[11px] font-semibold text-foreground/65 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              {text.more(remainingAssets)}
            </button>
          ) : null}
        </div>
      )}

      <SidePanel
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) cancelRename();
        }}
        title={text.panelTitle}
        description={panelSummary}
        headerMode="editor"
        className="sm:max-w-[640px]"
        lang={lang}
        headerAction={(
          <Button
            size="xs"
            className="h-11 min-w-[4.75rem] px-3 sm:h-9"
            loading={saving}
            disabled={!changed || saving || loading}
            onClick={() => { void save(); }}
          >
            {isUnpublishing
              ? text.unpublish
              : changed
                ? text.saveChanges
                : text.saveShort}
          </Button>
        )}
      >
        <div className="space-y-5">
          {notice ? (
            <div role="status" className="floating-panel-shape border border-success/20 bg-success/[0.055] px-4 py-3 text-[12px] leading-relaxed text-success">
              {notice}
            </div>
          ) : null}
          {error ? (
            <div role="alert" className="floating-panel-shape border border-destructive/20 bg-destructive/[0.045] px-4 py-3 text-[12px] leading-relaxed text-destructive">
              {error}
            </div>
          ) : null}

          <div>
            <h3 className="mb-3 text-[12px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              {text.captured}
            </h3>
            <p className="mb-4 max-w-xl text-[11px] leading-relaxed text-muted-foreground">
              {text.panelDescription}
            </p>

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
                  const state = assetStatus(asset, selection, text, lang);
                  const displayName = assetDisplayName(asset, lang);
                  const thumbnail = asset.thumbnail_url;
                  const canPreview = canPreviewOnWeb(
                    asset,
                    asset.source_splat_id
                      ? splatsById.get(asset.source_splat_id)
                      : undefined,
                  );
                  return (
                    <article key={asset.id} className="floating-panel p-4">
                      <div className="flex items-start gap-3">
                        <div className="relative mt-0.5 h-11 w-[4.4rem] shrink-0 overflow-hidden rounded-xl bg-surface-subtle ring-1 ring-inset ring-border/45">
                          {thumbnail ? (
                            <Thumbnail
                              src={thumbnail}
                              alt={displayName}
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
                            <div className={cn(
                              "min-w-0",
                              editingNameId === asset.id && "basis-full",
                            )}>
                              {editingNameId === asset.id ? (
                                <div className="flex min-w-0 items-center gap-1.5">
                                  <input
                                    autoFocus
                                    value={nameDraft}
                                    maxLength={120}
                                    aria-label={text.namePlaceholder}
                                    placeholder={text.namePlaceholder}
                                    disabled={renamingId === asset.id}
                                    className="h-9 min-w-0 flex-1 rounded-xl border border-border bg-card px-3 text-[13px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-60"
                                    onChange={(event) => setNameDraft(event.target.value)}
                                    onKeyDown={(event) => {
                                      if (event.key === "Enter") {
                                        event.preventDefault();
                                        void saveName(asset);
                                      } else if (event.key === "Escape") {
                                        event.preventDefault();
                                        cancelRename();
                                      }
                                    }}
                                  />
                                  <button
                                    type="button"
                                    aria-label={text.saveName}
                                    title={text.saveName}
                                    disabled={renamingId === asset.id || !nameDraft.trim()}
                                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-foreground text-background disabled:opacity-35"
                                    onClick={() => { void saveName(asset); }}
                                  >
                                    <CheckIcon size={13} />
                                  </button>
                                  <button
                                    type="button"
                                    aria-label={text.cancelName}
                                    title={text.cancelName}
                                    disabled={renamingId === asset.id}
                                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-foreground/[0.055] text-foreground/55 disabled:opacity-35"
                                    onClick={cancelRename}
                                  >
                                    <CloseIcon size={13} />
                                  </button>
                                </div>
                              ) : (
                                <div className="flex min-w-0 items-center gap-1">
                                  <h4 className="truncate text-[14px] font-semibold">{displayName}</h4>
                                  <button
                                    type="button"
                                    aria-label={`${text.editName}: ${displayName}`}
                                    title={text.editName}
                                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-foreground/35 transition-colors hover:bg-foreground/[0.055] hover:text-foreground"
                                    onClick={() => beginRename(asset)}
                                  >
                                    <EditIcon size={12} />
                                  </button>
                                </div>
                              )}
                              <p className="mt-0.5 text-[11px] text-muted-foreground">
                                {assetSubtitle(asset, lang)}
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
                                  aria-label={`${text.web}: ${displayName}`}
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
                                  aria-label={`${text.ios}: ${displayName}`}
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
                                      ? "border-success bg-success text-success-foreground"
                                      : "border-foreground/25",
                                  )}>
                                    {selection?.isPrimary ? <CheckIcon size={10} /> : null}
                                  </span>
                                  {text.makePrimary}
                                  {selection?.isPrimary ? (
                                    <span className="ml-auto text-[10px] text-success">{text.primaryBadge}</span>
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
                              {asset.editor_workspace || (canCreateInWeb && asset.source_splat_id) ? (
                                <Button asChild variant="outline" size="sm" className="mt-3 w-full">
                                  <Link href={`/create/tour/${asset.id}`}>
                                    <EditIcon size={13} />
                                    {t("webCreate.openEditor", lang)}
                                  </Link>
                                </Button>
                              ) : null}
                            </div>
                          )}

                          {asset.lifecycle?.can_remove ? (
                            <div className="mt-3 border-t border-border/55 pt-3">
                              {confirmRemoveId === asset.id ? (
                                <div className="floating-panel-shape border border-destructive/20 bg-destructive/[0.04] p-3">
                                  <p className="text-[12px] font-semibold text-destructive">
                                    {text.removeConfirmTitle}
                                  </p>
                                  <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
                                    {text.removeConfirm(
                                      asset.lifecycle.removal_kind ?? "archive",
                                    )}
                                  </p>
                                  {changed ? (
                                    <p className="mt-2 text-[10px] font-medium text-foreground/60">
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
                                  className="text-foreground/55 hover:bg-foreground/[0.045] hover:text-foreground"
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

          <label className="floating-panel flex items-center gap-3 p-4">
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

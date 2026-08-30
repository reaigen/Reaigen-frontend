"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  createWebTour,
  getDraftTourAssets,
  renameDraftTourAsset,
  removeDraftTourAsset,
  updateDraftTourPublication,
} from "../lib/api/client";
import { getSafeApiErrorMessage, isApiNotFound } from "../lib/api/error-message";
import { t } from "../lib/i18n";
import type {
  DraftSplatVersion,
  DraftTourAsset,
  DraftTourAssetsPayload,
  DraftTourPublicationSelection,
} from "../lib/tour-types";
import { Button } from "../lib/ui/button";
import { CollectionLoading } from "./collection-loading";
import { useWebAuthoringAccess } from "./hooks/use-web-authoring-access";
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
  SettingsIcon,
  ShareIcon,
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

function selectionsFromPayload(payload: DraftTourAssetsPayload | null) {
  if (!payload) return {};
  return Object.fromEntries(payload.assets.map((asset, index) => [
    asset.id,
    {
      web: asset.publication.targets.includes("web"),
      ios: asset.publication.targets.includes("ios"),
      isPrimary: asset.publication.is_primary,
      sortOrder: asset.publication.sort_order ?? payload.assets.length + index,
    } satisfies Selection,
  ]));
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
    unpublishAll: "Unpublish all tours",
    unpublishAllHint: "Removes every tour from client delivery. Existing links stop showing the 3D tour. You can publish again at any time.",
    openSharing: "Share this listing",
    openSharingHint: "Opens the share settings, where you create the link and choose who can open it — protection level, PIN and expiry.",
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
    unpublishAll: "Zrušiť zverejnenie všetkých prehliadok",
    unpublishAllHint: "Odstráni všetky prehliadky z doručenia klientom. Existujúce odkazy prestanú zobrazovať 3D prehliadku. Zverejniť môžete kedykoľvek znova.",
    openSharing: "Zdieľať nehnuteľnosť",
    openSharingHint: "Otvorí nastavenia zdieľania, kde vytvoríte odkaz a určíte, kto ho môže otvoriť — ochrana, PIN a platnosť.",
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
  initialPayload = null,
  onPayloadChanged,
  onPrimaryChanged,
  onOpenSharing,
}: {
  draftId: number;
  lang: string;
  splats?: DraftSplatVersion[];
  initialPayload?: DraftTourAssetsPayload | null;
  onPayloadChanged?: (payload: DraftTourAssetsPayload) => void;
  onPrimaryChanged?: (splatId: number | null) => void;
  /** Hands off to the share settings — link, protection level, PIN, expiry. */
  onOpenSharing?: () => void;
}) {
  const text = copyFor(lang);
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [payload, setPayload] = React.useState<DraftTourAssetsPayload | null>(
    initialPayload,
  );
  const [selections, setSelections] = React.useState<Record<number, Selection>>(
    () => selectionsFromPayload(initialPayload),
  );
  const [baseline, setBaseline] = React.useState(
    () => selectionSignature(selectionsFromPayload(initialPayload)),
  );
  const [loading, setLoading] = React.useState(!initialPayload);
  const [saving, setSaving] = React.useState(false);
  const [editingNameId, setEditingNameId] = React.useState<number | null>(null);
  const [nameDraft, setNameDraft] = React.useState("");
  const [nameBaseline, setNameBaseline] = React.useState("");
  const [renamingId, setRenamingId] = React.useState<number | null>(null);
  const [removingId, setRemovingId] = React.useState<number | null>(null);
  const [confirmRemoveId, setConfirmRemoveId] = React.useState<number | null>(null);
  const [applyToShares, setApplyToShares] = React.useState(true);
  const [confirmUnpublish, setConfirmUnpublish] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  // Confirmations describe work that is already finished, so they retire
  // themselves rather than sitting above the list until the next action.
  React.useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  // Rendered on the draft detail page, which is behind AppShell and therefore
  // already authenticated.
  const {
    allowed: canCreateInWeb,
    loading: createAccessLoading,
  } = useWebAuthoringAccess(true);
  const [creatingInWeb, setCreatingInWeb] = React.useState(false);

  const createInWeb = React.useCallback(async () => {
    setCreatingInWeb(true);
    setError(null);
    try {
      const workspace = await createWebTour({ draft_id: draftId });
      router.push(`/create/tour/${workspace.tour_id}`);
    } catch (reason) {
      // A cached/deleted draft may briefly remain visible in the creator. Do
      // not surface the backend's raw English "Draft not found" on a Slovak
      // page; the empty-state guidance is the useful recovery information.
      setError(isApiNotFound(reason) ? text.empty : getSafeApiErrorMessage(reason, lang));
      setCreatingInWeb(false);
    }
  }, [draftId, lang, router, text.empty]);

  const applyPayload = React.useCallback((next: DraftTourAssetsPayload) => {
    const mapped = selectionsFromPayload(next);
    setPayload(next);
    setSelections(mapped);
    setBaseline(selectionSignature(mapped));
    onPayloadChanged?.(next);
  }, [onPayloadChanged]);

  React.useEffect(() => {
    if (!initialPayload) return;
    applyPayload(initialPayload);
    setLoading(false);
  }, [applyPayload, initialPayload]);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      applyPayload(await getDraftTourAssets(draftId));
    } catch (reason) {
      if (isApiNotFound(reason)) {
        // The tour inventory is optional for legacy and cached drafts. A 404
        // means "nothing to manage here", not a broken detail page.
        applyPayload({
          schema: "com.reaigen.draft-tour-assets",
          version: 1,
          draft_id: draftId,
          assets: [],
          publication: null,
        });
      } else {
        setError(getSafeApiErrorMessage(reason, lang));
      }
    } finally {
      setLoading(false);
    }
  }, [applyPayload, draftId, lang]);

  React.useEffect(() => {
    if (initialPayload) return;
    void load();
  }, [initialPayload, load]);

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

  /*
    Unpublishing used to be reachable only by switching every target off one
    by one and noticing that the header button had relabelled itself, so a
    listing stayed "available to clients" because nobody found the way back.
    It gets its own action.
  */
  const unpublishAll = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const result = await updateDraftTourPublication(draftId, [], applyToShares);
      applyPayload(result);
      onPrimaryChanged?.(null);
      setNotice(text.saved);
      setConfirmUnpublish(false);
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
    <section className="draft-tour-assets mt-7 sm:mt-9">
      <header className="draft-tour-header mb-3 flex items-center gap-3 px-1 sm:justify-between">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="min-w-0">
            <h2 className="text-[16px] font-semibold tracking-[-0.015em]">{text.title}</h2>
            <p className="mt-1 truncate text-[12px] text-muted-foreground">
              {text.summary(
                visibleAssets.length,
                readyAssets.length,
                previewableAssets.length,
                payload?.assets.length ?? 0,
              )}
            </p>
          </div>
        </div>
        <div className="draft-tour-actions flex shrink-0 items-center gap-1.5 empty:hidden">
          {payload?.assets.length ? (
            <Button
              type="button"
              data-testid="draft-tour-assets-open"
              variant="ghost"
              size="sm"
              className="h-10 w-10 shrink-0 px-0 text-foreground/62 sm:w-auto sm:px-3"
              onClick={() => setOpen(true)}
              aria-label={text.manage}
              title={text.manage}
            >
              <SettingsIcon size={14} />
              <span className="hidden sm:inline">{text.manage}</span>
            </Button>
          ) : null}
          {createAccessLoading ? (
            <span
              aria-hidden="true"
              className="hidden h-9 w-32 shrink-0 animate-pulse rounded-full bg-foreground/[0.055] motion-reduce:animate-none md:block"
            />
          ) : canCreateInWeb ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="pen-touch-target hidden h-11 w-auto shrink-0 px-3 md:inline-flex"
              loading={creatingInWeb}
              onClick={() => { void createInWeb(); }}
              aria-label={t("webCreate.tourAction", lang)}
              title={t("webCreate.tourAction", lang)}
            >
              {/*
                Button keeps its children beside the loading spinner, and the
                compact variant is a 2.25rem circle — spinner plus icon does not
                fit, so the icon stands down while the spinner is showing.
              */}
              {creatingInWeb ? null : <PlusIcon size={14} />}
              <span>{t("webCreate.tourAction", lang)}</span>
            </Button>
          ) : null}
        </div>
      </header>

      {loading && !payload ? (
        <CollectionLoading
          label={t("common.loading", lang)}
          className="min-h-36 rounded-[1.5rem] border border-border/65 bg-card pt-10 shadow-control sm:min-h-[6.25rem] sm:pt-6"
        />
      ) : error && !payload ? (
        <div className="flex items-center gap-3 rounded-[1.5rem] border border-border/65 bg-card p-4 shadow-control sm:px-5">
          <InfoIcon size={18} className="shrink-0 text-destructive" />
          <p className="min-w-0 flex-1 text-[12px] text-muted-foreground">{error}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => { void load(); }}>
            {text.retry}
          </Button>
        </div>
      ) : !payload?.assets.length ? (
        <div className="flex items-start gap-3.5 rounded-[1.5rem] border border-border/70 bg-card p-5 shadow-control sm:items-center">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-surface-subtle text-foreground/52 ring-1 ring-inset ring-border/40">
            <TourIcon size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-[14px] font-semibold">{text.emptyTitle}</h3>
            <p className="mt-1 max-w-2xl text-[12px] leading-relaxed text-muted-foreground">
              {text.empty}
            </p>
          </div>
        </div>
      ) : (
        <div className={cn(
          "draft-tour-asset-grid grid grid-cols-1 gap-3",
          overviewAssets.length > 1 && "lg:grid-cols-2",
        )}>
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
            // Authoring access gates both arms. An asset that already carries an
            // editor_workspace used to offer the editor to anyone who could see
            // the draft, because an existing workspace was read as proof of
            // permission — but it only records that *someone* authored this
            // tour, not that this account may. Those users reached the editor
            // and got 403s from every endpoint it calls.
            const canEdit = Boolean(
              canCreateInWeb && (asset.editor_workspace || asset.source_splat_id),
            );
            return (
              <article
                key={asset.id}
                /*
                  Thumbnail leads at both widths. Phones get a slightly larger
                  one now that the platform badges no longer force a second row
                  of pills beside it; desktop keeps actions on their own column.
                */
                className={cn(
                  "draft-tour-asset-card grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded-[1.4rem] border border-border/65 bg-card/88 p-3.5 shadow-control backdrop-blur-xl transition-[border-color,box-shadow,transform] hover:-translate-y-px hover:border-foreground/18 hover:shadow-card sm:gap-4 sm:p-4",
                  overviewAssets.length === 1 && "lg:grid-cols-[auto_minmax(0,1fr)_minmax(18rem,auto)] lg:px-5",
                )}
              >
                <div className={cn(
                  "relative shrink-0 overflow-hidden bg-surface-subtle ring-1 ring-inset ring-border/45",
                  thumbnail
                    ? "h-14 w-20 rounded-xl sm:h-16 sm:w-24"
                    : "h-11 w-11 rounded-full bg-foreground/[0.045]",
                )}>
                  {thumbnail ? (
                    <Thumbnail
                      src={thumbnail}
                      alt={displayName}
                      className="absolute inset-0 h-full w-full object-cover"
                      priority={index === 0}
                    />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center text-foreground/30">
                      {state.ready ? <TourIcon size={24} /> : <ClockIcon size={21} />}
                    </div>
                  )}
                </div>

                <div className="min-w-0">
                  {/*
                    `justify-start`, and the heading sized by its text rather
                    than `flex-1`: this column is everything between the
                    thumbnail and the actions, so a stretched heading pushed the
                    rename control to the far right of the row, where it read as
                    a stray icon floating in the middle of the card instead of
                    as something belonging to the title beside it.
                  */}
                  <div className="flex min-w-0 items-center justify-start gap-0.5">
                    <h3 className="min-w-0 truncate text-[13px] font-semibold sm:text-[14px]">{displayName}</h3>
                    {/* Was a 28px target with a 12px glyph — under the 44px touch minimum. */}
                    <button
                      type="button"
                      aria-label={`${text.editName}: ${displayName}`}
                      title={text.editName}
                      className="pen-touch-target flex shrink-0 items-center justify-center rounded-full text-foreground/40 transition-colors hover:bg-foreground/[0.055] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-9 sm:min-h-0 sm:w-9 sm:min-w-0"
                      onClick={() => {
                        beginRename(asset);
                        setOpen(true);
                      }}
                    >
                      <EditIcon size={14} />
                    </button>
                  </div>
                  {/*
                    Status is a pill; when it was captured and where it is
                    published are facts. Those two facts used to sit on separate
                    lines with the pills wedged between them, so one asset spent
                    four stacked rows saying very little. They are the same kind
                    of thing in the same muted voice, so they share a line and
                    the pills follow — name, facts, state.
                  */}
                  <p className="truncate text-[10px] text-muted-foreground sm:text-[11px]">
                    {[
                      assetSubtitle(asset, lang),
                      selection?.web ? text.web : null,
                      selection?.ios ? text.ios : null,
                    ].filter(Boolean).join(" · ")}
                  </p>

                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <StatusPill tone={state.tone} dot className="shrink-0">
                      {state.label}
                    </StatusPill>
                    {selection?.isPrimary ? (
                      <StatusPill>{text.primaryBadge}</StatusPill>
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

                {(canOpen || canEdit || createAccessLoading) ? (
                  <div className={cn(
                    "col-span-2 grid grid-cols-2 gap-2 border-t border-border/45 pt-3",
                    !canOpen && "hidden md:grid",
                    overviewAssets.length === 1 && "lg:col-span-1 lg:col-start-3 lg:row-start-1 lg:self-center lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0",
                  )}>
                    {createAccessLoading ? (
                      <span
                        aria-hidden="true"
                        className="col-span-2 h-9 w-full animate-pulse rounded-full bg-foreground/[0.055] motion-reduce:animate-none sm:w-32"
                      />
                    ) : canEdit ? (
                      <Button
                        asChild
                        variant="outline"
                        size="sm"
                        className={cn(
                          "pen-touch-target order-2 hidden h-10 w-full rounded-full md:inline-flex",
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
                    {!createAccessLoading && canOpen && asset.source_splat_id ? (
                      <Button
                        asChild
                        size="sm"
                        variant={selection?.isPrimary && state.ready ? "default" : "secondary"}
                        className={cn(
                          "pen-touch-target order-1 h-10 w-full rounded-full",
                          "col-span-2 md:col-span-1",
                          !canEdit && "md:col-span-2",
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
              className="floating-capsule mx-auto flex min-h-11 items-center justify-center rounded-full px-5 text-[11px] font-semibold text-foreground/62 shadow-control transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:col-span-2"
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
        /*
          Only rendered once there is something to save. It is a save button,
          not a share button — with nothing toggled it had nothing to do, and
          sitting there greyed out it read as "sharing is disabled". Appears
          the moment a target is switched.
        */
        headerAction={changed ? (
          <Button
            size="xs"
            className="h-11 min-w-[4.75rem] px-3"
            loading={saving}
            disabled={saving || loading}
            onClick={() => { void save(); }}
          >
            {isUnpublishing ? text.unpublish : text.saveChanges}
          </Button>
        ) : undefined}
      >
        <div className="space-y-5">
          {notice ? (
            /* A rename that worked needs an acknowledgement, not a banner. The
               full-width tinted panel read as an empty container the width of
               the dock; a quiet line under the header says the same thing. */
            <div role="status" className="flex items-center gap-1.5 text-[12px] font-medium text-success">
              <CheckIcon size={13} className="shrink-0" />
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
              /*
                A skeleton in the shape of the list, not a spinner floating in
                the middle of a tall empty box. The spinner sat centred in its
                own `py-14` well and was then replaced by full-height cards, so
                the panel appeared to load in the middle and then shove
                everything else down. These match the real card — same
                `floating-panel p-4`, same 4.4rem thumbnail, same header row —
                so the swap barely moves.
              */
              <div className="space-y-3" role="status" aria-busy="true" aria-label={t("common.loading", lang)}>
                <span className="sr-only">{t("common.loading", lang)}</span>
                {[0, 1].map((row) => (
                  <div key={row} className="floating-panel p-4" aria-hidden="true">
                    <div className="flex items-start gap-3">
                      <div className="h-11 w-[4.4rem] shrink-0 animate-pulse rounded-xl bg-surface-subtle ring-1 ring-inset ring-border/45 motion-reduce:animate-none" />
                      <div className="min-w-0 flex-1 space-y-2 pt-1">
                        <div className="h-3.5 w-2/5 animate-pulse rounded-full bg-muted/70 motion-reduce:animate-none" />
                        <div className="h-3 w-1/4 animate-pulse rounded-full bg-muted/50 motion-reduce:animate-none" />
                      </div>
                      <div className="h-6 w-24 shrink-0 animate-pulse rounded-full bg-muted/55 motion-reduce:animate-none" />
                    </div>
                  </div>
                ))}
              </div>
            ) : !payload?.assets.length ? (
              <div className="editor-glass-surface flex items-start gap-3.5 rounded-[1.4rem] border p-4 sm:p-5">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border/55 bg-card/86 text-foreground/48 shadow-control">
                  <TourIcon size={18} />
                </span>
                <div className="min-w-0 pt-0.5">
                  <h4 className="text-[14px] font-semibold">{text.emptyTitle}</h4>
                  <p className="mt-1 max-w-md text-[11px] leading-relaxed text-muted-foreground">{text.empty}</p>
                </div>
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
                                    className="pen-touch-target flex shrink-0 items-center justify-center rounded-full text-foreground/45 transition-colors hover:bg-foreground/[0.055] hover:text-foreground"
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
                              <div className="grid gap-3 sm:grid-cols-2 sm:gap-4">
                                <label className="flex min-h-11 items-center gap-3">
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
                                <label className="flex min-h-11 items-center gap-3 sm:border-l sm:border-border/45 sm:pl-4">
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
                              </div>
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
                                <Button asChild variant="outline" size="sm" className="h-11 w-full">
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
                                <Button asChild variant="outline" size="sm" className="mt-3 h-11 w-full">
                                  <Link href={`/tour/${asset.source_splat_id}`}>
                                    <ExternalLinkIcon size={13} />
                                    {text.preview}
                                  </Link>
                                </Button>
                              ) : null}
                              {canCreateInWeb && (asset.editor_workspace || asset.source_splat_id) ? (
                                <Button asChild variant="outline" size="sm" className="mt-3 hidden h-11 w-full md:inline-flex">
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
                              {/*
                                The confirm tray itself stays neutral. Tinting
                                it red as well as the heading, the border and
                                the action turned a two-button confirmation
                                into a block of red inside an otherwise
                                monochrome product — the destructive signal
                                reads more clearly when only the action
                                carries it.
                              */}
                              {confirmRemoveId === asset.id ? (
                                <div className="border-t border-border/45 pt-3">
                                  <p className="text-[12px] font-semibold text-destructive">
                                    {text.removeConfirmTitle}
                                  </p>
                                  <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                                    {text.removeConfirm(
                                      asset.lifecycle.removal_kind ?? "archive",
                                    )}
                                  </p>
                                  {changed ? (
                                    <p className="mt-2 text-[11px] font-medium text-foreground/60">
                                      {text.saveBeforeRemove}
                                    </p>
                                  ) : null}
                                  {/* Side by side once there is room; two
                                      full-width stacked pills made a routine
                                      confirmation look like a major event. */}
                                  <div className="mt-3 grid grid-cols-2 gap-2">
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
                                      variant="outline"
                                      size="xs"
                                      className="h-auto min-h-9 w-full justify-center whitespace-normal border-destructive/18 !bg-destructive/[0.045] py-2 text-center leading-tight text-destructive shadow-none hover:!bg-destructive/[0.08]"
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
                                  className="pen-touch-target text-foreground/70 hover:bg-foreground/[0.045] hover:text-foreground"
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

          {/*
            Publishing is delivery, not sharing — it mints no link and shows no
            recipient controls. Without this hand-off the panel dead-ends: the
            tour reads "Published" and there is nowhere to get a URL or set a
            PIN. It only routes; it never creates a share by itself.
          */}
          {!loading && payload ? <div className="editor-glass-surface overflow-hidden rounded-[1.4rem] border border-border/60">
          {onOpenSharing ? (
            <div className="p-4">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border/55 bg-card/82 text-foreground/62 shadow-control">
                  <ShareIcon size={15} />
                </span>
                <span className="min-w-0 pt-0.5">
                  <span className="block text-[12px] font-semibold">{text.openSharing}</span>
                  <span className="mt-0.5 block text-[10px] leading-relaxed text-muted-foreground">{text.openSharingHint}</span>
                </span>
              </div>
              {/*
                Sized above the card's own "Otvoriť prehliadku" (sm): this is
                the panel's primary action, and at xs it read as a footnote.
              */}
              <Button
                variant="outline"
                className="glossy-capsule mt-3 h-11 w-full border-border/65 bg-card/86 text-foreground shadow-control"
                onClick={() => {
                  setOpen(false);
                  onOpenSharing();
                }}
              >
                <ShareIcon size={15} />
                {text.openSharing}
              </Button>
            </div>
          ) : null}

          <label className={cn("flex items-center gap-3 p-4", onOpenSharing && "border-t border-border/55")}>
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
          </div> : null}

          {!loading && (payload?.publication?.entries.length ?? 0) > 0 ? (
            <div className="floating-panel p-4">
              <p className="text-[10px] leading-relaxed text-muted-foreground">
                {text.unpublishAllHint}
              </p>
              <div className="mt-3 flex gap-2">
                {confirmUnpublish ? (
                  <>
                    <Button
                      size="xs"
                      variant="ghost"
                      className="flex-1"
                      disabled={saving}
                      onClick={() => setConfirmUnpublish(false)}
                    >
                      {t("common.cancel", lang)}
                    </Button>
                    <Button
                      size="xs"
                      variant="destructive"
                      className="flex-1"
                      loading={saving}
                      disabled={saving}
                      onClick={() => { void unpublishAll(); }}
                    >
                      {text.unpublish}
                    </Button>
                  </>
                ) : (
                  <Button
                    size="xs"
                    variant="outline"
                    className="w-full"
                    disabled={saving || loading}
                    onClick={() => setConfirmUnpublish(true)}
                  >
                    {text.unpublishAll}
                  </Button>
                )}
              </div>
            </div>
          ) : null}
        </div>
      </SidePanel>
    </section>
  );
}

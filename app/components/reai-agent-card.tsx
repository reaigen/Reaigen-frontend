"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";

import {
  applyReaiMediaAction,
  applyReaiTranslationAction,
  applyReaiWorkspaceAction,
  applyReaiWorkspaceProposal,
  askReaiWorkspace,
  getAgentCreationHistory,
  getAgentMediaVersions,
  getReaiAgentConsent,
  getReaiImprovementConsent,
  listUnits,
  restoreAgentCreationRevision,
  manageAgentMediaVersion,
  saveReaiFeedback,
  updateLocalization,
  type AgentCreationRevision,
  type AgentMediaVersionGroup,
  type ReaiAgentConsent,
  type ReaiAgentResponse,
  type ReaiImprovementConsent,
} from "../lib/api/client";
import {
  agentTranscriptKey,
  readAgentTranscript,
  writeAgentTranscript,
} from "../lib/agent-session";
import { formatDate, t } from "../lib/i18n";
import type { LocaleKey } from "../lib/locales";
import { PROPERTY_FIELD_SECTIONS, subtypeOptions, type PropertyFieldDefinition, type PropertyType } from "../lib/property-field-registry";
import type { DraftDetailItem } from "../lib/tour-types";
import { baseUnitForCategory, resolveUnit, unitLabel, type UnitLookup } from "../lib/unit-catalog";
import { Button } from "../lib/ui/button";
import { cn } from "../lib/utils";
import { AgentMiniUi } from "./agent-mini-ui";
import { MediaVersionCard, type MediaAction } from "./draft-version-manager";
import { useAuth } from "./hooks/use-auth";
import { StatusPill } from "./status-pill";
import { SearchIcon, VersionsIcon, LayoutIcon, SparklesIcon, CheckIcon, CloseIcon, EditIcon, LockIcon, InfoIcon } from "./icons";

// Maps a quick-action key to its icon, so the agent suggestions read as
// distinct, recognisable actions rather than flat text rows.
const ACTION_ICON: Record<string, typeof SearchIcon> = {
  "reai.quickFind": SearchIcon,
  "reai.quickCompare": VersionsIcon,
  "reai.quickBulk": LayoutIcon,
  "reai.quickImproveDescription": SparklesIcon,
  "reai.quickCheckFields": CheckIcon,
  "reai.quickEditCurrent": EditIcon,
  "reai.quickSettingsAgent": SparklesIcon,
  "reai.quickSettingsLanguage": InfoIcon,
  "reai.quickSettingsSecurity": LockIcon,
};

function Working({ lang, className }: { lang: string; className?: string }) {
  return (
    <p role="status" aria-live="polite" className={cn("flex items-center gap-2 py-3 text-[11px] text-muted-foreground", className)}>
      <svg className="h-3.5 w-3.5 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
      {t("reai.working", lang)}
    </p>
  );
}

function AgentStatusBadge({
  tone,
  children,
}: {
  tone: "success" | "pending" | "neutral";
  children: ReactNode;
}) {
  const Icon = tone === "success" ? CheckIcon : tone === "pending" ? InfoIcon : CloseIcon;
  return (
    <span
      role="status"
      className={cn(
        "floating-status inline-flex items-center gap-1.5 text-xs",
        tone === "success" && "bg-foreground text-background",
        tone === "pending" && "border border-border/55 bg-background text-foreground/75",
        tone === "neutral" && "bg-foreground/[0.06] text-muted-foreground",
      )}
    >
      <Icon size={12} aria-hidden="true" />
      {children}
    </span>
  );
}

type ChatTurn = {
  id: number;
  role: "user" | "assistant";
  content: string;
  response?: ReaiAgentResponse;
  feedback?: boolean;
  proposalStatus?: "applied" | "dismissed";
  actionStatus?: "applied" | "dismissed";
};

function contextualShareUrl(answer: ReaiAgentResponse): string | null {
  if (answer.share_path && typeof window !== "undefined") {
    return new URL(answer.share_path, window.location.origin).toString();
  }
  return answer.share_url || null;
}

const revisionFieldKeys = {
  title: "reai.field.title",
  description: "reai.field.description",
  price: "reai.field.price",
  currency: "reai.field.currency",
  area: "reai.field.area",
  lot_size: "reai.field.lot_size",
  year_built: "reai.field.year_built",
  specs: "reai.field.specs",
} as const;

function agentFieldLabel(field: string, lang: string): string {
  const key = revisionFieldKeys[field as keyof typeof revisionFieldKeys];
  return key ? t(key, lang) : field.replaceAll("_", " ");
}

function proposalValue(
  field: string,
  value: unknown,
  answer: ReaiAgentResponse,
  units: readonly UnitLookup[],
  lang: string,
): string {
  const number = typeof value === "number" ? value : (
    typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value)) ? Number(value) : null
  );
  const formatted = number === null
    ? null
    : new Intl.NumberFormat(lang || "en", { maximumFractionDigits: 2 }).format(number);
  const firstCreation = answer.draft_results?.[0]?.creation_data;
  if (field === "area" && formatted) {
    const measurements = firstCreation?.floorplan_measurements as { total_floor_area_m2?: number } | undefined;
    const unit = measurements?.total_floor_area_m2 != null
      ? baseUnitForCategory(units, "AREA")
      : resolveUnit(units, firstCreation?.area_unit as string | number | null | undefined, "AREA");
    const label = unitLabel(unit);
    return `${formatted}${label ? ` ${label}` : ""}`;
  }
  if (field === "lot_size" && formatted) {
    const unit = resolveUnit(units, firstCreation?.lot_size_unit as string | number | null | undefined, "AREA");
    const label = unitLabel(unit);
    return `${formatted}${label ? ` ${label}` : ""}`;
  }
  if (field === "price" && formatted) {
    const unit = resolveUnit(units, firstCreation?.currency, "CURRENCY");
    const label = unitLabel(unit);
    return `${formatted}${label ? ` ${label}` : ""}`;
  }
  if (formatted) return formatted;
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function positiveDisplayValue(value: unknown): boolean {
  if (value === null || value === undefined || value === "") return false;
  const number = Number(value);
  return !Number.isFinite(number) || number > 0;
}

function localizedMetric(value: unknown, lang: string): string | null {
  if (!positiveDisplayValue(value)) return null;
  const number = Number(value);
  return Number.isFinite(number)
    ? new Intl.NumberFormat(lang || "en", { maximumFractionDigits: 2 }).format(number)
    : String(value);
}

function localizedLookupMetric(
  value: unknown,
  unitValue: unknown,
  category: "AREA" | "CURRENCY",
  units: readonly UnitLookup[],
  lang: string,
) {
  const formatted = localizedMetric(value, lang);
  if (!formatted) return null;
  const unit = resolveUnit(
    units,
    typeof unitValue === "string" || typeof unitValue === "number" ? unitValue : null,
    category,
  );
  const label = unitLabel(unit);
  return `${formatted}${label ? ` ${label}` : ""}`;
}

const specFieldDefinitions: Map<string, PropertyFieldDefinition> = new Map(
  PROPERTY_FIELD_SECTIONS.flatMap((section) => (
    section.fields.map((field) => [`${section.key}.${field.key}`, field] as const)
  )),
);
const propertyTypes: PropertyType[] = ["apartment", "house", "land", "commercial", "other"];
const propertySubtypeOptions = propertyTypes.flatMap((propertyType) => subtypeOptions(propertyType));

function localizedSpecValue(value: unknown, lang: string, section: string, key: string): string {
  if (Array.isArray(value)) return value.map((item) => localizedSpecValue(item, lang, section, key)).join(", ");
  if (typeof value === "boolean") return value ? t("common.yes", lang) : t("common.no", lang);
  const raw = String(value ?? "");
  const definition = specFieldDefinitions.get(`${section}.${key}`);
  const options = key === "property_subtype" ? propertySubtypeOptions : definition?.options;
  const option = options?.find((item) => item.value === raw);
  return option ? t(option.labelKey, lang) : raw.replaceAll("_", " ");
}

function proposalSpecEntries(value: unknown, lang: string): Array<{ key: string; label: string; value: string }> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const entries: Array<{ key: string; label: string; value: string }> = [];
  Object.entries(value as Record<string, unknown>).forEach(([section, sectionValue]) => {
    if (!sectionValue || typeof sectionValue !== "object" || Array.isArray(sectionValue)) return;
    Object.entries(sectionValue as Record<string, unknown>).forEach(([key, item]) => {
      const definition = specFieldDefinitions.get(`${section}.${key}`);
      entries.push({
        key: `${section}.${key}`,
        label: definition ? t(definition.labelKey, lang) : key.replaceAll("_", " "),
        value: localizedSpecValue(item, lang, section, key),
      });
    });
  });
  return entries;
}

function localizedLanguageName(code: string, lang: string): string {
  if (code === "auto") return t("reai.translationAuto", lang);
  try {
    return new Intl.DisplayNames([lang || "en"], { type: "language" }).of(code) || code.toUpperCase();
  } catch {
    return code.toUpperCase();
  }
}

function mediaOperationSuffix(key: string, value: string | number | boolean, lang: string): string {
  if (typeof value === "boolean") return "";
  if (key === "motion") {
    return ` · ${t(`reai.mediaMotion.${value}` as LocaleKey, lang)}`;
  }
  if (typeof value === "number") {
    return ` · ${new Intl.NumberFormat(lang || "en", { maximumFractionDigits: 2 }).format(value)}`;
  }
  return ` · ${value}`;
}

function historyValue(
  field: string,
  value: unknown,
  unitState: Record<string, unknown>,
  units: readonly UnitLookup[],
  lang: string,
): string {
  if (field === "specs") {
    const entries = proposalSpecEntries(value, lang);
    return entries.length > 0
      ? entries.map((item) => `${item.label}: ${item.value}`).join(" · ")
      : t("reai.detailsChanged", lang);
  }
  if (value === null || value === undefined || value === "") return t("reai.emptyValue", lang);
  const number = typeof value === "number" ? value : (
    typeof value === "string" && Number.isFinite(Number(value)) ? Number(value) : null
  );
  if (number !== null) {
    const formatted = new Intl.NumberFormat(lang || "en", { maximumFractionDigits: 2 }).format(number);
    if (field === "area" || field === "lot_size") {
      const unitValue = field === "lot_size"
        ? unitState.lot_size_unit
        : unitState.area_unit ?? unitState.area_unit_code ?? unitState.area_unit_display;
      const label = unitLabel(resolveUnit(units, unitValue as string | number | null | undefined, "AREA"));
      return `${formatted}${label ? ` ${label}` : ""}`;
    }
    if (field === "price") {
      const label = unitLabel(resolveUnit(units, unitState.currency as string | number | null | undefined, "CURRENCY"));
      return `${formatted}${label ? ` ${label}` : ""}`;
    }
    return formatted;
  }
  return String(value);
}

function errorText(_error: unknown, lang: string): string {
  // Backend `detail` strings are raw English internals (e.g. "The Agent tool
  // 'settings_navigation' is disabled in user settings") — never surface them
  // in a localized creator workspace. Always show a clean localized message.
  return t("reai.error", lang);
}

function isExplicitProposalConfirmation(value: string): boolean {
  const normalized = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/\s+/g, " ")
    .trim();

  return [
    /\b(save|apply|confirm)\b/,
    /\buse (it|this|that)(?: change)?\b/,
    /\b(uloz|pouzi|potvrd|aplikuj)\b/,
    /\b(speichern|anwenden|bestatigen|ubernehmen)\b/,
  ].some((pattern) => pattern.test(normalized));
}

export function ReaiAgentCard({
  draftId,
  currentUploadId,
  workspaceContext = draftId ? "draft" : "creator",
  lang,
  onDraftUpdated,
  panel = false,
  compact = false,
}: {
  draftId?: number;
  currentUploadId?: number;
  workspaceContext?: "creator" | "draft" | "settings";
  lang: string;
  onDraftUpdated?: (draft: DraftDetailItem) => void;
  panel?: boolean;
  compact?: boolean;
}) {
  const { user } = useAuth();
  const dateFormat = user?.localization?.date_format;
  const [consent, setConsent] = useState<ReaiAgentConsent | null>(null);
  const [consentResolved, setConsentResolved] = useState(false);
  const [improvementConsent, setImprovementConsent] = useState<ReaiImprovementConsent | null>(null);
  const [improvementConversationId, setImprovementConversationId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [busy, setBusy] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showMediaHistory, setShowMediaHistory] = useState(false);
  const [history, setHistory] = useState<AgentCreationRevision[]>([]);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [restoreCandidateId, setRestoreCandidateId] = useState<number | null>(null);
  const [historyNotice, setHistoryNotice] = useState<string | null>(null);
  const [mediaGroups, setMediaGroups] = useState<AgentMediaVersionGroup[]>([]);
  const [selectedMediaVersionIds, setSelectedMediaVersionIds] = useState<Record<string, number>>({});
  const [mediaBusy, setMediaBusy] = useState(false);
  const [mediaCandidate, setMediaCandidate] = useState<MediaAction>(null);
  const [unitCatalog, setUnitCatalog] = useState<UnitLookup[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [copiedShareUrl, setCopiedShareUrl] = useState<string | null>(null);
  const [consentReloadKey, setConsentReloadKey] = useState(0);
  const [composerFocused, setComposerFocused] = useState(false);
  const [transcriptRestored, setTranscriptRestored] = useState(false);
  const restoredTranscriptKeyRef = useRef<string | null>(null);
  const compactPanel = panel && compact;
  const transcriptKey = agentTranscriptKey(workspaceContext, draftId);
  const quickActions = workspaceContext === "settings"
    ? (["reai.quickSettingsAgent", "reai.quickSettingsLanguage", "reai.quickSettingsSecurity"] as const)
    : draftId
    ? (["reai.quickImproveDescription", "reai.quickCheckFields", "reai.quickEditCurrent"] as const)
    : (["reai.quickFind", "reai.quickCompare", "reai.quickBulk"] as const);

  // Each page mounts its own shell, so this component is recreated on every
  // navigation. Rehydrate the parked transcript on mount, then keep the parked
  // copy in step with it.
  useEffect(() => {
    setTurns(readAgentTranscript<ChatTurn>(transcriptKey) ?? []);
    restoredTranscriptKeyRef.current = transcriptKey;
    setTranscriptRestored(true);
  }, [transcriptKey]);

  useEffect(() => {
    // Switching drafts changes the key one render before `turns` catches up.
    // Writing in that gap would stamp the previous conversation onto the
    // bucket that was just read, so wait until the two agree.
    if (!transcriptRestored || restoredTranscriptKeyRef.current !== transcriptKey) return;
    writeAgentTranscript(transcriptKey, turns);
  }, [transcriptKey, transcriptRestored, turns]);

  useEffect(() => {
    let active = true;
    setConsentResolved(false);
    setError(null);
    getReaiAgentConsent()
      .then((value) => {
        if (active) setConsent(value);
      })
      .catch((err) => {
        if (active) {
          setConsent(null);
          setError(errorText(err, lang));
        }
      })
      .finally(() => {
        if (active) setConsentResolved(true);
      });
    getReaiImprovementConsent().then(setImprovementConsent).catch(() => undefined);
    listUnits().then(setUnitCatalog).catch(() => setUnitCatalog([]));
    return () => { active = false; };
  }, [consentReloadKey, lang]);

  const loadHistory = async () => {
    if (!draftId) return;
    setHistoryBusy(true);
    try {
      const result = await getAgentCreationHistory(draftId);
      setHistory(result.revisions);
    } catch (err) {
      setError(errorText(err, lang));
    } finally {
      setHistoryBusy(false);
    }
  };

  const loadMediaHistory = async () => {
    if (!draftId) return;
    setMediaBusy(true);
    try {
      const result = await getAgentMediaVersions(draftId);
      setMediaGroups(result.groups);
      setSelectedMediaVersionIds((current) => Object.fromEntries(result.groups.flatMap((group) => {
        const currentSelection = group.versions.find((version) => version.id === current[group.logical_asset_id]);
        const selected = currentSelection
          ?? group.versions.find((version) => version.is_master)
          ?? group.versions.find((version) => !version.is_deleted)
          ?? group.versions[0];
        return selected ? [[group.logical_asset_id, selected.id]] : [];
      })));
    } catch (err) {
      setError(errorText(err, lang));
    } finally {
      setMediaBusy(false);
    }
  };

  const manageMediaVersion = async () => {
    if (!draftId || !mediaCandidate) return;
    setMediaBusy(true);
    try {
      await manageAgentMediaVersion(draftId, mediaCandidate.uploadId, mediaCandidate.action);
      setMediaCandidate(null);
      await loadMediaHistory();
      window.dispatchEvent(new CustomEvent("reai-media-updated", { detail: { draftId } }));
      window.dispatchEvent(new CustomEvent("reai-creations-updated", { detail: { draftIds: [draftId] } }));
    } catch (err) {
      setError(errorText(err, lang));
    } finally {
      setMediaBusy(false);
    }
  };

  useEffect(() => {
    setTurns([]);
    setMessage("");
    setComposerFocused(false);
    setImprovementConversationId(null);
    setShowHistory(false);
    setShowMediaHistory(false);
    setHistory([]);
    setMediaGroups([]);
    setSelectedMediaVersionIds({});
    setMediaCandidate(null);
    setRestoreCandidateId(null);
    setHistoryNotice(null);
    setError(null);
  }, [draftId, workspaceContext]);

  const ask = async (override?: string) => {
    const requestText = (override ?? message).trim();
    if (!requestText || busy) return;
    const userTurn: ChatTurn = { id: Date.now(), role: "user", content: requestText };
    setTurns((current) => [...current, userTurn]);
    setMessage("");

    const pendingProposal = [...turns].reverse().find((turn) => (
      turn.role === "assistant"
      && Boolean(turn.response?.proposal_token)
      && !turn.proposalStatus
    ));
    if (
      pendingProposal?.response?.proposal_token
      && isExplicitProposalConfirmation(requestText)
    ) {
      const applied = await apply(pendingProposal.id, pendingProposal.response);
      if (applied) {
        setTurns((current) => [
          ...current,
          { id: Date.now() + 1, role: "assistant", content: t("reai.applied", lang) },
        ]);
      }
      return;
    }

    const conversation = turns.slice(-4).map(({ role, content }) => ({ role, content }));
    setBusy(true);
    setError(null);
    try {
      const pendingActionCode = [...turns]
        .reverse()
        .find((turn) => turn.role === "assistant" && turn.response)?.response?.action_code;
      const response = await askReaiWorkspace(
        requestText,
        draftId,
        conversation,
        improvementConversationId,
        undefined,
        pendingActionCode,
        workspaceContext,
        currentUploadId,
      );
      if (!draftId && response.operation === "list" && response.search_query) {
        window.dispatchEvent(new CustomEvent("reai-workspace-search", {
          detail: { query: response.search_query },
        }));
      }
      if (response.action_code === "settings_navigation" && response.settings_section) {
        window.dispatchEvent(new CustomEvent("reai-settings-navigate", {
          detail: { section: response.settings_section },
        }));
      }
      if (response.action_code === "settings_update" && response.settings_changes?.preferred_language) {
        window.dispatchEvent(new CustomEvent("reai-settings-navigate", {
          detail: { section: "localization" },
        }));
        await updateLocalization({
          preferred_language: response.settings_changes.preferred_language,
        });
        window.location.hash = "localization";
        window.location.reload();
        return;
      }
      if (response.improvement_conversation_id) setImprovementConversationId(response.improvement_conversation_id);
      setTurns((current) => [
        ...current,
        { id: Date.now() + 1, role: "assistant", content: response.reply, response },
      ]);
    } catch (err) {
      setError(errorText(err, lang));
      setTurns((current) => current.filter((turn) => turn.id !== userTurn.id));
      setMessage(requestText);
    } finally {
      setBusy(false);
    }
  };

  const apply = async (turnId: number, answer: ReaiAgentResponse): Promise<boolean> => {
    if (!answer.proposal_token) return false;
    setBusy(true);
    setError(null);
    try {
      const result = await applyReaiWorkspaceProposal(answer.proposal_token, draftId, improvementConversationId);
      if (result.current_draft) onDraftUpdated?.(result.current_draft);
      window.dispatchEvent(new CustomEvent("reai-creations-updated", {
        detail: { draftIds: result.applied_draft_ids },
      }));
      if (showHistory) await loadHistory();
      setTurns((current) => current.map((turn) => turn.id === turnId ? {
        ...turn,
        proposalStatus: "applied",
        response: { ...answer, proposal_token: null },
      } : turn));
      return true;
    } catch (err) {
      setError(errorText(err, lang));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const restoreRevision = async (revision: AgentCreationRevision) => {
    if (!draftId || busy || restoreCandidateId !== revision.id) return;
    setBusy(true);
    setError(null);
    try {
      const result = await restoreAgentCreationRevision(draftId, revision.id);
      onDraftUpdated?.(result.draft);
      window.dispatchEvent(new CustomEvent("reai-creations-updated", { detail: { draftIds: [draftId] } }));
      await loadHistory();
      setRestoreCandidateId(null);
      setHistoryNotice(t("reai.restored", lang));
    } catch (err) {
      setError(errorText(err, lang));
    } finally {
      setBusy(false);
    }
  };

  const dismissProposal = (turnId: number) => {
    setTurns((current) => current.map((turn) => turn.id === turnId && turn.response ? {
      ...turn,
      proposalStatus: "dismissed",
      response: { ...turn.response, proposal_token: null },
    } : turn));
  };

  const applyAction = async (turnId: number, answer: ReaiAgentResponse) => {
    if (!answer.action_token) return;
    setBusy(true);
    setError(null);
    try {
      if (answer.action_code === "translate_description") {
        const result = await applyReaiTranslationAction(answer.action_token, improvementConversationId);
        window.dispatchEvent(new CustomEvent("reai-creations-updated", {
          detail: { draftIds: [result.draft_id], translationStatus: result.status },
        }));
        setTurns((current) => current.map((turn) => turn.id === turnId ? {
          ...turn,
          actionStatus: "applied",
          response: {
            ...answer,
            action_token: null,
            translation_action: {
              field: "description",
              source_language: "auto",
              target_language: result.target_language,
              status: result.status,
              cached: result.cached,
              translated_text: result.translated_text,
            },
          },
        } : turn));
        return;
      }
      if (["grade_draft_images", "retouch_draft_image", "cleanplate_draft_images", "generative_hdr_draft_image", "organize_draft_images", "generate_draft_video"].includes(answer.action_code || "")) {
        const result = await applyReaiMediaAction(answer.action_token, improvementConversationId);
        window.dispatchEvent(new CustomEvent("reai-media-updated", {
          detail: { draftId: result.draft_id, action: result.action, pending: result.status === "pending" },
        }));
        window.dispatchEvent(new CustomEvent("reai-creations-updated", { detail: { draftIds: [result.draft_id] } }));
        setTurns((current) => current.map((turn) => turn.id === turnId ? {
          ...turn,
          actionStatus: "applied",
          response: { ...answer, action_token: null },
        } : turn));
        if (answer.action_code !== "generate_draft_video" && answer.action_code !== "organize_draft_images") {
          setTimeout(() => void loadMediaHistory(), result.status === "pending" ? 2500 : 0);
        }
        return;
      }
      const result = await applyReaiWorkspaceAction(answer.action_token, improvementConversationId);
      if (result.action === "revoke_all_shares" || result.action === "manage_shares") {
        window.dispatchEvent(new CustomEvent("reai-shares-updated", {
          detail: {
            revokedCount: result.revoked_count,
            updatedCount: "updated_count" in result ? result.updated_count : result.revoked_count,
            operation: "operation" in result ? result.operation : "revoke",
          },
        }));
      } else {
        window.dispatchEvent(new CustomEvent("reai-shares-updated", {
          detail: { created: result.created, draftId: result.draft_id, shareId: result.share_id },
        }));
      }
      setTurns((current) => current.map((turn) => turn.id === turnId ? {
        ...turn,
        actionStatus: "applied",
        response: {
          ...answer,
          action_token: null,
          share_id: result.action === "create_draft_share" ? result.share_id : answer.share_id,
          share_url: result.action === "create_draft_share" ? result.share_url : answer.share_url,
          share_path: result.action === "create_draft_share" ? result.share_path : answer.share_path,
          selected_share_fields: result.action === "create_draft_share"
            ? result.selected_share_fields
            : answer.selected_share_fields,
        },
      } : turn));
    } catch (err) {
      setError(errorText(err, lang));
    } finally {
      setBusy(false);
    }
  };

  const dismissAction = (turnId: number) => {
    setTurns((current) => current.map((turn) => turn.id === turnId && turn.response ? {
      ...turn,
      actionStatus: "dismissed",
      response: { ...turn.response, action_token: null },
    } : turn));
  };

  const copyShareUrl = async (url: string) => {
    await navigator.clipboard.writeText(url);
    setCopiedShareUrl(url);
    window.setTimeout(() => setCopiedShareUrl((current) => current === url ? null : current), 1800);
  };

  const sendFeedback = async (turnId: number, helpful: boolean, conversationId?: string | null) => {
    const id = conversationId || improvementConversationId;
    if (!id || busy) return;
    setBusy(true);
    try {
      await saveReaiFeedback(id, helpful);
      setTurns((current) => current.map((turn) => turn.id === turnId ? { ...turn, feedback: helpful } : turn));
    } catch (err) {
      setError(errorText(err, lang));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={cn(
      "rounded-2xl bg-foreground/[0.025]",
      compactPanel ? "p-3 [&_button]:min-h-11 [&_button]:min-w-11" : "p-4",
      panel ? "flex h-full min-h-0 flex-col rounded-none border-0 bg-transparent pb-[max(1rem,env(safe-area-inset-bottom))]" : "mt-5 border border-border/40",
    )} aria-label={panel ? t("reai.title", lang) : undefined} aria-labelledby={panel ? undefined : "reai-title"}>
      <div className={cn("items-start justify-between gap-3", panel ? "hidden" : "flex")}>
        <div>
          <h2 id="reai-title" className="text-[14px] font-semibold">{t("reai.title", lang)}</h2>
          <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{t("reai.subtitle", lang)}</p>
        </div>
        <StatusPill tone="success" dot className="rounded-2xl">{t("reai.private", lang)}</StatusPill>
      </div>

      {!consentResolved ? (
        <div className={cn("mt-4", panel && "flex min-h-0 flex-1 items-center justify-center")}>
          <Working lang={lang} />
        </div>
      ) : !consent ? (
        <div role="alert" className={cn("mt-4 rounded-2xl border border-destructive/20 bg-destructive/[0.045] p-3", panel && "mt-auto mb-auto")}>
          <p className="text-[12px] leading-relaxed text-destructive">{error || t("reai.error", lang)}</p>
          <Button type="button" variant="outline" size="sm" className="mt-3 rounded-2xl" onClick={() => setConsentReloadKey((current) => current + 1)}>
            {t("common.tryAgain", lang)}
          </Button>
        </div>
      ) : !consent.consented ? (
        <div className="mt-4 flex flex-col gap-3 rounded-2xl bg-background/70 p-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[12px] leading-relaxed text-foreground/65">{t("reai.enableInSettings", lang)}</p>
          <Button asChild size="sm" variant="outline" className="min-h-11">
            <Link href="/settings#reai">{t("reai.openSettings", lang)}</Link>
          </Button>
        </div>
      ) : (
        <div className={cn("mt-4", panel ? "flex min-h-0 flex-1 flex-col" : "space-y-3", compactPanel ? "mt-1 gap-2" : panel && "gap-3")}>
          {draftId && compactPanel && !composerFocused && (
            <nav className="grid grid-cols-3 border-b border-border/60" aria-label={t("reai.title", lang)}>
              <button
                type="button"
                aria-pressed={!showHistory && !showMediaHistory}
                className={cn(
                  "min-w-0 overflow-hidden rounded-none border-b-2 px-1 py-2 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  !showHistory && !showMediaHistory ? "border-foreground text-foreground" : "border-transparent text-foreground/50",
                )}
                onClick={() => {
                  setShowHistory(false);
                  setShowMediaHistory(false);
                }}
              >
                <span className="block truncate">{t("reai.chat", lang)}</span>
              </button>
              <button
                type="button"
                aria-label={t("reai.mediaVersions", lang)}
                aria-pressed={showMediaHistory}
                className={cn(
                  "min-w-0 overflow-hidden rounded-none border-b-2 px-1 py-2 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  showMediaHistory ? "border-foreground text-foreground" : "border-transparent text-foreground/50",
                )}
                onClick={() => {
                  if (!showMediaHistory) void loadMediaHistory();
                  setShowMediaHistory(true);
                  setShowHistory(false);
                }}
              >
                <span className="block truncate">{t("reai.mediaTab", lang)}</span>
              </button>
              <button
                type="button"
                aria-label={t("reai.editHistory", lang)}
                aria-pressed={showHistory}
                className={cn(
                  "min-w-0 overflow-hidden rounded-none border-b-2 px-1 py-2 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  showHistory ? "border-foreground text-foreground" : "border-transparent text-foreground/50",
                )}
                onClick={() => {
                  if (!showHistory) void loadHistory();
                  setShowHistory(true);
                  setShowMediaHistory(false);
                }}
              >
                <span className="block truncate">{t("reai.historyTab", lang)}</span>
              </button>
            </nav>
          )}
          {draftId && !compactPanel && (
            // A quiet segmented control. This bar only switches views, so it
            // should not outweigh the transcript it sits above: a muted track
            // with the active segment lifted by one step, rather than a glass
            // toolbar carrying a solid high-contrast capsule.
            <nav
              className="agent-view-tabs mx-auto grid w-full max-w-[24rem] grid-cols-3"
              aria-label={t("reai.title", lang)}
            >
              <button
                type="button"
                aria-pressed={!showHistory && !showMediaHistory}
                className={cn(
                  "agent-view-tab",
                  !showHistory && !showMediaHistory ? "agent-view-tab-active" : "text-foreground/55 hover:text-foreground",
                )}
                onClick={() => {
                  setShowHistory(false);
                  setShowMediaHistory(false);
                }}
              >
                {t("reai.chat", lang)}
              </button>
              <button
                type="button"
                aria-label={t("reai.mediaVersions", lang)}
                aria-pressed={showMediaHistory}
                className={cn(
                  "agent-view-tab",
                  showMediaHistory ? "agent-view-tab-active" : "text-foreground/55 hover:text-foreground",
                )}
                onClick={() => {
                  if (!showMediaHistory) void loadMediaHistory();
                  setShowMediaHistory(true);
                  setShowHistory(false);
                }}
              >
                {t("reai.mediaTab", lang)}
              </button>
              <button
                type="button"
                aria-label={t("reai.editHistory", lang)}
                aria-pressed={showHistory}
                className={cn(
                  "agent-view-tab",
                  showHistory ? "agent-view-tab-active" : "text-foreground/55 hover:text-foreground",
                )}
                onClick={() => {
                  if (!showHistory) void loadHistory();
                  setShowHistory(true);
                  setShowMediaHistory(false);
                }}
              >
                {t("reai.historyTab", lang)}
              </button>
            </nav>
          )}
          {showHistory && draftId && (
            <div className={cn("min-h-0 space-y-2 overflow-y-auto pr-1", panel && "flex-1")} aria-live="polite">
              <div className="pb-1">
                <h3 className="text-[13px] font-semibold">{t("reai.editHistory", lang)}</h3>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{t("reai.historySafety", lang)}</p>
              </div>
              {historyNotice && (
                <div className="rounded-2xl border border-border/50 bg-foreground/[0.035] px-3 py-2.5 text-[11px] leading-relaxed text-foreground/75">
                  {historyNotice}
                </div>
              )}
              {historyBusy && <Working lang={lang} />}
              {!historyBusy && history.length === 0 && (
                <p className="rounded-2xl border border-border/40 p-3 text-[11px] leading-relaxed text-muted-foreground">{t("reai.historyEmpty", lang)}</p>
              )}
              {!historyBusy && history.length > 0 && (
                <div className="relative ml-1 border-l border-border/55 pl-4">
                  {history.map((revision, index) => (
                    <article key={revision.id} className="relative pb-5 last:pb-1">
                      <span className={cn(
                        "absolute -left-[20px] top-1.5 h-[7px] w-[7px] rounded-full ring-4 ring-background",
                        index === 0 ? "bg-foreground" : "bg-border",
                      )} />
                      <div className={cn(
                        "rounded-2xl px-3.5 py-3",
                        index === 0 ? "bg-foreground/[0.045]" : "border border-border/45 bg-background",
                      )}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <h4 className="text-[13px] font-semibold leading-5">
                                {t(`reai.history.${revision.source}`, lang)}
                              </h4>
                              {index === 0 && (
                                <span className="rounded-2xl bg-foreground px-2 py-0.5 text-[11px] font-medium text-background">
                                  {t("reai.currentVersion", lang)}
                                </span>
                              )}
                            </div>
                            <time className="mt-0.5 block text-[11px] text-muted-foreground">
                              {formatDate(revision.created_at, dateFormat, lang)}
                            </time>
                          </div>
                          {index > 0 && (
                            <Button
                              type="button"
                              variant="outline"
                              size="xs"
                              className="shrink-0 rounded-2xl"
                              disabled={busy}
                              onClick={() => {
                                setHistoryNotice(null);
                                setRestoreCandidateId(revision.id);
                              }}
                            >
                              {t("reai.restore", lang)}
                            </Button>
                          )}
                        </div>
                        <div className="mt-3 space-y-3 border-t border-border/40 pt-3">
                          {(revision.changed_fields.length > 0
                            ? revision.changed_fields
                            : ["title", "area"].filter((field) => revision.snapshot[field] !== null && revision.snapshot[field] !== undefined && revision.snapshot[field] !== "")
                          ).map((field) => {
                            const hasDiff = revision.changed_fields.includes(field);
                            const longForm = field === "description" || field === "specs";
                            if (!hasDiff) {
                              return (
                                <div key={field}>
                                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                                    {agentFieldLabel(field, lang)}
                                  </p>
                                  <p className="mt-1 break-words text-[12px] leading-5 text-foreground/85">
                                    {historyValue(field, revision.snapshot[field], revision.snapshot, unitCatalog, lang)}
                                  </p>
                                </div>
                              );
                            }
                            return (
                              <div key={field}>
                                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                                  {agentFieldLabel(field, lang)}
                                </p>
                                <div className={cn("mt-1.5 gap-2", longForm ? "space-y-2" : "grid grid-cols-2")}>
                                  <div className="min-w-0 rounded-2xl bg-background/70 px-2.5 py-2">
                                    <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/80">
                                      {t("reai.historyBefore", lang)}
                                    </p>
                                    <p className="mt-1 break-words text-[11px] leading-[1.55] text-muted-foreground">
                                      {historyValue(field, revision.before_values[field], { ...revision.snapshot, ...revision.before_values }, unitCatalog, lang)}
                                    </p>
                                  </div>
                                  <div className="min-w-0 rounded-2xl border-l-2 border-foreground/60 bg-background px-2.5 py-2">
                                    <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/80">
                                      {t("reai.historyAfter", lang)}
                                    </p>
                                    <p className="mt-1 break-words text-[11px] font-medium leading-[1.55] text-foreground/90">
                                      {historyValue(field, revision.after_values[field], { ...revision.snapshot, ...revision.after_values }, unitCatalog, lang)}
                                    </p>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                        {restoreCandidateId === revision.id && (
                          <div className="mt-3 border-t border-border/40 pt-3">
                            <p className="text-[11px] leading-relaxed text-foreground/70">{t("reai.restoreConfirm", lang)}</p>
                            <div className="mt-2.5 flex items-center gap-2">
                              <Button type="button" size="xs" className="rounded-2xl" loading={busy} onClick={() => void restoreRevision(revision)}>
                                {t("reai.restore", lang)}
                              </Button>
                              <Button type="button" variant="ghost" size="xs" className="rounded-2xl" disabled={busy} onClick={() => setRestoreCandidateId(null)}>
                                {t("reai.restoreCancel", lang)}
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          )}
          {showMediaHistory && draftId && (
            <div className={cn("min-h-0 space-y-3 overflow-y-auto pr-1", panel && "flex-1")} aria-live="polite">
              <div className="flex min-h-8 items-center justify-between gap-3 px-1">
                <h3 className="text-[13px] font-semibold">{t("reai.mediaVersions", lang)}</h3>
                {mediaGroups.length > 0 ? (
                  <span className="floating-status inline-flex min-w-7 items-center justify-center border border-border/70 bg-card text-[10px] tabular-nums text-foreground/60 shadow-control">
                    {mediaGroups.length}
                  </span>
                ) : null}
              </div>
              {mediaBusy && mediaGroups.length === 0 && <Working lang={lang} />}
              {!mediaBusy && mediaGroups.length === 0 && (
                <p className="rounded-[1.5rem] border border-dashed border-border/55 px-4 py-10 text-center text-[11px] text-muted-foreground">{t("reai.mediaVersionsEmpty", lang)}</p>
              )}
              <div className="agent-media-version-grid">
                {mediaGroups.map((group, groupIndex) => (
                  <MediaVersionCard
                    key={group.logical_asset_id}
                    group={group}
                    groupIndex={groupIndex}
                    selectedId={selectedMediaVersionIds[group.logical_asset_id]}
                    lang={lang}
                    dateFormat={dateFormat}
                    candidate={mediaCandidate}
                    busy={mediaBusy}
                    onSelect={(id) => {
                      setSelectedMediaVersionIds((current) => ({ ...current, [group.logical_asset_id]: id }));
                      setMediaCandidate(null);
                    }}
                    onCandidate={setMediaCandidate}
                    onCancel={() => setMediaCandidate(null)}
                    onConfirm={() => void manageMediaVersion()}
                  />
                ))}
              </div>
            </div>
          )}
          {!showHistory && !showMediaHistory && turns.length > 0 && (
            <div className={cn("space-y-4 overflow-y-auto pr-1", panel ? "min-h-0 flex-1" : "max-h-[420px]")} aria-live="polite">
              {turns.map((turn) => {
                const answer = turn.response;
                const shareUrl = answer ? contextualShareUrl(answer) : null;
                const targetTitle = answer?.draft_results?.find((draft) => answer.selected_creation_ids?.includes(draft.id))?.creation_data.title;
                return (
                  <div
                    key={turn.id}
                    className={turn.role === "user"
                      ? "ml-auto w-fit max-w-[85%] rounded-2xl bg-foreground px-3.5 py-2.5"
                      : "py-1"}
                  >
                    <p className={cn("whitespace-pre-line text-[14px] leading-6", turn.role === "user" ? "text-background" : "text-foreground")}>{turn.content}</p>
                    {answer && (
                      <AgentMiniUi
                        answer={answer}
                        currentDraftId={draftId}
                        lang={lang}
                        busy={busy}
                        formatDraftMeta={(draft) => [
                          localizedLookupMetric(draft.creation_data.area, draft.creation_data.area_unit, "AREA", unitCatalog, lang),
                          localizedLookupMetric(draft.creation_data.price, draft.creation_data.currency, "CURRENCY", unitCatalog, lang),
                        ].filter(Boolean).join(" · ")}
                        onPrompt={(prompt) => void ask(prompt)}
                      />
                    )}
                    {answer && !!answer.knowledge_sources?.length && (
                      <div className="mt-3 border-t border-border/30 pt-2">
                        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t("reai.sources", lang)}</p>
                        <ul className="mt-1 space-y-0.5 text-[11px] text-muted-foreground">
                          {answer.knowledge_sources.map((source) => (
                            <li key={`${source.sha256}-${source.version}`}>{source.title} · {source.source} · v{source.version}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {answer && Object.keys(answer.proposed_changes).length > 0 && (
                      <div className="mt-4 overflow-hidden rounded-2xl border border-border/60 bg-foreground/[0.018]">
                        <div className="border-b border-border/45 px-3.5 py-3">
                          <p className="text-xs font-semibold text-foreground">{t("reai.proposal", lang)}</p>
                          <p className="mt-0.5 truncate text-xs text-muted-foreground">
                            {targetTitle || t("nav.creation", lang)}
                            {(answer.selected_creation_ids?.length || 0) > 1 ? ` · ${answer.selected_creation_ids?.length} ${t("reai.targets", lang).toLocaleLowerCase(lang)}` : ""}
                          </p>
                        </div>
                        <ul className="divide-y divide-border/40 px-3.5 text-sm">
                          {Object.entries(answer.proposed_changes)
                            .sort(([left], [right]) => {
                              const order: Record<string, number> = { specs: 0, description: 1 };
                              return (order[left] ?? 2) - (order[right] ?? 2);
                            })
                            .map(([key, value]) => {
                            const longForm = key === "description" || key === "specs";
                            const specEntries = key === "specs" ? proposalSpecEntries(value, lang) : [];
                            return (
                              <li
                                key={key}
                                className={longForm ? "py-3.5" : "flex items-baseline justify-between gap-4 py-3"}
                              >
                                <span className={longForm ? "block text-xs font-medium text-muted-foreground" : "text-muted-foreground"}>
                                  {agentFieldLabel(key, lang)}
                                </span>
                                {key === "specs" && specEntries.length > 0 ? (
                                  <dl className="mt-2 divide-y divide-border/35 rounded-2xl bg-background/70 px-3">
                                    {specEntries.map((item) => (
                                      <div key={item.key} className="flex items-baseline justify-between gap-4 py-2.5">
                                        <dt className="text-xs text-muted-foreground">{item.label}</dt>
                                        <dd className="text-right text-xs font-medium text-foreground">{item.value}</dd>
                                      </div>
                                    ))}
                                  </dl>
                                ) : (
                                  <span className={longForm
                                    ? "mt-2 block whitespace-pre-wrap break-words text-left text-sm font-normal leading-6 text-foreground/85"
                                    : "text-right font-medium text-foreground"}
                                  >
                                    {proposalValue(key, value, answer, unitCatalog, lang)}
                                  </span>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                        {answer.proposal_token && (
                          <div className="flex items-center gap-2 border-t border-border/45 px-3.5 py-3">
                            <Button type="button" size="xs" className="rounded-2xl" loading={busy} onClick={() => apply(turn.id, answer)}>
                              {t("reai.apply", lang)}
                            </Button>
                            <Button type="button" variant="ghost" size="xs" className="rounded-2xl" disabled={busy} onClick={() => dismissProposal(turn.id)}>
                              {t("reai.dismissProposal", lang)}
                            </Button>
                          </div>
                        )}
                        {!answer.proposal_token && turn.proposalStatus && (
                          <div className="border-t border-border/45 px-3.5 py-3">
                            <AgentStatusBadge tone={turn.proposalStatus === "applied" ? "success" : "neutral"}>
                              {t(turn.proposalStatus === "applied" ? "reai.proposalApplied" : "reai.proposalDismissed", lang)}
                            </AgentStatusBadge>
                          </div>
                        )}
                      </div>
                    )}
                    {answer?.action_code === "translate_description" && answer.translation_action && (
                      <div className="mt-4 overflow-hidden rounded-2xl border border-border/60 bg-foreground/[0.018]">
                        <div className="px-3.5 py-3">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-xs font-semibold text-foreground">{t("reai.translationTitle", lang)}</p>
                              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t("reai.translationDescription", lang)}</p>
                            </div>
                            <span className="rounded-2xl bg-foreground/[0.06] px-2 py-1 text-[11px] font-medium text-foreground/65">
                              {t("reai.translationService", lang)}
                            </span>
                          </div>
                          <dl className="mt-3 divide-y divide-border/35 rounded-2xl bg-background/70 px-3">
                            <div className="flex items-baseline justify-between gap-4 py-2.5">
                              <dt className="text-xs text-muted-foreground">{t("reai.translationField", lang)}</dt>
                              <dd className="text-right text-xs font-medium text-foreground">{t("reai.field.description", lang)}</dd>
                            </div>
                            <div className="flex items-baseline justify-between gap-4 py-2.5">
                              <dt className="text-xs text-muted-foreground">{t("reai.translationSource", lang)}</dt>
                              <dd className="text-right text-xs font-medium text-foreground">
                                {localizedLanguageName(answer.translation_action.source_language, lang)}
                              </dd>
                            </div>
                            <div className="flex items-baseline justify-between gap-4 py-2.5">
                              <dt className="text-xs text-muted-foreground">{t("reai.translationTarget", lang)}</dt>
                              <dd className="text-right text-xs font-medium text-foreground">
                                {localizedLanguageName(answer.translation_action.target_language, lang)}
                              </dd>
                            </div>
                          </dl>
                          {answer.translation_action.translated_text && (
                            <div className="mt-3 rounded-2xl border border-border/40 bg-background px-3 py-2.5">
                              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t("reai.translationPreview", lang)}</p>
                              <p className="mt-1.5 whitespace-pre-wrap text-xs leading-5 text-foreground/85">
                                {answer.translation_action.translated_text}
                              </p>
                            </div>
                          )}
                        </div>
                        {answer.action_token && (
                          <div className="flex items-center gap-2 border-t border-border/45 px-3.5 py-3">
                            <Button type="button" size="sm" className="flex-1 rounded-2xl sm:flex-none" loading={busy} onClick={() => void applyAction(turn.id, answer)}>
                              {t("reai.translationConfirm", lang)}
                            </Button>
                            <Button type="button" variant="ghost" size="sm" className="rounded-2xl" disabled={busy} onClick={() => dismissAction(turn.id)}>
                              {t("reai.dismissProposal", lang)}
                            </Button>
                          </div>
                        )}
                        {!answer.action_token && (turn.actionStatus || answer.translation_action.status !== "awaiting_confirmation") && (
                          <div className="border-t border-border/45 px-3.5 py-3">
                            <AgentStatusBadge tone={
                              turn.actionStatus === "dismissed" || answer.translation_action.status === "unavailable"
                                ? "neutral"
                                : answer.translation_action.status === "ready" ? "success" : "pending"
                            }>
                              {turn.actionStatus === "dismissed"
                                ? t("reai.proposalDismissed", lang)
                                : answer.translation_action.status === "ready"
                                  ? t("reai.translationReady", lang)
                                  : answer.translation_action.status === "unavailable"
                                    ? t("reai.translationUnavailable", lang)
                                    : t("reai.translationQueued", lang)}
                            </AgentStatusBadge>
                          </div>
                        )}
                      </div>
                    )}
                    {answer && (["grade_draft_images", "retouch_draft_image", "cleanplate_draft_images", "generative_hdr_draft_image", "organize_draft_images", "generate_draft_video"].includes(answer.action_code || "")) && (answer.action_token || turn.actionStatus) && (
                      <div className="mt-4 overflow-hidden rounded-2xl border border-border/60 bg-foreground/[0.018]">
                        <div className="px-3.5 py-3">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-xs font-semibold text-foreground">
                                {t(
                                  answer.action_code === "retouch_draft_image"
                                    ? "reai.mediaRetouchTitle"
                                  : answer.action_code === "cleanplate_draft_images"
                                    ? "reai.mediaCleanplateTitle"
                                    : answer.action_code === "organize_draft_images"
                                      ? "reai.mediaOrganizeTitle"
                                    : answer.action_code === "generate_draft_video"
                                      ? "reai.mediaVideoTitle"
                                    : answer.action_code === "generative_hdr_draft_image"
                                      ? "reai.mediaHdrTitle"
                                      : "reai.mediaGradeTitle",
                                  lang,
                                )}
                              </p>
                              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                                {t("reai.mediaSelection", lang).replace("{count}", String(answer.action_count || 0))}
                              </p>
                            </div>
                            <span className="rounded-2xl bg-foreground/[0.06] px-2 py-1 text-[11px] font-medium text-foreground/65">
                              {answer.media_action?.cloud_image_processor
                                ? t("reai.mediaCloud", lang)
                                : t("reai.mediaLocal", lang)}
                            </span>
                          </div>
                          <p className="mt-2 text-[11px] leading-relaxed text-foreground/70">
                            {t(
                              answer.action_code === "retouch_draft_image"
                                ? "reai.retouchSafety"
                              : answer.action_code === "generate_draft_video"
                                ? "reai.videoSafety"
                                : answer.action_code === "organize_draft_images"
                                  ? "reai.organizeSafety"
                                  : "reai.mediaVersionWarning",
                              lang,
                            )}
                          </p>
                          {answer.media_action?.authenticity_boundary && (
                            <p className="mt-2 rounded-2xl bg-amber-500/10 px-2.5 py-2 text-[11px] leading-relaxed text-amber-900 dark:text-amber-100">
                              {t("reai.mediaHdrBoundary", lang)}
                            </p>
                          )}
                          {!!answer.media_action?.operations && Object.keys(answer.media_action.operations).length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {Object.entries(answer.media_action.operations).map(([key, value]) => (
                                <span key={key} className="rounded-2xl border border-border/50 bg-background px-2.5 py-1 text-[11px] text-foreground/70">
                                  {t(`reai.mediaOperation.${key}` as LocaleKey, lang)}{mediaOperationSuffix(key, value, lang)}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                        {answer.action_token && (
                          <div className="flex items-center gap-2 border-t border-border/45 px-3.5 py-3">
                            <Button type="button" size="sm" className="flex-1 rounded-2xl sm:flex-none" loading={busy} onClick={() => void applyAction(turn.id, answer)}>
                              {t("reai.mediaConfirm", lang)}
                            </Button>
                            <Button type="button" variant="ghost" size="sm" className="rounded-2xl" disabled={busy} onClick={() => dismissAction(turn.id)}>
                              {t("reai.dismissProposal", lang)}
                            </Button>
                          </div>
                        )}
                        {!answer.action_token && turn.actionStatus && (
                          <div className="border-t border-border/45 px-3.5 py-3">
                            <AgentStatusBadge tone={
                              turn.actionStatus !== "applied"
                                ? "neutral"
                                : answer.action_code === "organize_draft_images" ? "success" : "pending"
                            }>
                              {t(
                                turn.actionStatus !== "applied"
                                  ? "reai.proposalDismissed"
                                  : answer.action_code === "generate_draft_video"
                                    ? "reai.videoQueued"
                                    : answer.action_code === "organize_draft_images"
                                      ? "reai.galleryOrganized"
                                      : "reai.mediaQueued",
                                lang,
                              )}
                            </AgentStatusBadge>
                          </div>
                        )}
                      </div>
                    )}
                    {(answer?.action_code === "revoke_all_shares" || answer?.action_code === "manage_shares") && (answer.action_token || turn.actionStatus) && (
                      <div className="mt-4 overflow-hidden rounded-2xl border border-border/60 bg-foreground/[0.018]">
                        <div className="px-3.5 py-3">
                          <p className="text-xs font-semibold text-foreground">{t("reai.shareManagerTitle", lang)}</p>
                          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                            {t(`reai.shareManagerSelection.${answer.action_scope || "active_and_paused"}` as LocaleKey, lang)
                              .replace("{count}", String(answer.action_count || 0))}
                          </p>
                          <p className="mt-2 text-[11px] leading-relaxed text-foreground/70">{t("reai.shareManagerWarning", lang)}</p>
                        </div>
                        {answer.action_token && (
                          <div className="flex items-center gap-2 border-t border-border/45 px-3.5 py-3">
                            <Button type="button" size="sm" className="flex-1 rounded-2xl sm:flex-none" loading={busy} onClick={() => void applyAction(turn.id, answer)}>
                              {t(`reai.shareManagerConfirm.${answer.share_action || "revoke"}` as LocaleKey, lang)}
                            </Button>
                            <Button type="button" variant="ghost" size="sm" className="rounded-2xl" disabled={busy} onClick={() => dismissAction(turn.id)}>
                              {t("reai.dismissProposal", lang)}
                            </Button>
                          </div>
                        )}
                        {!answer.action_token && turn.actionStatus && (
                          <div className="border-t border-border/45 px-3.5 py-3">
                            <AgentStatusBadge tone={turn.actionStatus === "applied" ? "success" : "neutral"}>
                              {t(turn.actionStatus === "applied" ? "reai.shareManagerApplied" : "reai.proposalDismissed", lang)}
                            </AgentStatusBadge>
                          </div>
                        )}
                      </div>
                    )}
                    {answer?.action_code === "share_inventory" && !!answer.share_results?.length && (
                      <div className="mt-3 divide-y divide-border/40 overflow-hidden rounded-2xl border border-border/55">
                        {answer.share_results.map((share) => (
                          <div key={share.id} className="flex items-center gap-2 px-3 py-2">
                            <span className="min-w-0 flex-1 truncate text-[11px] font-medium">{share.title}</span>
                            <span className="text-[11px] text-muted-foreground">
                              {t("reai.shareManagerViews", lang).replace("{count}", String(share.access_count))}
                            </span>
                            <span className="rounded-2xl bg-foreground/[0.06] px-1.5 py-0.5 text-[11px] text-foreground/65">
                              {t(`reai.shareStatus.${share.status}` as LocaleKey, lang)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                    {answer?.action_code === "share_status" && answer.share_status && (
                      <div className="mt-3 rounded-2xl border border-border/55 bg-foreground/[0.018] px-3 py-2.5">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-foreground">{t("reai.currentShareTitle", lang)}</p>
                            <p className="mt-0.5 text-[11px] text-muted-foreground">
                              {t(`reai.shareStatus.${answer.share_status}` as LocaleKey, lang)}
                              {!!answer.selected_share_fields?.length && (
                                <> · {t("reai.currentShareFields", lang).replace("{count}", String(answer.selected_share_fields.length))}</>
                              )}
                            </p>
                          </div>
                          {shareUrl && (
                            <div className="flex shrink-0 items-center gap-1">
                              <Button type="button" variant="outline" size="xs" className="rounded-2xl" onClick={() => void copyShareUrl(shareUrl)}>
                                {t(copiedShareUrl === shareUrl ? "reai.shareCopied" : "reai.shareCopy", lang)}
                              </Button>
                              <a
                                href={shareUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="floating-control inline-flex min-w-11 items-center justify-center px-2 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                              >
                                {t("reai.shareOpen", lang)}
                              </a>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                    {answer?.action_code === "create_draft_share" && (answer.action_token || shareUrl || turn.actionStatus) && (
                      <div className="mt-3 rounded-2xl border border-border/55 bg-foreground/[0.018] px-3 py-2.5">
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-foreground">{t("reai.shareCreateTitle", lang)}</p>
                          <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
                            {shareUrl ? t("reai.shareCreateReady", lang) : t("reai.shareCreateBody", lang)}
                          </p>
                          {!!answer.selected_share_fields?.length && (
                            <p className="mt-1 truncate text-[11px] text-foreground/55">
                              {answer.selected_share_fields
                                .map((field) => t(`shareDialog.field.${field}` as LocaleKey, lang))
                                .join(" · ")}
                            </p>
                          )}
                        </div>
                        {answer.action_token && (
                          <div className="mt-3 flex items-center gap-2">
                            <Button type="button" size="sm" className="flex-1 rounded-2xl sm:flex-none" loading={busy} onClick={() => void applyAction(turn.id, answer)}>
                              {t("reai.shareCreateConfirm", lang)}
                            </Button>
                            <Button type="button" variant="ghost" size="sm" className="rounded-2xl" disabled={busy} onClick={() => dismissAction(turn.id)}>
                              {t("reai.dismissProposal", lang)}
                            </Button>
                          </div>
                        )}
                        {!answer.action_token && turn.actionStatus === "dismissed" && (
                          <div className="mt-3 border-t border-border/40 pt-3">
                            <AgentStatusBadge tone="neutral">{t("reai.proposalDismissed", lang)}</AgentStatusBadge>
                          </div>
                        )}
                        {shareUrl && (
                          <div className="mt-2 flex min-w-0 items-center gap-1.5 border-t border-border/40 pt-2">
                            <span className="min-w-0 flex-1 truncate text-[11px] text-foreground/65">{shareUrl}</span>
                            <Button type="button" variant="outline" size="xs" className="shrink-0 rounded-2xl" onClick={() => void copyShareUrl(shareUrl)}>
                              {t(copiedShareUrl === shareUrl ? "reai.shareCopied" : "reai.shareCopy", lang)}
                            </Button>
                            <a
                              href={shareUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="floating-control inline-flex min-w-11 shrink-0 items-center justify-center px-2 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                            >
                              {t("reai.shareOpen", lang)}
                            </a>
                          </div>
                        )}
                      </div>
                    )}
                    {answer && improvementConsent?.consented && answer.improvement_conversation_id && (
                      <div className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground">
                        <span className="mr-1">{t("reai.feedbackPrompt", lang)}</span>
                        <button
                          type="button"
                          aria-label={t("reai.feedbackGood", lang)}
                          disabled={busy || turn.feedback !== undefined}
                          onClick={() => void sendFeedback(turn.id, true, answer.improvement_conversation_id)}
                          className={cn(
                            "flex h-7 w-7 items-center justify-center rounded-2xl transition-colors hover:bg-foreground/[0.04] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none",
                            turn.feedback === true ? "text-foreground" : "disabled:opacity-40",
                          )}
                        >
                          <CheckIcon size={12} />
                        </button>
                        <button
                          type="button"
                          aria-label={t("reai.feedbackBad", lang)}
                          disabled={busy || turn.feedback !== undefined}
                          onClick={() => void sendFeedback(turn.id, false, answer.improvement_conversation_id)}
                          className={cn(
                            "flex h-7 w-7 items-center justify-center rounded-2xl transition-colors hover:bg-foreground/[0.04] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none",
                            turn.feedback === false ? "text-foreground" : "disabled:opacity-40",
                          )}
                        >
                          <CloseIcon size={12} />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
              {busy && <div className="border-l border-foreground/15 py-1 pl-3 text-[12px] text-muted-foreground">{t("reai.working", lang)}</div>}
            </div>
          )}
          {!showHistory && !showMediaHistory && turns.length === 0 && (
            <div className={cn("flex flex-col", panel ? "min-h-0 flex-1" : "py-2", panel && !compactPanel && "items-center justify-start px-5 pt-12 text-center")}>
              <p className={cn("text-[14px] leading-relaxed text-foreground/70", panel && "max-w-[280px] text-[13px]", compactPanel && "hidden")}>
                {t(workspaceContext === "settings" ? "reai.startSettingsConversation" : (draftId ? "reai.startDraftConversation" : "reai.startConversation"), lang)}
              </p>
            </div>
          )}
          {error && <p role="alert" className="rounded-2xl border border-destructive/20 bg-destructive/[0.045] px-3 py-2.5 text-[12px] text-destructive">{error}</p>}
          {!showHistory && !showMediaHistory && turns.length === 0 && (!panel || (!composerFocused && !message.trim())) && (
            <div className={cn("flex gap-2", compactPanel ? "overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" : "flex-wrap")}>
              {quickActions.map((key, index) => {
                const Icon = ACTION_ICON[key] ?? SparklesIcon;
                return (
                  <button
                    key={key}
                    type="button"
                    disabled={busy}
                    onClick={() => void ask(t(key, lang))}
                    className={cn(
                      "group inline-flex shrink-0 items-center gap-1.5 rounded-2xl border border-transparent bg-foreground/[0.045] px-3 text-[12px] font-medium text-foreground/75 transition-colors hover:bg-foreground/[0.075] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
                      compactPanel ? "h-10" : "h-8",
                      compactPanel && index > 1 && "hidden",
                      compactPanel && index > 0 && "max-[359px]:hidden",
                    )}
                  >
                    <Icon size={14} className="text-foreground/45 transition-colors group-hover:text-foreground/70" />
                    {t(key, lang)}
                  </button>
                );
              })}
            </div>
          )}
          {!showHistory && !showMediaHistory && <div className={cn(
            "floating-panel-shape flex items-end gap-1.5 border border-border bg-white transition-colors focus-within:border-foreground/25",
            compactPanel ? "p-1.5" : "p-2",
          )}>
            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              onFocus={() => setComposerFocused(true)}
              onBlur={() => setComposerFocused(false)}
              maxLength={2000}
              rows={1}
              placeholder={t(workspaceContext === "settings" ? "reai.settingsPlaceholder" : (draftId ? "reai.draftPlaceholder" : "reai.placeholder"), lang)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void ask();
                }
              }}
              className={cn(
                "min-w-0 flex-1 resize-none overflow-y-auto bg-transparent px-2.5 py-2.5 text-[14px] leading-5 outline-none [field-sizing:content] placeholder:text-foreground/40",
                compactPanel ? "min-h-11" : "min-h-12",
              )}
            />
            <button
              type="button"
              disabled={!message.trim() || busy}
              onClick={() => void ask()}
              aria-label={t("reai.ask", lang)}
              className={cn(
                "bg-creative text-creative-foreground hover:bg-creative/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-creative focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-25",
                compactPanel ? "floating-icon-button px-0" : "floating-control w-auto gap-1.5 px-3.5",
              )}
            >
              <SparklesIcon size={15} />
              <span className={compactPanel ? "sr-only" : undefined}>{t("reai.ask", lang)}</span>
            </button>
          </div>}
        </div>
      )}
    </section>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import {
  ApiError,
  applyReaiMediaAction,
  applyReaiWorkspaceAction,
  applyReaiWorkspaceProposal,
  askReaiWorkspace,
  getAgentCreationHistory,
  getAgentMediaVersions,
  getReaiAgentConsent,
  getReaiImprovementConsent,
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
import { t } from "../lib/i18n";
import type { LocaleKey } from "../lib/locales";
import type { DraftDetailItem } from "../lib/tour-types";
import { Button } from "../lib/ui/button";
import { cn } from "../lib/utils";

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

function proposalValue(field: string, value: unknown, answer: ReaiAgentResponse, lang: string): string {
  const number = typeof value === "number" ? value : (
    typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value)) ? Number(value) : null
  );
  const formatted = number === null
    ? null
    : new Intl.NumberFormat(lang || "en", { maximumFractionDigits: 2 }).format(number);
  const firstCreation = answer.draft_results?.[0]?.creation_data;
  if (field === "area" && formatted) {
    const measurements = firstCreation?.floorplan_measurements as { total_floor_area_m2?: number } | undefined;
    const unit = measurements?.total_floor_area_m2 ? "m²" : String(firstCreation?.area_unit || "m²");
    return `${formatted} ${unit}`;
  }
  if (field === "lot_size" && formatted) return `${formatted} ${String(firstCreation?.area_unit || "m²")}`;
  if (field === "price" && formatted) return `${formatted} ${String(firstCreation?.currency || "")}`.trim();
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

const specLabelKeys: Record<string, LocaleKey> = {
  property_type: "reai.attribute.propertyType",
  property_subtype: "reai.attribute.propertySubtype",
  rooms: "reai.attribute.rooms",
  bedrooms: "reai.attribute.bedrooms",
  bathrooms: "reai.attribute.bathrooms",
  toilets: "reai.attribute.toilets",
  cooling_types: "reai.attribute.coolingTypes",
};

const specValueKeys: Record<string, LocaleKey> = {
  commercial: "reai.value.commercial",
  office: "reai.value.office",
  air_conditioning: "reai.value.airConditioning",
};

function localizedSpecValue(value: unknown, lang: string): string {
  if (Array.isArray(value)) return value.map((item) => localizedSpecValue(item, lang)).join(", ");
  if (typeof value === "boolean") return value ? t("common.yes", lang) : t("common.no", lang);
  const raw = String(value ?? "");
  return specValueKeys[raw] ? t(specValueKeys[raw], lang) : raw.replaceAll("_", " ");
}

function proposalSpecEntries(value: unknown, lang: string): Array<{ key: string; label: string; value: string }> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const entries: Array<{ key: string; label: string; value: string }> = [];
  Object.entries(value as Record<string, unknown>).forEach(([section, sectionValue]) => {
    if (!sectionValue || typeof sectionValue !== "object" || Array.isArray(sectionValue)) return;
    Object.entries(sectionValue as Record<string, unknown>).forEach(([key, item]) => {
      entries.push({
        key: `${section}.${key}`,
        label: specLabelKeys[key] ? t(specLabelKeys[key], lang) : key.replaceAll("_", " "),
        value: localizedSpecValue(item, lang),
      });
    });
  });
  return entries;
}

function historyValue(
  field: string,
  value: unknown,
  revision: AgentCreationRevision,
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
    if (field === "area" || field === "lot_size") return `${formatted} m²`;
    if (field === "price") return `${formatted} ${String(revision.snapshot.currency || "")}`.trim();
    return formatted;
  }
  return String(value);
}

function errorText(error: unknown, lang: string): string {
  if (error instanceof ApiError) {
    try {
      const parsed = JSON.parse(error.body) as { detail?: string };
      // Provider and validation internals are intentionally not rendered as
      // raw English strings in a localized creator workspace.
      if (parsed.detail && error.status < 500) return parsed.detail;
    } catch { /* use localized fallback */ }
  }
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
}: {
  draftId?: number;
  currentUploadId?: number;
  workspaceContext?: "creator" | "draft" | "settings";
  lang: string;
  onDraftUpdated?: (draft: DraftDetailItem) => void;
  panel?: boolean;
}) {
  const [consent, setConsent] = useState<ReaiAgentConsent | null>(null);
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
  const [mediaBusy, setMediaBusy] = useState(false);
  const [mediaCandidate, setMediaCandidate] = useState<{ id: number; action: "promote" | "hide" | "restore" } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedShareUrl, setCopiedShareUrl] = useState<string | null>(null);
  const quickActions = workspaceContext === "settings"
    ? (["reai.quickSettingsAgent", "reai.quickSettingsLanguage", "reai.quickSettingsSecurity"] as const)
    : draftId
    ? (["reai.quickImproveDescription", "reai.quickCheckFields", "reai.quickEditCurrent"] as const)
    : (["reai.quickFind", "reai.quickCompare", "reai.quickBulk"] as const);

  useEffect(() => {
    getReaiAgentConsent().then(setConsent).catch((err) => setError(errorText(err, lang)));
    getReaiImprovementConsent().then(setImprovementConsent).catch(() => undefined);
  }, [lang]);

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
      await manageAgentMediaVersion(draftId, mediaCandidate.id, mediaCandidate.action);
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
    setImprovementConversationId(null);
    setShowHistory(false);
    setShowMediaHistory(false);
    setHistory([]);
    setMediaGroups([]);
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
        lang,
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

  if (!consent) return null;

  return (
    <section className={cn(
      "rounded-2xl bg-foreground/[0.025] p-4",
      panel ? "flex h-full min-h-0 flex-col rounded-none border-0 bg-transparent" : "mt-5 border border-border/40",
    )} aria-labelledby="reai-title">
      <div className={cn("items-start justify-between gap-3", panel ? "hidden" : "flex")}>
        <div>
          <h2 id="reai-title" className="text-[14px] font-semibold">{t("reai.title", lang)}</h2>
          <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{t("reai.subtitle", lang)}</p>
        </div>
        <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-[10px] font-medium text-emerald-700">
          {t("reai.private", lang)}
        </span>
      </div>

      {!consent.consented ? (
        <div className="mt-4 flex flex-col gap-3 rounded-xl bg-background/70 p-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[12px] leading-relaxed text-foreground/65">{t("reai.enableInSettings", lang)}</p>
          <Button asChild size="sm" variant="outline">
            <Link href="/settings#reai">{t("reai.openSettings", lang)}</Link>
          </Button>
        </div>
      ) : (
        <div className={cn("mt-4", panel ? "flex min-h-0 flex-1 flex-col gap-3" : "space-y-3")}>
          {draftId && (
            <div className="flex items-center justify-end gap-4 border-b border-border/35 pb-2">
              <button
                type="button"
                className={cn("text-[11px] font-medium transition hover:text-foreground", showMediaHistory ? "text-foreground" : "text-muted-foreground")}
                onClick={() => {
                  const next = !showMediaHistory;
                  setShowMediaHistory(next);
                  setShowHistory(false);
                  if (next) void loadMediaHistory();
                }}
              >
                {showMediaHistory ? t("reai.backToChat", lang) : t("reai.mediaVersions", lang)}
              </button>
              <button
                type="button"
                className={cn("text-[11px] font-medium transition hover:text-foreground", showHistory ? "text-foreground" : "text-muted-foreground")}
                onClick={() => {
                  const next = !showHistory;
                  setShowHistory(next);
                  setShowMediaHistory(false);
                  if (next) void loadHistory();
                }}
              >
                {showHistory ? t("reai.backToChat", lang) : t("reai.editHistory", lang)}
              </button>
            </div>
          )}
          {showHistory && draftId && (
            <div className={cn("min-h-0 space-y-2 overflow-y-auto pr-1", panel && "flex-1")} aria-live="polite">
              <div className="pb-1">
                <h3 className="text-[13px] font-semibold">{t("reai.editHistory", lang)}</h3>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{t("reai.historySafety", lang)}</p>
              </div>
              {historyNotice && (
                <div className="rounded-lg border border-border/50 bg-foreground/[0.035] px-3 py-2.5 text-[11px] leading-relaxed text-foreground/75">
                  {historyNotice}
                </div>
              )}
              {historyBusy && <p className="py-3 text-[11px] text-muted-foreground">{t("reai.working", lang)}</p>}
              {!historyBusy && history.length === 0 && (
                <p className="rounded-xl border border-border/40 p-3 text-[11px] leading-relaxed text-muted-foreground">{t("reai.historyEmpty", lang)}</p>
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
                        "rounded-xl px-3.5 py-3",
                        index === 0 ? "bg-foreground/[0.045]" : "border border-border/45 bg-background",
                      )}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <h4 className="text-[13px] font-semibold leading-5">
                                {t(`reai.history.${revision.source}`, lang)}
                              </h4>
                              {index === 0 && (
                                <span className="rounded-full bg-foreground px-2 py-0.5 text-[9px] font-medium text-background">
                                  {t("reai.currentVersion", lang)}
                                </span>
                              )}
                            </div>
                            <time className="mt-0.5 block text-[10px] text-muted-foreground">
                              {new Intl.DateTimeFormat(lang || "en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(revision.created_at))}
                            </time>
                          </div>
                          {index > 0 && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => {
                                setHistoryNotice(null);
                                setRestoreCandidateId(revision.id);
                              }}
                              className="shrink-0 text-[10px] font-semibold text-muted-foreground underline-offset-4 transition hover:text-foreground hover:underline disabled:opacity-40"
                            >
                              {t("reai.restore", lang)}
                            </button>
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
                                  <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                    {agentFieldLabel(field, lang)}
                                  </p>
                                  <p className="mt-1 break-words text-[12px] leading-5 text-foreground/85">
                                    {historyValue(field, revision.snapshot[field], revision, lang)}
                                  </p>
                                </div>
                              );
                            }
                            return (
                              <div key={field}>
                                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                  {agentFieldLabel(field, lang)}
                                </p>
                                <div className={cn("mt-1.5 gap-2", longForm ? "space-y-2" : "grid grid-cols-2")}>
                                  <div className="min-w-0 rounded-lg bg-background/70 px-2.5 py-2">
                                    <p className="text-[9px] font-medium uppercase tracking-wide text-muted-foreground/80">
                                      {t("reai.historyBefore", lang)}
                                    </p>
                                    <p className="mt-1 break-words text-[11px] leading-[1.55] text-muted-foreground">
                                      {historyValue(field, revision.before_values[field], revision, lang)}
                                    </p>
                                  </div>
                                  <div className="min-w-0 rounded-lg border-l-2 border-foreground/60 bg-background px-2.5 py-2">
                                    <p className="text-[9px] font-medium uppercase tracking-wide text-muted-foreground/80">
                                      {t("reai.historyAfter", lang)}
                                    </p>
                                    <p className="mt-1 break-words text-[11px] font-medium leading-[1.55] text-foreground/90">
                                      {historyValue(field, revision.after_values[field], revision, lang)}
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
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void restoreRevision(revision)}
                                className="rounded-lg bg-foreground px-3 py-1.5 text-[11px] font-semibold text-background transition hover:bg-foreground/85 disabled:opacity-40"
                              >
                                {t("reai.restore", lang)}
                              </button>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => setRestoreCandidateId(null)}
                                className="rounded-lg px-3 py-1.5 text-[11px] font-medium text-muted-foreground transition hover:text-foreground disabled:opacity-40"
                              >
                                {t("reai.restoreCancel", lang)}
                              </button>
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
              <div>
                <h3 className="text-[13px] font-semibold">{t("reai.mediaVersions", lang)}</h3>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{t("reai.mediaVersionsSafety", lang)}</p>
              </div>
              {mediaBusy && mediaGroups.length === 0 && <p className="py-3 text-[11px] text-muted-foreground">{t("reai.working", lang)}</p>}
              {!mediaBusy && mediaGroups.length === 0 && (
                <p className="rounded-xl border border-border/45 p-3 text-[11px] text-muted-foreground">{t("reai.mediaVersionsEmpty", lang)}</p>
              )}
              {mediaGroups.map((group, groupIndex) => (
                <section key={group.logical_asset_id} className="overflow-hidden rounded-xl border border-border/55 bg-background">
                  <div className="border-b border-border/40 px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {t("reai.mediaAsset", lang).replace("{number}", String(groupIndex + 1))}
                  </div>
                  <div className="divide-y divide-border/40">
                    {group.versions.map((version) => (
                      <article key={version.id} className={cn("p-3", version.is_deleted && "bg-foreground/[0.025] opacity-70")}>
                        <div className="flex gap-3">
                          <div className="h-16 w-20 shrink-0 overflow-hidden rounded-lg bg-foreground/[0.05]">
                            {version.file_url && (
                              // Version URLs are short-lived, backend-signed media previews.
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={version.file_url} alt="" className="h-full w-full object-cover" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="text-[12px] font-semibold">v{version.version}</span>
                              {version.is_master && <span className="rounded-full bg-foreground px-1.5 py-0.5 text-[8px] font-medium text-background">{t("reai.mediaCurrent", lang)}</span>}
                              {version.is_deleted && <span className="rounded-full bg-foreground/[0.08] px-1.5 py-0.5 text-[8px] font-medium">{t("reai.mediaHidden", lang)}</span>}
                            </div>
                            <p className="mt-1 truncate text-[10px] text-muted-foreground">{version.processor === "original" ? t("reai.mediaOriginal", lang) : version.processor}</p>
                            <time className="mt-0.5 block text-[9px] text-muted-foreground/80">
                              {new Intl.DateTimeFormat(lang || "en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(version.uploaded_at))}
                            </time>
                          </div>
                        </div>
                        <div className="mt-2.5 flex flex-wrap items-center gap-3">
                          {!version.is_deleted && !version.is_master && (
                            <button type="button" disabled={mediaBusy} onClick={() => setMediaCandidate({ id: version.id, action: "promote" })} className="text-[10px] font-semibold hover:underline disabled:opacity-40">
                              {t("reai.mediaUseVersion", lang)}
                            </button>
                          )}
                          {!version.is_deleted && (
                            <button type="button" disabled={mediaBusy} onClick={() => setMediaCandidate({ id: version.id, action: "hide" })} className="text-[10px] font-medium text-muted-foreground hover:text-foreground disabled:opacity-40">
                              {t("reai.mediaHide", lang)}
                            </button>
                          )}
                          {version.is_deleted && (
                            <button type="button" disabled={mediaBusy} onClick={() => setMediaCandidate({ id: version.id, action: "restore" })} className="text-[10px] font-semibold hover:underline disabled:opacity-40">
                              {t("reai.mediaRestore", lang)}
                            </button>
                          )}
                        </div>
                        {mediaCandidate?.id === version.id && (
                          <div className="mt-3 rounded-lg bg-foreground/[0.04] p-2.5">
                            <p className="text-[10px] leading-relaxed text-foreground/70">
                              {t(mediaCandidate.action === "hide" ? "reai.mediaHideConfirm" : "reai.mediaActionConfirm", lang)}
                            </p>
                            <div className="mt-2 flex gap-2">
                              <button type="button" disabled={mediaBusy} onClick={() => void manageMediaVersion()} className="rounded-md bg-foreground px-2.5 py-1.5 text-[10px] font-semibold text-background disabled:opacity-40">{t("reai.confirm", lang)}</button>
                              <button type="button" disabled={mediaBusy} onClick={() => setMediaCandidate(null)} className="px-2 py-1.5 text-[10px] text-muted-foreground">{t("reai.restoreCancel", lang)}</button>
                            </div>
                          </div>
                        )}
                      </article>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
          {!showHistory && !showMediaHistory && turns.length > 0 && (
            <div className={cn("space-y-2 overflow-y-auto pr-1", panel ? "min-h-0 flex-1" : "max-h-[420px]")} aria-live="polite">
              {turns.map((turn) => {
                const answer = turn.response;
                const shareUrl = answer ? contextualShareUrl(answer) : null;
                const visibleDraftResults = answer?.draft_results?.filter((draft) => !draftId || draft.id !== draftId) ?? [];
                const targetTitle = answer?.draft_results?.find((draft) => answer.selected_creation_ids?.includes(draft.id))?.creation_data.title;
                return (
                  <div
                    key={turn.id}
                    className={turn.role === "user"
                      ? "ml-10 rounded-2xl rounded-br-md bg-foreground/[0.06] px-3.5 py-2.5 text-sm leading-relaxed text-foreground"
                      : "py-1"}
                  >
                    <p className="whitespace-pre-line text-sm leading-6 text-foreground/85">{turn.content}</p>
                    {answer && visibleDraftResults.length > 0 && (
                      <div className="mt-3 space-y-1.5">
                        {visibleDraftResults.map((draft) => (
                          <Link
                            key={draft.id}
                            href={`/draft/${draft.id}`}
                            className="block rounded-xl border border-border/50 px-3 py-2.5 transition hover:border-foreground/20 hover:bg-foreground/[0.025]"
                          >
                            <span className="block truncate text-sm font-medium">{draft.creation_data.title || `#${draft.id}`}</span>
                            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                              {[
                                localizedMetric(draft.creation_data.area, lang) && `${localizedMetric(draft.creation_data.area, lang)} ${draft.creation_data.area_unit || "m²"}`,
                                localizedMetric(draft.creation_data.price, lang) && `${localizedMetric(draft.creation_data.price, lang)} ${draft.creation_data.currency || ""}`,
                              ].filter(Boolean).join(" · ") || t("nav.creation", lang)}
                            </span>
                            {(draft.semantic_summary || draft.creation_data.description) && (
                              <span className="mt-1.5 line-clamp-2 block text-xs leading-relaxed text-muted-foreground">
                                {draft.semantic_summary || draft.creation_data.description}
                              </span>
                            )}
                          </Link>
                        ))}
                      </div>
                    )}
                    {answer && !!answer.knowledge_sources?.length && (
                      <div className="mt-3 border-t border-border/30 pt-2">
                        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{t("reai.sources", lang)}</p>
                        <ul className="mt-1 space-y-0.5 text-[11px] text-muted-foreground">
                          {answer.knowledge_sources.map((source) => (
                            <li key={`${source.sha256}-${source.version}`}>{source.title} · {source.source} · v{source.version}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {answer && Object.keys(answer.proposed_changes).length > 0 && (
                      <div className="mt-4 overflow-hidden rounded-xl border border-border/60 bg-foreground/[0.018]">
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
                                  <dl className="mt-2 divide-y divide-border/35 rounded-lg bg-background/70 px-3">
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
                                    {proposalValue(key, value, answer, lang)}
                                  </span>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                        {answer.proposal_token && (
                          <div className="flex items-center gap-2 border-t border-border/45 px-3.5 py-3">
                            <button
                              type="button"
                              className="rounded-lg bg-foreground px-3 py-2 text-xs font-medium text-background transition hover:bg-foreground/85 disabled:opacity-40"
                              disabled={busy}
                              onClick={() => apply(turn.id, answer)}
                            >
                              {t("reai.apply", lang)}
                            </button>
                            <button
                              type="button"
                              className="px-2 py-2 text-xs font-medium text-muted-foreground transition hover:text-foreground disabled:opacity-40"
                              disabled={busy}
                              onClick={() => dismissProposal(turn.id)}
                            >
                              {t("reai.dismissProposal", lang)}
                            </button>
                          </div>
                        )}
                        {!answer.proposal_token && turn.proposalStatus && (
                          <div className="border-t border-border/45 px-3.5 py-3">
                            <span className={cn(
                              "inline-flex rounded-md px-2 py-1 text-xs font-medium",
                              turn.proposalStatus === "applied"
                                ? "bg-foreground text-background"
                                : "bg-foreground/[0.06] text-muted-foreground",
                            )}>
                              {t(turn.proposalStatus === "applied" ? "reai.proposalApplied" : "reai.proposalDismissed", lang)}
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                    {answer && (["grade_draft_images", "retouch_draft_image", "cleanplate_draft_images", "generative_hdr_draft_image", "organize_draft_images", "generate_draft_video"].includes(answer.action_code || "")) && (answer.action_token || turn.actionStatus) && (
                      <div className="mt-4 overflow-hidden rounded-xl border border-border/60 bg-foreground/[0.018]">
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
                            <span className="rounded-full bg-foreground/[0.06] px-2 py-1 text-[10px] font-medium text-foreground/65">
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
                            <p className="mt-2 rounded-lg bg-amber-500/10 px-2.5 py-2 text-[10px] leading-relaxed text-amber-900 dark:text-amber-100">
                              {t("reai.mediaHdrBoundary", lang)}
                            </p>
                          )}
                          {!!answer.media_action?.operations && Object.keys(answer.media_action.operations).length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {Object.entries(answer.media_action.operations).map(([key, value]) => (
                                <span key={key} className="rounded-md border border-border/50 bg-background px-2 py-1 text-[10px] text-foreground/70">
                                  {t(`reai.mediaOperation.${key}` as LocaleKey, lang)}{typeof value === "number" ? ` · ${value}` : ""}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                        {answer.action_token && (
                          <div className="flex items-center gap-2 border-t border-border/45 px-3.5 py-3">
                            <button
                              type="button"
                              className="rounded-lg bg-foreground px-3 py-2 text-xs font-medium text-background transition hover:bg-foreground/85 disabled:opacity-40"
                              disabled={busy}
                              onClick={() => void applyAction(turn.id, answer)}
                            >
                              {t("reai.mediaConfirm", lang)}
                            </button>
                            <button
                              type="button"
                              className="px-2 py-2 text-xs font-medium text-muted-foreground transition hover:text-foreground disabled:opacity-40"
                              disabled={busy}
                              onClick={() => dismissAction(turn.id)}
                            >
                              {t("reai.dismissProposal", lang)}
                            </button>
                          </div>
                        )}
                        {!answer.action_token && turn.actionStatus && (
                          <div className="border-t border-border/45 px-3.5 py-3 text-xs font-medium text-foreground/75">
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
                          </div>
                        )}
                      </div>
                    )}
                    {(answer?.action_code === "revoke_all_shares" || answer?.action_code === "manage_shares") && (answer.action_token || turn.actionStatus) && (
                      <div className="mt-4 overflow-hidden rounded-xl border border-border/60 bg-foreground/[0.018]">
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
                            <button
                              type="button"
                              className="rounded-lg bg-foreground px-3 py-2 text-xs font-medium text-background transition hover:bg-foreground/85 disabled:opacity-40"
                              disabled={busy}
                              onClick={() => void applyAction(turn.id, answer)}
                            >
                              {t(`reai.shareManagerConfirm.${answer.share_action || "revoke"}` as LocaleKey, lang)}
                            </button>
                            <button
                              type="button"
                              className="px-2 py-2 text-xs font-medium text-muted-foreground transition hover:text-foreground disabled:opacity-40"
                              disabled={busy}
                              onClick={() => dismissAction(turn.id)}
                            >
                              {t("reai.dismissProposal", lang)}
                            </button>
                          </div>
                        )}
                        {!answer.action_token && turn.actionStatus && (
                          <div className="border-t border-border/45 px-3.5 py-3 text-xs font-medium text-foreground/75">
                            {t(turn.actionStatus === "applied" ? "reai.shareManagerApplied" : "reai.proposalDismissed", lang)}
                          </div>
                        )}
                      </div>
                    )}
                    {answer?.action_code === "share_inventory" && !!answer.share_results?.length && (
                      <div className="mt-3 divide-y divide-border/40 overflow-hidden rounded-lg border border-border/55">
                        {answer.share_results.map((share) => (
                          <div key={share.id} className="flex items-center gap-2 px-3 py-2">
                            <span className="min-w-0 flex-1 truncate text-[11px] font-medium">{share.title}</span>
                            <span className="text-[10px] text-muted-foreground">
                              {t("reai.shareManagerViews", lang).replace("{count}", String(share.access_count))}
                            </span>
                            <span className="rounded-full bg-foreground/[0.06] px-1.5 py-0.5 text-[9px] text-foreground/65">
                              {t(`reai.shareStatus.${share.status}` as LocaleKey, lang)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                    {answer?.action_code === "share_status" && answer.share_status && (
                      <div className="mt-3 rounded-lg border border-border/55 bg-foreground/[0.018] px-3 py-2.5">
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
                              <button
                                type="button"
                                className="rounded-md border border-border/60 px-2 py-1 text-[10px] font-medium"
                                onClick={() => void copyShareUrl(shareUrl)}
                              >
                                {t(copiedShareUrl === shareUrl ? "reai.shareCopied" : "reai.shareCopy", lang)}
                              </button>
                              <a
                                href={shareUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="px-1 py-1 text-[10px] font-medium text-muted-foreground hover:text-foreground"
                              >
                                {t("reai.shareOpen", lang)}
                              </a>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                    {answer?.action_code === "create_draft_share" && (answer.action_token || shareUrl || turn.actionStatus) && (
                      <div className="mt-3 rounded-lg border border-border/55 bg-foreground/[0.018] px-3 py-2.5">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-foreground">{t("reai.shareCreateTitle", lang)}</p>
                            <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
                              {shareUrl ? t("reai.shareCreateReady", lang) : t("reai.shareCreateBody", lang)}
                            </p>
                            {!!answer.selected_share_fields?.length && (
                              <p className="mt-1 truncate text-[10px] text-foreground/55">
                                {answer.selected_share_fields
                                  .map((field) => t(`shareDialog.field.${field}` as LocaleKey, lang))
                                  .join(" · ")}
                              </p>
                            )}
                          </div>
                          {answer.action_token && (
                            <div className="flex shrink-0 items-center gap-1.5">
                              <button
                                type="button"
                                className="rounded-md bg-foreground px-2.5 py-1.5 text-[11px] font-medium text-background disabled:opacity-40"
                                disabled={busy}
                                onClick={() => void applyAction(turn.id, answer)}
                              >
                                {t("reai.shareCreateConfirm", lang)}
                              </button>
                              <button
                                type="button"
                                className="px-1.5 py-1.5 text-[11px] text-muted-foreground hover:text-foreground"
                                disabled={busy}
                                onClick={() => dismissAction(turn.id)}
                              >
                                {t("reai.dismissProposal", lang)}
                              </button>
                            </div>
                          )}
                        </div>
                        {shareUrl && (
                          <div className="mt-2 flex min-w-0 items-center gap-1.5 border-t border-border/40 pt-2">
                            <span className="min-w-0 flex-1 truncate text-[11px] text-foreground/65">{shareUrl}</span>
                            <button
                              type="button"
                              className="shrink-0 rounded-md border border-border/60 px-2 py-1 text-[10px] font-medium"
                              onClick={() => void copyShareUrl(shareUrl)}
                            >
                              {t(copiedShareUrl === shareUrl ? "reai.shareCopied" : "reai.shareCopy", lang)}
                            </button>
                            <a
                              href={shareUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="shrink-0 px-1 py-1 text-[10px] font-medium text-muted-foreground hover:text-foreground"
                            >
                              {t("reai.shareOpen", lang)}
                            </a>
                          </div>
                        )}
                      </div>
                    )}
                    {answer && improvementConsent?.consented && answer.improvement_conversation_id && (
                      <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
                        <span>{t("reai.feedbackPrompt", lang)}</span>
                        <button disabled={busy || turn.feedback !== undefined} onClick={() => void sendFeedback(turn.id, true, answer.improvement_conversation_id)}>✓</button>
                        <button disabled={busy || turn.feedback !== undefined} onClick={() => void sendFeedback(turn.id, false, answer.improvement_conversation_id)}>✕</button>
                      </div>
                    )}
                  </div>
                );
              })}
              {busy && <div className="border-l border-foreground/15 py-1 pl-3 text-[12px] text-muted-foreground">{t("reai.working", lang)}</div>}
            </div>
          )}
          {!showHistory && !showMediaHistory && panel && turns.length === 0 && (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-4 text-center">
              <p className="max-w-xs text-[13px] leading-relaxed text-muted-foreground">
                {t(workspaceContext === "settings" ? "reai.startSettingsConversation" : (draftId ? "reai.startDraftConversation" : "reai.startConversation"), lang)}
              </p>
              <div className="mt-5 flex max-w-xs flex-wrap justify-center gap-2">
                {quickActions.map((key) => (
                  <button
                    key={key}
                    type="button"
                    disabled={busy}
                    onClick={() => void ask(t(key, lang))}
                    className="rounded-full border border-border/60 px-3 py-1.5 text-[11px] text-foreground/65 transition hover:border-foreground/25 hover:text-foreground"
                  >
                    {t(key, lang)}
                  </button>
                ))}
              </div>
            </div>
          )}
          {!showHistory && !showMediaHistory && <div className="flex items-end gap-2 rounded-2xl border border-border/60 bg-background p-2 transition focus-within:border-foreground/30">
            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              maxLength={2000}
              rows={2}
              placeholder={t(workspaceContext === "settings" ? "reai.settingsPlaceholder" : (draftId ? "reai.draftPlaceholder" : "reai.placeholder"), lang)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void ask();
                }
              }}
              className="min-h-10 flex-1 resize-none bg-transparent px-2 py-1.5 text-[13px] leading-relaxed outline-none"
            />
            <button
              type="button"
              disabled={!message.trim() || busy}
              onClick={() => void ask()}
              aria-label={t("reai.ask", lang)}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-foreground text-background transition hover:bg-foreground/85 disabled:cursor-not-allowed disabled:opacity-25"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 14-7-4.5 14-2.5-6.5L5 12Z" /></svg>
            </button>
          </div>}
        </div>
      )}
      {error && <p className="mt-3 text-[12px] text-red-600" role="alert">{error}</p>}
    </section>
  );
}

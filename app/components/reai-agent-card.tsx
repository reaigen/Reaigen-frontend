"use client";

import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import {
  advanceReaiAgentPlan,
  applyReaiTourCoverAction,
  applyReaiWorkspaceProposal,
  askReaiWorkspace,
  getAgentCreationHistory,
  getAgentMediaVersions,
  getDraft,
  getDraftService,
  refreshDraft,
  getReaiAgentConsent,
  getReaiSourceImportProgress,
  getReaiImprovementConsent,
  intakeReaiAttachment,
  intakeSavedReaiEvidence,
  importReaiSources,
  listDraftUploads,
  listUnits,
  restoreAgentCreationRevision,
  manageAgentMediaVersion,
  saveReaiFeedback,
  REAI_FEEDBACK_REASONS,
  type ReaiFeedbackReason,
  updateLocalization,
  uploadDraftPhoto,
  uploadDraftAttachment,
  type AgentCreationRevision,
  type AgentMediaVersionGroup,
  type ReaiAgentConsent,
  type ReaiAgentResponse,
  type ReaiAgentSourceImageCandidate,
  type ReaiAgentIntakeResponse,
  type ReaiSourceImportProgress,
  type ReaiImprovementConsent,
} from "../lib/api/client";
import {
  addPoolItem,
  agentPoolKey,
  dragHasFiles,
  dragHasPoolItem,
  poolItemKey,
  poolItemsForRequest,
  readAgentPool,
  readDragItem,
  removePoolItem,
  writeAgentPool,
  type AgentPoolItem,
  type AgentPoolField,
} from "../lib/agent-pool";
import {
  agentTranscriptKey,
  readAgentTranscript,
  writeAgentTranscript,
} from "../lib/agent-session";
import {
  announceAgentActionResult,
  executeAgentAction,
  type AgentActionResult,
} from "../lib/agent-actions";
import { isPlanConfirmation, isPlanStop, isProposalConfirmation } from "../lib/agent-plan-confirmation";
import { latestThreadToken, pendingAgentTurn, pendingCreationContextToken } from "../lib/agent-conversation";
import { canApplyDirectEdit, isCurrentEditContext, proposalUndo, type AgentEditContext, type AgentEditUndo } from "../lib/agent-direct-edit";
import { MAX_SOURCE_IMAGE_PREVIEWS, markSourceImportAttempt, monitorSourceImportProgress, reviewedSourceImageFile, reviewedSourceImport, sourceImageCandidates, unattemptedSourceImports } from "../lib/agent-document-import";
import { proposalFieldUnit } from "../lib/agent-proposal";
import { activeAgentSourceTokens, consumeAcceptedAgentSources, discardAgentSourceTokens, discardPoolSourceTokens, isAgentAttachmentResponse } from "../lib/agent-sources";
import { MAX_AGENT_ATTACHMENTS, describeAgentAttachment, documentIntakeBlock, documentReadState, pendingAttachmentDescriptors, pendingImageCount, remainingAgentAttachments, type AgentDocumentReadState } from "../lib/agent-attachments";
import {
  AgentPlanRunner,
  createPlanSnapshot,
  isLivePlanPhase,
  isTerminalPlanPhase,
  openPlanQuestions,
  planApprovalDigests,
  systemPlanClock,
  type AgentPlanSnapshot,
  type AgentPlanUploadResult,
} from "../lib/agent-plan-runner";
import { getApiErrorCode, getSafeApiErrorMessage } from "../lib/api/error-message";
import { agentJobFromAction, monitorAgentJob, type AgentJobState } from "../lib/agent-job-monitor";
import { formatDate, t } from "../lib/i18n";
import type { LocaleKey } from "../lib/locales";
import { PROPERTY_FIELD_SECTIONS, subtypeOptions, type PropertyFieldDefinition, type PropertyType } from "../lib/property-field-registry";
import type { DraftDetailItem, DraftUpload } from "../lib/tour-types";
import { copyToClipboard } from "../lib/share-ui";
import {
  REAI_VIEWER_ACTION_RESULT_EVENT,
  dispatchReaiViewerAction,
  readReaiViewerActionResult,
} from "../lib/reai-viewer-actions";
import { resolveUnit, unitLabel, type UnitLookup } from "../lib/unit-catalog";
import { Button } from "../lib/ui/button";
import { cn } from "../lib/utils";
import { randomUUID } from "../lib/uuid";
import { REAI_COMPOSE_EVENT, readReaiComposeDetail } from "../lib/reai-compose";
import { AgentMiniUi } from "./agent-mini-ui";
import { AgentComposer } from "./agent-composer";
import { AgentPlanCard } from "./agent-plan-card";
import { AgentTinyUi } from "./agent-tiny-ui";
import { MediaVersionCard, type MediaAction } from "./draft-version-manager";
import { useAuth } from "./hooks/use-auth";
import { StatusPill } from "./status-pill";
import { AgentIcon, SearchIcon, VersionsIcon, LayoutIcon, SparklesIcon, CheckIcon, CloseIcon, EditIcon, LockIcon, InfoIcon, DocumentIcon, ImageIcon, VideoIcon } from "./icons";

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

/**
 * The pending assistant turn.
 *
 * A turn is one JSON request — there is no token stream to render, so this
 * cannot show the answer arriving. What it can do is stop the panel looking
 * stopped: the previous version was a single line of static grey text above an
 * otherwise empty screen, so a reply that takes several seconds was
 * indistinguishable from a request that had failed silently.
 *
 * It occupies the shape the answer will take — same left rule, same rhythm of
 * lines — so the reply lands in place rather than appearing somewhere new, and
 * the widths taper the way a paragraph does. Deliberately three lines: enough
 * to read as prose, few enough not to promise a longer answer than usually
 * arrives.
 *
 * No invented progress steps. Naming stages the client cannot observe
 * ("reading images…", "checking the listing…") would be telling the user
 * something we do not know.
 */
function PendingAnswer({ lang }: { lang: string }) {
  return (
    <div className="border-l border-foreground/15 pl-3" role="status" aria-live="polite">
      <p className="flex items-center gap-2 py-1 text-[12px] text-muted-foreground">
        <svg className="h-3 w-3 shrink-0 animate-spin motion-reduce:animate-none" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        {t("reai.working", lang)}
      </p>
      <div aria-hidden="true" className="mt-2 space-y-2 pb-1">
        {["w-[92%]", "w-[78%]", "w-[54%]"].map((width) => (
          <div
            key={width}
            className={cn(
              "h-2.5 rounded-full bg-gradient-to-r from-foreground/[0.06] via-foreground/[0.13] to-foreground/[0.06]",
              "bg-[length:200%_100%] animate-shimmer motion-reduce:animate-none",
              width,
            )}
          />
        ))}
      </div>
    </div>
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

function AgentVersionStamp({ answer }: { answer: ReaiAgentResponse }) {
  const version = answer.agent_version;
  if (!version?.version) return null;
  const build = version.build_sha || "unknown";
  const shortBuild = build === "development" ? build : build.slice(0, 12);

  return (
    <details
      className="mt-1.5 w-fit text-[11px] text-muted-foreground"
      data-agent-version={version.version}
      data-agent-build={build}
    >
      <summary className="cursor-pointer select-none hover:text-foreground">
        ReaiAgent {version.version} · {shortBuild}
      </summary>
      <div className="mt-1 max-w-full space-y-0.5 border-l border-border/55 pl-2.5 leading-relaxed">
        <p className="break-all">Git <code>{build}</code></p>
        {version.prompt_version && <p className="break-all">Prompt <code>{version.prompt_version}</code></p>}
        <p>
          Schema <code>{version.response_schema_version || "untracked"}</code>
          {" · "}tools <code>{version.tool_policy_version || "untracked"}</code>
          {" · "}runtime <code>r{version.runtime_settings_revision}</code>
        </p>
      </div>
    </details>
  );
}

type ChatTurn = {
  id: number;
  role: "user" | "assistant";
  content: string;
  response?: ReaiAgentResponse;
  feedback?: boolean;
  /** Set while the reason picker is open for a thumbs-down on this turn. */
  feedbackReasonOpen?: boolean;
  proposalStatus?: "pending" | "applied" | "failed" | "undone" | "dismissed";
  directEdit?: boolean;
  undo?: AgentEditUndo;
  actionStatus?: "pending" | "applied" | "failed" | "dismissed";
  job?: AgentJobState;
  /** The action plan this turn is (the plan card) or belongs to (a step's confirm card). */
  planId?: string;
  /** Set on a step's own confirm card; its buttons go through the plan runner. */
  planStepId?: string;
  /** The plan card's live state, parked with the transcript so a reload can resume it. */
  planState?: AgentPlanSnapshot;
};

type AgentDocumentSource = File | { name: string; uploadId: number; draftId: number };
type SourceImageReview = { key: string; source: AgentDocumentSource; candidate: ReaiAgentSourceImageCandidate; selectedFile?: File; uploaded?: boolean; draftId?: number };
type SourceImportRetry = { options: Parameters<typeof importReaiSources>[0]; generation: number; userId?: number };

function withPlanSnapshot(turns: ChatTurn[], snapshot: AgentPlanSnapshot): ChatTurn[] {
  const ended = isTerminalPlanPhase(snapshot.phase);
  return turns.map((turn) => {
    if (turn.planId !== snapshot.planId) return turn;
    if (!turn.planStepId) return { ...turn, planState: snapshot };
    // A step card left open when its plan ended must not stay confirmable.
    if (ended && turn.response?.action_token && !turn.actionStatus) {
      return { ...turn, actionStatus: "dismissed", response: { ...turn.response, action_token: null } };
    }
    return turn;
  });
}

/** The confirm card after its action ran, identical for a tapped card and a plan step. */
function withAppliedAction(turn: ChatTurn, answer: ReaiAgentResponse, outcome: AgentActionResult): ChatTurn {
  const job = agentJobFromAction(outcome);
  const actionStatus = job?.status === "failed" ? "failed" : job && job.status !== "completed" ? "pending" : "applied";
  if (outcome.kind === "translate_description") {
    const result = outcome.result;
    return {
      ...turn,
      actionStatus,
      ...(job ? { job } : {}),
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
    };
  }
  if (outcome.kind === "workspace") {
    const result = outcome.result;
    return {
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
    };
  }
  return {
    ...turn,
    actionStatus,
    ...(job ? { job } : {}),
    response: { ...answer, action_token: null },
  };
}

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
  const definition = specFieldDefinitions.get(field.replace(/^specs\./, ""));
  if (definition) return t(definition.labelKey, lang);
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
  if (["currency", "area_unit", "lot_size_unit"].includes(field)) {
    const unit = resolveUnit(units, typeof value === "number" || typeof value === "string" ? value : null, field === "currency" ? "CURRENCY" : "AREA");
    return unitLabel(unit) || t("reai.emptyValue", lang);
  }
  if ((field === "area" || field === "lot_size" || field === "price") && formatted) {
    const unit = proposalFieldUnit(field, answer.proposed_changes, firstCreation, units);
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

function errorText(error: unknown, lang: string): string {
  // Safe 4xx details explain an actionable permission/context problem. Server
  // failures and technical internals remain behind the localized fallback.
  return getSafeApiErrorMessage(error, lang, "reai.error");
}

// Warning codes the import reports, as sentences; an unknown code is not shown raw.
const IMPORT_WARNING_KEYS: Record<string, Parameters<typeof t>[0]> = {
  mapping_unavailable: "reai.import.warning.mappingUnavailable",
  conflicting_source_values: "reai.import.warning.conflictingValues",
};

function safeAgentNavigationPath(answer: ReaiAgentResponse): string | null {
  const path = answer.navigation_path;
  if (!path || !path.startsWith("/") || path.startsWith("//")) return null;
  if (answer.action_code === "open_creation" && /^\/draft\/[1-9]\d*\/?$/.test(path)) return path;
  if (answer.action_code === "create_creation" && path === "/create") return path;
  if (answer.action_code === "open_tour" && /^\/create\/tour\/[1-9]\d*\/?$/.test(path)) return path;
  // A plan opens the listing it just created before it adds photos and text.
  if (answer.action_code === "create_listing" && /^\/draft\/[1-9]\d*\/?$/.test(path)) return path;
  if (answer.action_code === "settings_navigation" && /^\/settings(?:#[a-z_-]+)?$/.test(path)) return path;
  return null;
}

export function ReaiAgentCard({
  draftId,
  currentUploadId,
  currentField,
  onFieldClear,
  currentTourId,
  workspaceContext = draftId ? "draft" : "creator",
  lang,
  onDraftUpdated,
  panel = false,
  compact = false,
}: {
  draftId?: number;
  currentUploadId?: number;
  currentField?: AgentPoolField;
  onFieldClear?: () => void;
  currentTourId?: number;
  workspaceContext?: "creator" | "draft" | "settings" | "floorplan" | "virtual_tour";
  lang: string;
  onDraftUpdated?: (draft: DraftDetailItem) => void;
  panel?: boolean;
  compact?: boolean;
}) {
  const router = useRouter();
  const { user } = useAuth();
  const dateFormat = user?.localization?.date_format;
  const [consent, setConsent] = useState<ReaiAgentConsent | null>(null);
  const [consentResolved, setConsentResolved] = useState(false);
  const consentRef = useRef<ReaiAgentConsent | null>(null);
  useEffect(() => {
    consentRef.current = consent;
  }, [consent]);
  const [improvementConsent, setImprovementConsent] = useState<ReaiImprovementConsent | null>(null);
  const [improvementConversationId, setImprovementConversationId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [busy, setBusy] = useState(false);
  /** Local files waiting for a listing, or a failed upload's explicit retry. */
  const [pendingAttachments, setPendingAttachments] = useState<File[]>([]);
  const [attachmentDraftId, setAttachmentDraftId] = useState<number | null>(null);
  const [attachmentNotice, setAttachmentNotice] = useState<string | null>(null);
  const [intakeBusy, setIntakeBusy] = useState(false);
  const sourceTokensRef = useRef(new Map<File, string>());
  const documentReadStatesRef = useRef(new Map<File, AgentDocumentReadState>());
  const [documentReadStates, setDocumentReadStates] = useState(new Map<File, AgentDocumentReadState>());
  // Keep original source authority for explicit follow-up/retry, separately
  // from fresh sources automatically sent with the next pending draft turn.
  const sourceArchiveRef = useRef(new Map<AgentDocumentSource, { token: string; draftId?: number }>());
  const sourceImportAttemptsRef = useRef(new Set<string>());
  const sourceImportBusyRef = useRef(false);
  const sourceImportControllerRef = useRef<AbortController | null>(null);
  const [sourceImportProgress, setSourceImportProgress] = useState<{ id: string; progress: ReaiSourceImportProgress | null } | null>(null);
  const [sourceImportRetry, setSourceImportRetry] = useState<SourceImportRetry | null>(null);
  const [sourceImportFollowUp, setSourceImportFollowUp] = useState<SourceImportRetry | null>(null);
  const [sourceImages, setSourceImages] = useState<SourceImageReview[]>([]);
  const [savedEvidence, setSavedEvidence] = useState<{ draftId: number; files: DraftUpload[] } | null>(null);
  const intakeGenerationRef = useRef(0);
  const assistSequenceRef = useRef(0);
  const editContextRef = useRef<AgentEditContext>({ draftId, userId: user?.id, generation: 0, consented: false });
  useEffect(() => {
    editContextRef.current = { draftId, userId: user?.id, generation: intakeGenerationRef.current, consented: Boolean(consent?.consented) };
  }, [draftId, user?.id, consent?.consented]);
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
  const [pendingViewerActionTurnId, setPendingViewerActionTurnId] = useState<number | null>(null);
  const pendingViewerActionTurnRef = useRef<number | null>(null);
  const viewerActionTimeoutRef = useRef<number | null>(null);
  /*
   * Action plans run across several awaits and outlive the render that started
   * them, so everything the runner reads goes through refs rather than the
   * closure of one render: the latest transcript, the dropped photos, the
   * conversation id and the language.
   */
  const runnerRef = useRef<AgentPlanRunner<AgentActionResult> | null>(null);
  const jobMonitorsRef = useRef(new Map<number, AbortController>());
  const turnsRef = useRef<ChatTurn[]>([]);
  const pendingAttachmentsRef = useRef<File[]>([]);
  const improvementConversationIdRef = useRef<string | null>(null);
  const langRef = useRef(lang);
  /**
   * Turn ids. `Date.now()` alone collided when a plan appended several turns in
   * the same millisecond, and every turn update matches by id.
   */
  const nextTurnIdRef = useRef(0);
  /** An open plan question the next typed message answers, shown above the composer. */
  const [answering, setAnswering] = useState<{ planId: string; stepId: string; text: string } | null>(null);

  useEffect(() => { turnsRef.current = turns; }, [turns]);
  useEffect(() => { pendingAttachmentsRef.current = pendingAttachments; }, [pendingAttachments]);
  useEffect(() => { improvementConversationIdRef.current = improvementConversationId; }, [improvementConversationId]);
  useEffect(() => { langRef.current = lang; }, [lang]);

  useEffect(() => {
    for (const turn of turns) {
      const job = turn.job;
      if (!job || job.status !== "pending" || jobMonitorsRef.current.has(turn.id)) continue;
      const controller = new AbortController();
      jobMonitorsRef.current.set(turn.id, controller);
      void monitorAgentJob(job, { getService: getDraftService, ...systemPlanClock, signal: controller.signal })
        .then(async (status) => {
          if (!status || controller.signal.aborted) return;
          setTurns((current) => current.map((entry) => entry.id === turn.id ? {
            ...entry,
            job: { ...job, status },
            actionStatus: status === "completed" ? "applied" : status === "failed" ? "failed" : "pending",
          } : entry));
          if (status === "completed") {
            try { await refreshDraft(job.draftId); } catch { /* The job result is known even if refreshing the listing fails. */ }
            if (!controller.signal.aborted) window.dispatchEvent(new CustomEvent("reai-creations-updated", { detail: { draftIds: [job.draftId] } }));
          }
        })
        .finally(() => jobMonitorsRef.current.delete(turn.id));
    }
  }, [turns]);

  useEffect(() => {
    const handleResult = (event: Event) => {
      const result = readReaiViewerActionResult(event);
      const turnId = pendingViewerActionTurnRef.current;
      if (
        !result
        || turnId == null
        || (draftId !== undefined && result.resource.draft_id !== draftId)
        || (currentTourId !== undefined && result.resource.tour_id !== currentTourId)
      ) return;
      if (viewerActionTimeoutRef.current != null) {
        window.clearTimeout(viewerActionTimeoutRef.current);
        viewerActionTimeoutRef.current = null;
      }
      pendingViewerActionTurnRef.current = null;
      setPendingViewerActionTurnId(null);
      const completed = result.status === "completed";
      setTurns((current) => current.map((turn) => turn.id === turnId && turn.response ? {
        ...turn,
        actionStatus: completed ? "applied" : "failed",
        response: completed
          ? { ...turn.response, client_action: null, action_token: null }
          : turn.response,
      } : turn));
      setBusy(false);
      if (!completed) setError(t("reai.tourCoverFailed", lang));
    };
    window.addEventListener(REAI_VIEWER_ACTION_RESULT_EVENT, handleResult);
    return () => {
      window.removeEventListener(REAI_VIEWER_ACTION_RESULT_EVENT, handleResult);
      if (viewerActionTimeoutRef.current != null) {
        window.clearTimeout(viewerActionTimeoutRef.current);
        viewerActionTimeoutRef.current = null;
      }
    };
  }, [currentTourId, draftId, lang]);

  useEffect(() => {
    if (!historyNotice) return;
    const timer = window.setTimeout(() => setHistoryNotice(null), 3_200);
    return () => window.clearTimeout(timer);
  }, [historyNotice]);
  const [consentReloadKey, setConsentReloadKey] = useState(0);
  const [composerFocused, setComposerFocused] = useState(false);
  const [transcriptRestored, setTranscriptRestored] = useState(false);
  const restoredTranscriptKeyRef = useRef<string | null>(null);
  const [pool, setPool] = useState<AgentPoolItem[]>([]);
  const [poolRestored, setPoolRestored] = useState(false);
  const [restoredPoolKey, setRestoredPoolKey] = useState<string | null>(null);
  const [dropActive, setDropActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const dragDepthRef = useRef(0);
  const compactPanel = panel && compact;
  const transcriptKey = agentTranscriptKey();
  const poolKey = agentPoolKey(workspaceContext, draftId);
  const requestPool = currentField ? addPoolItem(pool, currentField) : pool;
  const quickActions = workspaceContext === "settings"
    ? (["reai.quickSettingsAgent", "reai.quickSettingsLanguage", "reai.quickSettingsSecurity"] as const)
    : draftId
    ? (["reai.quickImproveDescription", "reai.quickCheckFields", "reai.quickEditCurrent"] as const)
    : (["reai.quickFind", "reai.quickCompare", "reai.quickBulk"] as const);

  useEffect(() => {
    const compose = (event: Event) => {
      const detail = readReaiComposeDetail(event);
      if (!detail) return;
      setShowHistory(false);
      setShowMediaHistory(false);
      setMessage(detail.prompt);
      window.setTimeout(() => {
        composerRef.current?.focus({ preventScroll: true });
        composerRef.current?.setSelectionRange(detail.prompt.length, detail.prompt.length);
      }, 240);
    };
    window.addEventListener(REAI_COMPOSE_EVENT, compose);
    return () => window.removeEventListener(REAI_COMPOSE_EVENT, compose);
  }, []);

  // The persistent workspace shell carries this transcript across draft routes.
  // Rehydrate after a real remount, without replaying interrupted writes.
  useEffect(() => {
    const restored = (readAgentTranscript<ChatTurn>(transcriptKey) ?? []).map((turn): ChatTurn => (
      turn.directEdit && turn.proposalStatus === "pending" ? {
        ...turn,
        content: t("reai.directEdit.failed", langRef.current),
        proposalStatus: "failed",
        response: turn.response ? { ...turn.response, proposal_token: null } : undefined,
      } : turn
    ));
    nextTurnIdRef.current = restored.reduce((highest, turn) => (
      typeof turn.id === "number" && turn.id > highest ? turn.id : highest
    ), nextTurnIdRef.current);
    setTurns(restored);
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

  // The working pool is parked and restored on the same terms as the
  // transcript: what you dropped is still there after a navigation.
  useEffect(() => {
    setPool(readAgentPool(poolKey));
    setRestoredPoolKey(poolKey);
    setPoolRestored(true);
  }, [poolKey]);

  useEffect(() => {
    if (!poolRestored || restoredPoolKey !== poolKey) return;
    writeAgentPool(poolKey, pool);
  }, [pool, poolKey, poolRestored, restoredPoolKey]);

  useEffect(() => {
    let active = true;
    // A reload after the agent was switched on (or the language changed)
    // keeps what the card already shows while the fresh answer arrives.
    // Blanking it first put a spinner between "enable in settings" and the
    // composer, and the panel jumped through three heights.
    setConsentResolved((resolved) => resolved && consentRef.current !== null);
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

  const resetConversation = useCallback(() => {
    intakeGenerationRef.current += 1;
    for (const controller of jobMonitorsRef.current.values()) controller.abort();
    jobMonitorsRef.current.clear();
    sourceTokensRef.current.clear();
    documentReadStatesRef.current.clear();
    setDocumentReadStates(new Map());
    sourceArchiveRef.current.clear();
    sourceImportAttemptsRef.current.clear();
    sourceImportBusyRef.current = false;
    sourceImportControllerRef.current?.abort();
    sourceImportControllerRef.current = null;
    setSourceImportProgress(null);
    setSourceImportRetry(null);
    setSourceImportFollowUp(null);
    setSourceImages([]);
    setSavedEvidence(null);
    pendingAttachmentsRef.current = [];
    setPendingAttachments([]);
    setAttachmentDraftId(null);
    setAttachmentNotice(null);
    setIntakeBusy(false);
    setUploading(false);
    if (viewerActionTimeoutRef.current != null) {
      window.clearTimeout(viewerActionTimeoutRef.current);
      viewerActionTimeoutRef.current = null;
    }
    pendingViewerActionTurnRef.current = null;
    setPendingViewerActionTurnId(null);
    // A running plan stops with the conversation it belongs to. Steps that
    // already ran stay; nothing further runs from this window.
    const runner = runnerRef.current;
    runnerRef.current = null;
    void runner?.stop();
    setAnswering(null);
    setBusy(false);
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
  }, []);

  // Resource-specific drawers must not leak across pages, while the site-wide
  // conversation itself deliberately follows the creator into the next page.
  useEffect(() => {
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

  /*
   * "New conversation" from the panel header. The transcript is client-side
   * only — the assist endpoint is stateless and is handed the last few turns
   * with each request — so clearing state is the entire operation. The parked
   * copy is dropped by the write effect on the next tick.
   */
  useEffect(() => {
    const startNew = () => resetConversation();
    window.addEventListener("reai-new-conversation", startNew);
    return () => window.removeEventListener("reai-new-conversation", startNew);
  }, [resetConversation]);

  // Withdrawing consent stops a running plan at once; the server would refuse
  // its next step anyway, but polling and uploads must not carry on meanwhile.
  useEffect(() => {
    const consentChanged = (event: Event) => {
      setConsentReloadKey((current) => current + 1);
      if ((event as CustomEvent<{ enabled?: boolean }>).detail?.enabled === true) {
        // Settings just confirmed the agent is on: show the composer now and
        // let the reload confirm it, instead of a disabled box, a spinner
        // and then the composer.
        setConsent((current) => current ? { ...current, consented: true } : current);
        return;
      }
      intakeGenerationRef.current += 1;
      editContextRef.current = { ...editContextRef.current, consented: false, generation: intakeGenerationRef.current };
      setConsent((current) => current ? { ...current, consented: false } : null);
      sourceImportControllerRef.current?.abort();
      sourceImportControllerRef.current = null;
      sourceImportBusyRef.current = false;
      setSourceImportProgress(null);
      setSourceImportRetry(null);
      setSourceImportFollowUp(null);
      setBusy(false);
      setIntakeBusy(false);
      setUploading(false);
      for (const controller of jobMonitorsRef.current.values()) controller.abort();
      jobMonitorsRef.current.clear();
      const runner = runnerRef.current;
      runnerRef.current = null;
      void runner?.stop();
      setAnswering(null);
    };
    window.addEventListener("reai-consent-changed", consentChanged);
    return () => window.removeEventListener("reai-consent-changed", consentChanged);
  }, []);

  // Leaving the workspace unmounts the panel: stop watching, but do not cancel.
  // The parked plan comes back paused and waits for Continue.
  useEffect(() => () => {
    intakeGenerationRef.current += 1;
    sourceImportControllerRef.current?.abort();
    for (const controller of jobMonitorsRef.current.values()) controller.abort();
    jobMonitorsRef.current.clear();
    runnerRef.current?.dispose();
  }, []);

  const newTurnId = () => {
    nextTurnIdRef.current = Math.max(Date.now(), nextTurnIdRef.current + 1);
    return nextTurnIdRef.current;
  };

  /** Photos dropped before the listing existed, uploaded as the plan's photo step. */
  const uploadPlanPhotos = async (
    planDraftId: number,
    _expectedCount: number,
    startIndex: number,
  ): Promise<AgentPlanUploadResult> => {
    const generation = intakeGenerationRef.current;
    const files = pendingAttachmentsRef.current.filter((file) => describeAgentAttachment(file)?.kind === "image");
    if (!files.length) return { uploadedUploadIds: [], failedCount: 0, attemptedCount: 0 };
    const uploadedUploadIds: number[] = [];
    const failed: File[] = [];
    for (const [index, file] of files.entries()) {
      if (generation !== intakeGenerationRef.current) return { uploadedUploadIds, failedCount: files.length - uploadedUploadIds.length, attemptedCount: files.length };
      try {
        const upload = await uploadDraftPhoto(planDraftId, file, startIndex + index, {});
        uploadedUploadIds.push(upload.id);
      } catch {
        failed.push(file);
      }
    }
    // Keep what failed, plus anything dropped while the upload ran.
    if (generation !== intakeGenerationRef.current) return { uploadedUploadIds, failedCount: failed.length, attemptedCount: files.length };
    const remaining = remainingAgentAttachments(pendingAttachmentsRef.current, files, failed);
    pendingAttachmentsRef.current = remaining;
    setPendingAttachments(remaining);
    return { uploadedUploadIds, failedCount: failed.length, attemptedCount: files.length };
  };

  const createPlanRunner = () => new AgentPlanRunner<AgentActionResult>({
    advance: advanceReaiAgentPlan,
    execute: async (actionCode, actionToken) => {
      const outcome = await executeAgentAction(actionCode, actionToken, improvementConversationIdRef.current);
      announceAgentActionResult(outcome);
      return outcome;
    },
    uploadPhotos: uploadPlanPhotos,
    getService: getDraftService,
    onSnapshot: (snapshot) => {
      setTurns((current) => withPlanSnapshot(current, snapshot));
      setAnswering((current) => {
        if (!current || current.planId !== snapshot.planId) return current;
        const askedNow = snapshot.phase === "asking" && snapshot.stepId === current.stepId;
        const askedUpFront = !snapshot.plan.approval
          && (snapshot.phase === "awaiting_approval" || snapshot.phase === "asking")
          && Boolean(snapshot.plan.steps.find((step) => step.step_id === current.stepId)?.question);
        return askedNow || askedUpFront ? current : null;
      });
    },
    onConfirm: (stepId, stepResponse, snapshot) => {
      const id = newTurnId();
      setTurns((current) => {
        // Re-minted after a field change or an expired token: update the open card in place.
        const index = current.findIndex((turn) => (
          turn.planId === snapshot.planId && turn.planStepId === stepId && !turn.actionStatus
        ));
        if (index >= 0) {
          const updated = [...current];
          updated[index] = { ...updated[index], content: stepResponse.reply || updated[index].content, response: stepResponse };
          return updated;
        }
        return [...current, {
          id,
          role: "assistant" as const,
          content: stepResponse.reply,
          response: stepResponse,
          planId: snapshot.planId,
          planStepId: stepId,
        }];
      });
    },
    onAsk: (stepId, question, snapshot) => {
      if (stepId && question.allows_text) setAnswering({ planId: snapshot.planId, stepId, text: question.text });
    },
    onNavigate: (planDraftId) => {
      const path = safeAgentNavigationPath({
        reply: "",
        proposed_changes: {},
        suggested_actions: [],
        proposal_token: null,
        action_code: "create_listing",
        navigation_path: `/draft/${planDraftId}`,
      });
      if (path) router.push(path);
    },
    writeTranscript: (snapshot) => writeAgentTranscript(transcriptKey, withPlanSnapshot(turnsRef.current, snapshot)),
    onDraftChanged: (draftIds) => {
      window.dispatchEvent(new CustomEvent("reai-creations-updated", { detail: { draftIds } }));
    },
    onDone: (summary) => {
      const followUp = summary?.follow_up;
      if (!followUp?.reply) return;
      const id = newTurnId();
      setTurns((current) => [...current, {
        id,
        role: "assistant" as const,
        content: followUp.reply,
        response: {
          reply: followUp.reply,
          proposed_changes: {},
          suggested_actions: followUp.suggested_actions || [],
          proposal_token: null,
        },
      }]);
    },
    pendingPhotoCount: () => pendingImageCount(pendingAttachmentsRef.current),
    conversationId: () => improvementConversationIdRef.current,
    describeError: (err) => {
      const text = errorText(err, langRef.current);
      return text === t("reai.error", langRef.current) ? null : text;
    },
  });

  /**
   * The runner for a plan turn, created on first use. A plan restored from the
   * parked transcript gets one only when the creator acts on it, so a reload
   * never starts anything by itself.
   */
  const planRunnerFor = (planTurn: ChatTurn | undefined): AgentPlanRunner<AgentActionResult> | null => {
    const snapshot = planTurn?.planState;
    if (!planTurn || !snapshot) return null;
    // Only the newest plan is live. A tap on an older plan's leftover card must
    // never take the runner away from the plan that is actually running.
    const latestPlanId = [...turnsRef.current]
      .reverse()
      .find((turn) => turn.response?.action_code === "action_plan" && turn.planState)?.planId;
    if (latestPlanId && latestPlanId !== snapshot.planId) return null;
    const existing = runnerRef.current;
    if (existing && existing.planId === snapshot.planId) return existing;
    existing?.dispose();
    const runner = createPlanRunner();
    runner.start(planTurn.id, snapshot);
    runnerRef.current = runner;
    return runner;
  };

  const planTurnOf = (planId: string | undefined) => (
    planId ? turnsRef.current.find((turn) => turn.planId === planId && !turn.planStepId) : undefined
  );

  /** A newer plan replaces every live older one, including plans restored without a runner. */
  const stopLivePlans = () => {
    const runner = runnerRef.current;
    runnerRef.current = null;
    const stopped = new Set<string>();
    if (runner?.planId) {
      stopped.add(runner.planId);
      void runner.stop();
    }
    for (const turn of turnsRef.current) {
      const snapshot = turn.planState;
      if (!snapshot || turn.planStepId || stopped.has(snapshot.planId) || !isLivePlanPhase(snapshot.phase)) continue;
      stopped.add(snapshot.planId);
      const orphan = createPlanRunner();
      orphan.start(turn.id, snapshot);
      void orphan.stop();
    }
    setAnswering(null);
  };

  const confirmViewerAction = useCallback(async (turnId: number, answer: ReaiAgentResponse) => {
    if (
      !answer.client_action
      || !answer.client_action.confirmation_required
      || answer.action_code !== "set_tour_cover"
      || !answer.action_token
    ) return false;
    setError(null);
    pendingViewerActionTurnRef.current = turnId;
    setPendingViewerActionTurnId(turnId);
    setTurns((current) => current.map((turn) => turn.id === turnId ? {
      ...turn,
      actionStatus: "pending",
    } : turn));
    setBusy(true);
    let dispatched = false;
    let confirmationError: string | null = null;
    try {
      const confirmed = await applyReaiTourCoverAction(
        answer.action_token,
        improvementConversationId,
      );
      dispatched = dispatchReaiViewerAction(confirmed.client_action, {
        draftId,
        tourId: currentTourId,
      });
    } catch (err) {
      confirmationError = errorText(err, lang);
    }
    if (!dispatched) {
      pendingViewerActionTurnRef.current = null;
      setPendingViewerActionTurnId(null);
      setBusy(false);
      setTurns((current) => current.map((turn) => turn.id === turnId ? {
        ...turn,
        actionStatus: "failed",
      } : turn));
      setError(confirmationError ?? t("reai.tourCoverUnavailable", lang));
      return false;
    }
    viewerActionTimeoutRef.current = window.setTimeout(() => {
      if (pendingViewerActionTurnRef.current !== turnId) return;
      pendingViewerActionTurnRef.current = null;
      setPendingViewerActionTurnId(null);
      viewerActionTimeoutRef.current = null;
      setBusy(false);
      setTurns((current) => current.map((turn) => turn.id === turnId ? {
        ...turn,
        actionStatus: "failed",
      } : turn));
      setError(t("reai.tourCoverFailed", lang));
    }, 20_000);
    return true;
  }, [currentTourId, draftId, improvementConversationId, lang]);

  const lastAssistantTurnId = [...turns].reverse().find((turn) => turn.role === "assistant")?.id;
  /** Only the newest plan can be acted on; older plan cards are a record. */
  const latestPlanTurnId = [...turns].reverse().find((turn) => turn.response?.action_code === "action_plan" && turn.planState)?.id;

  const forgetExpiredSources = (tokens: readonly string[]) => {
    discardAgentSourceTokens(sourceTokensRef.current, tokens);
    for (const [file, source] of sourceArchiveRef.current) if (tokens.includes(source.token)) sourceArchiveRef.current.delete(file);
    setPool((current) => discardPoolSourceTokens(current, tokens));
    setSourceImportRetry(null);
    setSourceImportFollowUp(null);
    setAttachmentNotice(t("reai.attachments.sourceExpired", lang));
  };

  const discussSources = () => {
    const tokens = [...sourceArchiveRef.current.values()].filter((source) => source.draftId === draftId).map((source) => source.token).slice(-24);
    if (!tokens.length) {
      setAttachmentNotice(t("reai.attachments.sourceExpired", lang));
      return;
    }
    setSourceImportFollowUp({
      options: { sourceTokens: [...new Set(tokens)], message: "", currentDraftId: draftId },
      generation: intakeGenerationRef.current, userId: user?.id,
    });
    composerRef.current?.focus();
  };

  const importSources = async (options: Parameters<typeof importReaiSources>[0]): Promise<ReaiAgentResponse> => {
    const generation = intakeGenerationRef.current;
    const retry: SourceImportRetry = { options, generation, userId: user?.id };
    markSourceImportAttempt(options.sourceTokens, sourceImportAttemptsRef.current, options.currentDraftId);
    sourceImportBusyRef.current = true;
    setSourceImportFollowUp(null);
    const requestId = randomUUID();
    const controller = new AbortController();
    sourceImportControllerRef.current?.abort();
    sourceImportControllerRef.current = controller;
    setSourceImportProgress({ id: requestId, progress: null });
    void monitorSourceImportProgress({
      ...systemPlanClock, signal: controller.signal,
      getStatus: () => getReaiSourceImportProgress(requestId, controller.signal),
      onProgress: (progress) => {
        if (generation === intakeGenerationRef.current && user?.id === editContextRef.current.userId && !controller.signal.aborted) {
          setSourceImportProgress({ id: requestId, progress });
        }
      },
    });
    try {
      const response = reviewedSourceImport(await importReaiSources({ ...options, importRequestId: requestId, improvementConversationId }));
      if (generation === intakeGenerationRef.current && user?.id === editContextRef.current.userId) {
        if (response.improvement_conversation_id) setImprovementConversationId(response.improvement_conversation_id);
        setSourceImportRetry(response.source_import?.status === "unavailable" ? retry : null);
        setSourceImportFollowUp(response.source_import?.requires_input ? retry : null);
      }
      return response;
    } catch (err) {
      if (generation === intakeGenerationRef.current && user?.id === editContextRef.current.userId && getApiErrorCode(err) !== "agent_source_expired") setSourceImportRetry(retry);
      throw err;
    } finally {
      controller.abort();
      if (generation === intakeGenerationRef.current) {
        sourceImportBusyRef.current = false;
        if (sourceImportControllerRef.current === controller) sourceImportControllerRef.current = null;
        setSourceImportProgress((current) => current?.id === requestId ? null : current);
      }
    }
  };

  const retrySourceImport = async () => {
    const retry = sourceImportRetry;
    if (!retry || busy || uploading || intakeBusy || sourceImportBusyRef.current || !consent?.consented
      || retry.generation !== intakeGenerationRef.current || retry.userId !== user?.id || retry.options.currentDraftId !== draftId) return;
    setBusy(true);
    setError(null);
    try {
      const response = await importSources(retry.options);
      if (retry.generation !== intakeGenerationRef.current || retry.userId !== editContextRef.current.userId) return;
      consumeAcceptedAgentSources(sourceTokensRef.current, retry.options.sourceTokens, response.creation_context_token);
      if (response.creation_context_token) setPool((current) => discardPoolSourceTokens(current, retry.options.sourceTokens));
      setTurns((current) => [...current, { id: newTurnId(), role: "assistant", content: response.reply, response }]);
    } catch (err) {
      if (retry.generation === intakeGenerationRef.current) {
        if (getApiErrorCode(err) === "agent_source_expired") forgetExpiredSources(retry.options.sourceTokens);
        setError(errorText(err, lang));
      }
    } finally {
      if (retry.generation === intakeGenerationRef.current) setBusy(false);
    }
  };

  /** Shared signed apply path; callers own the serialized busy state. */
  const submitProposal = async (turnId: number, answer: ReaiAgentResponse, context: AgentEditContext, conversationId: string | null, direct = false): Promise<boolean> => {
    if (!answer.proposal_token || !isCurrentEditContext(context, { ...editContextRef.current, generation: intakeGenerationRef.current })) return false;
    try {
      const result = await applyReaiWorkspaceProposal(answer.proposal_token, context.draftId, conversationId);
      if (context.generation !== intakeGenerationRef.current || context.userId !== editContextRef.current.userId || !editContextRef.current.consented) return false;
      const stillCurrent = isCurrentEditContext(context, { ...editContextRef.current, generation: intakeGenerationRef.current });
      if (result.current_draft && stillCurrent) onDraftUpdated?.(result.current_draft);
      window.dispatchEvent(new CustomEvent("reai-creations-updated", { detail: { draftIds: result.applied_draft_ids } }));
      setTurns((current) => current.map((turn) => turn.id === turnId ? {
        ...turn,
        proposalStatus: "applied",
        ...(direct ? { content: t("reai.directEdit.saved", lang), undo: proposalUndo(result, context.draftId) } : {}),
        response: { ...answer, proposal_token: null },
      } : turn.undo && result.applied_draft_ids.includes(turn.undo.draftId) ? { ...turn, undo: undefined } : turn));
      if (showHistory && stillCurrent) await loadHistory();
      return true;
    } catch (err) {
      if (context.generation !== intakeGenerationRef.current || context.userId !== editContextRef.current.userId || !editContextRef.current.consented) return false;
      setError(errorText(err, lang));
      if (direct) setTurns((current) => current.map((turn) => turn.id === turnId ? {
        ...turn,
        content: t("reai.directEdit.failed", lang),
        proposalStatus: "failed",
        // A dropped response may have committed. Never automatically replay it.
        response: { ...answer, proposal_token: null },
      } : turn));
      return false;
    }
  };

  const ask = async (override?: string) => {
    const requestText = (override ?? message).trim();
    if (!requestText || busy || uploading || intakeBusy || sourceImportBusyRef.current || !consent?.consented) return;
    assistSequenceRef.current += 1;
    const generation = intakeGenerationRef.current;
    const editContext: AgentEditContext = { draftId, userId: user?.id, generation, consented: Boolean(consent?.consented) };
    const userTurn: ChatTurn = { id: newTurnId(), role: "user", content: requestText };
    setTurns((current) => [...current, userTurn]);
    setMessage("");

    // A bare "stop" ends the live plan, even while a question is open: no
    // answer to a plan question is ever that single word.
    const latestPlanTurn = [...turns].reverse().find((turn) => turn.response?.action_code === "action_plan" && turn.planState);
    const latestPlan = latestPlanTurn?.planState;
    if (latestPlan && isLivePlanPhase(latestPlan.phase) && isPlanStop(requestText)) {
      void planRunnerFor(latestPlanTurn)?.stop();
      setAnswering(null);
      return;
    }
    // An open plan question takes the typed text as its answer. It goes to the
    // plan, never back through the router as a fresh request.
    if (answering) {
      const runner = planRunnerFor(turns.find((turn) => turn.planId === answering.planId && !turn.planStepId));
      setAnswering(null);
      if (runner && !runner.busy) {
        void runner.answer(answering.stepId, { text: requestText });
        return;
      }
    }
    // "yes" approves the plan only while it is the very last thing Agent said
    // and nothing in it still needs an answer.
    const latestAssistantTurn = [...turns].reverse().find((turn) => turn.role === "assistant");
    if (
      latestPlan
      && latestAssistantTurn?.id === latestPlanTurn?.id
      && latestPlan.phase === "awaiting_approval"
      && !latestPlan.plan.approval
      && latestPlan.plan.approval_options.includes("all")
      && openPlanQuestions(latestPlan.plan, pendingImageCount(pendingAttachments)).length === 0
      && isPlanConfirmation(requestText, lang)
    ) {
      void planRunnerFor(latestPlanTurn)?.approve("all", planApprovalDigests(latestPlan.plan), pendingImageCount(pendingAttachments));
      return;
    }

    const pendingProposal = pendingAgentTurn(turns);
    if (
      pendingProposal?.response?.proposal_token
      && !sourceImportFollowUp
      && isProposalConfirmation(requestText, lang)
    ) {
      const applied = await apply(pendingProposal.id, pendingProposal.response);
      if (applied) {
        const appliedTurnId = newTurnId();
        setTurns((current) => [
          ...current,
          { id: appliedTurnId, role: "assistant", content: t("reai.applied", lang) },
        ]);
      }
      return;
    }
    const pendingViewerAction = pendingAgentTurn(turns);
    if (
      pendingViewerAction?.response?.client_action?.confirmation_required
      && isProposalConfirmation(requestText, lang)
    ) {
      void confirmViewerAction(pendingViewerAction.id, pendingViewerAction.response);
      return;
    }

    const conversation = turns.slice(-4).map(({ role, content }) => ({ role, content }));
    const sourceTokens = activeAgentSourceTokens(
      [...sourceTokensRef.current.values(), ...pool.flatMap((item) => item.kind === "document" && item.sourceToken ? [item.sourceToken] : [])],
      sourceArchiveRef.current.values(), draftId,
    );
    const followUpTokens = sourceImportFollowUp?.options.currentDraftId === draftId
      && sourceImportFollowUp?.generation === generation && sourceImportFollowUp?.userId === user?.id
      ? sourceImportFollowUp.options.sourceTokens : [];
    const newSourceTokens = unattemptedSourceImports(sourceTokens, sourceImportAttemptsRef.current, draftId);
    const importTokens = [...new Set([...followUpTokens, ...(newSourceTokens.length ? sourceTokens : [])])];
    setBusy(true);
    setError(null);
    try {
      // Plan turns and their step cards are driven by the plan itself, so they
      // hand the router no pending code. Looking past them to an older turn
      // would resurrect a finished flow and switch off the copy-edit guard the
      // server keeps for a message with no pending action.
      const pendingActionCode = pendingAgentTurn(turns)?.response?.action_code;
      const response = importTokens.length ? await importSources({
        sourceTokens: importTokens, message: requestText, currentDraftId: draftId,
        creationContextToken: !draftId ? pendingCreationContextToken(turns) : null,
        conversation, language: lang, threadToken: latestThreadToken(turns),
      }) : await askReaiWorkspace(
        requestText,
        draftId,
        conversation,
        improvementConversationId,
        undefined,
        pendingActionCode,
        workspaceContext,
        currentField ? undefined : currentUploadId,
        poolItemsForRequest(requestPool),
        currentTourId,
        {
          pendingPhotoCount: pendingImageCount(pendingAttachments),
          pendingAttachments: pendingAttachmentDescriptors(pendingAttachments, documentReadStatesRef.current),
          creationContextToken: !draftId ? pendingCreationContextToken(turns) : null,
          sourceTokens,
          threadToken: latestThreadToken(turns),
        },
      );
      if (generation !== intakeGenerationRef.current || editContext.userId !== editContextRef.current.userId || !editContextRef.current.consented) return;
      consumeAcceptedAgentSources(sourceTokensRef.current, sourceTokens, response.creation_context_token);
      if (response.creation_context_token) setPool((current) => discardPoolSourceTokens(current, sourceTokens));
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
      if (response.client_action && !response.client_action.confirmation_required) {
        dispatchReaiViewerAction(response.client_action, { draftId, tourId: currentTourId });
      }
      if (response.improvement_conversation_id) setImprovementConversationId(response.improvement_conversation_id);
      const assistantTurnId = newTurnId();
      const directEdit = !importTokens.length && isCurrentEditContext(editContext, { ...editContextRef.current, generation: intakeGenerationRef.current })
        && canApplyDirectEdit(response, editContext);
      const plan = response.action_code === "action_plan" && response.plan && response.plan_token
        ? response.plan
        : null;
      const planSnapshot = plan && response.plan_token
        ? createPlanSnapshot(assistantTurnId, plan, response.plan_token, response.reply, Date.now())
        : null;
      const assistantTurn: ChatTurn = {
        id: assistantTurnId,
        role: "assistant",
        content: response.reply,
        response,
        ...(directEdit ? { directEdit: true, proposalStatus: "pending" as const, content: t("reai.directEdit.saving", lang) } : {}),
        ...(planSnapshot ? { planId: planSnapshot.planId, planState: planSnapshot } : {}),
      };
      if (planSnapshot) stopLivePlans();
      setTurns((current) => [
        ...current,
        assistantTurn,
      ]);
      if (directEdit) {
        await submitProposal(assistantTurnId, response, editContext, response.improvement_conversation_id ?? improvementConversationId, true);
        return;
      }
      if (planSnapshot) {
        // Registered, not started: nothing runs until the creator approves.
        const runner = createPlanRunner();
        runner.start(assistantTurnId, planSnapshot);
        runnerRef.current = runner;
        const typedQuestion = openPlanQuestions(planSnapshot.plan, pendingImageCount(pendingAttachments))
          .find((step) => step.question?.allows_text);
        if (typedQuestion?.question) {
          setAnswering({ planId: planSnapshot.planId, stepId: typedQuestion.step_id, text: typedQuestion.question.text });
        }
      }
      const navigationPath = safeAgentNavigationPath(response);
      if (navigationPath) {
        // Navigation can unmount this page before the persistence effect runs.
        // Park the complete turn pair synchronously so the destination page
        // always rehydrates the same conversation.
        writeAgentTranscript(transcriptKey, [...turns, userTurn, assistantTurn]);
        router.push(navigationPath);
      }
    } catch (err) {
      if (generation !== intakeGenerationRef.current) return;
      if (getApiErrorCode(err) === "agent_source_expired") {
        forgetExpiredSources(importTokens.length ? importTokens : sourceTokens);
      }
      setError(errorText(err, lang));
      setTurns((current) => current.filter((turn) => turn.id !== userTurn.id));
      setMessage(requestText);
    } finally {
      if (generation === intakeGenerationRef.current) setBusy(false);
    }
  };

  const apply = async (turnId: number, answer: ReaiAgentResponse): Promise<boolean> => {
    if (!answer.proposal_token || busy || uploading || intakeBusy || !consent?.consented) return false;
    const generation = intakeGenerationRef.current;
    setBusy(true);
    setError(null);
    try {
      return await submitProposal(turnId, answer, { draftId, userId: user?.id, generation, consented: true }, improvementConversationId);
    } finally {
      if (generation === intakeGenerationRef.current) setBusy(false);
    }
  };

  const undoProposal = async (turn: ChatTurn) => {
    const undo = turn.undo;
    if (!undo || undo.draftId !== draftId || busy || uploading || intakeBusy || !consent?.consented) return;
    const context: AgentEditContext = { draftId, userId: user?.id, generation: intakeGenerationRef.current, consented: true };
    if (!isCurrentEditContext(context, { ...editContextRef.current, generation: intakeGenerationRef.current })) return;
    setBusy(true);
    setError(null);
    try {
      const result = await restoreAgentCreationRevision(undo.draftId, undo.revisionId, undo.expectedRevisionId);
      if (context.generation !== intakeGenerationRef.current || context.userId !== editContextRef.current.userId || !editContextRef.current.consented) return;
      const stillCurrent = isCurrentEditContext(context, { ...editContextRef.current, generation: intakeGenerationRef.current });
      if (stillCurrent) onDraftUpdated?.(result.draft);
      window.dispatchEvent(new CustomEvent("reai-creations-updated", { detail: { draftIds: [undo.draftId] } }));
      setTurns((current) => current.map((entry) => entry.id === turn.id ? {
        ...entry, undo: undefined, proposalStatus: "undone", content: t("reai.directEdit.undone", lang),
      } : entry.undo?.draftId === undo.draftId ? { ...entry, undo: undefined } : entry));
      if (showHistory && stillCurrent) await loadHistory();
    } catch (err) {
      if (context.generation === intakeGenerationRef.current && context.userId === editContextRef.current.userId) setError(errorText(err, lang));
    } finally {
      if (context.generation === intakeGenerationRef.current) setBusy(false);
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

  /** Confirm on a plan step's own card: the plan runs the step and carries on. */
  const confirmPlanStep = async (stepTurn: ChatTurn, answer: ReaiAgentResponse) => {
    const runner = planRunnerFor(planTurnOf(stepTurn.planId));
    if (!runner || !stepTurn.planStepId) return;
    setBusy(true);
    setError(null);
    try {
      const outcome = await runner.confirmStep(stepTurn.planStepId, answer);
      if (outcome) {
        setTurns((current) => current.map((turn) => turn.id === stepTurn.id ? withAppliedAction(turn, answer, outcome) : turn));
      }
    } finally {
      setBusy(false);
    }
  };

  const applyAction = async (turnId: number, answer: ReaiAgentResponse) => {
    if (!answer.action_token || busy || uploading || intakeBusy || !consent?.consented) return;
    const generation = intakeGenerationRef.current;
    const planStepTurn = turns.find((turn) => turn.id === turnId && turn.planId && turn.planStepId);
    if (planStepTurn) {
      await confirmPlanStep(planStepTurn, answer);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const outcome = await executeAgentAction(answer.action_code, answer.action_token, improvementConversationId);
      if (generation !== intakeGenerationRef.current) return;
      if (outcome.kind === "create_listing") {
        const result = outcome.result;
        for (const [file, source] of sourceArchiveRef.current) {
          if (source.draftId === undefined) {
            // Creating the reviewed draft is not a new document-analysis
            // request. Carry the attempt marker along with its source scope.
            if (!unattemptedSourceImports([source.token], sourceImportAttemptsRef.current).length) {
              markSourceImportAttempt([source.token], sourceImportAttemptsRef.current, result.draft_id);
            }
            sourceArchiveRef.current.set(file, { ...source, draftId: result.draft_id });
          }
        }
        setSourceImages((current) => current.map((image) => image.draftId === undefined ? { ...image, draftId: result.draft_id, key: `${result.draft_id}:${image.source.name}:${image.candidate.sha256}:${image.candidate.id}` } : image));
        // The listing exists from here on. A photo that fails to upload must
        // not hide that: leaving the confirm card up with only an error would
        // send the creator back to describe a listing they already have.
        if (pendingAttachmentsRef.current.length) await uploadAttachments(result.draft_id, [...pendingAttachmentsRef.current]);
        if (generation !== intakeGenerationRef.current) return;
        announceAgentActionResult(outcome);
        const followUp = result.follow_up;
        const followUpTurnId = newTurnId();
        const updatedTurns = ((current: ChatTurn[]) => {
          const updated = current.map((turn) => turn.id === turnId ? {
            ...turn,
            actionStatus: "applied" as const,
            response: { ...answer, action_token: null },
          } : turn);
          if (!followUp?.reply) return updated;
          // The conversation carries on inside the new listing: the agent asks
          // for the next missing fact and offers the description, instead of
          // falling silent the moment the listing opens.
          return [...updated, {
            id: followUpTurnId,
            role: "assistant" as const,
            content: followUp.reply,
            response: {
              reply: followUp.reply,
              proposed_changes: {},
              suggested_actions: followUp.suggested_actions || [],
              proposal_token: null,
            },
          }];
        })(turnsRef.current);
        turnsRef.current = updatedTurns;
        setTurns(updatedTurns);
        writeAgentTranscript(transcriptKey, updatedTurns);
        router.push(result.navigation_path);
        return;
      }
      announceAgentActionResult(outcome);
      setTurns((current) => current.map((turn) => turn.id === turnId ? withAppliedAction(turn, answer, outcome) : turn));
      if (
        outcome.kind === "media"
        && answer.action_code !== "generate_draft_video"
        && answer.action_code !== "organize_draft_images"
      ) {
        setTimeout(() => void loadMediaHistory(), outcome.result.status === "pending" ? 2500 : 0);
      }
    } catch (err) {
      if (generation !== intakeGenerationRef.current) return;
      setError(errorText(err, lang));
    } finally {
      if (generation === intakeGenerationRef.current) setBusy(false);
    }
  };

  const dismissAction = (turnId: number) => {
    const planStepTurn = turns.find((turn) => turn.id === turnId && turn.planId && turn.planStepId);
    if (planStepTurn?.planStepId) {
      // Dismissing a step's card skips that step; the rest of the plan goes on.
      const runner = planRunnerFor(planTurnOf(planStepTurn.planId));
      if (!runner || runner.busy) return;
      void runner.skipStep(planStepTurn.planStepId);
    }
    setTurns((current) => current.map((turn) => turn.id === turnId && turn.response ? {
      ...turn,
      actionStatus: "dismissed",
      response: { ...turn.response, action_token: null },
    } : turn));
  };

  const dismissViewerAction = (turnId: number) => {
    setTurns((current) => current.map((turn) => turn.id === turnId && turn.response ? {
      ...turn,
      actionStatus: "dismissed",
      response: { ...turn.response, client_action: null, action_token: null },
    } : turn));
  };

  // Files are accepted on an open listing (uploaded at once) and, in the creator
  // workspace, before the listing exists: they wait below the conversation and
  // are uploaded when Agent creates it. The second case used to be rejected
  // here, which left the waiting-photos branch below unreachable.
  const acceptsDrop = (dataTransfer: DataTransfer) =>
    dragHasPoolItem(dataTransfer)
    || (dragHasFiles(dataTransfer) && (Boolean(draftId) || workspaceContext === "creator"));

  // A file drop adds listing media or private evidence. Replacing an existing
  // version remains an explicit action in the media manager.
  // A drop with nothing typed is the request. Agent names what arrived and
  // offers the two to four things that fit it; each chip is a sentence the
  // router runs, with the pool still attached. Nothing runs until a tap.
  const reactToDrop = async (nextPool: AgentPoolItem[], pendingFiles: File[]) => {
    if (busy || sourceImportBusyRef.current || message.trim() || !consent?.consented) return;
    const generation = intakeGenerationRef.current;
    const requestSequence = ++assistSequenceRef.current;
    const sourceTokens = activeAgentSourceTokens(
      [...sourceTokensRef.current.values(), ...nextPool.flatMap((item) => item.kind === "document" && item.sourceToken ? [item.sourceToken] : [])],
      sourceArchiveRef.current.values(), draftId,
    );
    const newImportTokens = unattemptedSourceImports(sourceTokens, sourceImportAttemptsRef.current, draftId);
    const followUpTokens = sourceImportFollowUp?.options.currentDraftId === draftId
      && sourceImportFollowUp?.generation === generation ? sourceImportFollowUp.options.sourceTokens : [];
    // A photo/field drop cannot answer a document ambiguity. Keep the question
    // active; only another document or the creator's words can continue it.
    if (sourceImportFollowUp && followUpTokens.length && !newImportTokens.length) return;
    const importTokens = [...new Set(newImportTokens.length ? [...sourceTokens, ...followUpTokens] : [])];
    setBusy(true);
    try {
      const response = importTokens.length ? await importSources({
        sourceTokens: importTokens, message: "", currentDraftId: draftId,
        creationContextToken: !draftId ? pendingCreationContextToken(turnsRef.current) : null,
        conversation: turnsRef.current.slice(-4).map(({ role, content }) => ({ role, content })), language: lang,
      }) : await askReaiWorkspace(
        "",
        draftId,
        turns.slice(-4).map((turn) => ({ role: turn.role, content: turn.content })),
        improvementConversationId,
        undefined,
        undefined,
        workspaceContext,
        currentUploadId,
        poolItemsForRequest(nextPool),
        currentTourId,
        {
          pendingPhotoCount: pendingImageCount(pendingFiles),
          pendingAttachments: pendingAttachmentDescriptors(pendingFiles, documentReadStatesRef.current),
          creationContextToken: !draftId ? pendingCreationContextToken(turns) : null,
          sourceTokens,
          threadToken: latestThreadToken(turns),
        },
      );
      if (generation !== intakeGenerationRef.current) return;
      if (requestSequence !== assistSequenceRef.current || (!importTokens.length && !isAgentAttachmentResponse(response.action_code))) return;
      consumeAcceptedAgentSources(sourceTokensRef.current, sourceTokens, response.creation_context_token);
      if (response.creation_context_token) setPool((current) => discardPoolSourceTokens(current, sourceTokens));
      setTurns((current) => [
        ...current,
        { id: newTurnId(), role: "assistant", content: response.reply, response },
      ]);
      if (response.improvement_conversation_id) setImprovementConversationId(response.improvement_conversation_id);
    } catch (err) {
      if (generation !== intakeGenerationRef.current || requestSequence !== assistSequenceRef.current) return;
      if (getApiErrorCode(err) === "agent_source_expired") {
        forgetExpiredSources(importTokens.length ? importTokens : sourceTokens);
      }
      // Mapping can incur usage, so report failure and require an explicit retry.
      if (importTokens.length) setError(errorText(err, lang));
    } finally {
      if (generation === intakeGenerationRef.current) setBusy(false);
    }
  };

  const uploadAttachments = async (targetDraftId: number, files: File[]) => {
    const generation = intakeGenerationRef.current;
    setUploading(true);
    setAttachmentDraftId(targetDraftId);
    const failed: File[] = [];
    let nextPool = draftId === targetDraftId ? pool : readAgentPool(agentPoolKey("draft", targetDraftId));
    let firstError: unknown;
    for (const [index, file] of files.entries()) {
      if (generation !== intakeGenerationRef.current) break;
      try {
        const upload = await uploadDraftAttachment(targetDraftId, file, index);
        if (generation !== intakeGenerationRef.current) return nextPool;
        const kind = describeAgentAttachment(file)?.kind;
        if (kind === "image") {
          nextPool = addPoolItem(nextPool, { kind, uploadId: upload.id, url: upload.file_url, label: file.name });
        } else if (kind) {
          nextPool = addPoolItem(nextPool, { kind, uploadId: upload.id, label: file.name, sourceToken: sourceTokensRef.current.get(file) });
        }
        sourceTokensRef.current.delete(file);
        const archived = sourceArchiveRef.current.get(file);
        if (archived) {
          const savedSource = { name: file.name, uploadId: upload.id, draftId: targetDraftId };
          sourceArchiveRef.current.delete(file);
          sourceArchiveRef.current.set(savedSource, { ...archived, draftId: targetDraftId });
          setSourceImages((current) => current.map((image) => image.source === file ? { ...image, source: savedSource, draftId: targetDraftId } : image));
        }
        setSourceImages((current) => current.map((image) => image.selectedFile === file ? { ...image, uploaded: true, draftId: targetDraftId } : image.source === file ? { ...image, draftId: targetDraftId } : image));
      } catch (err) {
        failed.push(file);
        firstError ??= err;
      }
    }
    if (generation !== intakeGenerationRef.current) return nextPool;
    const remaining = remainingAgentAttachments(pendingAttachmentsRef.current, files, failed);
    pendingAttachmentsRef.current = remaining;
    setPendingAttachments(remaining);
    writeAgentPool(agentPoolKey("draft", targetDraftId), nextPool);
    if (draftId === targetDraftId) setPool(nextPool);
    setUploading(false);
    if (failed.length) {
      setAttachmentNotice(failed.length === 1
        ? t("reai.attachments.failedOne", lang)
        : t("reai.attachments.failed", lang).replace("{count}", String(failed.length)));
      if (firstError) setError(errorText(firstError, lang));
    }
    window.dispatchEvent(new CustomEvent("reai-creations-updated", { detail: { draftIds: [targetDraftId] } }));
    if (draftId === targetDraftId && onDraftUpdated) {
      try { onDraftUpdated(await getDraft(targetDraftId)); } catch { /* Uploads already succeeded; refresh may be retried. */ }
    }
    return nextPool;
  };

  const toggleSourceImage = async (image: SourceImageReview) => {
    if (image.uploaded || image.draftId !== draftId || busy || uploading || intakeBusy || !consent?.consented) return;
    if (image.selectedFile) {
      pendingAttachmentsRef.current = pendingAttachmentsRef.current.filter((file) => file !== image.selectedFile);
      setPendingAttachments(pendingAttachmentsRef.current);
      setSourceImages((current) => current.map((entry) => entry.key === image.key ? { ...entry, selectedFile: undefined } : entry));
      return;
    }
    if (pendingAttachmentsRef.current.length >= MAX_AGENT_ATTACHMENTS) {
      setAttachmentNotice(t("reai.import.imageLimit", lang));
      return;
    }
    const generation = intakeGenerationRef.current;
    setIntakeBusy(true);
    setError(null);
    try {
      const file = await reviewedSourceImageFile(image.candidate, image.source.name);
      if (generation !== intakeGenerationRef.current) return;
      // Selecting a brochure picture only stages local bytes. No upload or
      // gallery publication happens until Create / Add selected images.
      pendingAttachmentsRef.current = [...pendingAttachmentsRef.current, file];
      setPendingAttachments(pendingAttachmentsRef.current);
      setSourceImages((current) => current.map((entry) => entry.key === image.key ? { ...entry, selectedFile: file } : entry));
    } catch (err) {
      if (generation === intakeGenerationRef.current) setError(errorText(err, lang));
    } finally {
      if (generation === intakeGenerationRef.current) setIntakeBusy(false);
    }
  };

  const rememberDocumentReadState = (file: File, state: AgentDocumentReadState) => {
    documentReadStatesRef.current.set(file, state);
    setDocumentReadStates(new Map(documentReadStatesRef.current));
  };

  const rememberSourceIntake = (source: AgentDocumentSource, intake: ReaiAgentIntakeResponse) => {
    const readState = documentReadState(intake);
    if (source instanceof File) rememberDocumentReadState(source, readState);
    if (intake.source_token) {
      if (source instanceof File) sourceTokensRef.current.set(source, intake.source_token);
      for (const key of sourceArchiveRef.current.keys()) {
        if (!(source instanceof File) && !(key instanceof File) && key.uploadId === source.uploadId && key.draftId === source.draftId) sourceArchiveRef.current.delete(key);
      }
      sourceArchiveRef.current.set(source, { token: intake.source_token, draftId });
    }
    const candidates = sourceImageCandidates(intake.image_candidates);
    if (candidates.length) setSourceImages((current) => [
      ...current,
      ...candidates.map((candidate) => ({ key: `${draftId ?? "new"}:${source.name}:${candidate.sha256}:${candidate.id}`, source, candidate, draftId })),
    ].filter((candidate, index, all) => all.findIndex((other) => other.key === candidate.key) === index).slice(-MAX_SOURCE_IMAGE_PREVIEWS));
    if (readState.status !== "extracted") setAttachmentNotice(t(`reai.attachments.read.${readState.reason}`, lang));
  };

  const loadSavedEvidence = async () => {
    if (!draftId || busy || intakeBusy || uploading || !consent?.consented) return;
    if (savedEvidence?.draftId === draftId) { setSavedEvidence(null); return; }
    const generation = intakeGenerationRef.current;
    setBusy(true);
    setError(null);
    try {
      const files = await listDraftUploads(draftId, { role: "evidence", fresh: true });
      if (generation === intakeGenerationRef.current && editContextRef.current.draftId === draftId && editContextRef.current.userId === user?.id) {
        setSavedEvidence({ draftId, files: files.filter((file) => file.role === "evidence" && !file.is_deleted) });
      }
    } catch (err) {
      if (generation === intakeGenerationRef.current) setError(errorText(err, lang));
    } finally {
      if (generation === intakeGenerationRef.current) setBusy(false);
    }
  };

  const reviewSavedEvidence = async (upload: DraftUpload) => {
    if (!draftId || savedEvidence?.draftId !== draftId || busy || intakeBusy || uploading || !consent?.consented) return;
    const generation = intakeGenerationRef.current;
    setIntakeBusy(true);
    setError(null);
    try {
      const intake = await intakeSavedReaiEvidence(draftId, upload.id);
      if (generation !== intakeGenerationRef.current || editContextRef.current.draftId !== draftId || editContextRef.current.userId !== user?.id) return;
      if (intake.draft_id !== draftId || intake.evidence_upload_id !== upload.id) throw new Error(t("common.somethingWentWrongTryAgain", lang));
      const source = { name: intake.name || upload.original_file_name || upload.file_name, uploadId: upload.id, draftId };
      rememberSourceIntake(source, intake);
      const nextPool = addPoolItem(pool, { kind: "document", uploadId: upload.id, label: source.name, sourceToken: intake.source_token || undefined });
      setPool(nextPool);
      if (intake.source_token) await reactToDrop(nextPool, pendingAttachmentsRef.current);
    } catch (err) {
      if (generation === intakeGenerationRef.current) setError(errorText(err, lang));
    } finally {
      if (generation === intakeGenerationRef.current) setIntakeBusy(false);
    }
  };

  const handleDroppedFiles = async (files: File[]) => {
    if (files.length === 0 || uploading || intakeBusy || busy || !consent?.consented) return;
    // Failed uploads belong to their original listing, never the page opened later.
    if (attachmentDraftId && attachmentDraftId !== draftId && pendingAttachmentsRef.current.length) return;
    const accepted = files.filter((file) => describeAgentAttachment(file)).slice(0, MAX_AGENT_ATTACHMENTS - pendingAttachmentsRef.current.length);
    const rejected = files.length - accepted.length;
    setAttachmentNotice(rejected ? t("reai.attachments.rejected", lang).replace("{count}", String(rejected)) : null);
    if (!accepted.length) return;
    const nextFiles = [...pendingAttachmentsRef.current, ...accepted];
    pendingAttachmentsRef.current = nextFiles;
    setPendingAttachments(nextFiles);
    const generation = intakeGenerationRef.current;
    setIntakeBusy(true);
    setError(null);
    try {
      for (const file of accepted) {
        if (generation !== intakeGenerationRef.current) return;
        if (describeAgentAttachment(file)?.kind !== "document") continue;
        const intakeBlock = documentIntakeBlock(file);
        if (intakeBlock) {
          rememberDocumentReadState(file, { status: "evidence_only", reason: intakeBlock });
          setAttachmentNotice(t(`reai.attachments.read.${intakeBlock}`, lang));
          continue;
        }
        try {
          const intake = await intakeReaiAttachment(file);
          if (generation !== intakeGenerationRef.current) return;
          rememberSourceIntake(file, intake);
        } catch (err) {
          if (generation !== intakeGenerationRef.current) return;
          rememberDocumentReadState(file, { status: "evidence_only", reason: "request_failed" });
          setAttachmentNotice(t("reai.attachments.read.request_failed", lang));
          setError(errorText(err, lang));
        }
      }
      if (draftId) {
        const nextPool = await uploadAttachments(draftId, accepted);
        if (generation === intakeGenerationRef.current) await reactToDrop(nextPool, pendingAttachmentsRef.current);
      } else {
        await reactToDrop(pool, nextFiles);
      }
    } finally {
      if (generation === intakeGenerationRef.current) setIntakeBusy(false);
    }
  };

  const handleDrop = (event: React.DragEvent) => {
    dragDepthRef.current = 0;
    if (!acceptsDrop(event.dataTransfer)) return;
    event.preventDefault();
    setDropActive(false);
    const item = readDragItem(event.dataTransfer);
    if (item) {
      const nextPool = addPoolItem(pool, item);
      setPool(nextPool);
      void reactToDrop(nextPool, pendingAttachmentsRef.current);
      return;
    }
    void handleDroppedFiles(Array.from(event.dataTransfer.files));
  };

  const copyShareUrl = async (url: string) => {
    // Via the shared helper, not navigator.clipboard directly: that API only
    // exists in a secure context, so this threw on every plain-HTTP origin and
    // the "copied" confirmation never appeared.
    if (!await copyToClipboard(url)) return;
    setCopiedShareUrl(url);
    window.setTimeout(() => setCopiedShareUrl((current) => current === url ? null : current), 1800);
  };

  const sendFeedback = async (
    turnId: number,
    helpful: boolean,
    conversationId?: string | null,
    messageId?: number | null,
    reason?: ReaiFeedbackReason,
  ) => {
    const id = conversationId || improvementConversationId;
    if (!id || busy) return;
    setBusy(true);
    try {
      await saveReaiFeedback(id, helpful, "", messageId ?? null, reason ?? null);
      setTurns((current) => current.map((turn) => turn.id === turnId
        ? { ...turn, feedback: helpful, feedbackReasonOpen: false }
        : turn));
    } catch (err) {
      setError(errorText(err, lang));
    } finally {
      setBusy(false);
    }
  };

  // A thumbs-down alone says only that something was wrong. Asking which of
  // the failure families it was is one tap, and it is what makes the rating
  // usable: the same reason across many turns is the next thing to fix.
  const openFeedbackReasons = (turnId: number) => {
    setTurns((current) => current.map((turn) => turn.id === turnId
      ? { ...turn, feedbackReasonOpen: true }
      : { ...turn, feedbackReasonOpen: false }));
  };

  return (
    <section
      className={cn(
        "relative rounded-2xl bg-foreground/[0.025]",
        compactPanel ? "p-3 [&_button]:min-h-11 [&_button]:min-w-11" : "p-4",
        panel ? "flex h-full min-h-0 flex-col rounded-none border-0 bg-transparent pb-[max(1rem,env(safe-area-inset-bottom))]" : "mt-5 border border-border/40",
      )}
      aria-label={panel ? t("reai.title", lang) : undefined}
      aria-labelledby={panel ? undefined : "reai-title"}
      // The whole window is the drop target. Depth counting keeps the
      // affordance stable while the pointer crosses child elements, which
      // otherwise fire dragleave on every boundary.
      onDragEnter={(event) => {
        if (!acceptsDrop(event.dataTransfer)) return;
        event.preventDefault();
        dragDepthRef.current += 1;
        setDropActive(true);
      }}
      onDragOver={(event) => {
        if (!acceptsDrop(event.dataTransfer)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(event) => {
        if (!acceptsDrop(event.dataTransfer)) return;
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
        if (dragDepthRef.current === 0) setDropActive(false);
      }}
      onDrop={handleDrop}
    >
      {dropActive && (
        <div
          className="pointer-events-none absolute inset-1 z-20 flex items-center justify-center rounded-2xl border-2 border-dashed border-foreground/30 bg-background/85"
          aria-hidden="true"
        >
          <p className="px-6 text-center text-[12px] font-medium leading-relaxed text-foreground/70">
            {t("reai.pool.dropHint", lang)}
          </p>
        </div>
      )}
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
            <nav className="selection-capsule-track grid grid-cols-3" aria-label={t("reai.title", lang)}>
              <button
                type="button"
                aria-pressed={!showHistory && !showMediaHistory}
                className={cn(
                  "selection-capsule-item min-w-0 overflow-hidden px-1 text-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
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
                  "selection-capsule-item min-w-0 overflow-hidden px-1 text-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
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
                  "selection-capsule-item min-w-0 overflow-hidden px-1 text-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
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
            // Built from the workspace capsule primitives rather than bespoke
            // geometry: the theme's pill radius, its compact control height,
            // and its control shadow. This bar only switches views, so the
            // active segment is a lifted card on a muted track instead of the
            // solid high-contrast capsule it used to be.
            <nav
              className="selection-capsule-track mx-auto grid w-full max-w-[24rem] grid-cols-3"
              aria-label={t("reai.title", lang)}
            >
              <button
                type="button"
                aria-pressed={!showHistory && !showMediaHistory}
                className={cn(
                  "selection-capsule-item w-full text-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
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
                  "selection-capsule-item w-full text-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
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
                  "selection-capsule-item w-full text-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
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
                <div className="floating-panel-shape border border-border/65 bg-card shadow-control px-3 py-2.5 text-[11px] leading-relaxed text-foreground/75">
                  {historyNotice}
                </div>
              )}
              {historyBusy && <Working lang={lang} />}
              {!historyBusy && history.length === 0 && (
                <p className="floating-panel-shape border border-border/65 bg-card shadow-control p-3 text-[11px] leading-relaxed text-muted-foreground">{t("reai.historyEmpty", lang)}</p>
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
                        index === 0 ? "bg-foreground/[0.04]" : "border border-border/45 bg-background",
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
                <p className="floating-panel-shape border border-dashed border-border/55 px-4 py-10 text-center text-[11px] text-muted-foreground">{t("reai.mediaVersionsEmpty", lang)}</p>
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
          {!showHistory && !showMediaHistory && (turns.length > 0 || sourceImportProgress) && (
            <div className={cn("space-y-4 overflow-y-auto pr-1", panel ? "min-h-0 flex-1" : "max-h-[420px]")} aria-live="polite">
              {turns.map((turn) => {
                const answer = turn.response;
                const planState = turn.planState;
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
                    {/* The agent often ends with options — "Central heating", "Write a
                        new description". They were returned by the server and never
                        shown, so the creator had to retype an answer the agent had
                        already offered. Only the latest turn's options are live. */}
                    {turn.role === "assistant"
                      && !!answer?.suggested_actions?.length
                      && !turn.planStepId
                      && turn.id === lastAssistantTurnId && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {answer.suggested_actions.slice(0, 4).map((suggestion) => (
                          <button
                            key={suggestion}
                            type="button"
                            disabled={busy}
                            onClick={() => void ask(suggestion)}
                            className="min-h-9 rounded-2xl border border-border/60 bg-card px-3 py-1.5 text-left text-[12px] text-foreground transition-colors hover:bg-foreground/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40"
                          >
                            {suggestion}
                          </button>
                        ))}
                      </div>
                    )}
                    {answer && <AgentVersionStamp answer={answer} />}
                    {answer?.source_import && (
                      <div className="mt-3 space-y-3 rounded-2xl border border-border/65 bg-card p-3 text-xs">
                        <p className="font-medium">{t("reai.import.review", lang)}</p>
                        <p className="text-muted-foreground">{t("reai.import.reviewHint", lang)}</p>
                        {answer.listing_draft && (
                          <dl className="space-y-2">
                            {Object.entries(answer.listing_draft.fields).map(([field, value]) => (
                              <div key={field}>
                                <dt className="font-medium">{agentFieldLabel(field, lang)}</dt>
                                <dd className="mt-1 whitespace-pre-wrap break-words text-muted-foreground">{proposalValue(field, value, { ...answer, proposed_changes: answer.listing_draft!.fields }, unitCatalog, lang)}</dd>
                              </div>
                            ))}
                            {proposalSpecEntries(answer.listing_draft.specs, lang).map((entry) => (
                              <div key={entry.key}><dt className="font-medium">{entry.label}</dt><dd className="mt-1 text-muted-foreground">{entry.value}</dd></div>
                            ))}
                          </dl>
                        )}
                        {!!answer.source_import.mappings?.length && (
                          <details className="border-t border-border/40 pt-2">
                            <summary className="cursor-pointer font-medium">{t("reai.import.mappings", lang)}</summary>
                            <dl className="mt-2 space-y-3">
                              {answer.source_import.mappings.map((mapping, index) => (
                                <div key={`${mapping.field}-${index}`}>
                                  <dt className="font-medium">{agentFieldLabel(mapping.field, lang)}</dt>
                                  <dd className="mt-1 whitespace-pre-wrap break-words text-muted-foreground">
                                    {mapping.field.startsWith("specs.")
                                      ? localizedSpecValue(mapping.value, lang, mapping.field.split(".")[1], mapping.field.split(".")[2])
                                      : proposalValue(mapping.field, mapping.value, { ...answer, proposed_changes: answer.listing_draft?.fields ?? answer.proposed_changes }, unitCatalog, lang)}
                                    <p className="mt-1 text-[11px]">{mapping.source_name}{mapping.page > 0 ? ` · ${t("reai.import.page", lang).replace("{page}", String(mapping.page))}` : ""}</p>
                                    {mapping.excerpt && <blockquote className="mt-1 border-l-2 border-border pl-2 text-[11px]">{mapping.excerpt}</blockquote>}
                                  </dd>
                                </div>
                              ))}
                            </dl>
                          </details>
                        )}
                        {answer.source_import.warnings?.map((warning, index) => {
                          const key = IMPORT_WARNING_KEYS[warning];
                          return key ? <p key={index} className="text-muted-foreground">{t(key, lang)}</p> : null;
                        })}
                        {turn.id === lastAssistantTurnId && <Button type="button" variant="ghost" size="xs" disabled={busy || uploading || intakeBusy} onClick={discussSources}>{t("reai.import.askSources", lang)}</Button>}
                      </div>
                    )}
                    {Boolean(answer?.listing_draft?.source_conflicts?.length) && (
                      <div className="mt-3 rounded-2xl border border-border/65 bg-card p-3 text-xs">
                        <p className="font-medium">{t("reai.attachments.conflicts", lang)}</p>
                        {answer?.listing_draft?.source_conflicts?.map((conflict) => (
                          <div key={conflict.field} className="mt-2">
                            <p className="font-medium">{agentFieldLabel(conflict.field, lang)}</p>
                            {conflict.candidates.map((candidate, index) => (
                              <p key={index} className="mt-1 break-words text-muted-foreground">
                                {typeof candidate.value === "object" ? JSON.stringify(candidate.value) : String(candidate.value)}
                                {candidate.sources.length ? ` · ${candidate.sources.map((source) => source.name).join(", ")}` : ""}
                              </p>
                            ))}
                          </div>
                        ))}
                      </div>
                    )}
                    {turn.job && (
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <AgentStatusBadge tone={turn.job.status === "completed" ? "success" : turn.job.status === "pending" ? "pending" : "neutral"}>
                          {t(`reai.job.${turn.job.status}` as LocaleKey, lang)}
                        </AgentStatusBadge>
                        {turn.job.status === "completed" && <Link href={`/draft/${turn.job.draftId}`} className="text-xs underline">{t("reai.job.viewResult", lang)}</Link>}
                        {turn.job.status === "paused" && turn.job.serviceIds.length > 0 && <button type="button" className="text-xs underline" onClick={() => setTurns((current) => current.map((entry) => entry.id === turn.id && entry.job ? { ...entry, job: { ...entry.job, status: "pending" } } : entry))}>{t("reai.job.checkStatus", lang)}</button>}
                      </div>
                    )}
                    {answer && (
                      <>
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
                        <AgentTinyUi answer={answer} busy={busy} onPrompt={(prompt) => void ask(prompt)} lang={lang} />
                      </>
                    )}
                    {answer?.action_code === "action_plan" && planState && (
                      <AgentPlanCard
                        snapshot={planState}
                        lang={lang}
                        live={turn.id === latestPlanTurnId}
                        pendingPhotoCount={pendingImageCount(pendingAttachments)}
                        onApprove={(approval) => void planRunnerFor(turn)?.approve(
                          approval,
                          planApprovalDigests(planState.plan),
                          pendingImageCount(pendingAttachments),
                        )}
                        onCancel={() => {
                          setAnswering(null);
                          void planRunnerFor(turn)?.stop();
                        }}
                        onStop={() => {
                          setAnswering(null);
                          void planRunnerFor(turn)?.stop();
                        }}
                        onContinue={() => void planRunnerFor(turn)?.resume()}
                        onSkip={(stepId) => void planRunnerFor(turn)?.skipStep(stepId)}
                        onRetry={(stepId) => void planRunnerFor(turn)?.retry(stepId)}
                        onRetryPhotos={() => void planRunnerFor(turn)?.retryPhotoUploads()}
                        onAnswer={(stepId, value) => void planRunnerFor(turn)?.answer(stepId, value)}
                        onTypeAnswer={(stepId, question) => {
                          setAnswering({ planId: planState.planId, stepId, text: question.text });
                          composerRef.current?.focus({ preventScroll: true });
                        }}
                      />
                    )}
                    {answer?.action_code === "set_tour_cover" && (answer.client_action || turn.actionStatus) && (
                      <div className="mt-4 overflow-hidden floating-panel-shape border border-border/65 bg-card shadow-control">
                        <div className="px-3.5 py-3">
                          <p className="text-xs font-semibold text-foreground">{t("reai.tourCoverTitle", lang)}</p>
                          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                            {t("reai.tourCoverDescription", lang)}
                          </p>
                        </div>
                        {answer.client_action && (!turn.actionStatus || turn.actionStatus === "failed") && (
                          <div className="flex items-center gap-2 border-t border-border/45 px-3.5 py-3">
                            <Button
                              type="button"
                              size="sm"
                              className="flex-1 rounded-2xl sm:flex-none"
                              loading={busy && pendingViewerActionTurnId === turn.id}
                              disabled={busy && pendingViewerActionTurnId !== turn.id}
                              onClick={() => void confirmViewerAction(turn.id, answer)}
                            >
                              {t(turn.actionStatus === "failed" ? "reai.tourCoverRetry" : "reai.tourCoverConfirm", lang)}
                            </Button>
                            <Button type="button" variant="ghost" size="sm" className="rounded-2xl" disabled={busy} onClick={() => dismissViewerAction(turn.id)}>
                              {t("reai.dismissProposal", lang)}
                            </Button>
                          </div>
                        )}
                        {turn.actionStatus && turn.actionStatus !== "failed" && (
                          <div className="border-t border-border/45 px-3.5 py-3">
                            <AgentStatusBadge tone={
                              turn.actionStatus === "applied"
                                ? "success"
                                : turn.actionStatus === "pending" ? "pending" : "neutral"
                            }>
                              {t(
                                turn.actionStatus === "applied"
                                  ? "reai.tourCoverSaved"
                                  : turn.actionStatus === "pending"
                                    ? "reai.tourCoverSaving"
                                    : "reai.proposalDismissed",
                                lang,
                              )}
                            </AgentStatusBadge>
                          </div>
                        )}
                        {turn.actionStatus === "failed" && (
                          <div className="border-t border-border/45 px-3.5 py-3">
                            <AgentStatusBadge tone="neutral">{t("reai.tourCoverFailed", lang)}</AgentStatusBadge>
                          </div>
                        )}
                      </div>
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
                      <div className="mt-4 overflow-hidden floating-panel-shape border border-border/65 bg-card shadow-control">
                        <div className="border-b border-border/45 px-3.5 py-3">
                          <p className="text-xs font-semibold text-foreground">{t(turn.directEdit ? "reai.directEdit.title" : "reai.proposal", lang)}</p>
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
                        {answer.proposal_token && !turn.directEdit && (
                          <div className="flex items-center gap-2 border-t border-border/45 px-3.5 py-3">
                            <Button type="button" size="xs" className="rounded-2xl" loading={busy} onClick={() => apply(turn.id, answer)}>
                              {t("reai.apply", lang)}
                            </Button>
                            <Button type="button" variant="ghost" size="xs" className="rounded-2xl" disabled={busy} onClick={() => dismissProposal(turn.id)}>
                              {t("reai.dismissProposal", lang)}
                            </Button>
                          </div>
                        )}
                        {turn.proposalStatus && (!answer.proposal_token || turn.directEdit) && (
                          <div className="flex flex-wrap items-center gap-2 border-t border-border/45 px-3.5 py-3">
                            <AgentStatusBadge tone={turn.proposalStatus === "applied" ? "success" : turn.proposalStatus === "pending" ? "pending" : "neutral"}>
                              {t(turn.proposalStatus === "pending" ? "common.saving"
                                : turn.proposalStatus === "undone" ? "reai.directEdit.undone"
                                : turn.proposalStatus === "failed" ? "reai.directEdit.unconfirmed"
                                : turn.proposalStatus === "applied" ? "reai.proposalApplied" : "reai.proposalDismissed", lang)}
                            </AgentStatusBadge>
                            {turn.undo && turn.undo.draftId === draftId && <Button type="button" variant="ghost" size="xs" className="rounded-2xl" disabled={busy || uploading || intakeBusy} onClick={() => void undoProposal(turn)}>{t("common.undo", lang)}</Button>}
                            {turn.directEdit && turn.proposalStatus === "failed" && answer.direct_edit_draft_id && <Link href={`/draft/${answer.direct_edit_draft_id}`} className="text-xs underline">{t("reai.job.viewResult", lang)}</Link>}
                          </div>
                        )}
                      </div>
                    )}
                    {answer?.action_code === "translate_description" && answer.translation_action && (
                      <div className="mt-4 overflow-hidden floating-panel-shape border border-border/65 bg-card shadow-control">
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
                            <div className="mt-3 rounded-xl border border-border/40 bg-background px-3 py-2.5">
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
                        {!turn.job && !answer.action_token && (turn.actionStatus || answer.translation_action.status !== "awaiting_confirmation") && (
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
                      <div className="mt-4 overflow-hidden floating-panel-shape border border-border/65 bg-card shadow-control">
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
                        {!turn.job && !answer.action_token && turn.actionStatus && (
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
                    {answer?.action_code === "create_listing" && (answer.action_token || turn.actionStatus) && (
                      <div className="mt-4 overflow-hidden floating-panel-shape border border-border/65 bg-card shadow-control">
                        <div className="px-3.5 py-3">
                          <p className="text-xs font-semibold text-foreground">
                            {answer.listing_draft?.title || t("reai.createListingTitle", lang)}
                          </p>
                          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                            {pendingAttachments.length
                              ? t("reai.attachments.createWithFiles", lang).replace("{count}", String(pendingAttachments.length))
                              : t("reai.createListingBody", lang)}
                          </p>
                        </div>
                        {answer.action_token && (
                          <div className="flex items-center gap-2 border-t border-border/45 px-3.5 py-3">
                            <Button type="button" size="sm" className="flex-1 rounded-2xl sm:flex-none" loading={busy} onClick={() => void applyAction(turn.id, answer)}>
                              {t("reai.createListingConfirm", lang)}
                            </Button>
                            <Button type="button" variant="ghost" size="sm" className="rounded-2xl" disabled={busy} onClick={() => dismissAction(turn.id)}>
                              {t("reai.dismissProposal", lang)}
                            </Button>
                          </div>
                        )}
                        {turn.actionStatus && !turn.job && (
                          <div className="border-t border-border/45 px-3.5 py-3">
                            <AgentStatusBadge tone={turn.actionStatus === "applied" ? "success" : "neutral"}>
                              {t(turn.actionStatus === "applied" ? "reai.createListingDone" : "reai.proposalDismissed", lang)}
                            </AgentStatusBadge>
                          </div>
                        )}
                      </div>
                    )}
                    {answer?.action_code === "generate_description" && (answer.action_token || turn.actionStatus) && (
                      <div className="mt-4 overflow-hidden floating-panel-shape border border-border/65 bg-card shadow-control">
                        <div className="px-3.5 py-3">
                          <p className="text-xs font-semibold text-foreground">
                            {t("reai.describeGenerateTitle", lang)}
                          </p>
                          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                            {t(
                              answer.description_generation?.has_existing_description
                                ? "reai.describeGenerateReplaces"
                                : "reai.describeGenerateFirst",
                              lang,
                            )}
                          </p>
                        </div>
                        {answer.action_token && (
                          <div className="flex items-center gap-2 border-t border-border/45 px-3.5 py-3">
                            <Button type="button" size="sm" className="flex-1 rounded-2xl sm:flex-none" loading={busy} onClick={() => void applyAction(turn.id, answer)}>
                              {t("reai.describeGenerateConfirm", lang)}
                            </Button>
                            <Button type="button" variant="ghost" size="sm" className="rounded-2xl" disabled={busy} onClick={() => dismissAction(turn.id)}>
                              {t("reai.dismissProposal", lang)}
                            </Button>
                          </div>
                        )}
                        {turn.actionStatus && !turn.job && (
                          <div className="border-t border-border/45 px-3.5 py-3">
                            <AgentStatusBadge tone={turn.actionStatus === "applied" ? "pending" : "neutral"}>
                              {t(
                                turn.actionStatus === "applied"
                                  ? "reai.describeGenerateQueued"
                                  : "reai.proposalDismissed",
                                lang,
                              )}
                            </AgentStatusBadge>
                          </div>
                        )}
                      </div>
                    )}
                    {(answer?.action_code === "revoke_all_shares" || answer?.action_code === "manage_shares") && (answer.action_token || turn.actionStatus) && (
                      <div className="mt-4 overflow-hidden floating-panel-shape border border-border/65 bg-card shadow-control">
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
                      <div className="mt-3 divide-y divide-border/40 overflow-hidden floating-panel-shape border border-border/65 bg-card shadow-control">
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
                      <div className="mt-3 floating-panel-shape border border-border/65 bg-card shadow-control px-3 py-2.5">
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
                      <div className="mt-3 floating-panel-shape border border-border/65 bg-card shadow-control px-3 py-2.5">
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-foreground">{t("reai.shareCreateTitle", lang)}</p>
                          <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
                            {shareUrl ? t("reai.shareCreateReady", lang) : t("reai.shareCreateBody", lang)}
                          </p>
                          {!!answer.selected_share_fields?.length && (
                            /* Wraps to two lines rather than truncating the field list to a fragment. */
                            <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-foreground/55">
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
                        {/*
                          The link gets its own line. Sharing the URL beside two
                          actions on one row left it truncated to almost nothing
                          on a phone, and the two actions were a filled pill next
                          to bare text — peers rendered as different things. This
                          matches the sharing panel: copy leads, open follows.
                        */}
                        {shareUrl && (
                          <div className="mt-2.5 border-t border-border/40 pt-2.5">
                            <p className="select-all break-all text-[11px] leading-relaxed text-foreground/65">{shareUrl}</p>
                            <div className="mt-2.5 flex gap-2">
                              <Button type="button" size="sm" className="flex-1 rounded-2xl" onClick={() => void copyShareUrl(shareUrl)}>
                                {t(copiedShareUrl === shareUrl ? "reai.shareCopied" : "reai.shareCopy", lang)}
                              </Button>
                              <Button asChild variant="outline" size="sm" className="flex-1 rounded-2xl">
                                <a href={shareUrl} target="_blank" rel="noreferrer">
                                  {t("reai.shareOpen", lang)}
                                </a>
                              </Button>
                            </div>
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
                          onClick={() => void sendFeedback(
                            turn.id, true, answer.improvement_conversation_id, answer.improvement_message_id,
                          )}
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
                          onClick={() => openFeedbackReasons(turn.id)}
                          className={cn(
                            "flex h-7 w-7 items-center justify-center rounded-2xl transition-colors hover:bg-foreground/[0.04] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none",
                            turn.feedback === false ? "text-foreground" : "disabled:opacity-40",
                          )}
                        >
                          <CloseIcon size={12} />
                        </button>
                        {turn.feedback !== undefined && (
                          <span className="ml-1">{t("reai.feedbackThanks", lang)}</span>
                        )}
                      </div>
                    )}
                    {answer && turn.feedbackReasonOpen && turn.feedback === undefined && (
                      <div className="mt-2 rounded-2xl bg-foreground/[0.03] p-2 text-[11px]">
                        <div className="mb-1 px-1 text-muted-foreground">
                          {t("reai.feedbackReasonPrompt", lang)}
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {REAI_FEEDBACK_REASONS.map((reason) => (
                            <button
                              key={reason}
                              type="button"
                              disabled={busy}
                              onClick={() => void sendFeedback(
                                turn.id,
                                false,
                                answer.improvement_conversation_id,
                                answer.improvement_message_id,
                                reason,
                              )}
                              className="min-h-9 rounded-2xl bg-foreground/[0.04] px-2 py-1 transition-colors hover:bg-foreground/[0.08] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40"
                            >
                              {t(`reai.feedbackReason.${reason}` as never, lang)}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              {sourceImportProgress ? (
                <div role="status" aria-live="polite" className="rounded-2xl border border-border/60 bg-card px-3.5 py-3 text-xs">
                  <p className="font-medium">{t("reai.import.progressTitle", lang)}</p>
                  <p className="mt-1 flex items-center gap-2 text-muted-foreground"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" aria-hidden="true" />{sourceImportProgress.progress ? t(`reai.import.stage.${sourceImportProgress.progress.stage}` as LocaleKey, lang) : t("reai.working", lang)}</p>
                  <p className="mt-2 text-[11px] text-muted-foreground">{t("reai.import.progressHint", lang)}</p>
                </div>
              ) : busy && <PendingAnswer lang={lang} />}
            </div>
          )}
          {!showHistory && !showMediaHistory && turns.length === 0 && !sourceImportProgress && (
            <div className={cn(
              "flex flex-col",
              panel ? "min-h-0 flex-1 items-center justify-center px-6 pb-8 text-center" : "py-2",
            )}>
              {panel ? (
                <span
                  aria-hidden="true"
                  className="mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-border/65 bg-card text-foreground shadow-control"
                >
                  <AgentIcon size={22} strokeWidth={1.7} />
                </span>
              ) : null}
              <p className={cn("text-[14px] leading-relaxed text-foreground/70", panel && "max-w-[300px] text-[13px]")}>
                {t(workspaceContext === "settings" ? "reai.startSettingsConversation" : (draftId ? "reai.startDraftConversation" : "reai.startConversation"), lang)}
              </p>
            </div>
          )}
          {error && <p role="alert" className="rounded-2xl border border-destructive/20 bg-destructive/[0.045] px-3 py-2.5 text-[12px] text-destructive">{error}</p>}
          {!showHistory && !showMediaHistory && turns.length === 0 && !sourceImportProgress && (!panel || (!composerFocused && !message.trim())) && (
            <div className={cn(
              "flex gap-2",
              compactPanel
                ? "overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                : "flex-wrap justify-center",
            )}>
              {quickActions.map((key, index) => {
                const Icon = ACTION_ICON[key] ?? SparklesIcon;
                return (
                  <button
                    key={key}
                    type="button"
                    disabled={busy}
                    onClick={() => void ask(t(key, lang))}
                    className={cn(
                      "group inline-flex shrink-0 items-center gap-1.5 rounded-2xl border border-transparent bg-foreground/[0.04] px-3 text-[12px] font-medium text-foreground/75 transition-colors hover:bg-foreground/[0.06] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
                      "h-11",
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
          {!showHistory && !showMediaHistory && (attachmentNotice || intakeBusy) && (
            <p role="status" className="px-2 text-xs text-muted-foreground">{intakeBusy ? t("reai.attachments.reading", lang) : attachmentNotice}</p>
          )}
          {!showHistory && !showMediaHistory && draftId && (
            <div className="text-xs">
              <Button type="button" variant="ghost" size="xs" disabled={busy || uploading || intakeBusy} onClick={() => void loadSavedEvidence()}>{t("reai.import.savedEvidence", lang)}</Button>
              {savedEvidence?.draftId === draftId && (
                <div className="mt-1 max-h-40 overflow-y-auto rounded-2xl border border-border/60 bg-card p-2">
                  <p className="px-1 py-1 text-muted-foreground">{t("reai.import.savedEvidenceHint", lang)}</p>
                  {savedEvidence.files.length === 0 && <p className="px-1 py-1 text-muted-foreground">{t("reai.import.noSavedEvidence", lang)}</p>}
                  {savedEvidence.files.map((file) => <button key={file.id} type="button" disabled={busy || uploading || intakeBusy} onClick={() => void reviewSavedEvidence(file)} className="block w-full truncate rounded-xl px-2 py-2 text-left hover:bg-foreground/[0.04] disabled:opacity-40">{file.original_file_name || file.file_name}</button>)}
                </div>
              )}
            </div>
          )}
          {!showHistory && !showMediaHistory && sourceImportRetry && sourceImportRetry.options.currentDraftId === draftId && (
            <div className="rounded-2xl border border-border/60 bg-card p-3 text-xs">
              <p className="text-muted-foreground">{t("reai.import.retryHint", lang)}</p>
              <Button type="button" variant="ghost" size="xs" className="mt-1" disabled={busy || uploading || intakeBusy} onClick={() => void retrySourceImport()}>{t("reai.import.retry", lang)}</Button>
            </div>
          )}
          {!showHistory && !showMediaHistory && sourceImportFollowUp?.options.currentDraftId === draftId && sourceImportFollowUp && (
            <div className="flex items-center gap-2 rounded-2xl border border-border/60 px-3 py-2 text-xs">
              <span className="flex-1 text-muted-foreground">{t("reai.import.nextSourceQuestion", lang)}</span>
              <button type="button" aria-label={t("reai.pool.remove", lang)} disabled={busy || intakeBusy} onClick={() => setSourceImportFollowUp(null)}><CloseIcon size={12} /></button>
            </div>
          )}
          {!showHistory && !showMediaHistory && sourceImages.some((image) => image.draftId === draftId) && (
            <details className="rounded-2xl border border-border/60 bg-card p-3 text-xs">
              <summary className="cursor-pointer font-medium">{t("reai.import.images", lang)}</summary>
              <p className="mt-2 text-muted-foreground">{t(draftId ? "reai.import.imagesExistingHint" : "reai.import.imagesHint", lang)}</p>
              <div className="mt-3 grid max-h-72 grid-cols-2 gap-2 overflow-y-auto">
                {sourceImages.filter((image) => image.draftId === draftId).map((image) => (
                  <button key={image.key} type="button" aria-pressed={Boolean(image.selectedFile)} disabled={image.uploaded || busy || uploading || intakeBusy} onClick={() => void toggleSourceImage(image)} className={cn("overflow-hidden rounded-xl border p-1 text-left disabled:opacity-60", image.selectedFile ? "border-foreground ring-1 ring-foreground" : "border-border")}>
                    <Image src={image.candidate.preview_data_url} alt={`${image.source.name} · ${t("reai.import.page", lang).replace("{page}", String(image.candidate.page))}`} width={image.candidate.width} height={image.candidate.height} unoptimized className="h-24 w-full rounded-lg object-contain" />
                    <span className="mt-1 block truncate px-1">{image.source.name}</span>
                    <span className="block px-1 text-muted-foreground">{t("reai.import.page", lang).replace("{page}", String(image.candidate.page))}{image.uploaded ? ` · ${t("common.saved", lang)}` : image.selectedFile ? ` · ${t("reai.import.selected", lang)}` : ""}</span>
                  </button>
                ))}
              </div>
              {draftId && sourceImages.some((image) => image.draftId === draftId && image.selectedFile && !image.uploaded) && (
                <Button type="button" size="xs" className="mt-2" disabled={busy || uploading || intakeBusy} onClick={() => void uploadAttachments(draftId, sourceImages.flatMap((image) => image.draftId === draftId && image.selectedFile && !image.uploaded ? [image.selectedFile] : []))}>{t("reai.import.addImages", lang)}</Button>
              )}
            </details>
          )}
          {!showHistory && !showMediaHistory && <AgentComposer
            lang={lang}
            value={message}
            onChange={setMessage}
            onSend={() => void ask()}
            onFiles={(files) => void handleDroppedFiles(files)}
            textareaRef={composerRef}
            onFocusChange={setComposerFocused}
            placeholder={t(workspaceContext === "settings" ? "reai.settingsPlaceholder" : (draftId ? "reai.draftPlaceholder" : "reai.placeholder"), lang)}
            canAttach={Boolean(draftId) || workspaceContext === "creator"}
            busy={busy || uploading || intakeBusy || Boolean(sourceImportProgress)}
            busyLabel={t(intakeBusy ? "reai.attachments.reading" : uploading ? "reai.pool.uploading" : "reai.working", lang)}
            hasContext={Boolean(pendingAttachments.length || requestPool.length || uploading || answering)}
          >
          {pendingAttachments.length > 0 && (
            <div className="space-y-1">
              {pendingAttachments.map((file, index) => {
                const kind = describeAgentAttachment(file)?.kind;
                const Icon = kind === "image" ? ImageIcon : kind === "video" ? VideoIcon : DocumentIcon;
                const readState = documentReadStates.get(file);
                return (
                <div key={`${file.name}-${index}`} className="flex min-w-0 items-center gap-2 rounded-[20px] bg-foreground/[0.035] py-1 pl-3 pr-1">
                  <Icon size={18} className="shrink-0 text-foreground/55" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] font-medium text-foreground/85" title={file.name}>{file.name}</p>
                    <p className="flex items-center gap-1 text-[11px] text-muted-foreground" title={readState?.status === "evidence_only" ? t(`reai.attachments.read.${readState.reason}`, lang) : undefined}>
                      {kind === "document" ? <><LockIcon size={11} className="shrink-0" aria-hidden="true" />{t("reai.attachments.privateEvidence", lang)}</> : file.name.split(".").pop()?.toUpperCase()}
                      {readState?.status === "evidence_only" ? ` · ${t("reai.attachments.unread", lang)}` : ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={uploading || intakeBusy || busy}
                    aria-label={`${t("reai.pool.remove", lang)} — ${file.name}`}
                    onClick={() => {
                      sourceTokensRef.current.delete(file);
                      documentReadStatesRef.current.delete(file);
                      setDocumentReadStates(new Map(documentReadStatesRef.current));
                      sourceArchiveRef.current.delete(file);
                      setSourceImages((current) => current.filter((image) => image.source !== file).map((image) => image.selectedFile === file ? { ...image, selectedFile: undefined } : image));
                      pendingAttachmentsRef.current = pendingAttachmentsRef.current.filter((entry) => entry !== file);
                      setPendingAttachments(pendingAttachmentsRef.current);
                    }}
                    className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[20px] text-foreground/50 transition-colors hover:bg-foreground/[0.06] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
                  ><CloseIcon size={15} aria-hidden="true" /></button>
                </div>
              ); })}
              {attachmentDraftId && (
                <button type="button" disabled={uploading || intakeBusy || busy} className="min-h-11 px-3 text-xs underline disabled:opacity-40" onClick={() => void uploadAttachments(attachmentDraftId, [...pendingAttachmentsRef.current])}>
                  {t("reai.attachments.retry", lang).replace("{id}", String(attachmentDraftId))}
                </button>
              )}
            </div>
          )}
          {(requestPool.length > 0 || uploading) && (
            <div className="space-y-1">
              {requestPool.map((item) => {
                const key = poolItemKey(item);
                return (
                  <div
                    key={key}
                    className="flex min-w-0 items-center gap-2 rounded-[20px] bg-foreground/[0.035] py-1 pl-3 pr-1 text-[12px]"
                  >
                    {item.kind === "image" ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={item.url} alt="" className="h-8 w-8 shrink-0 rounded-lg object-cover" />
                    ) : item.kind === "field" ? (
                      <span className="max-w-[5rem] shrink-0 truncate rounded-lg bg-foreground/[0.04] px-1.5 py-1 font-medium text-foreground/70" title={item.value || undefined}>
                        {item.value || "—"}
                      </span>
                    ) : item.kind === "video" ? <VideoIcon size={18} className="shrink-0 text-foreground/55" aria-hidden="true" /> : <DocumentIcon size={18} className="shrink-0 text-foreground/55" aria-hidden="true" />}
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-foreground/85" title={item.label}>{item.label}</p>
                      {item.kind === "document" && <p className="flex items-center gap-1 text-[11px] text-muted-foreground"><LockIcon size={11} className="shrink-0" aria-hidden="true" />{t("reai.attachments.privateEvidence", lang)}</p>}
                    </div>
                    <button
                      type="button"
                      disabled={busy || uploading || intakeBusy}
                      aria-label={`${t("reai.pool.remove", lang)} — ${item.label}`}
                      onClick={() => {
                        if (currentField && poolItemKey(currentField) === key) onFieldClear?.();
                        setPool((current) => removePoolItem(current, key));
                      }}
                      className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[20px] text-foreground/50 transition-colors hover:bg-foreground/[0.06] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
                    >
                      <CloseIcon size={15} aria-hidden="true" />
                    </button>
                  </div>
                );
              })}
              {uploading && (
                <span className="px-1.5 text-[11px] text-muted-foreground">{t("reai.pool.uploading", lang)}</span>
              )}
              {requestPool.length > 0 && (
                <button
                  type="button"
                  disabled={busy || uploading || intakeBusy}
                  onClick={() => { setPool([]); onFieldClear?.(); }}
                  className="min-h-11 rounded-[20px] px-3 text-[12px] text-foreground/60 transition-colors hover:bg-foreground/[0.04] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
                >
                  {t("reai.pool.clear", lang)}
                </button>
              )}
            </div>
          )}
          {answering && (
            <div className="flex items-start gap-2 rounded-[20px] bg-foreground/[0.035] py-1 pl-3 pr-1" role="status">
              <p className="min-w-0 flex-1 py-2 text-[12px] leading-5 text-foreground/80">
                <span className="font-medium text-foreground">{t("reai.plan.answering", lang)}</span>{" "}
                {answering.text}
              </p>
              <button
                type="button"
                aria-label={t("reai.plan.answeringClose", lang)}
                onClick={() => setAnswering(null)}
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[20px] text-foreground/50 transition-colors hover:bg-foreground/[0.06] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <CloseIcon size={15} aria-hidden="true" />
              </button>
            </div>
          )}
          </AgentComposer>}
        </div>
      )}
    </section>
  );
}

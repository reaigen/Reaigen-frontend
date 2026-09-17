import type {
  ReaiAgentPlan,
  ReaiAgentPlanAdvanceBody,
  ReaiAgentPlanAdvanceResponse,
  ReaiAgentPlanAnswer,
  ReaiAgentPlanNext,
  ReaiAgentPlanQuestion,
  ReaiAgentPlanSummary,
  ReaiAgentResponse,
} from "./api/client";

/**
 * Runs an approved Agent action plan, one server-minted step at a time.
 *
 * The runner decides nothing about *what* runs. Every step, its parameters and
 * whether it needs its own tap come from `POST workspace/plans/advance/`, which
 * re-checks consent, tool permission, ownership and quota on each call and
 * mints the step's ordinary action token just in time. The runner only
 * sequences: apply the token through the same endpoint a tapped card uses,
 * upload the photos that exist only in this browser, wait for a queued job,
 * then ask the server what comes next.
 *
 * Deliberately conservative:
 * - Nothing runs on construction or restore. A plan found in the parked
 *   transcript comes back paused and waits for Continue.
 * - Only one request is in flight at a time, and a failed apply is never
 *   repeated automatically. Each step is idempotent on the server, so Continue
 *   after a network error is safe — but it is the creator's tap, not a loop.
 * - Sharing and media actions are never executed on the server's say-so, even
 *   if a response claims `execute`; they always come back as a confirm card.
 * - The draft id is only ever taken from the server's plan state, never from the
 *   page the panel happens to be on.
 *
 * No React here: the card injects the API calls, the uploader and the UI
 * callbacks, which keeps the sequencing testable with plain node.
 */

export type AgentPlanPhase =
  /** The plan is on screen and nothing has run. */
  | "awaiting_approval"
  /** A request (advance or apply) is in flight. */
  | "working"
  /** Photos from this window are being uploaded to the new listing. */
  | "uploading"
  /** A queued job (description, translation) is being watched. */
  | "waiting"
  /** A step needs its own tap on its confirm card. */
  | "confirming"
  /** The server, or the photo step, needs an answer. */
  | "asking"
  /** A step cannot run (permission, ownership, quota) until the creator chooses. */
  | "blocked"
  /** Interrupted (network, throttle, slow job, reload). Continue recomputes from the server. */
  | "paused"
  /** Stopped for good: allowance, credits, a switched-off tool, or an expired plan. */
  | "failed"
  | "done"
  | "cancelled";

export type AgentPlanNoticeKind =
  | "throttled"
  | "network"
  | "server"
  | "wait_timeout"
  | "photos_failed"
  | "photos_missing"
  | "plan_changed"
  | "expired"
  | "quota"
  | "credits"
  | "tool_unavailable"
  | "forbidden"
  | "error"
  | "restored";

export interface AgentPlanNotice {
  kind: AgentPlanNoticeKind;
  /** A creator-safe message from the server, when there is one. */
  detail?: string | null;
  retryAfterSeconds?: number | null;
  count?: number | null;
  stepId?: string | null;
}

/** Everything the card needs to render the plan and to resume it after a reload. */
export interface AgentPlanSnapshot {
  turnId: number;
  planId: string;
  plan: ReaiAgentPlan;
  planToken: string;
  phase: AgentPlanPhase;
  reply: string | null;
  /** Bound by the server once the listing exists (or the open listing's id). */
  draftId: number | null;
  /** The last decision the server returned. */
  next: ReaiAgentPlanNext | null;
  /** The step the current phase is about. */
  stepId: string | null;
  question: ReaiAgentPlanQuestion | null;
  notice: AgentPlanNotice | null;
  /** Photos already uploaded for the attach step, kept across a partial failure. */
  uploadedUploadIds: number[];
  /** A client result not yet reported to the server (after a partial upload). */
  pendingClientResult: { step_id: string; uploaded_upload_ids: number[]; failed_count: number } | null;
  /** The listing this plan already opened, so a restore never navigates twice. */
  navigatedDraftId: number | null;
  summary: ReaiAgentPlanSummary | null;
  updatedAt: number;
}

export interface AgentPlanClock {
  now(): number;
  /** Resolves after `ms`, or as soon as `signal` aborts. Never rejects. */
  sleep(ms: number, signal: AbortSignal): Promise<void>;
}

export interface AgentPlanUploadResult {
  uploadedUploadIds: number[];
  failedCount: number;
  /** 0 when the files are gone (reload, new tab): the step turns into a question. */
  attemptedCount: number;
}

export interface AgentPlanRunnerDeps<TResult = unknown> {
  advance(planToken: string, body: ReaiAgentPlanAdvanceBody): Promise<ReaiAgentPlanAdvanceResponse>;
  /** Applies one minted action token through its ordinary apply endpoint. */
  execute(actionCode: string, actionToken: string): Promise<TResult>;
  uploadPhotos(draftId: number, expectedCount: number, startIndex: number): Promise<AgentPlanUploadResult>;
  getService(serviceId: number): Promise<{ status: string; error_message?: string | null }>;
  onSnapshot(snapshot: AgentPlanSnapshot): void;
  onConfirm(stepId: string, stepResponse: ReaiAgentResponse, snapshot: AgentPlanSnapshot): void;
  onAsk(stepId: string | null, question: ReaiAgentPlanQuestion, snapshot: AgentPlanSnapshot): void;
  onNavigate(draftId: number, snapshot: AgentPlanSnapshot): void;
  /** Parks the transcript synchronously; called before any navigation. */
  writeTranscript(snapshot: AgentPlanSnapshot): void;
  /** A step changed the listing's content (upload, finished job, done). */
  onDraftChanged?(draftIds: number[]): void;
  onDone?(summary: ReaiAgentPlanSummary | null, snapshot: AgentPlanSnapshot): void;
  pendingPhotoCount?(): number;
  conversationId?(): string | null;
  /** Creator-safe text for an error, or null to show only the localized notice. */
  describeError?(error: unknown): string | null;
  clock?: AgentPlanClock;
}

/** Only these actions may run under a plan-level approval. */
const AUTO_EXECUTABLE_ACTION_CODES: Record<string, string> = {
  create_listing: "create_listing",
  generate_description: "generate_description",
  translate_description: "translate_description",
};

const TERMINAL_SERVICE_STATUSES = new Set(["completed", "failed", "timeout", "error", "cancelled"]);
const DEFAULT_SERVICE_BUDGET_MS: Record<string, number> = {
  // The draft editor polls a description for 240 × 1.5 s; allow half as much again.
  text_description: 360_000,
  text_translation: 240_000,
};
const FALLBACK_BUDGET_MS = 360_000;
const FAST_POLL_MS = 2_000;
const SLOW_POLL_MS = 5_000;
const FAST_POLL_WINDOW_MS = 30_000;
/** A server that keeps answering without progress must not spin the client. */
const MAX_HOPS_PER_RUN = 40;

const ACTIVE_PHASES = new Set<AgentPlanPhase>(["working", "uploading", "waiting"]);
const TERMINAL_PHASES = new Set<AgentPlanPhase>(["done", "cancelled", "failed"]);

export const systemPlanClock: AgentPlanClock = {
  now: () => Date.now(),
  sleep: (ms, signal) => new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, Math.max(0, ms));
    signal.addEventListener("abort", finish, { once: true });
  }),
};

export function isTerminalPlanPhase(phase: AgentPlanPhase): boolean {
  return TERMINAL_PHASES.has(phase);
}

/** Phases in which the plan is still live and could still act or be stopped. */
export function isLivePlanPhase(phase: AgentPlanPhase): boolean {
  return !TERMINAL_PHASES.has(phase);
}

type PlanErrorKind =
  | "network"
  | "server"
  | "throttled"
  | "credits"
  | "tool_unavailable"
  | "expired_token"
  | "quota"
  | "forbidden"
  | "plan_changed"
  | "conflict"
  | "client";

export interface PlanErrorInfo {
  kind: PlanErrorKind;
  status: number | null;
  detail: string | null;
  code: string | null;
  body: Record<string, unknown> | null;
  retryAfterSeconds: number | null;
}

function parseBody(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

/**
 * Reads an `ApiError` by shape (status + body) so this module stays free of
 * runtime imports. Anything without an HTTP status is a transport failure.
 */
export function classifyPlanError(error: unknown): PlanErrorInfo {
  const candidate = error as { status?: unknown; body?: unknown } | null;
  const status = candidate && typeof candidate === "object" && typeof candidate.status === "number"
    ? candidate.status
    : null;
  const body = status === null ? null : parseBody(candidate?.body);
  const detail = typeof body?.detail === "string" ? body.detail : null;
  const code = typeof body?.code === "string" ? body.code.trim().toLowerCase() : null;
  const info = (kind: PlanErrorKind, retryAfterSeconds: number | null = null): PlanErrorInfo => ({
    kind, status, detail, code, body, retryAfterSeconds,
  });
  if (status === null) return info("network");
  if (status === 429) {
    const seconds = detail ? Number(detail.match(/(\d+)/)?.[1]) : NaN;
    return info("throttled", Number.isFinite(seconds) && seconds > 0 ? seconds : null);
  }
  if (status >= 500) return info("server");
  if (status === 409 && detail === "plan_changed") return info("plan_changed");
  if (status === 409) return info("conflict");
  if (status === 403) {
    if (code === "insufficient_compute_credits") return info("credits");
    if (code === "tool_unavailable" || /\bagent tool\b/i.test(detail || "")) return info("tool_unavailable");
    if (/invalid or expired/i.test(detail || "")) return info("expired_token");
    if (code === "processing_quota" || (body && "quota" in body)) return info("quota");
    return info("forbidden");
  }
  return info("client");
}

function stepKindOf(plan: ReaiAgentPlan, stepId: string): string | null {
  return plan.steps.find((step) => step.step_id === stepId)?.kind ?? null;
}

export function planApprovalDigests(plan: ReaiAgentPlan): Record<string, string> {
  return Object.fromEntries(plan.steps.map((step) => [step.step_id, step.digest]));
}

/** Up-front questions that must be answered before the plan can be approved. */
export function openPlanQuestions(plan: ReaiAgentPlan, pendingPhotoCount: number) {
  return plan.steps.filter((step) => (
    step.question
    && step.status !== "skipped"
    && step.status !== "skipped_dependency"
    // Dropping photos answers the photo question; the server accepts the count.
    && !(step.question.kind === "photos" && pendingPhotoCount > 0)
  ));
}

function initialPhase(plan: ReaiAgentPlan): AgentPlanPhase {
  switch (plan.status) {
    case "done": return "done";
    case "cancelled": return "cancelled";
    case "blocked": return "blocked";
    case "running":
    case "paused": return "paused";
    default: return "awaiting_approval";
  }
}

export function createPlanSnapshot(
  turnId: number,
  plan: ReaiAgentPlan,
  planToken: string,
  reply: string | null,
  now: number,
): AgentPlanSnapshot {
  return {
    turnId,
    planId: plan.plan_id,
    plan,
    planToken,
    phase: initialPhase(plan),
    reply,
    draftId: typeof plan.draft_id === "number" ? plan.draft_id : null,
    next: null,
    stepId: null,
    question: null,
    notice: null,
    uploadedUploadIds: [],
    pendingClientResult: null,
    navigatedDraftId: null,
    summary: null,
    updatedAt: now,
  };
}

/**
 * A snapshot read back from the parked transcript. Work that was in flight when
 * the page went away is reported as paused: its request may or may not have
 * landed, and only the server can say — after the creator taps Continue.
 */
export function restorePlanSnapshot(snapshot: AgentPlanSnapshot): AgentPlanSnapshot {
  if (!ACTIVE_PHASES.has(snapshot.phase)) return snapshot;
  return { ...snapshot, phase: "paused", notice: { kind: "restored" } };
}

type StepOutcome<TResult> =
  | { kind: "applied"; result: TResult }
  | { kind: "refresh" }
  | { kind: "continue" }
  | { kind: "halted" };

export class AgentPlanRunner<TResult = unknown> {
  private readonly deps: AgentPlanRunnerDeps<TResult>;
  private readonly clock: AgentPlanClock;
  private state: AgentPlanSnapshot | null = null;
  private run = 0;
  private stopped = false;
  private inFlight = false;
  private doneAnnounced = false;
  /** Replaced by every creator action, so a new tap ends a pending poll at once. */
  private sleepAbort = new AbortController();
  /** Steps whose token was already re-minted once after a 403. */
  private readonly refreshed = new Set<string>();
  /** Translation steps already re-gated once after a 409. */
  private readonly regated = new Set<string>();
  private readonly waitStarted = new Map<string, number>();
  private readonly waitDeadlines = new Map<string, number>();

  constructor(deps: AgentPlanRunnerDeps<TResult>) {
    this.deps = deps;
    this.clock = deps.clock ?? systemPlanClock;
  }

  get planId(): string | null {
    return this.state?.planId ?? null;
  }

  get draftId(): number | null {
    return this.state?.draftId ?? null;
  }

  get planToken(): string | null {
    return this.state?.planToken ?? null;
  }

  get busy(): boolean {
    return this.inFlight;
  }

  get snapshot(): AgentPlanSnapshot | null {
    return this.state;
  }

  /** Loads a plan. Never sends a request and never executes anything. */
  start(turnId: number, snapshot: AgentPlanSnapshot): void {
    this.state = restorePlanSnapshot({ ...snapshot, turnId });
    this.emit();
  }

  /** Approve the plan as shown. `digests` binds the approval to what the creator saw. */
  async approve(approval: "all" | "step", digests: Record<string, string>, pendingPhotoCount: number): Promise<void> {
    const state = this.state;
    if (!state || state.plan.approval || !["awaiting_approval", "asking", "blocked"].includes(state.phase)) return;
    const run = this.beginAction();
    if (run === null) return;
    await this.request({
      intent: "approve",
      confirmed: true,
      approval,
      digests,
      client_state: { pending_photo_count: Math.max(0, Math.min(24, pendingPhotoCount)) },
    }, run);
  }

  /**
   * The creator tapped Confirm on a step's own card. Resolves with the apply
   * result as soon as the step itself has run, so the card can show it; the
   * rest of the plan carries on in the background.
   */
  async confirmStep(stepId: string, stepResponse: ReaiAgentResponse): Promise<TResult | null> {
    const state = this.state;
    // Also from a pause on this very step (the first tap hit a network error):
    // tapping the step's own card again is an explicit, idempotent retry.
    if (!state || state.stepId !== stepId || (state.phase !== "confirming" && state.phase !== "paused")) return null;
    if (!stepResponse.action_token || !stepResponse.action_code) return null;
    const run = this.beginAction();
    if (run === null) return null;
    const outcome = await this.executeStep(stepId, stepResponse, run);
    if (outcome.kind === "halted") return null;
    const intent = outcome.kind === "refresh" ? "refresh" : "continue";
    void this.request({ intent }, run);
    return outcome.kind === "applied" ? outcome.result : null;
  }

  async skipStep(stepId: string): Promise<void> {
    const run = this.beginAction();
    if (run === null) return;
    await this.request({ intent: "skip", step_id: stepId }, run);
  }

  async answer(stepId: string | null, answer: ReaiAgentPlanAnswer): Promise<void> {
    const run = this.beginAction();
    if (run === null) return;
    await this.request({
      intent: "answer",
      ...(stepId ? { step_id: stepId } : {}),
      answer,
    }, run);
  }

  /** Run a failed step again. It spends again, so the server makes it step-confirmed. */
  async retry(stepId: string): Promise<void> {
    const run = this.beginAction();
    if (run === null) return;
    await this.request({ intent: "retry", step_id: stepId, confirmed: true }, run);
  }

  /** Continue a paused or restored plan: the server recomputes every step from its records. */
  async resume(): Promise<void> {
    const state = this.state;
    if (!state || isTerminalPlanPhase(state.phase)) return;
    const run = this.beginAction();
    if (run === null) return;
    const clientResult = this.state?.pendingClientResult ?? null;
    await this.request({
      intent: "continue",
      ...(clientResult ? { client_result: clientResult } : {}),
    }, run);
  }

  /** Upload the photos that failed last time, then report everything uploaded. */
  async retryPhotoUploads(): Promise<void> {
    const state = this.state;
    const pending = state?.pendingClientResult;
    if (!state || !pending || state.draftId === null) return;
    const run = this.beginAction();
    if (run === null) return;
    const next = await this.uploadAndReport(pending.step_id, state.draftId, pending.failed_count, run);
    if (next) await this.request(next, run);
  }

  /**
   * Stop the plan: polling ends now and the server is told. Steps that already
   * ran are not rolled back.
   */
  async stop(): Promise<void> {
    const state = this.state;
    this.halt();
    if (!state || isTerminalPlanPhase(state.phase)) return;
    this.update({ phase: "cancelled", notice: null, question: null });
    try {
      const response = await this.deps.advance(state.planToken, {
        intent: "cancel",
        improvement_conversation_id: this.deps.conversationId?.() ?? null,
      });
      if (response?.plan && response.plan_token) {
        this.update({ plan: response.plan, planToken: response.plan_token, reply: response.reply ?? null });
      }
    } catch {
      // Cancelling is best effort: the token already expires on its own, and
      // nothing further runs from this window either way.
    }
  }

  /** The panel went away: stop watching without telling the server anything. */
  dispose(): void {
    this.halt();
  }

  private halt() {
    this.stopped = true;
    this.run += 1;
    this.sleepAbort.abort();
  }

  private beginAction(): number | null {
    if (this.stopped || !this.state || this.inFlight) return null;
    this.run += 1;
    this.sleepAbort.abort();
    this.sleepAbort = new AbortController();
    // Every creator action gives running jobs a fresh waiting budget.
    this.waitStarted.clear();
    this.waitDeadlines.clear();
    return this.run;
  }

  private alive(run: number): boolean {
    return !this.stopped && this.run === run;
  }

  private emit() {
    if (this.state) this.deps.onSnapshot(this.state);
  }

  private update(patch: Partial<AgentPlanSnapshot>) {
    if (!this.state) return;
    this.state = { ...this.state, ...patch, updatedAt: this.clock.now() };
    this.emit();
  }

  private bodyContext(body: ReaiAgentPlanAdvanceBody): ReaiAgentPlanAdvanceBody {
    const count = this.deps.pendingPhotoCount?.();
    return {
      ...body,
      client_state: body.client_state ?? (typeof count === "number" ? { pending_photo_count: Math.max(0, Math.min(24, count)) } : undefined),
      improvement_conversation_id: this.deps.conversationId?.() ?? null,
    };
  }

  /** One advance call, then follow the server's decisions until one needs the creator. */
  private async request(body: ReaiAgentPlanAdvanceBody, run: number): Promise<void> {
    let pending: ReaiAgentPlanAdvanceBody | null = body;
    let hops = 0;
    while (pending && hops < MAX_HOPS_PER_RUN) {
      if (!this.alive(run) || !this.state) return;
      this.update({ phase: "working", notice: null });
      let response: ReaiAgentPlanAdvanceResponse;
      this.inFlight = true;
      try {
        response = await this.deps.advance(this.state.planToken, this.bodyContext(pending));
      } catch (error) {
        this.inFlight = false;
        if (this.alive(run)) this.onAdvanceError(error, pending);
        return;
      }
      this.inFlight = false;
      if (!this.alive(run)) return;
      if (pending.client_result) this.update({ pendingClientResult: null });
      // Waiting is bounded by the job budget, not by the hop count.
      if (response?.next?.mode !== "wait") hops += 1;
      pending = await this.follow(response, run);
    }
    if (pending && this.alive(run)) {
      this.update({ phase: "paused", notice: { kind: "error" } });
    }
  }

  private absorb(response: ReaiAgentPlanAdvanceResponse) {
    const state = this.state;
    if (!state) return;
    const next = response.next;
    const serverDraftId = (next.mode === "client" ? next.client.draft_id : null)
      ?? next.summary?.draft_id
      ?? response.plan.draft_id
      ?? null;
    this.update({
      plan: response.plan,
      planToken: response.plan_token,
      reply: response.reply ?? null,
      next,
      draftId: typeof serverDraftId === "number" && serverDraftId > 0 ? serverDraftId : state.draftId,
      stepId: next.step_id ?? null,
      question: null,
      notice: null,
      summary: next.summary ?? state.summary,
    });
  }

  /** Open the listing a plan just created, once. The transcript is parked first. */
  private maybeNavigate() {
    const state = this.state;
    if (!state || state.plan.target.kind !== "new_listing" || state.draftId === null) return;
    if (state.navigatedDraftId === state.draftId) return;
    this.update({ navigatedDraftId: state.draftId });
    const parked = this.state as AgentPlanSnapshot;
    this.deps.writeTranscript(parked);
    this.deps.onNavigate(parked.draftId as number, parked);
  }

  /**
   * Act on one server decision. Returns the next advance to send, or null when
   * the plan now waits for the creator (or has finished).
   */
  private async follow(response: ReaiAgentPlanAdvanceResponse, run: number): Promise<ReaiAgentPlanAdvanceBody | null> {
    if (!response?.plan || !response.plan_token || !response.next) {
      this.update({ phase: "paused", notice: { kind: "error" } });
      return null;
    }
    this.absorb(response);
    this.maybeNavigate();
    const next = response.next;
    switch (next.mode) {
      case "awaiting_approval":
        this.update({ phase: "awaiting_approval" });
        return null;
      case "ask":
        this.update({ phase: "asking", stepId: next.step_id, question: next.question });
        this.deps.onAsk(next.step_id, next.question, this.state as AgentPlanSnapshot);
        return null;
      case "confirm":
        return this.showConfirm(next.step_id, next.step_response);
      case "blocked":
        this.update({ phase: "blocked" });
        return null;
      case "cancelled":
        this.update({ phase: "cancelled" });
        return null;
      case "done": {
        this.update({ phase: "done" });
        const draftId = this.state?.draftId;
        if (draftId) this.deps.onDraftChanged?.([draftId]);
        if (!this.doneAnnounced) {
          this.doneAnnounced = true;
          this.deps.onDone?.(next.summary ?? null, this.state as AgentPlanSnapshot);
        }
        return null;
      }
      case "execute": {
        const stepResponse = next.step_response;
        const expectedKind = AUTO_EXECUTABLE_ACTION_CODES[stepResponse?.action_code || ""];
        const stepKind = this.state ? stepKindOf(this.state.plan, next.step_id) : null;
        if (!expectedKind || (stepKind !== null && stepKind !== expectedKind) || !stepResponse.action_token) {
          // Publishing a link or editing media always takes the creator's own
          // tap. A server that says otherwise is wrong, so show the card.
          return this.showConfirm(next.step_id, stepResponse);
        }
        const outcome = await this.executeStep(next.step_id, stepResponse, run);
        if (outcome.kind === "halted") return null;
        return { intent: outcome.kind === "refresh" ? "refresh" : "continue" };
      }
      case "client": {
        const { draft_id: draftId, expected_count: expectedCount } = next.client;
        if (!draftId || this.state?.draftId !== draftId) {
          this.update({ phase: "paused", notice: { kind: "error", stepId: next.step_id } });
          return null;
        }
        const alreadyUploaded = this.state?.uploadedUploadIds.length ?? 0;
        return this.uploadAndReport(next.step_id, draftId, Math.max(0, expectedCount - alreadyUploaded), run);
      }
      case "wait": {
        const finished = await this.waitForJobs(next.wait ?? { waiting_on: [], retry_after_ms: FAST_POLL_MS, budget_ms: 0 }, run);
        return finished ? { intent: "continue" } : null;
      }
      default:
        this.update({ phase: "paused", notice: { kind: "error" } });
        return null;
    }
  }

  private showConfirm(stepId: string, stepResponse: ReaiAgentResponse): null {
    this.update({ phase: "confirming", stepId });
    this.deps.onConfirm(stepId, stepResponse, this.state as AgentPlanSnapshot);
    return null;
  }

  private async executeStep(stepId: string, stepResponse: ReaiAgentResponse, run: number): Promise<StepOutcome<TResult>> {
    this.update({ phase: "working", stepId, notice: null });
    this.inFlight = true;
    try {
      const result = await this.deps.execute(stepResponse.action_code as string, stepResponse.action_token as string);
      return { kind: "applied", result };
    } catch (error) {
      if (!this.alive(run)) return { kind: "halted" };
      const info = classifyPlanError(error);
      const isShare = stepResponse.action_code === "create_draft_share";
      const mayRefresh = info.kind === "expired_token"
        || (isShare && info.status === 403 && info.kind !== "credits" && info.kind !== "tool_unavailable");
      if (mayRefresh && !this.refreshed.has(stepId)) {
        // A token that expired while the creator read the card, or a share whose
        // fields changed: re-mint once under the same idempotency key.
        this.refreshed.add(stepId);
        return { kind: "refresh" };
      }
      if (stepResponse.action_code === "translate_description" && info.kind === "conflict" && !this.regated.has(stepId)) {
        // 409: the description is not ready. The server re-gates on its records.
        this.regated.add(stepId);
        return { kind: "continue" };
      }
      this.stopOn(info, error, stepId);
      return { kind: "halted" };
    } finally {
      this.inFlight = false;
    }
  }

  private async uploadAndReport(
    stepId: string,
    draftId: number,
    expectedCount: number,
    run: number,
  ): Promise<ReaiAgentPlanAdvanceBody | null> {
    const previous = this.state?.uploadedUploadIds ?? [];
    this.update({ phase: "uploading", stepId, notice: null });
    let upload: AgentPlanUploadResult;
    this.inFlight = true;
    try {
      upload = await this.deps.uploadPhotos(draftId, expectedCount, previous.length);
    } catch (error) {
      if (this.alive(run)) this.stopOn(classifyPlanError(error), error, stepId);
      return null;
    } finally {
      this.inFlight = false;
    }
    if (!this.alive(run)) return null;
    const uploaded = [...previous, ...upload.uploadedUploadIds];
    if (upload.uploadedUploadIds.length) this.deps.onDraftChanged?.([draftId]);
    const clientResult = { step_id: stepId, uploaded_upload_ids: uploaded, failed_count: upload.failedCount };
    if (upload.attemptedCount === 0 && uploaded.length === 0) {
      // The files lived only in the old page. Ask for them again rather than
      // pretending the step ran.
      const question: ReaiAgentPlanQuestion = { kind: "photos", text: "", options: [], allows_text: false };
      this.update({ phase: "asking", stepId, question, notice: { kind: "photos_missing", stepId } });
      this.deps.onAsk(stepId, question, this.state as AgentPlanSnapshot);
      return null;
    }
    if (upload.failedCount > 0) {
      this.update({
        phase: "paused",
        uploadedUploadIds: uploaded,
        pendingClientResult: clientResult,
        notice: { kind: "photos_failed", count: upload.failedCount, stepId },
      });
      return null;
    }
    this.update({ uploadedUploadIds: uploaded, pendingClientResult: clientResult, notice: null });
    return { intent: "continue", client_result: clientResult };
  }

  private async waitForJobs(
    wait: { waiting_on: Array<{ step_id: string; service_id: number | null; service_name: string }>; retry_after_ms: number; budget_ms: number },
    run: number,
  ): Promise<boolean> {
    this.update({ phase: "waiting" });
    const now = this.clock.now();
    const waitingOn = Array.isArray(wait.waiting_on) ? wait.waiting_on : [];
    for (const item of waitingOn) {
      if (!this.waitStarted.has(item.step_id)) this.waitStarted.set(item.step_id, now);
      if (!this.waitDeadlines.has(item.step_id)) {
        const budget = wait.budget_ms > 0
          ? wait.budget_ms
          : DEFAULT_SERVICE_BUDGET_MS[item.service_name] ?? FALLBACK_BUDGET_MS;
        this.waitDeadlines.set(item.step_id, now + budget);
      }
    }
    const deadlines = waitingOn.map((item) => this.waitDeadlines.get(item.step_id) ?? now + FALLBACK_BUDGET_MS);
    const deadline = deadlines.length ? Math.max(...deadlines) : now + FALLBACK_BUDGET_MS;
    const startedAt = Math.min(...waitingOn.map((item) => this.waitStarted.get(item.step_id) ?? now), now);
    const services = waitingOn.filter((item) => typeof item.service_id === "number" && item.service_id > 0);
    let first = true;
    for (;;) {
      const current = this.clock.now();
      if (current >= deadline) {
        this.update({ phase: "paused", notice: { kind: "wait_timeout" } });
        return false;
      }
      const cadence = current - startedAt < FAST_POLL_WINDOW_MS ? FAST_POLL_MS : SLOW_POLL_MS;
      const delay = first ? Math.max(cadence, wait.retry_after_ms || 0) : cadence;
      first = false;
      await this.clock.sleep(Math.min(delay, Math.max(0, deadline - current)), this.sleepAbort.signal);
      if (!this.alive(run)) return false;
      if (services.length === 0) return true;
      for (const item of services) {
        try {
          const service = await this.deps.getService(item.service_id as number);
          if (!this.alive(run)) return false;
          if (TERMINAL_SERVICE_STATUSES.has(String(service?.status || "").toLowerCase())) {
            const draftId = this.state?.draftId;
            if (draftId) this.deps.onDraftChanged?.([draftId]);
            return true;
          }
        } catch {
          // A failed status read decides nothing; keep watching within the budget.
          if (!this.alive(run)) return false;
        }
      }
    }
  }

  private onAdvanceError(error: unknown, body: ReaiAgentPlanAdvanceBody) {
    const info = classifyPlanError(error);
    if (info.kind === "plan_changed" && info.body) {
      const plan = info.body.plan as ReaiAgentPlan | undefined;
      const token = info.body.plan_token;
      if (plan && typeof token === "string" && token) {
        this.update({ plan, planToken: token, phase: "awaiting_approval", notice: { kind: "plan_changed" } });
        return;
      }
    }
    if (info.kind === "forbidden" || info.kind === "expired_token") {
      // The plan token itself was refused (expired, another account, consent
      // withdrawn). No step can run from it any more.
      this.update({ phase: "failed", notice: { kind: "expired", detail: this.describe(error) } });
      return;
    }
    this.stopOn(info, error, body.step_id ?? this.state?.stepId ?? null);
  }

  private describe(error: unknown): string | null {
    try {
      return this.deps.describeError?.(error) ?? null;
    } catch {
      return null;
    }
  }

  /** Pause on what Continue can fix; fail on what it cannot. */
  private stopOn(info: PlanErrorInfo, error: unknown, stepId: string | null) {
    const detail = this.describe(error);
    switch (info.kind) {
      case "throttled":
        this.update({ phase: "paused", notice: { kind: "throttled", retryAfterSeconds: info.retryAfterSeconds, stepId } });
        return;
      case "network":
        this.update({ phase: "paused", notice: { kind: "network", stepId } });
        return;
      case "server":
        this.update({ phase: "paused", notice: { kind: "server", stepId } });
        return;
      case "credits":
        this.update({ phase: "failed", notice: { kind: "credits", detail, stepId } });
        return;
      case "tool_unavailable":
        this.update({ phase: "failed", notice: { kind: "tool_unavailable", detail, stepId } });
        return;
      case "quota":
        this.update({ phase: "failed", notice: { kind: "quota", detail, stepId } });
        return;
      case "expired_token":
      case "forbidden":
        this.update({ phase: "failed", notice: { kind: "forbidden", detail, stepId } });
        return;
      default:
        this.update({ phase: "paused", notice: { kind: "error", detail, stepId } });
    }
  }
}

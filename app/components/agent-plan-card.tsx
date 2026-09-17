"use client";

import Link from "next/link";
import { useState } from "react";

import type {
  ReaiAgentPlanAnswer,
  ReaiAgentPlanQuestion,
  ReaiAgentPlanStep,
  ReaiAgentPlanStepStatus,
} from "../lib/api/client";
import { openPlanQuestions, type AgentPlanSnapshot } from "../lib/agent-plan-runner";
import { t } from "../lib/i18n";
import type { LocaleKey } from "../lib/locales";
import { Button } from "../lib/ui/button";
import { cn } from "../lib/utils";
import { CheckIcon, CloseIcon, InfoIcon, LockIcon, MinusIcon } from "./icons";

/**
 * The checklist for one Agent action plan.
 *
 * It shows everything the creator is agreeing to before anything runs: each
 * step in the order it will run, the words of theirs it came from, what it
 * spends, and which steps will still stop for their own tap. What was left out
 * — declined in the message, or not something a plan can do — is listed too,
 * so a request is never silently shortened.
 *
 * Labels, questions and notes arrive localized from the server; this component
 * only adds the chrome around them.
 */

type PlanCardProps = {
  snapshot: AgentPlanSnapshot;
  lang: string;
  /** Only the latest plan in the conversation can be acted on. */
  live: boolean;
  pendingPhotoCount: number;
  onApprove: (approval: "all" | "step") => void;
  onCancel: () => void;
  onStop: () => void;
  onContinue: () => void;
  onSkip: (stepId: string) => void;
  onRetry: (stepId: string) => void;
  onRetryPhotos: () => void;
  onAnswer: (stepId: string, answer: ReaiAgentPlanAnswer) => void;
  onTypeAnswer: (stepId: string, question: ReaiAgentPlanQuestion) => void;
};

const RUNNING_PHASES = new Set(["working", "uploading", "waiting"]);

function Spinner() {
  return (
    <svg className="h-3.5 w-3.5 shrink-0 animate-spin motion-reduce:animate-none" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

function StepIcon({ status, active }: { status: ReaiAgentPlanStepStatus; active: boolean }) {
  const frame = "flex h-5 w-5 shrink-0 items-center justify-center rounded-full";
  if (status === "done") {
    return <span className={cn(frame, "bg-foreground text-background")}><CheckIcon size={11} aria-hidden="true" /></span>;
  }
  if (active || status === "running" || status === "waiting_job") {
    return <span className={cn(frame, "border border-foreground/30 text-foreground")}><Spinner /></span>;
  }
  if (status === "failed") {
    return <span className={cn(frame, "bg-destructive/10 text-destructive")}><CloseIcon size={11} aria-hidden="true" /></span>;
  }
  if (status === "blocked") {
    return <span className={cn(frame, "bg-foreground/[0.06] text-muted-foreground")}><LockIcon size={11} aria-hidden="true" /></span>;
  }
  if (status === "skipped" || status === "skipped_dependency") {
    return <span className={cn(frame, "bg-foreground/[0.04] text-muted-foreground")}><MinusIcon size={11} aria-hidden="true" /></span>;
  }
  if (status === "needs_input" || status === "awaiting_confirmation") {
    return <span className={cn(frame, "border border-foreground/40 text-foreground")}><InfoIcon size={11} aria-hidden="true" /></span>;
  }
  return <span className={cn(frame, "border border-border")} aria-hidden="true" />;
}

function languageName(code: string, lang: string): string {
  try {
    return new Intl.DisplayNames([lang || "en"], { type: "language" }).of(code) || code.toUpperCase();
  } catch {
    return code.toUpperCase();
  }
}

/**
 * Status, reason and spend codes come from the server. One this build has no
 * wording for yet falls back to a generic line instead of a raw locale key.
 */
function tKnown(key: string, fallback: LocaleKey, lang: string): string {
  const text = t(key as LocaleKey, lang);
  return text === key ? t(fallback, lang) : text;
}

function fieldLabel(field: string, lang: string): string {
  return t(`shareDialog.field.${field}` as LocaleKey, lang);
}

function answerFor(question: ReaiAgentPlanQuestion, value: string | boolean): ReaiAgentPlanAnswer {
  // The yes/no chips carry booleans straight from the server; everything else
  // is a string the server reads back.
  const text = String(value);
  switch (question.kind) {
    case "target_language": return { target_language: text };
    case "share_fields": return { share_field_names: [text] };
    case "photos": return { photos: text === "skip" ? "skip" : "dropped" };
    case "add_prerequisite": return { add_prerequisite: typeof value === "boolean" ? value : ["yes", "true", "1"].includes(text.toLowerCase()) };
    default: return { text };
  }
}

function noticeText(snapshot: AgentPlanSnapshot, lang: string): string | null {
  const notice = snapshot.notice;
  if (!notice) return null;
  if (notice.kind === "throttled" && notice.retryAfterSeconds) {
    return t("reai.plan.notice.throttledSeconds", lang).replace("{seconds}", String(notice.retryAfterSeconds));
  }
  return tKnown(`reai.plan.notice.${notice.kind}`, "reai.plan.notice.error", lang).replace("{count}", String(notice.count ?? 0));
}

function StepPreview({ step, lang, pendingPhotoCount }: { step: ReaiAgentPlanStep; lang: string; pendingPhotoCount: number }) {
  const preview = step.preview;
  const items: string[] = [];
  if (step.kind === "attach_photos") {
    const count = preview?.photo_count || pendingPhotoCount;
    if (count) items.push(t("reai.plan.preview.photos", lang).replace("{count}", String(count)));
  }
  if (step.kind === "translate_description" && preview?.target_language) {
    items.push(t("reai.plan.preview.target", lang).replace("{language}", languageName(preview.target_language, lang)));
  }
  if (step.kind === "share_listing" && preview) {
    if (preview.fields_source === "default") items.push(t("reai.plan.preview.defaultFields", lang));
    if (preview.field_names?.length) items.push(preview.field_names.map((field) => fieldLabel(field, lang)).join(" · "));
    if (preview.excluded?.length) {
      items.push(t("reai.plan.preview.excluded", lang).replace("{fields}", preview.excluded.map((field) => fieldLabel(field, lang)).join(", ")));
    }
    if (preview.pin_protected) items.push(t("reai.plan.preview.pin", lang));
  }
  if (!items.length) return null;
  return <p className="mt-1 text-[11px] leading-4 text-foreground/60">{items.join(" · ")}</p>;
}

function ShareFieldToggles({
  snapshot,
  step,
  lang,
  disabled,
  onAnswer,
}: {
  snapshot: AgentPlanSnapshot;
  step: ReaiAgentPlanStep;
  lang: string;
  disabled: boolean;
  onAnswer: PlanCardProps["onAnswer"];
}) {
  const next = snapshot.next;
  if (next?.mode !== "confirm" || next.step_id !== step.step_id) return null;
  const available = next.step_response.available_share_fields ?? [];
  const selected = new Set(next.step_response.selected_share_fields ?? []);
  if (!available.length) return null;
  return (
    <div className="mt-2">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t("reai.plan.shareFields", lang)}</p>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {available.map((field) => {
          const on = selected.has(field);
          return (
            <button
              key={field}
              type="button"
              aria-pressed={on}
              disabled={disabled || (on && selected.size === 1)}
              onClick={() => {
                const names = on
                  ? available.filter((item) => selected.has(item) && item !== field)
                  : available.filter((item) => selected.has(item) || item === field);
                onAnswer(step.step_id, { share_field_names: names });
              }}
              className={cn(
                "min-h-8 rounded-2xl border px-2.5 py-1 text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40",
                on ? "border-foreground bg-foreground text-background" : "border-border/60 bg-card text-foreground/75 hover:bg-foreground/[0.04]",
              )}
            >
              {fieldLabel(field, lang)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function QuestionBlock({
  step,
  question,
  lang,
  disabled,
  approved,
  onAnswer,
  onSkip,
  onContinue,
  onTypeAnswer,
}: {
  step: ReaiAgentPlanStep;
  question: ReaiAgentPlanQuestion;
  lang: string;
  disabled: boolean;
  approved: boolean;
  onAnswer: PlanCardProps["onAnswer"];
  onSkip: PlanCardProps["onSkip"];
  onContinue: PlanCardProps["onContinue"];
  onTypeAnswer: PlanCardProps["onTypeAnswer"];
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const chip = "min-h-9 rounded-2xl border border-border/60 bg-card px-3 py-1.5 text-left text-[12px] text-foreground transition-colors hover:bg-foreground/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40";
  const text = question.text || (question.kind === "photos" ? t("reai.plan.photosHint", lang) : "");
  return (
    <div className="mt-2 rounded-2xl bg-foreground/[0.03] px-2.5 py-2">
      {text && <p className="text-[12px] leading-5 text-foreground/85">{text}</p>}
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {question.kind === "share_fields"
          ? question.options.map((option) => {
            const on = picked.includes(String(option.value));
            return (
              <button
                key={String(option.value)}
                type="button"
                aria-pressed={on}
                disabled={disabled}
                className={cn(chip, on && "border-foreground bg-foreground text-background hover:bg-foreground")}
                onClick={() => setPicked((current) => on ? current.filter((item) => item !== String(option.value)) : [...current, String(option.value)])}
              >
                {option.label}
              </button>
            );
          })
          : question.options.map((option) => (
            <button
              key={String(option.value)}
              type="button"
              disabled={disabled}
              className={chip}
              onClick={() => onAnswer(step.step_id, answerFor(question, option.value))}
            >
              {option.label}
            </button>
          ))}
        {question.kind === "share_fields" && picked.length > 0 && (
          <Button type="button" size="xs" className="rounded-2xl" disabled={disabled} onClick={() => onAnswer(step.step_id, { share_field_names: picked })}>
            {t("reai.plan.useFields", lang)}
          </Button>
        )}
        {/* On the open listing a drop uploads straight away, so there may be
            nothing waiting here; the server counts the listing's photos. */}
        {question.kind === "photos" && approved && (
          <Button type="button" size="xs" className="rounded-2xl" disabled={disabled} onClick={onContinue}>
            {t("reai.plan.continue", lang)}
          </Button>
        )}
        {question.kind === "photos" && !question.options.length && (
          <button
            type="button"
            disabled={disabled}
            className={chip}
            onClick={() => (approved ? onSkip(step.step_id) : onAnswer(step.step_id, { photos: "skip" }))}
          >
            {t("reai.plan.skipPhotos", lang)}
          </button>
        )}
        {question.allows_text && (
          <button type="button" disabled={disabled} className={chip} onClick={() => onTypeAnswer(step.step_id, question)}>
            {t("reai.plan.typeAnswer", lang)}
          </button>
        )}
      </div>
    </div>
  );
}

export function AgentPlanCard({
  snapshot,
  lang,
  live,
  pendingPhotoCount,
  onApprove,
  onCancel,
  onStop,
  onContinue,
  onSkip,
  onRetry,
  onRetryPhotos,
  onAnswer,
  onTypeAnswer,
}: PlanCardProps) {
  const { plan, phase } = snapshot;
  const approved = Boolean(plan.approval);
  const running = RUNNING_PHASES.has(phase);
  const terminal = phase === "done" || phase === "cancelled" || phase === "failed";
  const openQuestions = openPlanQuestions(plan, pendingPhotoCount);
  // Before approval a plan can also arrive blocked (say, no listings left): it
  // still shows its Cancel, with the approval buttons disabled.
  const approvalOpen = live && !approved && (phase === "awaiting_approval" || phase === "asking" || phase === "blocked");
  const canApprove = approvalOpen && openQuestions.length === 0 && plan.approval_options.length > 0;
  const blocked = snapshot.next?.mode === "blocked" ? snapshot.next.blocked : null;
  const notice = noticeText(snapshot, lang);
  const doneCount = plan.steps.filter((step) => step.status === "done").length;

  return (
    <div
      className="mt-4 overflow-hidden floating-panel-shape border border-border/65 bg-card shadow-control"
      data-agent-plan={plan.plan_id}
      data-agent-plan-phase={phase}
    >
      <div className="flex items-center justify-between gap-3 border-b border-border/45 px-3.5 py-2.5">
        <p className="text-xs font-semibold text-foreground">{t("reai.plan.title", lang)}</p>
        <span className="rounded-2xl bg-foreground/[0.06] px-2 py-0.5 text-[11px] font-medium text-foreground/65">
          {t("reai.plan.stepCount", lang).replace("{count}", String(plan.steps.length))}
        </span>
      </div>

      <ol className="divide-y divide-border/35 px-3.5">
        {plan.steps.map((step) => {
          const active = live && running && snapshot.stepId === step.step_id;
          // Dropping photos answers an up-front photo question without a tap.
          const upFrontQuestion = live && !approved && step.question
            && !(step.question.kind === "photos" && pendingPhotoCount > 0)
            ? step.question
            : null;
          const question = live && snapshot.phase === "asking" && snapshot.stepId === step.step_id && snapshot.question
            ? snapshot.question
            : upFrontQuestion;
          const confirmLabel = step.confirmation === "step"
            ? (step.confirmation_reason
              ? tKnown(`reai.plan.confirmReason.${step.confirmation_reason}`, "reai.plan.confirm.step", lang)
              : t("reai.plan.confirm.step", lang))
            : null;
          return (
            <li key={step.step_id} className={cn("flex gap-2.5 py-3", snapshot.stepId === step.step_id && live && !terminal && "bg-foreground/[0.015]")}>
              <StepIcon status={step.status} active={active} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                  <p className="text-[13px] font-medium leading-5 text-foreground">{step.label}</p>
                  {step.status !== "ready" && (
                    <span className="text-[11px] text-muted-foreground">{tKnown(`reai.plan.status.${step.status}`, "reai.plan.status.ready", lang)}</span>
                  )}
                </div>
                {step.quote && (
                  <p className="mt-0.5 line-clamp-2 text-[11px] italic leading-4 text-muted-foreground">“{step.quote}”</p>
                )}
                <StepPreview step={step} lang={lang} pendingPhotoCount={pendingPhotoCount} />
                {(step.spends.length > 0 || confirmLabel) && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {step.spends.filter((spend) => t(`reai.plan.spend.${spend}` as LocaleKey, lang) !== `reai.plan.spend.${spend}`).map((spend) => (
                      <span key={spend} className="rounded-2xl border border-border/50 bg-background px-2 py-0.5 text-[10px] text-foreground/65">
                        {t(`reai.plan.spend.${spend}` as LocaleKey, lang)}
                      </span>
                    ))}
                    {confirmLabel && (
                      <span className="rounded-2xl bg-foreground/[0.06] px-2 py-0.5 text-[10px] font-medium text-foreground/70">{confirmLabel}</span>
                    )}
                  </div>
                )}
                {step.blocked && (
                  <p className="mt-1.5 text-[11px] leading-4 text-foreground/75">
                    {tKnown(`reai.plan.blocked.${step.blocked.reason}`, "reai.plan.phase.blocked", lang)}
                    {step.blocked.reason === "user_policy" && (
                      <>
                        {" "}
                        <Link href="/settings#reai" className="font-medium underline underline-offset-2 hover:text-foreground">
                          {t("reai.plan.openAgentSettings", lang)}
                        </Link>
                      </>
                    )}
                  </p>
                )}
                {live && step.kind === "share_listing" && phase === "confirming" && (
                  <ShareFieldToggles snapshot={snapshot} step={step} lang={lang} disabled={running} onAnswer={onAnswer} />
                )}
                {question && (
                  <QuestionBlock
                    key={`${step.step_id}:${question.kind}:${question.reask ? "again" : "first"}`}
                    step={step}
                    question={question}
                    lang={lang}
                    disabled={running}
                    approved={approved}
                    onAnswer={onAnswer}
                    onSkip={onSkip}
                    onContinue={onContinue}
                    onTypeAnswer={onTypeAnswer}
                  />
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {(plan.declined.length > 0 || plan.not_included.length > 0 || plan.notes.length > 0) && (
        <div className="space-y-2 border-t border-border/45 px-3.5 py-2.5 text-[11px] leading-4">
          {plan.declined.length > 0 && (
            <div>
              <p className="font-medium uppercase tracking-wide text-muted-foreground">{t("reai.plan.declinedTitle", lang)}</p>
              <ul className="mt-0.5 space-y-0.5 text-foreground/70">
                {plan.declined.map((item, index) => <li key={`${item.kind}-${index}`}>{item.label}{item.quote ? ` — “${item.quote}”` : ""}</li>)}
              </ul>
            </div>
          )}
          {plan.not_included.length > 0 && (
            <div>
              <p className="font-medium uppercase tracking-wide text-muted-foreground">{t("reai.plan.notIncludedTitle", lang)}</p>
              <ul className="mt-0.5 space-y-0.5 text-foreground/70">
                {plan.not_included.map((item, index) => (
                  <li key={`${item.reason}-${index}`}>{item.label ? `${item.label} — ` : ""}“{item.quote}”</li>
                ))}
              </ul>
            </div>
          )}
          {plan.notes.length > 0 && (
            <div>
              <p className="font-medium uppercase tracking-wide text-muted-foreground">{t("reai.plan.notesTitle", lang)}</p>
              <ul className="mt-0.5 space-y-0.5 text-foreground/70">
                {plan.notes.map((note, index) => <li key={`${note.code}-${index}`}>{note.text}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}

      <div className="border-t border-border/45 px-3.5 py-3" aria-live="polite">
        {approvalOpen && (
          <>
            <p className="text-[11px] leading-4 text-muted-foreground">
              {notice ?? t(
                openQuestions.length
                  ? "reai.plan.answerFirst"
                  : plan.approval_options.length ? "reai.plan.approvalHint" : "reai.plan.phase.blocked",
                lang,
              )}
            </p>
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              {plan.approval_options.includes("all") && (
                <Button type="button" size="sm" className="rounded-2xl" disabled={!canApprove} onClick={() => onApprove("all")}>
                  {t("reai.plan.runAll", lang)}
                </Button>
              )}
              {plan.approval_options.includes("step") && (
                <Button type="button" variant="outline" size="sm" className="rounded-2xl" disabled={!canApprove} onClick={() => onApprove("step")}>
                  {t("reai.plan.stepByStep", lang)}
                </Button>
              )}
              <Button type="button" variant="ghost" size="sm" className="rounded-2xl" onClick={onCancel}>
                {t("reai.plan.cancel", lang)}
              </Button>
            </div>
          </>
        )}

        {live && !approvalOpen && !terminal && phase !== "paused" && (
          <div className="flex items-center justify-between gap-3">
            <p className="flex min-w-0 items-center gap-2 text-[12px] leading-5 text-foreground/75">
              {running && <Spinner />}
              <span className="min-w-0">
                {phase === "blocked"
                  ? (blocked ? tKnown(`reai.plan.blocked.${blocked.reason}`, "reai.plan.phase.blocked", lang) : t("reai.plan.phase.blocked", lang))
                  : notice ?? (approved && snapshot.reply && running ? snapshot.reply : tKnown(`reai.plan.phase.${phase}`, "reai.plan.phase.working", lang))}
              </span>
            </p>
            {/* Stop never waits for the shared busy flag: it must work while a step runs. */}
            <Button type="button" variant="ghost" size="sm" className="shrink-0 rounded-2xl" onClick={onStop}>
              {t("reai.plan.stop", lang)}
            </Button>
          </div>
        )}

        {live && approved && phase === "blocked" && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {blocked?.reason === "user_policy" && (
              <Button asChild variant="outline" size="sm" className="rounded-2xl">
                <Link href="/settings#reai">{t("reai.plan.openAgentSettings", lang)}</Link>
              </Button>
            )}
            {blocked?.options.includes("retry") && snapshot.stepId && (
              <Button type="button" size="sm" className="rounded-2xl" onClick={() => onRetry(snapshot.stepId as string)}>
                {t("reai.plan.retry", lang)}
              </Button>
            )}
            {blocked?.options.includes("skip") && snapshot.stepId && (
              <Button type="button" variant="outline" size="sm" className="rounded-2xl" onClick={() => onSkip(snapshot.stepId as string)}>
                {t("reai.plan.skip", lang)}
              </Button>
            )}
          </div>
        )}

        {live && phase === "paused" && (
          <>
            <p className="text-[12px] font-medium leading-5 text-foreground">{t("reai.plan.paused", lang)}</p>
            <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
              {notice ? `${notice} ` : ""}{t("reai.plan.pausedBody", lang)}
            </p>
            {snapshot.notice?.detail && (
              <p className="mt-1 text-[11px] leading-4 text-foreground/70">{snapshot.notice.detail}</p>
            )}
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              {snapshot.notice?.kind === "photos_failed" && pendingPhotoCount > 0 && (
                <Button type="button" variant="outline" size="sm" className="rounded-2xl" onClick={onRetryPhotos}>
                  {t("reai.plan.retryPhotos", lang)}
                </Button>
              )}
              <Button type="button" size="sm" className="rounded-2xl" onClick={onContinue}>
                {t("reai.plan.continue", lang)}
              </Button>
              <Button type="button" variant="ghost" size="sm" className="rounded-2xl" onClick={onStop}>
                {t("reai.plan.stop", lang)}
              </Button>
            </div>
          </>
        )}

        {phase === "failed" && (
          <>
            <p className="text-[12px] font-medium leading-5 text-foreground">{t("reai.plan.failed", lang)}</p>
            {notice && <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">{notice}</p>}
            {snapshot.notice?.detail && <p className="mt-1 text-[11px] leading-4 text-foreground/70">{snapshot.notice.detail}</p>}
          </>
        )}

        {phase === "done" && (
          <p className="flex items-center gap-2 text-[12px] leading-5 text-foreground/80">
            <CheckIcon size={12} aria-hidden="true" />
            {t("reai.plan.done", lang)}{" "}
            {t("reai.plan.stepsDone", lang).replace("{done}", String(doneCount)).replace("{total}", String(plan.steps.length))}
          </p>
        )}

        {phase === "cancelled" && (
          <p className="text-[12px] leading-5 text-foreground/70">{t("reai.plan.cancelled", lang)}</p>
        )}

        {!live && !terminal && (
          <p className="text-[11px] leading-4 text-muted-foreground">{t("reai.plan.superseded", lang)}</p>
        )}
      </div>
    </div>
  );
}

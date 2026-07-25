"use client";

import Link from "next/link";

import type { ReaiAgentDraftResult, ReaiAgentResponse, ReaiAgentUiBlock } from "../lib/api/client";
import { t } from "../lib/i18n";
import type { LocaleKey } from "../lib/locales";
import { cn } from "../lib/utils";
import {
  ArrowRightIcon,
  CheckIcon,
  ClockIcon,
  LayoutIcon,
  SearchIcon,
  SettingsIcon,
  SparklesIcon,
  VersionsIcon,
} from "./icons";

function toneClass(tone: "neutral" | "success" | "warning" | undefined) {
  if (tone === "success") return "bg-emerald-500/10 text-emerald-800";
  if (tone === "warning") return "bg-amber-500/10 text-amber-900";
  return "bg-foreground/[0.055] text-foreground/70";
}

function safeSettingsPath(answer: ReaiAgentResponse): string {
  const path = answer.navigation_path;
  if (path?.startsWith("/") && !path.startsWith("//")) return path;
  return answer.settings_section ? `/settings#${answer.settings_section}` : "/settings";
}

function MiniBlock({
  block,
  busy,
  onPrompt,
}: {
  block: ReaiAgentUiBlock;
  busy: boolean;
  onPrompt: (prompt: string) => void;
}) {
  if (block.kind === "summary") {
    const items = block.items.slice(0, 4);
    if (items.length === 0) return null;
    return (
      <section aria-label={block.title} className="overflow-hidden rounded-[1.35rem] border border-border/65 bg-card shadow-control">
        <header className="flex items-start gap-2.5 border-b border-border/45 px-3 py-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-foreground text-background">
            <LayoutIcon size={14} />
          </span>
          <div className="min-w-0 pt-0.5">
            <h3 className="truncate text-[12px] font-semibold">{block.title}</h3>
            {block.description ? <p className="mt-0.5 line-clamp-2 text-[10px] leading-4 text-muted-foreground">{block.description}</p> : null}
          </div>
        </header>
        <dl className="grid grid-cols-2 gap-px bg-border/45">
          {items.map((item, index) => (
            <div key={`${item.label}-${index}`} className="min-w-0 bg-card px-3 py-2.5">
              <dt className="truncate text-[9px] font-medium uppercase tracking-[0.06em] text-muted-foreground">{item.label}</dt>
              <dd className="mt-1 truncate text-[14px] font-semibold tracking-[-0.015em]">{item.value}</dd>
              {item.hint ? (
                <span className={cn("mt-1 inline-flex max-w-full truncate rounded-full px-1.5 py-0.5 text-[9px] font-medium", toneClass(item.tone))}>
                  {item.hint}
                </span>
              ) : null}
            </div>
          ))}
        </dl>
      </section>
    );
  }

  if (block.kind === "progress") {
    const value = typeof block.value === "number" && Number.isFinite(block.value)
      ? Math.max(0, Math.min(100, block.value))
      : null;
    return (
      <section aria-label={block.title} className="rounded-[1.35rem] border border-border/65 bg-card p-3 shadow-control">
        <div className="flex items-start gap-2.5">
          <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full", toneClass(block.tone))}>
            {block.tone === "success" ? <CheckIcon size={14} /> : <ClockIcon size={14} />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="truncate text-[12px] font-semibold">{block.title}</h3>
              {value !== null ? <span className="shrink-0 text-[10px] font-semibold tabular-nums text-muted-foreground">{Math.round(value)}%</span> : null}
            </div>
            <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{block.label}</p>
            <div
              role="progressbar"
              aria-label={block.label}
              aria-valuemin={value === null ? undefined : 0}
              aria-valuemax={value === null ? undefined : 100}
              aria-valuenow={value === null ? undefined : Math.round(value)}
              className="mt-2 h-1.5 overflow-hidden rounded-full bg-foreground/[0.08]"
            >
              <span
                className={cn(
                  "block h-full rounded-full bg-foreground transition-[width] duration-300",
                  value === null && "w-2/5 animate-pulse motion-reduce:animate-none",
                )}
                style={value === null ? undefined : { width: `${value}%` }}
              />
            </div>
            {block.detail ? <p className="mt-2 line-clamp-2 text-[10px] leading-4 text-foreground/60">{block.detail}</p> : null}
          </div>
        </div>
      </section>
    );
  }

  const actions = block.actions.slice(0, 3);
  if (actions.length === 0) return null;
  return (
    <section aria-label={block.title} className="overflow-hidden rounded-[1.35rem] border border-border/65 bg-card shadow-control">
      {block.title ? <h3 className="border-b border-border/45 px-3 py-2.5 text-[11px] font-semibold">{block.title}</h3> : null}
      <div className="divide-y divide-border/40">
        {actions.map((action, index) => (
          <button
            key={`${action.prompt}-${index}`}
            type="button"
            disabled={busy}
            onClick={() => onPrompt(action.prompt)}
            className="group flex min-h-11 w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-foreground/[0.035] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-45"
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-foreground/[0.055] text-foreground/60">
              <SparklesIcon size={12} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[11px] font-semibold">{action.label}</span>
              {action.description ? <span className="mt-0.5 block truncate text-[9px] text-muted-foreground">{action.description}</span> : null}
            </span>
            <ArrowRightIcon size={13} className="shrink-0 text-foreground/30 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground/60" />
          </button>
        ))}
      </div>
    </section>
  );
}

export function AgentMiniUi({
  answer,
  currentDraftId,
  lang,
  busy,
  formatDraftMeta,
  onPrompt,
}: {
  answer: ReaiAgentResponse;
  currentDraftId?: number;
  lang: string;
  busy: boolean;
  formatDraftMeta: (draft: ReaiAgentDraftResult) => string;
  onPrompt: (prompt: string) => void;
}) {
  const results = (answer.draft_results ?? [])
    .filter((draft) => !currentDraftId || draft.id !== currentDraftId)
    .slice(0, 3);
  const uiBlocks = (answer.ui_blocks ?? []).slice(0, 2);
  const hasActionBlock = uiBlocks.some((block) => block.kind === "actions");
  const canSuggest = !answer.proposal_token && !answer.action_token && !hasActionBlock && uiBlocks.length === 0;
  const suggestions = canSuggest ? (answer.suggested_actions ?? []).filter(Boolean).slice(0, 3) : [];
  const settingsSection = answer.action_code === "settings_navigation" ? answer.settings_section : null;

  if (results.length === 0 && uiBlocks.length === 0 && suggestions.length === 0 && !settingsSection) return null;

  const matchedCount = Math.max(answer.matched_creation_count ?? results.length, results.length);
  const resultTitle = answer.operation === "compare" ? t("reai.mini.compareTitle", lang) : t("reai.mini.resultsTitle", lang);
  const ResultIcon = answer.operation === "compare" ? VersionsIcon : SearchIcon;

  return (
    <div className="mt-3 space-y-2.5">
      {results.length > 0 ? (
        <section aria-label={resultTitle} className="overflow-hidden rounded-[1.35rem] border border-border/65 bg-card shadow-control">
          <header className="flex items-center gap-2.5 border-b border-border/45 px-3 py-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-foreground text-background">
              <ResultIcon size={14} />
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="truncate text-[12px] font-semibold">{resultTitle}</h3>
              {answer.search_query ? <p className="mt-0.5 truncate text-[10px] text-muted-foreground">“{answer.search_query}”</p> : null}
            </div>
            <span className="shrink-0 rounded-full bg-foreground/[0.055] px-2 py-1 text-[9px] font-semibold tabular-nums text-foreground/60">
              {t("reai.mini.matches", lang).replace("{count}", String(matchedCount))}
            </span>
          </header>
          <div className="divide-y divide-border/40">
            {results.map((draft) => {
              const title = draft.creation_data.title || `#${draft.id}`;
              const meta = formatDraftMeta(draft);
              return (
                <Link
                  key={draft.id}
                  href={`/draft/${draft.id}`}
                  aria-label={`${t("reai.mini.open", lang)}: ${title}`}
                  className="group flex min-h-12 items-center gap-2.5 px-3 py-2.5 transition-colors hover:bg-foreground/[0.035] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  <span className={cn("h-2 w-2 shrink-0 rounded-full", draft.is_complete ? "bg-emerald-600" : "bg-amber-500")} aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11px] font-semibold">{title}</span>
                    <span className="mt-0.5 block truncate text-[9px] text-muted-foreground">
                      {meta || draft.semantic_summary || t("nav.creation", lang)}
                    </span>
                  </span>
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-foreground/[0.045] text-foreground/45 transition-colors group-hover:bg-foreground group-hover:text-background">
                    <ArrowRightIcon size={12} />
                  </span>
                </Link>
              );
            })}
          </div>
        </section>
      ) : null}

      {settingsSection ? (
        <section aria-label={t("reai.settingsNavigationTitle", lang)} className="flex items-center gap-3 rounded-[1.35rem] border border-border/65 bg-card p-3 shadow-control">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-foreground text-background">
            <SettingsIcon size={15} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[10px] text-muted-foreground">{t("reai.settingsNavigationTitle", lang)}</p>
            <p className="mt-0.5 truncate text-[12px] font-semibold">
              {t(`settings.tab.${settingsSection}` as LocaleKey, lang)}
            </p>
          </div>
          <Link
            href={safeSettingsPath(answer)}
            className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border border-border/70 bg-background px-3 text-[10px] font-semibold transition-colors hover:bg-foreground hover:text-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:min-h-9"
          >
            {t("reai.settingsNavigationOpen", lang)}
            <ArrowRightIcon size={11} />
          </Link>
        </section>
      ) : null}

      {uiBlocks.map((block, index) => <MiniBlock key={`${block.kind}-${index}`} block={block} busy={busy} onPrompt={onPrompt} />)}

      {suggestions.length > 0 ? (
        <MiniBlock
          block={{
            kind: "actions",
            title: t("reai.mini.nextActions", lang),
            actions: suggestions.map((prompt) => ({ label: prompt, prompt })),
          }}
          busy={busy}
          onPrompt={onPrompt}
        />
      ) : null}
    </div>
  );
}

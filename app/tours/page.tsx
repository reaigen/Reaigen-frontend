"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppShell } from "../components/app-shell";
import { useAuth } from "../components/hooks/use-auth";
import { ArrowRightIcon, PlayIcon, TourIcon } from "../components/icons";
import { PageHeader } from "../components/page-header";
import { PageLoading } from "../components/page-loading";
import { StatusPill } from "../components/status-pill";
import { SearchField } from "../components/search-field";
import { Thumbnail } from "../components/thumbnail";
import { listAllSplats } from "../lib/api/client";
import { getUserLanguage, t } from "../lib/i18n";
import type { SplatListItem } from "../lib/tour-types";
import { cn } from "../lib/utils";

type TourFilter = "all" | "ready" | "processing" | "issues";

function tourState(item: SplatListItem): Exclude<TourFilter, "all"> {
  const status = item.status.toLowerCase();
  if (status === "failed" || status === "cancelled") return "issues";
  if (status === "completed" && (item.has_sog || item.has_splat || item.has_ply)) return "ready";
  return "processing";
}

function statusLabel(item: SplatListItem, lang: string) {
  const state = tourState(item);
  if (state === "ready") return t("dashboard.status.ready", lang);
  if (state === "issues") return t("dashboard.status.failed", lang);
  return t("dashboard.status.processing", lang);
}

function statusTone(item: SplatListItem): "success" | "warning" | "danger" {
  const state = tourState(item);
  if (state === "ready") return "success";
  if (state === "issues") return "danger";
  return "warning";
}

function formatUpdated(value: string, lang: string) {
  try {
    return new Intl.DateTimeFormat(lang || "en", { day: "numeric", month: "short", year: "numeric" }).format(new Date(value));
  } catch {
    return value;
  }
}

export default function ToursPage() {
  const { isAuthenticated, isLoading, user, logout } = useAuth();
  const router = useRouter();
  const [items, setItems] = React.useState<SplatListItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [filter, setFilter] = React.useState<TourFilter>("all");

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      setItems(await listAllSplats());
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (!isLoading && !isAuthenticated) router.replace("/");
  }, [isLoading, isAuthenticated, router]);

  React.useEffect(() => {
    if (isAuthenticated) void load();
  }, [isAuthenticated, load]);

  if (isLoading || !user) return <PageLoading />;

  const lang = getUserLanguage(user.localization);
  const counts = {
    all: items.length,
    ready: items.filter((item) => tourState(item) === "ready").length,
    processing: items.filter((item) => tourState(item) === "processing").length,
    issues: items.filter((item) => tourState(item) === "issues").length,
  };
  const normalizedQuery = query.trim().toLowerCase();
  const visible = items.filter((item) => {
    if (filter !== "all" && tourState(item) !== filter) return false;
    if (!normalizedQuery) return true;
    return `${item.title} ${item.scan_type}`.toLowerCase().includes(normalizedQuery);
  });

  const filters: Array<{ key: TourFilter; label: string }> = [
    { key: "all", label: t("tours.filter.all", lang) },
    { key: "ready", label: t("tours.filter.ready", lang) },
    { key: "processing", label: t("tours.filter.processing", lang) },
    { key: "issues", label: t("tours.filter.issues", lang) },
  ];

  return (
    <AppShell user={user} onLogout={logout}>
      <div className="mx-auto w-full max-w-[1180px] space-y-7 pb-10">
        <PageHeader
          title={t("tours.title", lang)}
          description={t("tours.subtitle", lang)}
        />

        <div className="flex flex-col gap-3 border-b border-border/45 pb-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-1 overflow-x-auto scrollbar-hide">
            {filters.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setFilter(item.key)}
                className={cn(
                  "inline-flex h-8 shrink-0 items-center gap-2 rounded-lg px-3 text-[12px] font-medium transition-colors",
                  filter === item.key
                    ? "bg-foreground text-background"
                    : "text-foreground/60 hover:bg-foreground/[0.045] hover:text-foreground",
                )}
              >
                {item.label}
                <span className={cn("tabular-nums", filter === item.key ? "text-background/65" : "text-foreground/45")}>{counts[item.key]}</span>
              </button>
            ))}
          </div>
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder={t("tours.search", lang)}
            clearLabel={t("dashboard.clearSearch", lang)}
            className="w-full lg:w-[280px]"
          />
        </div>

        {loading ? (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="animate-pulse">
                <div className="aspect-[16/10] rounded-2xl bg-muted/70" />
                <div className="mt-3 h-4 w-2/3 rounded bg-muted" />
                <div className="mt-2 h-3 w-1/3 rounded bg-muted/70" />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-border/55 bg-surface px-6 py-14 text-center">
            <p className="text-[14px] font-semibold">{t("tours.error", lang)}</p>
            <button type="button" onClick={() => void load()} className="mt-3 text-[12px] font-semibold underline underline-offset-4">
              {t("common.tryAgain", lang)}
            </button>
          </div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/70 bg-surface/60 px-6 py-20 text-center">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-foreground/[0.05] text-foreground/45"><TourIcon size={22} /></div>
            <p className="text-[14px] font-semibold">{query || filter !== "all" ? t("tours.emptyFiltered", lang) : t("tours.empty", lang)}</p>
            <p className="mt-1 max-w-sm text-[12px] leading-relaxed text-muted-foreground">{t("tours.emptyHint", lang)}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-x-6 gap-y-8 md:grid-cols-2 xl:grid-cols-3">
            {visible.map((item) => {
              const ready = tourState(item) === "ready";
              const href = ready ? `/tour/${item.id}` : `/draft/${item.source_draft}`;
              return (
                <article key={item.id} className="group min-w-0">
                  <Link href={href} className="block" prefetch={ready}>
                    <div className="relative aspect-[16/10] overflow-hidden rounded-2xl border border-border/55 bg-foreground/[0.035]">
                      {item.thumbnail_url ? (
                        <Thumbnail src={item.thumbnail_url} alt={item.title} className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-[1.025]" />
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center text-foreground/18"><TourIcon size={36} /></div>
                      )}
                      <div className="absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-black/45 to-transparent opacity-80" />
                      <StatusPill tone={statusTone(item)} dot className="absolute left-3 top-3 shadow-sm">
                        {statusLabel(item, lang)}
                      </StatusPill>
                      {ready ? (
                        <div className="absolute bottom-3 left-3 inline-flex h-8 items-center gap-2 rounded-full border border-white/15 bg-black/70 px-3 text-[11px] font-semibold text-white shadow-[0_4px_16px_rgba(0,0,0,0.18)] backdrop-blur-xl transition-colors group-hover:bg-black/85">
                          <PlayIcon size={14} /> {t("tours.open", lang)}
                        </div>
                      ) : null}
                    </div>
                  </Link>
                  <div className="mt-3 flex items-start justify-between gap-3 px-0.5">
                    <div className="min-w-0">
                      <Link href={`/draft/${item.source_draft}`} className="block truncate text-[14px] font-semibold hover:underline hover:underline-offset-4">{item.title}</Link>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {t("tours.updated", lang)} {formatUpdated(item.updated_at, lang)}
                        {item.delivery_versions_count && item.delivery_versions_count > 1 ? ` · ${item.delivery_versions_count} ${t("tours.versions", lang)}` : ""}
                      </p>
                    </div>
                    <Link href={href} aria-label={ready ? t("tours.open", lang) : t("tours.openCreation", lang)} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-foreground/45 transition hover:bg-foreground/[0.05] hover:text-foreground">
                      <ArrowRightIcon size={16} />
                    </Link>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}

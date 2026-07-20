"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppShell } from "../components/app-shell";
import { GridLayoutToggle } from "../components/grid-layout-toggle";
import { useAuth } from "../components/hooks/use-auth";
import { TourIcon } from "../components/icons";
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
  const [gridCols, setGridCols] = React.useState<1 | 2>(() => {
    if (typeof window === "undefined") return 2;
    return localStorage.getItem("reaigen:gridCols") === "1" ? 1 : 2;
  });

  const handleGridCols = React.useCallback((cols: 1 | 2) => {
    setGridCols(cols);
    localStorage.setItem("reaigen:gridCols", String(cols));
  }, []);

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
      <div className="mx-auto w-full max-w-[1180px] animate-fade-in pb-10">
        <PageHeader
          title={t("tours.title", lang)}
          description={t("tours.subtitle", lang)}
          actions={counts.all > 0 ? <StatusPill>{counts.all} {t("dashboard.items", lang)}</StatusPill> : undefined}
          className="mb-7"
        />

        <div className="mb-4 flex items-center gap-3 border-b border-border/40 pb-3">
          <SearchField
            value={query}
            onChange={setQuery}
            onClear={() => setQuery("")}
            placeholder={t("tours.search", lang)}
            clearLabel={t("dashboard.clearSearch", lang)}
            className="flex-1"
          />
          <GridLayoutToggle value={gridCols} onChange={handleGridCols} lang={lang} />
        </div>

        <div className="mb-6 flex min-w-0 items-center gap-1 overflow-x-auto scrollbar-hide">
          {filters.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setFilter(item.key)}
              className={cn(
                "inline-flex h-8 shrink-0 items-center gap-2 rounded-full px-3 text-[12px] font-medium transition-colors",
                filter === item.key
                  ? "bg-foreground text-background"
                  : "text-foreground/60 hover:bg-foreground/[0.04] hover:text-foreground",
              )}
              aria-pressed={filter === item.key}
            >
              {item.label}
              <span className={cn("tabular-nums", filter === item.key ? "text-background/65" : "text-foreground/45")}>{counts[item.key]}</span>
            </button>
          ))}
        </div>

        {loading ? (
          <div className={`grid grid-cols-1 gap-6 ${gridCols === 2 ? "md:grid-cols-2" : "mx-auto max-w-2xl"}`}>
            {Array.from({ length: gridCols === 2 ? 4 : 3 }).map((_, index) => (
              <div key={index} className="animate-pulse">
                <div className="aspect-[16/10] rounded-xl bg-muted/30" />
                <div className="mt-3 space-y-2 px-1">
                  <div className="h-4 w-2/3 rounded bg-muted/40" />
                  <div className="h-3 w-1/2 rounded bg-muted/30" />
                </div>
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-border/60 bg-surface px-6 py-14 text-center">
            <p className="text-[14px] font-semibold">{t("tours.error", lang)}</p>
            <button type="button" onClick={() => void load()} className="mt-3 text-[12px] font-semibold underline underline-offset-4">
              {t("common.tryAgain", lang)}
            </button>
          </div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-foreground/[0.04] text-foreground/35"><TourIcon size={22} /></div>
            <p className="text-[14px] font-semibold">{query || filter !== "all" ? t("tours.emptyFiltered", lang) : t("tours.empty", lang)}</p>
            <p className="mt-1 max-w-sm text-[12px] leading-relaxed text-muted-foreground">{t("tours.emptyHint", lang)}</p>
          </div>
        ) : (
          <div className={`grid grid-cols-1 gap-6 ${gridCols === 2 ? "md:grid-cols-2" : "mx-auto max-w-2xl"}`}>
            {visible.map((item, index) => {
              const ready = tourState(item) === "ready";
              const href = ready ? `/tour/${item.id}` : `/draft/${item.source_draft}`;
              return (
                <Link
                  key={item.id}
                  href={href}
                  prefetch={ready}
                  className="group block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <div className="relative aspect-[16/10] overflow-hidden rounded-xl bg-muted/20 transition-shadow group-hover:shadow-lg">
                    {item.thumbnail_url ? (
                      <Thumbnail src={item.thumbnail_url} alt={item.title} className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]" priority={index < 4} />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center text-foreground/12"><TourIcon size={36} /></div>
                    )}
                    <StatusPill tone={statusTone(item)} dot className="absolute left-3 top-3 shadow-sm">
                      {statusLabel(item, lang)}
                    </StatusPill>
                  </div>
                  <div className="mt-2.5 px-0.5">
                    <div className="flex items-start justify-between gap-3">
                      <h2 className="min-w-0 truncate text-[15px] font-semibold leading-snug">{item.title}</h2>
                      {item.delivery_versions_count && item.delivery_versions_count > 1 ? (
                        <span className="shrink-0 text-[12px] text-muted-foreground">
                          {item.delivery_versions_count} {t("tours.versions", lang)}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-0.5 text-[13px] text-muted-foreground">
                      {t("tours.updated", lang)} {formatUpdated(item.updated_at, lang)}
                    </p>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}

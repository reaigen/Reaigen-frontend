"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppShell } from "../components/app-shell";
import { CollectionCard } from "../components/collection-card";
import { CollectionState } from "../components/collection-state";
import { useAuth } from "../components/hooks/use-auth";
import { ArrowRightIcon, InfoIcon, PlayIcon, TourIcon } from "../components/icons";
import { PageHeader } from "../components/page-header";
import { PageLoading } from "../components/page-loading";
import { StatusPill } from "../components/status-pill";
import { SearchField } from "../components/search-field";
import { SegmentedControl } from "../components/segmented-control";
import { Thumbnail } from "../components/thumbnail";
import { listAllSplats } from "../lib/api/client";
import { getUserLanguage, t } from "../lib/i18n";
import type { SplatListItem } from "../lib/tour-types";
import { Button } from "../lib/ui/button";

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

  const filters: Array<{ value: TourFilter; label: string; count: number }> = [
    { value: "all", label: t("tours.filter.all", lang), count: counts.all },
    { value: "ready", label: t("tours.filter.ready", lang), count: counts.ready },
    { value: "processing", label: t("tours.filter.processing", lang), count: counts.processing },
    { value: "issues", label: t("tours.filter.issues", lang), count: counts.issues },
  ];

  return (
    <AppShell user={user} onLogout={logout}>
      <div className="mx-auto w-full max-w-[1320px] pb-10">
        <PageHeader
          title={t("tours.title", lang)}
          description={t("tours.subtitle", lang)}
          actions={counts.all > 0 ? <StatusPill>{counts.all} {t("dashboard.items", lang)}</StatusPill> : undefined}
          className="mb-6 md:mb-8 xl:mb-10"
        />

        <div className="xl:grid xl:grid-cols-[220px_minmax(0,1fr)] xl:items-start xl:gap-8">
          {/* Desktop: a stable workspace rail keeps the gallery itself quiet. */}
          <aside className="sticky top-7 hidden space-y-4 xl:block" aria-label={t("tours.title", lang)}>
            <SearchField
              value={query}
              onChange={setQuery}
              onClear={() => setQuery("")}
              placeholder={t("tours.search", lang)}
              clearLabel={t("dashboard.clearSearch", lang)}
            />
            <div className="space-y-1 rounded-2xl border border-border/75 bg-card p-2 shadow-card" role="group" aria-label={t("tours.title", lang)}>
              {filters.map((option) => {
                const active = filter === option.value;
                const dotClass = option.value === "ready"
                  ? "bg-emerald-600"
                  : option.value === "processing"
                    ? "bg-amber-500"
                    : option.value === "issues"
                      ? "bg-red-600"
                      : "bg-foreground/35";
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setFilter(option.value)}
                    aria-pressed={active}
                    className={`flex h-10 w-full items-center gap-2.5 rounded-full px-3.5 text-left text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${active ? "bg-foreground text-background" : "text-foreground/60 hover:bg-foreground/[0.045] hover:text-foreground"}`}
                  >
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${active ? "bg-background/80" : dotClass}`} aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate">{option.label}</span>
                    <span className={`text-[11px] tabular-nums ${active ? "text-background/60" : "text-foreground/35"}`}>{option.count}</span>
                  </button>
                );
              })}
            </div>
          </aside>

          <div className="min-w-0">
            {/* Mobile and tablet: controls stay above the image-first gallery. */}
            <div className="mb-6 space-y-3 xl:hidden">
              <SearchField
                value={query}
                onChange={setQuery}
                onClear={() => setQuery("")}
                placeholder={t("tours.search", lang)}
                clearLabel={t("dashboard.clearSearch", lang)}
              />
              <SegmentedControl
                value={filter}
                onChange={setFilter}
                options={filters}
                className="w-full"
                ariaLabel={t("tours.title", lang)}
              />
            </div>

            {loading ? (
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 md:gap-6 xl:gap-5 2xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <CollectionCard key={index} loading>
                <div className="aspect-[16/10] bg-muted/45" />
                <div className="flex h-14 items-center justify-between px-4">
                  <div className="h-3 w-1/2 rounded bg-muted/55" />
                  <div className="h-3 w-14 rounded bg-muted/40" />
                </div>
              </CollectionCard>
            ))}
          </div>
            ) : error ? (
          <CollectionState
            kind="error"
            icon={<InfoIcon size={20} />}
            title={t("tours.error", lang)}
            action={<Button type="button" variant="outline" size="sm" onClick={() => void load()}>{t("common.tryAgain", lang)}</Button>}
          />
            ) : visible.length === 0 ? (
          <CollectionState
            icon={<TourIcon size={20} />}
            title={query || filter !== "all" ? t("tours.emptyFiltered", lang) : t("tours.empty", lang)}
            description={t("tours.emptyHint", lang)}
            action={query || filter !== "all" ? <Button type="button" variant="outline" size="sm" onClick={() => { setQuery(""); setFilter("all"); }}>{t("tours.filter.all", lang)}</Button> : undefined}
          />
            ) : (
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 md:gap-6 xl:gap-5 2xl:grid-cols-3">
            {visible.map((item, index) => {
              const ready = tourState(item) === "ready";
              const href = ready ? `/tour/${item.id}` : `/draft/${item.source_draft}`;
              return (
                <CollectionCard
                  key={item.id}
                  revealIndex={index}
                >
                  <Link href={href} prefetch={ready} className="block focus-visible:outline-none">
                  <div className="relative aspect-[16/10] overflow-hidden bg-[#d8d2c8]">
                    {item.thumbnail_url ? (
                      <Thumbnail src={item.thumbnail_url} alt={item.title} className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.03]" priority={index < 4} />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-[#ded8ce] to-[#aaa194] text-black/15"><TourIcon size={40} /></div>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/5 to-black/15" aria-hidden="true" />
                    <StatusPill tone={statusTone(item)} dot className="absolute left-3 top-3 border-white/25 bg-white/90 text-black shadow-[0_4px_16px_rgba(0,0,0,0.14)]">
                      {statusLabel(item, lang)}
                    </StatusPill>
                    {ready ? (
                      <span className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/15 bg-black/65 px-0 text-[11px] font-semibold text-white shadow-sm backdrop-blur-md transition-colors group-hover:bg-black/80 sm:w-auto sm:gap-1.5 sm:px-3">
                        <PlayIcon size={14} /> <span className="hidden sm:inline">{t("tours.open", lang)}</span>
                      </span>
                    ) : null}
                    <div className="absolute inset-x-0 bottom-0 p-4 sm:p-5">
                      <h2 className="truncate text-[17px] font-semibold leading-snug tracking-[-0.02em] text-white">{item.title}</h2>
                      <p className="mt-1 text-[12px] text-white/70">
                        {t("tours.updated", lang)} {formatUpdated(item.updated_at, lang)}
                      </p>
                    </div>
                  </div>
                  <div className="flex h-12 items-center justify-between gap-4 border-t border-border/70 bg-card px-4">
                    <p className="min-w-0 truncate text-[12px] font-medium text-foreground/60">
                      {item.delivery_versions_count && item.delivery_versions_count > 1
                        ? `${item.delivery_versions_count} ${t("tours.versions", lang)}`
                        : statusLabel(item, lang)}
                    </p>
                    <span className="inline-flex shrink-0 items-center gap-1.5 text-[12px] font-semibold text-foreground/70 transition-colors group-hover:text-foreground">
                      {ready ? t("tours.open", lang) : t("tours.openCreation", lang)}
                      <ArrowRightIcon size={14} className="transition-transform duration-200 group-hover:translate-x-0.5" />
                    </span>
                  </div>
                  </Link>
                </CollectionCard>
              );
            })}
          </div>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}

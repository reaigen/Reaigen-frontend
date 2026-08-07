"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppShell } from "../components/app-shell";
import { CollectionCard } from "../components/collection-card";
import { CollectionState } from "../components/collection-state";
import { useAuth } from "../components/hooks/use-auth";
import { InfoIcon, MainTourIcon, PlayIcon } from "../components/icons";
import { PageHeader } from "../components/page-header";
import { PageLoading } from "../components/page-loading";
import { StatusPill } from "../components/status-pill";
import { SearchField } from "../components/search-field";
import { Thumbnail } from "../components/thumbnail";
import { listSplats } from "../lib/api/client";
import { getUserLanguage, t } from "../lib/i18n";
import type { SplatListItem } from "../lib/tour-types";
import { Button } from "../lib/ui/button";
import { WebCreateAction } from "../components/web-create-action";
import { CollectionLoading } from "../components/collection-loading";
import { GridLayoutToggle } from "../components/grid-layout-toggle";

const TOURS_PAGE_SIZE = 24;

type TourState = "ready" | "processing" | "issues";

function tourState(item: SplatListItem): TourState {
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
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [hasMore, setHasMore] = React.useState(false);
  const [error, setError] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [searchQuery, setSearchQuery] = React.useState("");
  const [gridCols, setGridCols] = React.useState<1 | 2>(2);
  const pageRef = React.useRef(1);
  const requestRef = React.useRef(0);

  React.useLayoutEffect(() => {
    const cached = localStorage.getItem("reaigen:gridCols");
    if (cached === "1") setGridCols(1);
  }, []);

  const handleGridCols = React.useCallback((cols: 1 | 2) => {
    setGridCols(cols);
    localStorage.setItem("reaigen:gridCols", String(cols));
  }, []);

  const load = React.useCallback(async () => {
    const requestId = ++requestRef.current;
    setLoading(true);
    setLoadingMore(false);
    setError(false);
    try {
      const data = await listSplats(1, TOURS_PAGE_SIZE, searchQuery);
      if (requestId !== requestRef.current) return;
      setItems(data.results ?? []);
      setHasMore(!!data.next);
      pageRef.current = 1;
    } catch {
      if (requestId === requestRef.current) setError(true);
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, [searchQuery]);

  const loadMore = React.useCallback(async () => {
    if (loadingMore || !hasMore) return;
    const requestId = requestRef.current;
    setLoadingMore(true);
    try {
      const nextPage = pageRef.current + 1;
      const data = await listSplats(nextPage, TOURS_PAGE_SIZE, searchQuery);
      if (requestId !== requestRef.current) return;
      setItems((current) => {
        const seen = new Set(current.map((item) => item.id));
        return [...current, ...(data.results ?? []).filter((item) => !seen.has(item.id))];
      });
      setHasMore(!!data.next);
      pageRef.current = nextPage;
    } catch {
      // Keep the already-rendered page usable; the button remains available.
    } finally {
      if (requestId === requestRef.current) setLoadingMore(false);
    }
  }, [hasMore, loadingMore, searchQuery]);

  React.useEffect(() => {
    if (!isLoading && !isAuthenticated) router.replace("/");
  }, [isLoading, isAuthenticated, router]);

  React.useEffect(() => {
    if (!isAuthenticated) return;
    void load();
    return () => { requestRef.current += 1; };
  }, [isAuthenticated, load]);

  React.useEffect(() => {
    const timer = window.setTimeout(() => setSearchQuery(query.trim()), 150);
    return () => window.clearTimeout(timer);
  }, [query]);

  if (isLoading || !user) return <PageLoading />;

  const lang = getUserLanguage(user.localization);

  return (
    <AppShell user={user} onLogout={logout}>
      <div className="mx-auto w-full max-w-[1180px] pb-10">
        <PageHeader
          title={t("tours.title", lang)}
          description={t("tours.subtitle", lang)}
          actions={<WebCreateAction lang={lang} labelKey="webCreate.tourAction" />}
          className="mb-5 sm:mb-8"
        />

        <div className="mb-5 flex min-w-0 items-center gap-3 rounded-full border border-border/80 bg-card px-4 py-0.5 shadow-control sm:mb-7 md:rounded-none md:border-x-0 md:border-t-0 md:bg-transparent md:px-0 md:pb-2 md:pt-0 md:shadow-none">
          <SearchField
            value={query}
            onChange={setQuery}
            onClear={() => setQuery("")}
            placeholder={t("tours.search", lang)}
            clearLabel={t("dashboard.clearSearch", lang)}
            className="flex-1"
            appearance="toolbar"
          />
          <GridLayoutToggle value={gridCols} onChange={handleGridCols} lang={lang} />
        </div>

        <div className="min-w-0">
          {loading ? (
          <CollectionLoading label={t("common.loading", lang)} className="min-h-48" />
            ) : error ? (
          <CollectionState
            kind="error"
            icon={<InfoIcon size={20} />}
            title={t("tours.error", lang)}
            action={<Button type="button" variant="outline" size="sm" onClick={() => void load()}>{t("common.tryAgain", lang)}</Button>}
          />
            ) : items.length === 0 ? (
          <CollectionState
            icon={<MainTourIcon size={20} />}
            title={searchQuery ? t("tours.emptyFiltered", lang) : t("tours.empty", lang)}
            description={t("tours.emptyHint", lang)}
            action={searchQuery ? <Button type="button" variant="outline" size="sm" onClick={() => setQuery("")}>{t("dashboard.clearSearch", lang)}</Button> : undefined}
          />
            ) : (
          <>
          <div className={`grid grid-cols-1 gap-7 ${gridCols === 2 ? "md:grid-cols-2" : "mx-auto max-w-2xl"}`}>
            {items.map((item, index) => {
              const ready = tourState(item) === "ready";
              const href = ready ? `/tour/${item.id}` : `/draft/${item.source_draft}`;
              return (
                <CollectionCard key={item.id}>
                  <Link href={href} prefetch={ready} className="block focus-visible:outline-none">
                  <div className="relative aspect-[16/10] overflow-hidden bg-surface-subtle">
                    {item.thumbnail_url ? (
                      <Thumbnail src={item.thumbnail_url} alt={item.title} className="absolute inset-0 h-full w-full object-cover [@media(hover:hover)]:transition-transform [@media(hover:hover)]:duration-500 [@media(hover:hover)]:ease-out [@media(hover:hover)]:group-hover:scale-[1.03]" priority={index < 4} />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-muted/60 via-muted to-foreground/10 text-foreground/20"><MainTourIcon size={42} strokeWidth={1.35} /></div>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/5 to-black/15" aria-hidden="true" />
                    <StatusPill tone={statusTone(item)} dot className="absolute left-3 top-3 border-white/15 bg-black/55 text-white/90 shadow-sm backdrop-blur-md">
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
                  </Link>
                </CollectionCard>
              );
            })}
          </div>
          {hasMore ? (
            <div className="mt-8 flex justify-center">
              <Button type="button" variant="outline" size="sm" disabled={loadingMore} onClick={() => void loadMore()}>
                {loadingMore ? t("common.loading", lang) : t("dashboard.loadMore", lang)}
              </Button>
            </div>
          ) : null}
          </>
            )}
        </div>
      </div>
    </AppShell>
  );
}

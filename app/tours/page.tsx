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

/**
 * One card per post. A draft's re-trained versions belong to the version
 * manager inside its detail, not the tours grid — listing every splat gave
 * the same property several identical cards. Keep the strongest candidate
 * per draft: a ready tour beats a processing one, then the newest wins.
 * Opening the card normalises to the draft's canonical tour anyway.
 */
function dedupeByDraft(list: SplatListItem[]): SplatListItem[] {
  const rank = (item: SplatListItem) => {
    const state = tourState(item);
    return state === "ready" ? 2 : state === "processing" ? 1 : 0;
  };
  const byDraft = new Map<number, SplatListItem>();
  for (const item of list) {
    const current = byDraft.get(item.source_draft);
    if (
      !current
      || rank(item) > rank(current)
      || (rank(item) === rank(current) && item.updated_at > current.updated_at)
    ) {
      byDraft.set(item.source_draft, item);
    }
  }
  const seen = new Set<number>();
  const ordered: SplatListItem[] = [];
  for (const item of list) {
    if (seen.has(item.source_draft)) continue;
    seen.add(item.source_draft);
    const kept = byDraft.get(item.source_draft);
    if (kept) ordered.push(kept);
  }
  return ordered;
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
  const lang = getUserLanguage(user?.localization);
  const [items, setItems] = React.useState<SplatListItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [hasMore, setHasMore] = React.useState(false);
  const [error, setError] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [searchQuery, setSearchQuery] = React.useState("");
  const [gridCols, setGridCols] = React.useState<1 | 2>(2);
  const clearSearch = React.useCallback(() => setQuery(""), []);
  const headerSearch = React.useMemo(() => ({
    value: query,
    onChange: setQuery,
    onClear: clearSearch,
    placeholder: t("tours.search", lang),
    clearLabel: t("dashboard.clearSearch", lang),
  }), [clearSearch, lang, query]);
  const pageRef = React.useRef(1);
  const requestRef = React.useRef(0);
  // Raw pages as fetched; `items` is always the deduped view of this list,
  // so a later page carrying a better version of an already-shown draft can
  // still replace its card.
  const rawItemsRef = React.useRef<SplatListItem[]>([]);

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
      rawItemsRef.current = data.results ?? [];
      setItems(dedupeByDraft(rawItemsRef.current));
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
      const seen = new Set(rawItemsRef.current.map((item) => item.id));
      rawItemsRef.current = [
        ...rawItemsRef.current,
        ...(data.results ?? []).filter((item) => !seen.has(item.id)),
      ];
      setItems(dedupeByDraft(rawItemsRef.current));
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

  return (
    <AppShell user={user} onLogout={logout} headerSearch={headerSearch}>
      <div className="mx-auto w-full max-w-[1360px] pb-10">
        <PageHeader
          title={t("tours.title", lang)}
          description={t("tours.subtitle", lang)}
          actions={(
            <>
              <span className="hidden md:inline-flex">
                <GridLayoutToggle value={gridCols} onChange={handleGridCols} lang={lang} />
              </span>
              <WebCreateAction lang={lang} labelKey="webCreate.tourAction" />
            </>
          )}
          className="mb-5 sm:mb-8"
        />

        <div className="mb-5 flex min-w-0 items-center gap-2 border-b border-border/75 pb-2 sm:mb-6 md:hidden">
          <SearchField
            value={query}
            onChange={setQuery}
            onClear={clearSearch}
            placeholder={t("tours.search", lang)}
            clearLabel={t("dashboard.clearSearch", lang)}
            className="flex-1 px-1"
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
          <div className={`grid grid-cols-1 gap-5 xl:gap-6 ${gridCols === 2 ? "md:grid-cols-2" : "mx-auto max-w-2xl"}`}>
            {items.map((item, index) => {
              const ready = tourState(item) === "ready";
              const href = ready ? `/tour/${item.id}` : `/draft/${item.source_draft}`;
              return (
                <CollectionCard key={item.id}>
                  <Link href={href} data-testid={ready ? "tour-card-link" : "draft-card-link"} prefetch={ready} className="block focus-visible:outline-none">
                  <div className="relative aspect-[16/10] overflow-hidden bg-surface-subtle">
                    {item.thumbnail_url ? (
                      <Thumbnail src={item.thumbnail_url} alt={item.title} className="absolute inset-0 h-full w-full object-cover [@media(hover:hover)]:transition-transform [@media(hover:hover)]:duration-500 [@media(hover:hover)]:ease-out [@media(hover:hover)]:group-hover:scale-[1.03]" priority={index < 4} />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-muted/60 via-muted to-foreground/10 text-foreground/20"><MainTourIcon size={42} strokeWidth={1.35} /></div>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/5 to-black/15" aria-hidden="true" />
                    {/* Matches the p-4 sm:p-5 block at the foot of the card, so
                        everything over the photo shares one margin. */}
                    <StatusPill tone={statusTone(item)} dot className="absolute left-4 top-4 border-white/15 bg-black/55 text-white/90 shadow-sm backdrop-blur-md sm:left-5 sm:top-5">
                      {statusLabel(item, lang)}
                    </StatusPill>
                    {ready ? (
                      <span className="absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/15 bg-black/65 px-0 text-[11px] font-semibold text-white shadow-sm backdrop-blur-md transition-colors group-hover:bg-black/80 sm:right-5 sm:top-5 sm:w-auto sm:gap-1.5 sm:px-3">
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
              <Button type="button" variant="outline" size="sm" className="h-11" disabled={loadingMore} onClick={() => void loadMore()}>
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

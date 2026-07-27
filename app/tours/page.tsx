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
import { Thumbnail } from "../components/thumbnail";
import { listAllSplats } from "../lib/api/client";
import { getUserLanguage, t } from "../lib/i18n";
import type { SplatListItem } from "../lib/tour-types";
import { Button } from "../lib/ui/button";

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
  const [error, setError] = React.useState(false);
  const [query, setQuery] = React.useState("");

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
  const normalizedQuery = query.trim().toLowerCase();
  const visible = items.filter((item) => {
    if (!normalizedQuery) return true;
    return `${item.title} ${item.scan_type}`.toLowerCase().includes(normalizedQuery);
  });
  const showToolbar = !loading && !error && items.length > 0;

  return (
    <AppShell user={user} onLogout={logout}>
      <div className="mx-auto w-full max-w-[1320px] pb-10">
        <PageHeader
          title={t("tours.title", lang)}
          description={t("tours.subtitle", lang)}
          className={showToolbar ? "mb-6 md:mb-8 xl:mb-10" : "mb-6 md:mb-8"}
        />

        {showToolbar ? (
          <div className="mb-6 min-w-0 md:mb-8">
            <div className="flex w-full min-w-0 items-center gap-3 rounded-full border border-border/80 bg-card px-4 py-0.5 shadow-control md:max-w-[340px] md:rounded-none md:border-x-0 md:border-t-0 md:bg-transparent md:px-0 md:pb-2 md:pt-0 md:shadow-none">
              <SearchField
                value={query}
                onChange={setQuery}
                onClear={() => setQuery("")}
                placeholder={t("tours.search", lang)}
                clearLabel={t("dashboard.clearSearch", lang)}
                className="flex-1"
                appearance="toolbar"
              />
            </div>
          </div>
        ) : null}

        <div className="min-w-0">
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
            title={query ? t("tours.emptyFiltered", lang) : t("tours.empty", lang)}
            description={t("tours.emptyHint", lang)}
            action={query ? <Button type="button" variant="outline" size="sm" onClick={() => setQuery("")}>{t("dashboard.clearSearch", lang)}</Button> : undefined}
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
    </AppShell>
  );
}

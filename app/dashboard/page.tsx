"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../components/hooks/use-auth";
import { AppShell } from "../components/app-shell";
import { ProfileCard } from "../components/profile-card";
import { Button } from "../lib/ui/button";
import { t, getUserLanguage } from "../lib/i18n";
import { listSplats } from "../lib/api/client";
import { ShareDialog } from "../components/share-dialog";
import type { SplatListItem } from "../lib/tour-types";
import Link from "next/link";

function statusLabel(status: string) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export default function DashboardPage() {
  const { isAuthenticated, isLoading, user, logout } = useAuth();
  const router = useRouter();
  const [splats, setSplats] = React.useState<SplatListItem[]>([]);
  const [splatsLoading, setSplatsLoading] = React.useState(true);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [hasMore, setHasMore] = React.useState(false);
  const [totalCount, setTotalCount] = React.useState(0);
  const pageRef = React.useRef(1);
  const [shareTarget, setShareTarget] = React.useState<{ splatId: number; title: string } | null>(null);

  React.useEffect(() => {
    if (!isLoading && !isAuthenticated) router.replace("/");
  }, [isLoading, isAuthenticated, router]);

  const loadPage = React.useCallback(async (page: number, append: boolean) => {
    const data = await listSplats(page, 20);
    const results = data.results ?? [];
    setSplats((prev) => {
      const merged = append ? [...prev, ...results] : results;
      const seenId = new Set<number>();
      const seenDraft = new Set<number>();
      return merged.filter((s) => {
        if (seenId.has(s.id)) return false;
        seenId.add(s.id);
        if (s.source_draft && seenDraft.has(s.source_draft)) return false;
        if (s.source_draft) seenDraft.add(s.source_draft);
        return true;
      });
    });
    setHasMore(!!data.next);
    setTotalCount(data.count ?? 0);
    pageRef.current = page;
  }, []);

  React.useEffect(() => {
    if (!isAuthenticated) return;
    loadPage(1, false).catch(() => {}).finally(() => setSplatsLoading(false));
  }, [isAuthenticated, loadPage]);

  const handleLoadMore = React.useCallback(async () => {
    setLoadingMore(true);
    try { await loadPage(pageRef.current + 1, true); } catch {}
    setLoadingMore(false);
  }, [loadPage]);

  if (isLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-2 border-foreground/20 border-t-foreground rounded-full" />
      </div>
    );
  }

  const lang = getUserLanguage(user.localization);

  return (
    <AppShell user={user} onLogout={logout}>
      <div className="animate-fade-in space-y-5 sm:space-y-6">
        {/* Greeting */}
        <div className="rounded-[1.75rem] bg-card px-5 py-5 shadow-[0_10px_30px_rgba(15,23,42,0.04)] sm:px-6">
          <h1 className="text-[22px] sm:text-2xl font-bold tracking-tight">
            {t("dashboard.title", lang)}
          </h1>
          <p className="text-[13px] text-muted-foreground mt-0.5">
            {t("dashboard.welcome", lang)}, {user.first_name || user.email}.
          </p>
        </div>

        <ProfileCard user={user} />

        {/* Tours header */}
        <section className="rounded-[1.75rem] bg-card px-4 py-4 shadow-[0_10px_30px_rgba(15,23,42,0.04)] sm:px-5 sm:py-5">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-[16px] sm:text-lg font-semibold tracking-tight">
              {t("dashboard.virtualTours", lang)}
            </h2>
            {totalCount > 0 && (
              <span className="rounded-full bg-muted px-2.5 py-1 text-[11px] text-muted-foreground tabular-nums">
                {splats.length} / {totalCount}
              </span>
            )}
          </div>

          {splatsLoading ? (
            <div className="flex items-center justify-center py-16">
              <div className="animate-spin h-6 w-6 border-2 border-foreground/20 border-t-foreground rounded-full" />
            </div>
          ) : splats.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-foreground/[0.04]">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" className="text-foreground/25" aria-hidden="true">
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              </div>
              <p className="text-[14px] font-medium text-foreground/60">{t("dashboard.noSplatsTitle", lang)}</p>
              <p className="mt-1 max-w-[260px] text-[12px] leading-relaxed text-muted-foreground">{t("dashboard.noSplats", lang)}</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {splats.map((splat) => {
              const isReady = splat.status === "completed" && (splat.has_ply || splat.has_splat || splat.has_sog);
              return (
                <div key={splat.id} className="overflow-hidden rounded-[1.4rem] border border-border/60 bg-card transition-colors hover:border-border hover:shadow-[0_12px_24px_rgba(15,23,42,0.06)]">
                  {/* Thumbnail */}
                  <div className="aspect-[16/10] bg-muted/30 relative">
                    {splat.thumbnail_url ? (
                      <img src={splat.thumbnail_url} alt={splat.title} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" className="text-foreground/10">
                          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" stroke="currentColor" strokeWidth="1.5" />
                          <path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12" stroke="currentColor" strokeWidth="1.5" />
                        </svg>
                      </div>
                    )}
                    <span className="absolute top-2 right-2 text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-background/80 backdrop-blur text-foreground/70">
                      {statusLabel(splat.status)}
                    </span>
                  </div>

                  {/* Info */}
                  <div className="px-3.5 py-3.5">
                    <p className="text-[13px] font-medium truncate">{splat.title}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {new Date(splat.created_at).toLocaleDateString()}
                    </p>

                    {isReady && (
                      <div className="mt-2.5 flex flex-col gap-1.5 border-t border-border/40 pt-2.5 sm:flex-row">
                        <Button
                          variant="ghost" size="sm"
                          className="h-8 flex-1 text-[11px] text-foreground/50 hover:text-foreground"
                          onClick={() => setShareTarget({ splatId: splat.id, title: splat.title })}
                        >
                          {t("dashboard.share", lang)}
                        </Button>
                        <Link href={`/tour/${splat.id}`} className="sm:flex-1">
                          <Button variant="ghost" size="sm" className="h-8 w-full text-[11px] text-foreground/50 hover:text-foreground">
                            {t("dashboard.viewTour", lang)}
                          </Button>
                        </Link>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

              {hasMore && (
                <div className="col-span-full flex justify-center pt-3">
                  <Button variant="ghost" size="sm" className="text-[12px] text-foreground/45" onClick={handleLoadMore} loading={loadingMore}>
                    {t("dashboard.loadMore", lang)}
                  </Button>
                </div>
              )}
            </div>
          )}
        </section>
      </div>

      {shareTarget && (
        <ShareDialog splatId={shareTarget.splatId} title={shareTarget.title} open={!!shareTarget} onClose={() => setShareTarget(null)} />
      )}
    </AppShell>
  );
}

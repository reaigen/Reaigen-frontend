"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../components/hooks/use-auth";
import { AppShell } from "../components/app-shell";
import { ProfileCard } from "../components/profile-card";
import { Card, CardContent, CardHeader, CardTitle } from "../lib/ui/card";
import { Button } from "../lib/ui/button";
import { t, getUserLanguage } from "../lib/i18n";
import { listSplats } from "../lib/api/client";
import { ShareDialog } from "../components/share-dialog";
import type { SplatListItem } from "../lib/tour-types";
import Link from "next/link";

function statusBadge(status: string) {
  const colors: Record<string, string> = {
    completed: "bg-success/10 text-success",
    processing: "bg-primary/10 text-primary",
    pending: "bg-muted text-muted-foreground",
    failed: "bg-destructive/10 text-destructive",
  };
  return colors[status] ?? "bg-muted text-muted-foreground";
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

  // Share dialog state
  const [shareTarget, setShareTarget] = React.useState<{ splatId: number; title: string } | null>(null);

  React.useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace("/");
    }
  }, [isLoading, isAuthenticated, router]);

  const loadPage = React.useCallback(async (page: number, append: boolean) => {
    const data = await listSplats(page, 20);
    const results = data.results ?? [];
    setSplats((prev) => {
      const merged = append ? [...prev, ...results] : results;
      const seen = new Set<number>();
      return merged.filter((s) => { if (seen.has(s.id)) return false; seen.add(s.id); return true; });
    });
    setHasMore(!!data.next);
    setTotalCount(data.count ?? 0);
    pageRef.current = page;
  }, []);

  React.useEffect(() => {
    if (!isAuthenticated) return;
    loadPage(1, false)
      .catch(() => {})
      .finally(() => setSplatsLoading(false));
  }, [isAuthenticated, loadPage]);

  const handleLoadMore = React.useCallback(async () => {
    setLoadingMore(true);
    try {
      await loadPage(pageRef.current + 1, true);
    } catch {}
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
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("dashboard.title", lang)}</h1>
          <p className="text-muted-foreground mt-1">{t("dashboard.welcome", lang)}, {user.first_name || user.email}.</p>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <ProfileCard user={user} />

          <Card>
            <CardHeader>
              <CardTitle>{t("dashboard.quickActions", lang)}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Link href="/settings">
                <Button variant="outline" className="w-full justify-start">
                  {t("dashboard.editSettings", lang)}
                </Button>
              </Link>
            </CardContent>
          </Card>
        </div>

        {/* Virtual Tours */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>{t("dashboard.virtualTours", lang)}</CardTitle>
            {totalCount > 0 && (
              <span className="text-xs text-muted-foreground">{splats.length} / {totalCount}</span>
            )}
          </CardHeader>
          <CardContent>
            {splatsLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin h-6 w-6 border-2 border-foreground/20 border-t-foreground rounded-full" />
              </div>
            ) : splats.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">{t("dashboard.noSplats", lang)}</p>
            ) : (
              <div className="space-y-2">
                {splats.map((splat) => (
                  <div
                    key={splat.id}
                    className="flex items-center gap-3 rounded-xl border border-border/50 px-4 py-3 hover:bg-accent/50 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{splat.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(splat.created_at).toLocaleDateString()}
                        {splat.scan_type !== "unknown" && ` · ${splat.scan_type}`}
                      </p>
                    </div>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusBadge(splat.status)}`}>
                      {splat.status}
                    </span>
                    {(splat.status === "completed" && (splat.has_ply || splat.has_splat)) && (
                      <div className="flex items-center gap-1.5">
                        <Button
                          variant="outline"
                          size="xs"
                          onClick={() => setShareTarget({ splatId: splat.id, title: splat.title })}
                        >
                          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" className="mr-1">
                            <path d="M6.5 9.5L9.5 6.5M7 11L5.5 12.5a2.121 2.121 0 01-3-3L4 8m5-3l1.5-1.5a2.121 2.121 0 013 3L12 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                          {t("dashboard.share", lang)}
                        </Button>
                        <Link href={`/tour/${splat.id}`}>
                          <Button variant="outline" size="xs">
                            {t("dashboard.viewTour", lang)}
                          </Button>
                        </Link>
                      </div>
                    )}
                  </div>
                ))}

                {hasMore && (
                  <div className="pt-2 text-center">
                    <Button variant="ghost" size="sm" onClick={handleLoadMore} loading={loadingMore}>
                      {t("dashboard.loadMore", lang)}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Share Dialog */}
      {shareTarget && (
        <ShareDialog
          splatId={shareTarget.splatId}
          title={shareTarget.title}
          open={!!shareTarget}
          onClose={() => setShareTarget(null)}
        />
      )}
    </AppShell>
  );
}

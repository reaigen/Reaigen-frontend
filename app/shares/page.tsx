"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "../components/hooks/use-auth";
import { AppShell } from "../components/app-shell";
import { Button } from "../lib/ui/button";
import { t, getUserLanguage } from "../lib/i18n";
import {
  listShares,
  listAllSplats,
  getShareAnalytics,
  pauseShare,
  resumeShare,
  revokeShare,
} from "../lib/api/client";
import type { ShareData } from "../lib/tour-types";

type ShareStats = { total_accesses: number; unique_ips: number; authenticated_accesses: number; failed_pin_attempts: number };

async function copyToClipboard(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

function StatusDot({ status }: { status: string }) {
  const c: Record<string, string> = { active: "bg-emerald-500", paused: "bg-amber-500", expired: "bg-foreground/30", revoked: "bg-destructive" };
  return <span className={`w-2 h-2 rounded-full ${c[status] ?? c.expired}`} />;
}

export default function SharesPage() {
  const { isAuthenticated, isLoading, user, logout } = useAuth();
  const router = useRouter();
  const [shares, setShares] = React.useState<ShareData[]>([]);
  const [draftTitles, setDraftTitles] = React.useState<Record<number, string>>({});
  const [loading, setLoading] = React.useState(true);
  const [filter, setFilter] = React.useState<"all" | "active">("all");
  const [expandedId, setExpandedId] = React.useState<number | null>(null);
  const [stats, setStats] = React.useState<Record<number, ShareStats>>({});
  const [statsLoading, setStatsLoading] = React.useState<number | null>(null);
  const [copiedId, setCopiedId] = React.useState<number | null>(null);
  const [actionId, setActionId] = React.useState<number | null>(null);
  const [confirmRevokeId, setConfirmRevokeId] = React.useState<number | null>(null);

  React.useEffect(() => {
    if (!isLoading && !isAuthenticated) router.replace("/");
  }, [isLoading, isAuthenticated, router]);

  React.useEffect(() => {
    if (!isAuthenticated) return;
    Promise.all([
      listShares().then(setShares).catch(() => setShares([])),
      listAllSplats().then((splats) => {
        const map: Record<number, string> = {};
        for (const s of splats) { if (s.source_draft) map[s.source_draft] = s.title; }
        setDraftTitles(map);
      }).catch(() => {}),
    ]).finally(() => setLoading(false));
  }, [isAuthenticated]);

  const loadStats = React.useCallback(async (id: number) => {
    if (stats[id]) return;
    setStatsLoading(id);
    try {
      const r = await getShareAnalytics(id);
      setStats((p) => ({ ...p, [id]: r.stats }));
    } catch {}
    setStatsLoading(null);
  }, [stats]);

  const toggle = React.useCallback((id: number) => {
    const next = expandedId === id ? null : id;
    setExpandedId(next);
    if (next) loadStats(id);
  }, [expandedId, loadStats]);

  const handleCopy = React.useCallback(async (share: ShareData) => {
    if (await copyToClipboard(`${window.location.origin}/shared/${share.token}`)) {
      setCopiedId(share.id);
      setTimeout(() => setCopiedId(null), 2000);
    }
  }, []);

  const handlePause = React.useCallback(async (share: ShareData) => {
    setActionId(share.id);
    try { const r = await pauseShare(share.id); setShares((p) => p.map((s) => s.id === share.id ? r.share : s)); } catch {}
    setActionId(null);
  }, []);

  const handleResume = React.useCallback(async (share: ShareData) => {
    setActionId(share.id);
    try { const r = await resumeShare(share.id); setShares((p) => p.map((s) => s.id === share.id ? r.share : s)); } catch {}
    setActionId(null);
  }, []);

  const handleRevoke = React.useCallback(async (share: ShareData) => {
    setActionId(share.id);
    try { await revokeShare(share.id); setShares((p) => p.map((s) => s.id === share.id ? { ...s, status: "revoked" } : s)); setConfirmRevokeId(null); } catch {}
    setActionId(null);
  }, []);

  if (isLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-2 border-foreground/20 border-t-foreground rounded-full" />
      </div>
    );
  }

  const lang = getUserLanguage(user.localization);
  const filtered = filter === "active" ? shares.filter((s) => s.status === "active" || s.status === "paused") : shares;

  return (
    <AppShell user={user} onLogout={logout}>
      <div className="animate-fade-in space-y-5 sm:space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-3 rounded-[1.75rem] bg-card px-5 py-5 shadow-[0_10px_30px_rgba(15,23,42,0.04)] sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="min-w-0">
            <h1 className="text-[22px] sm:text-2xl font-bold tracking-tight">{t("shares.title", lang)}</h1>
            <p className="text-[13px] text-muted-foreground mt-0.5">{t("shares.manage", lang)}</p>
          </div>
          <div className="flex w-full overflow-hidden rounded-lg border border-border sm:w-auto">
            <button
              onClick={() => setFilter("all")}
              className={`flex-1 px-3 py-2 text-[12px] font-medium transition-colors sm:flex-none ${filter === "all" ? "bg-foreground text-background" : "text-foreground/50 hover:text-foreground"}`}
            >
              {t("shares.allShares", lang)}
            </button>
            <button
              onClick={() => setFilter("active")}
              className={`flex-1 border-l border-border px-3 py-2 text-[12px] font-medium transition-colors sm:flex-none ${filter === "active" ? "bg-foreground text-background" : "text-foreground/50 hover:text-foreground"}`}
            >
              {t("shares.activeOnly", lang)}
            </button>
          </div>
        </div>

        {/* List */}
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="animate-spin h-6 w-6 border-2 border-foreground/20 border-t-foreground rounded-full" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-12 h-12 rounded-full bg-foreground/[0.04] flex items-center justify-center mb-4">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" className="text-foreground/25">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <p className="text-[14px] font-medium text-foreground/60">{t("shares.noShares", lang)}</p>
            <p className="text-[12px] text-muted-foreground mt-1">{t("shares.noSharesHint", lang)}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((share) => {
              const isExpanded = expandedId === share.id;
              const isCopied = copiedId === share.id;
              const isActioning = actionId === share.id;
              const shareStats = stats[share.id];
              const isActive = share.status === "active";
              const isPaused = share.status === "paused";
              const isLive = isActive || isPaused;
              const tourName = share.title || draftTitles[share.draft] || "Untitled Tour";

              return (
                <div key={share.id} className={`rounded-[1.4rem] border bg-card transition-colors ${isExpanded ? "border-border shadow-[0_12px_24px_rgba(15,23,42,0.06)]" : "border-border/60 hover:border-border hover:shadow-[0_12px_24px_rgba(15,23,42,0.04)]"}`}>
                  {/* Main row */}
                  <div className="px-4 py-3.5 cursor-pointer" onClick={() => toggle(share.id)}>
                    <div className="flex items-start gap-3 sm:items-center">
                      <StatusDot status={share.status} />
                      <div className="flex-1 min-w-0">
                        <p className="text-[14px] font-medium truncate">{tourName}</p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          {share.access_count} {t("shares.views", lang)}
                          {share.requires_pin && " · PIN"}
                          {share.expires_at && ` · ${t("shares.expires", lang)} ${new Date(share.expires_at).toLocaleDateString()}`}
                          {share.max_access_count && ` · ${t("shares.viewLimit", lang)} ${share.max_access_count}`}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5 self-start sm:self-center">
                        {isLive && (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleCopy(share); }}
                            className={`h-7 px-2.5 rounded-md text-[11px] font-medium transition-all ${isCopied ? "bg-foreground text-background" : "bg-foreground/[0.06] text-foreground/60 hover:text-foreground hover:bg-foreground/[0.1]"}`}
                          >
                            {isCopied ? t("shares.copied", lang) : t("shares.copyLink", lang)}
                          </button>
                        )}
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className={`text-foreground/30 transition-transform ${isExpanded ? "rotate-180" : ""}`}>
                          <path d="M4 6L8 10L12 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </div>
                    </div>
                  </div>

                  {/* Expanded panel */}
                  {isExpanded && (
                    <div className="px-4 pb-4 space-y-3 border-t border-border/40 pt-3">
                      {/* Analytics */}
                      {statsLoading === share.id ? (
                        <div className="flex justify-center py-3">
                          <div className="animate-spin h-4 w-4 border-2 border-foreground/20 border-t-foreground rounded-full" />
                        </div>
                      ) : shareStats ? (
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-3">
                          <div className="rounded-lg bg-muted/50 px-3 py-2.5 text-center">
                            <p className="text-[18px] font-semibold tabular-nums">{shareStats.total_accesses}</p>
                            <p className="text-[10px] text-muted-foreground mt-0.5">{t("shares.totalViews", lang)}</p>
                          </div>
                          <div className="rounded-lg bg-muted/50 px-3 py-2.5 text-center">
                            <p className="text-[18px] font-semibold tabular-nums">{shareStats.unique_ips}</p>
                            <p className="text-[10px] text-muted-foreground mt-0.5">{t("shares.uniqueVisitors", lang)}</p>
                          </div>
                          <div className="rounded-lg bg-muted/50 px-3 py-2.5 text-center">
                            <p className={`text-[18px] font-semibold tabular-nums ${shareStats.failed_pin_attempts > 0 ? "text-destructive" : ""}`}>
                              {shareStats.failed_pin_attempts}
                            </p>
                            <p className="text-[10px] text-muted-foreground mt-0.5">{t("shares.failedPins", lang)}</p>
                          </div>
                        </div>
                      ) : null}

                      {/* Link URL */}
                      <div className="flex flex-col gap-1.5 rounded-lg bg-muted/30 px-3 py-2 sm:flex-row sm:items-center sm:gap-2">
                        <p className="text-[11px] font-mono truncate text-foreground/50 flex-1">
                          {typeof window !== "undefined" ? `${window.location.origin}/shared/${share.token}` : `/shared/${share.token}`}
                        </p>
                        {share.max_access_count && (
                          <span className="text-[10px] text-muted-foreground shrink-0">{t("shares.viewLimit", lang)}: {share.max_access_count}</span>
                        )}
                      </div>

                      {/* Management actions */}
                      {isLive && (
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pt-1">
                          {isActive && (
                            <button onClick={() => handlePause(share)} disabled={isActioning}
                              className="text-[12px] text-foreground/50 hover:text-foreground transition-colors disabled:opacity-40">
                              {t("shares.pause", lang)}
                            </button>
                          )}
                          {isPaused && (
                            <button onClick={() => handleResume(share)} disabled={isActioning}
                              className="text-[12px] font-medium text-foreground/70 hover:text-foreground transition-colors disabled:opacity-40">
                              {t("shares.resume", lang)}
                            </button>
                          )}
                          <span className="text-foreground/15">|</span>
                          {confirmRevokeId !== share.id ? (
                            <button onClick={() => setConfirmRevokeId(share.id)}
                              className="text-[12px] text-foreground/40 hover:text-destructive transition-colors">
                              {t("shares.revoke", lang)}
                            </button>
                          ) : (
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-[11px] text-destructive">{t("shares.revokeConfirm", lang)}</span>
                              <button onClick={() => handleRevoke(share)} disabled={isActioning}
                                className="text-[12px] font-medium text-destructive disabled:opacity-40">
                                {t("shares.revoke", lang)}
                              </button>
                              <button onClick={() => setConfirmRevokeId(null)}
                                className="text-[12px] text-foreground/40 hover:text-foreground transition-colors">
                                {t("shares.cancel", lang)}
                              </button>
                            </div>
                          )}
                          {share.draft && (
                            <>
                              <span className="text-foreground/15">|</span>
                              <Link href={`/tour/${share.draft}`} className="text-[12px] text-foreground/40 hover:text-foreground transition-colors">
                                {t("dashboard.viewTour", lang)}
                              </Link>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}

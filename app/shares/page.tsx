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
  const c: Record<string, string> = { active: "bg-foreground", paused: "bg-foreground/45", expired: "bg-foreground/25", revoked: "bg-foreground/15" };
  return <span className={`w-2 h-2 rounded-full ${c[status] ?? c.expired}`} />;
}

function shareUrl(token: string) {
  return `${window.location.origin}/shared/${token}`;
}

function maskedShareUrl(token: string) {
  const prefix = typeof window !== "undefined" ? `${window.location.origin}/shared/` : "/shared/";
  return `${prefix}${token.slice(0, 6)}...${token.slice(-4)}`;
}

function accessLabel(share: ShareData) {
  const controls = [
    share.requires_pin && "PIN",
    share.expires_at && "expires",
    share.max_access_count && "limited",
  ].filter(Boolean);
  return controls.length ? controls.join(" · ") : "public";
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
    if (await copyToClipboard(shareUrl(share.token))) {
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
  const activeShares = shares.filter((s) => s.status === "active");
  const pausedShares = shares.filter((s) => s.status === "paused");
  const unprotectedShares = activeShares.filter((s) => !s.requires_pin && !s.expires_at && !s.max_access_count);
  const failedPinAttempts = Object.values(stats).reduce((total, item) => total + item.failed_pin_attempts, 0);

  return (
    <AppShell user={user} onLogout={logout}>
      <div className="mx-auto max-w-5xl animate-fade-in space-y-6">
        {/* Header */}
        <div className="border-b border-border/70 pb-5">
          <div className="min-w-0">
            <h1 className="text-[22px] sm:text-2xl font-bold tracking-tight">{t("shares.title", lang)}</h1>
            <p className="text-[13px] text-muted-foreground mt-0.5">{t("shares.manage", lang)}</p>
          </div>
        </div>

        <div className="flex flex-col gap-3 border-b border-border/70 pb-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[12px] text-muted-foreground">
            {activeShares.length} active, {pausedShares.length} paused, {unprotectedShares.length} public without limits, {failedPinAttempts} failed PIN attempts loaded
          </p>
          <label className="flex items-center gap-2 text-[12px] text-muted-foreground">
            <span>View</span>
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as "all" | "active")}
              className="h-9 rounded-lg border border-border bg-background px-3 text-[13px] text-foreground outline-none focus:border-foreground/40"
            >
              <option value="all">{t("shares.allShares", lang)}</option>
              <option value="active">{t("shares.activeOnly", lang)}</option>
            </select>
          </label>
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
          <div className="border-y border-border/70">
            <div className="hidden grid-cols-[minmax(0,1fr)_8rem_9rem_5rem] border-b border-border/70 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground sm:grid">
              <span>Tour</span>
              <span>Status</span>
              <span>Access</span>
              <span className="text-right">Actions</span>
            </div>
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
                <div key={share.id} className="border-b border-border/60 last:border-b-0">
                  {/* Main row */}
                  <button type="button" className="w-full px-0 py-4 text-left" onClick={() => toggle(share.id)}>
                    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem_9rem_5rem] sm:items-center">
                      <div className="flex min-w-0 items-start gap-3">
                        <StatusDot status={share.status} />
                        <div className="min-w-0">
                        <p className="text-[14px] font-medium truncate">{tourName}</p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          {share.access_count} {t("shares.views", lang)}
                          {` · ${accessLabel(share)}`}
                          {share.expires_at && ` · ${t("shares.expires", lang)} ${new Date(share.expires_at).toLocaleDateString()}`}
                          {share.max_access_count && ` · ${t("shares.viewLimit", lang)} ${share.max_access_count}`}
                        </p>
                        </div>
                      </div>
                      <div className="hidden text-[12px] text-muted-foreground sm:block">{share.status}</div>
                      <div className="hidden text-[12px] text-muted-foreground sm:block">{accessLabel(share)}</div>
                      <div className="flex shrink-0 items-center justify-start gap-1.5 self-start sm:justify-end sm:self-center">
                        {isActive && (
                          <span
                            onClick={(e) => { e.stopPropagation(); handleCopy(share); }}
                            className={`inline-flex h-7 items-center px-2.5 rounded-md text-[11px] font-medium transition-all ${isCopied ? "bg-foreground text-background" : "bg-foreground/[0.06] text-foreground/60 hover:text-foreground hover:bg-foreground/[0.1]"}`}
                          >
                            {isCopied ? t("shares.copied", lang) : t("shares.copyLink", lang)}
                          </span>
                        )}
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className={`text-foreground/30 transition-transform ${isExpanded ? "rotate-180" : ""}`}>
                          <path d="M4 6L8 10L12 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </div>
                    </div>
                  </button>

                  {/* Expanded panel */}
                  {isExpanded && (
                    <div className="space-y-4 border-t border-border/50 pb-4 pt-4">
                      {/* Analytics */}
                      {statsLoading === share.id ? (
                        <div className="flex justify-center py-3">
                          <div className="animate-spin h-4 w-4 border-2 border-foreground/20 border-t-foreground rounded-full" />
                        </div>
                      ) : shareStats ? (
                        <div className="grid grid-cols-3 gap-4">
                          <div>
                            <p className="text-[17px] font-semibold tabular-nums">{shareStats.total_accesses}</p>
                            <p className="text-[11px] text-muted-foreground mt-0.5">{t("shares.totalViews", lang)}</p>
                          </div>
                          <div>
                            <p className="text-[17px] font-semibold tabular-nums">{shareStats.unique_ips}</p>
                            <p className="text-[11px] text-muted-foreground mt-0.5">{t("shares.uniqueVisitors", lang)}</p>
                          </div>
                          <div>
                            <p className="text-[17px] font-semibold tabular-nums">
                              {shareStats.failed_pin_attempts}
                            </p>
                            <p className="text-[11px] text-muted-foreground mt-0.5">{t("shares.failedPins", lang)}</p>
                          </div>
                        </div>
                      ) : null}

                      {/* Link URL */}
                      <div className="flex flex-col gap-1.5 border-t border-border/50 pt-3 sm:flex-row sm:items-center sm:gap-2">
                        <p className="text-[11px] font-mono truncate text-foreground/50 flex-1">
                          {maskedShareUrl(share.token)}
                        </p>
                        {isActive && (
                          <button
                            onClick={() => handleCopy(share)}
                            className="text-[11px] font-medium text-foreground/50 hover:text-foreground transition-colors"
                          >
                            {isCopied ? t("shares.copied", lang) : t("shares.copyLink", lang)}
                          </button>
                        )}
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

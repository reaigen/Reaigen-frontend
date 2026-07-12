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
  listSplats,
  pauseShare,
  resumeShare,
  revokeShare,
} from "../lib/api/client";
import type { ShareData } from "../lib/tour-types";

async function copyToClipboard(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

function shareUrl(token: string) {
  return `${window.location.origin}/shared/${token}`;
}

function formatDate(dateStr: string, lang: string): string {
  return new Date(dateStr).toLocaleDateString(lang, { month: "short", day: "numeric" });
}

function expiryLabel(dateStr: string | null, lang: string): string | null {
  if (!dateStr) return null;
  const diff = new Date(dateStr).getTime() - Date.now();
  const days = Math.round(diff / 86400000);
  if (days < 0) return t("shares.expired", lang);
  if (days === 0) return t("shares.expirestoday", lang);
  if (days === 1) return t("shares.expirestomorrow", lang);
  return `${days}d`;
}

/* ── Share Row ────────────────────────────────────────────────────────── */

function ShareRow({
  share,
  tourName,
  tourLink,
  lang,
  onUpdate,
}: {
  share: ShareData;
  tourName: string;
  tourLink: string | null;
  lang: string;
  onUpdate: (updated: ShareData | null) => void;
}) {
  const [copied, setCopied] = React.useState(false);
  const [actionLoading, setActionLoading] = React.useState(false);
  const [confirmRevoke, setConfirmRevoke] = React.useState(false);

  const isActive = share.status === "active";
  const isPaused = share.status === "paused";

  const handleCopy = async () => {
    if (await copyToClipboard(shareUrl(share.token))) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handlePause = async () => {
    setActionLoading(true);
    try { const r = await pauseShare(share.id); onUpdate(r.share); } catch {}
    setActionLoading(false);
  };

  const handleResume = async () => {
    setActionLoading(true);
    try { const r = await resumeShare(share.id); onUpdate(r.share); } catch {}
    setActionLoading(false);
  };

  const handleRevoke = async () => {
    setActionLoading(true);
    try { await revokeShare(share.id); onUpdate(null); } catch {}
    setActionLoading(false);
  };

  const statusLabel = isActive
    ? t("shares.statusActive", lang)
    : isPaused
      ? t("shares.statusPaused", lang)
      : share.status === "expired"
        ? t("shares.statusExpired", lang)
        : t("shares.statusRevoked", lang);

  const statusColor = isActive
    ? "text-foreground/80"
    : isPaused
      ? "text-foreground/50"
      : "text-foreground/30";

  const expiry = expiryLabel(share.expires_at, lang);

  return (
    <div className="group rounded-xl border border-border/60 bg-background px-4 py-4 transition-colors hover:border-border">
      {/* Top: name + status */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {tourLink ? (
              <Link href={tourLink} className="text-[13px] font-medium truncate hover:underline">{tourName}</Link>
            ) : (
              <span className="text-[13px] font-medium truncate">{tourName}</span>
            )}
          </div>
        </div>
        <span className={`text-[11px] font-medium shrink-0 ${statusColor}`}>
          {statusLabel}
        </span>
      </div>

      {/* Meta row */}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <span>{share.access_count} {share.access_count === 1 ? t("shares.viewSingular", lang) : t("shares.viewPlural", lang)}</span>
        {share.requires_pin && <span className="text-foreground/50">PIN</span>}
        {share.max_access_count && <span>{t("shares.viewLimit", lang)}: {share.max_access_count}</span>}
        {expiry && <span>{expiry}</span>}
        <span>{formatDate(share.created_at, lang)}</span>
      </div>

      {/* Actions row */}
      <div className="mt-3 flex items-center gap-2">
        {(isActive || isPaused) && (
          <button
            onClick={handleCopy}
            className={`inline-flex h-7 items-center gap-1.5 px-3 rounded-lg text-[11px] font-medium transition-all ${
              copied
                ? "bg-foreground text-background"
                : "bg-foreground/[0.05] text-foreground/70 hover:bg-foreground/[0.09]"
            }`}
          >
            {copied ? (
              <>
                <svg width="11" height="11" viewBox="0 0 16 16" fill="none"><path d="M3 8.5L6.5 12L13 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                {t("shares.copied", lang)}
              </>
            ) : (
              <>
                <svg width="11" height="11" viewBox="0 0 16 16" fill="none"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.5" /><path d="M10.5 5.5V3.5C10.5 2.67 9.83 2 9 2H3.5C2.67 2 2 2.67 2 3.5V9C2 9.83 2.67 10.5 3.5 10.5H5.5" stroke="currentColor" strokeWidth="1.5" /></svg>
                {t("shares.copyLink", lang)}
              </>
            )}
          </button>
        )}

        {isActive && (
          <button onClick={handlePause} disabled={actionLoading}
            className="h-7 px-2.5 rounded-lg text-[11px] text-muted-foreground hover:text-foreground hover:bg-foreground/[0.04] transition-colors disabled:opacity-40">
            {t("shares.pause", lang)}
          </button>
        )}
        {isPaused && (
          <button onClick={handleResume} disabled={actionLoading}
            className="h-7 px-2.5 rounded-lg text-[11px] font-medium text-foreground/70 hover:bg-foreground/[0.04] transition-colors disabled:opacity-40">
            {t("shares.resume", lang)}
          </button>
        )}

        {(isActive || isPaused) && (
          !confirmRevoke ? (
            <button onClick={() => setConfirmRevoke(true)}
              className="h-7 px-2.5 rounded-lg text-[11px] text-muted-foreground hover:text-destructive hover:bg-destructive/[0.05] transition-colors">
              {t("shares.revoke", lang)}
            </button>
          ) : (
            <div className="flex items-center gap-1.5">
              <button onClick={handleRevoke} disabled={actionLoading}
                className="h-7 px-2.5 rounded-lg text-[11px] font-medium text-destructive bg-destructive/[0.06] hover:bg-destructive/[0.1] transition-colors disabled:opacity-40">
                {t("shares.revoke", lang)}
              </button>
              <button onClick={() => setConfirmRevoke(false)}
                className="h-7 px-2.5 rounded-lg text-[11px] text-muted-foreground hover:text-foreground transition-colors">
                {t("shares.cancel", lang)}
              </button>
            </div>
          )
        )}
      </div>
    </div>
  );
}

/* ── Page ──────────────────────────────────────────────────────────────── */

export default function SharesPage() {
  const { isAuthenticated, isLoading, user, logout } = useAuth();
  const router = useRouter();
  const [shares, setShares] = React.useState<ShareData[]>([]);
  const [splatsByDraft, setSplatsByDraft] = React.useState<Record<number, { title: string; splatId: number }>>({});
  const [loading, setLoading] = React.useState(true);
  const [filter, setFilter] = React.useState<"all" | "active" | "inactive">("all");

  React.useEffect(() => {
    if (!isLoading && !isAuthenticated) router.replace("/");
  }, [isLoading, isAuthenticated, router]);

  React.useEffect(() => {
    if (!isAuthenticated) return;
    Promise.all([
      listShares().then(setShares).catch(() => setShares([])),
      listSplats(1, 50).then((res) => {
        const map: Record<number, { title: string; splatId: number }> = {};
        for (const s of (res.results ?? [])) { if (s.source_draft) map[s.source_draft] = { title: s.title, splatId: s.id }; }
        setSplatsByDraft(map);
      }).catch(() => {}),
    ]).finally(() => setLoading(false));
  }, [isAuthenticated]);

  const handleShareUpdate = React.useCallback((id: number, updated: ShareData | null) => {
    if (!updated) {
      setShares((p) => p.filter((s) => s.id !== id));
    } else {
      setShares((p) => p.map((s) => s.id === id ? updated : s));
    }
  }, []);

  if (isLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin h-7 w-7 border-2 border-foreground/15 border-t-foreground/60 rounded-full" />
      </div>
    );
  }

  const lang = getUserLanguage(user.localization);
  const filtered = filter === "active"
    ? shares.filter((s) => s.status === "active" || s.status === "paused")
    : filter === "inactive"
      ? shares.filter((s) => s.status === "expired" || s.status === "revoked")
      : shares;
  const activeCount = shares.filter((s) => s.status === "active").length;

  return (
    <AppShell user={user} onLogout={logout}>
      <div className="mx-auto w-full max-w-2xl space-y-5 animate-fade-in">
        {/* Header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-[18px] font-semibold tracking-tight sm:text-xl">{t("shares.title", lang)}</h1>
            {shares.length > 0 && (
              <p className="text-[12px] text-muted-foreground mt-0.5">
                {activeCount} {t("shares.summaryActive", lang)} · {shares.length} {t("shares.allShares", lang).toLowerCase()}
              </p>
            )}
          </div>
          {shares.length > 0 && (
            <div className="flex items-center gap-0.5 rounded-lg bg-muted/50 p-0.5">
              {(["all", "active", "inactive"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all ${
                    filter === f
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {f === "all" ? t("shares.allShares", lang) : f === "active" ? t("shares.activeOnly", lang) : t("shares.inactiveOnly", lang)}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Content */}
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="rounded-xl border border-border/60 px-4 py-4 animate-pulse">
                <div className="flex items-center justify-between">
                  <div className="h-4 w-1/3 rounded bg-muted/50" />
                  <div className="h-3 w-12 rounded bg-muted/30" />
                </div>
                <div className="mt-2.5 h-3 w-2/5 rounded bg-muted/30" />
                <div className="mt-3 h-7 w-24 rounded-lg bg-muted/30" />
              </div>
            ))}
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
            <p className="text-[12px] text-muted-foreground mt-1 max-w-[260px]">{t("shares.noSharesHint", lang)}</p>
            <Link href="/dashboard">
              <Button variant="ghost" size="sm" className="mt-4 text-[12px]">
                {t("shares.goToDashboard", lang)}
              </Button>
            </Link>
          </div>
        ) : (
          <div className="space-y-2.5">
            {filtered.map((share) => {
              const draftTour = splatsByDraft[share.draft];
              const tourName = share.title || draftTour?.title || t("shares.untitledTour", lang);
              const tourLink = share.draft ? `/draft/${share.draft}` : null;

              return (
                <ShareRow
                  key={share.id}
                  share={share}
                  tourName={tourName}
                  tourLink={tourLink}
                  lang={lang}
                  onUpdate={(updated) => handleShareUpdate(share.id, updated)}
                />
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}

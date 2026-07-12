"use client";

import * as React from "react";
import { t, formatDateShort, type LocaleKey } from "../../lib/i18n";
import {
  pauseShare,
  resumeShare,
  revokeShare,
  getShareAnalytics,
} from "../../lib/api/client";
import type { ShareData, ShareBundleName } from "../../lib/tour-types";
import { SHARE_BUNDLES } from "../../lib/tour-types";

// ── Helpers ────────────────────────────────────────────────────────────

async function copyToClipboard(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

function shareUrl(token: string) {
  return `${window.location.origin}/shared/${token}`;
}

type ShareStats = { total_accesses: number; unique_ips: number; authenticated_accesses: number; failed_pin_attempts: number };

function detectBundle(selected: string[]): ShareBundleName | null {
  const set = new Set(selected);
  for (const name of ["minimal", "less", "all"] as const) {
    const bundle = SHARE_BUNDLES[name];
    if (bundle.length === set.size && bundle.every((f) => set.has(f))) return name;
  }
  return null;
}

function fieldSummaryLabel(share: ShareData, lang: string): string {
  if (share.fields?.length) {
    const visible = share.fields.filter((f) => f.is_visible).map((f) => f.field_name);
    const bundleName = detectBundle(visible);
    if (bundleName) return t(`shareDialog.bundle.${bundleName}` as LocaleKey, lang);
    return `${visible.length} ${t("shareDialog.fieldSummary", lang)}`;
  }
  return t("shareDialog.bundle.less", lang);
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

const STATUS_CONFIG: Record<string, { dot: string; bg: string; text: string; labelKey: LocaleKey }> = {
  active:  { dot: "bg-emerald-500", bg: "bg-emerald-500/10", text: "text-emerald-700 dark:text-emerald-400", labelKey: "shares.statusActive" },
  paused:  { dot: "bg-amber-500",   bg: "bg-amber-500/10",   text: "text-amber-700 dark:text-amber-400",   labelKey: "shares.statusPaused" },
  expired: { dot: "bg-foreground/20", bg: "bg-foreground/[0.04]", text: "text-foreground/40", labelKey: "shares.statusExpired" },
  revoked: { dot: "bg-foreground/20", bg: "bg-foreground/[0.04]", text: "text-foreground/40", labelKey: "shares.statusRevoked" },
};

// ── Component ──────────────────────────────────────────────────────────

interface ShareLinkCardProps {
  share: ShareData;
  lang: string;
  onUpdate: (updated: ShareData | null) => void;
  onEdit: () => void;
}

export function ShareLinkCard({ share, lang, onUpdate, onEdit }: ShareLinkCardProps) {
  const [copied, setCopied] = React.useState(false);
  const [actionLoading, setActionLoading] = React.useState(false);
  const [confirmRevoke, setConfirmRevoke] = React.useState(false);
  const [expanded, setExpanded] = React.useState(false);
  const [stats, setStats] = React.useState<ShareStats | null>(null);
  const [statsLoading, setStatsLoading] = React.useState(false);

  const isActive = share.status === "active";
  const isPaused = share.status === "paused";
  const isLive = isActive || isPaused;
  const cfg = STATUS_CONFIG[share.status] ?? STATUS_CONFIG.revoked;
  const expiry = expiryLabel(share.expires_at, lang);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (await copyToClipboard(shareUrl(share.token))) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleToggleExpand = () => {
    const next = !expanded;
    setExpanded(next);
    if (next && !stats && !statsLoading) {
      setStatsLoading(true);
      getShareAnalytics(share.id).then((a) => setStats(a.stats)).catch(() => {}).finally(() => setStatsLoading(false));
    }
  };

  const handlePause = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setActionLoading(true);
    try { const r = await pauseShare(share.id); onUpdate(r.share); } catch {}
    setActionLoading(false);
  };

  const handleResume = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setActionLoading(true);
    try { const r = await resumeShare(share.id); onUpdate(r.share); } catch {}
    setActionLoading(false);
  };

  const handleRevoke = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setActionLoading(true);
    try { await revokeShare(share.id); onUpdate(null); } catch {}
    setActionLoading(false);
  };

  return (
    <div className={`rounded-xl border transition-colors ${isLive ? "border-border/70 bg-background hover:border-border" : "border-border/40 bg-muted/20"}`}>
      {/* Collapsed row */}
      <div
        role="button"
        tabIndex={0}
        onClick={handleToggleExpand}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleToggleExpand(); } }}
        className="w-full text-left px-4 py-3 flex items-center gap-3 cursor-pointer"
      >
        <span className={`w-2 h-2 rounded-full shrink-0 ${cfg.dot}`} />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={`text-[13px] font-medium ${isLive ? "" : "text-foreground/50"}`}>
              {t("sharing.linkLabel", lang)}
            </span>
            {share.requires_pin && (
              <span className="shrink-0 inline-flex items-center gap-0.5 rounded bg-foreground/[0.05] px-1.5 py-px text-[9px] font-medium text-foreground/50 uppercase tracking-wider">
                <svg width="8" height="8" viewBox="0 0 16 16" fill="none"><rect x="3" y="7" width="10" height="7" rx="2" stroke="currentColor" strokeWidth="1.5" /><path d="M5 7V5a3 3 0 016 0v2" stroke="currentColor" strokeWidth="1.5" /></svg>
                PIN
              </span>
            )}
            {expiry && (
              <span className="shrink-0 rounded bg-foreground/[0.05] px-1.5 py-px text-[9px] font-medium text-foreground/40">
                {expiry}
              </span>
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className="tabular-nums">{share.access_count} {share.access_count === 1 ? t("shares.viewSingular", lang) : t("shares.viewPlural", lang)}</span>
            <span className="text-foreground/15">·</span>
            <span>{fieldSummaryLabel(share, lang)}</span>
            <span className="text-foreground/15">·</span>
            <span>{formatDateShort(share.created_at, lang)}</span>
          </div>
        </div>

        <span className={`shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${cfg.bg} ${cfg.text}`}>
          {t(cfg.labelKey, lang)}
        </span>

        {isLive && (
          <button
            onClick={handleCopy}
            className={`shrink-0 inline-flex h-7 items-center gap-1 px-2.5 rounded-lg text-[11px] font-medium transition-all ${
              copied
                ? "bg-foreground text-background"
                : "bg-foreground/[0.06] text-foreground/60 hover:bg-foreground/[0.1] hover:text-foreground"
            }`}
          >
            {copied ? (
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M3 8.5L6.5 12L13 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.5" /><path d="M10.5 5.5V3.5C10.5 2.67 9.83 2 9 2H3.5C2.67 2 2 2.67 2 3.5V9C2 9.83 2.67 10.5 3.5 10.5H5.5" stroke="currentColor" strokeWidth="1.5" /></svg>
            )}
            {copied ? t("shares.copied", lang) : t("shares.copyLink", lang)}
          </button>
        )}

        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className={`shrink-0 text-foreground/25 transition-transform ${expanded ? "rotate-180" : ""}`}>
          <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>

      {/* Expanded panel */}
      {expanded && (
        <div className="border-t border-border/50 px-4 py-3 space-y-3">
          {isLive && (
            <div className="flex items-center gap-2 rounded-lg bg-muted/30 px-3 py-2">
              <p className="flex-1 text-[11px] font-mono text-foreground/60 truncate select-all">{shareUrl(share.token)}</p>
            </div>
          )}

          {/* Analytics */}
          <div className={`grid gap-2 ${share.requires_pin ? "grid-cols-4" : "grid-cols-3"}`}>
            {statsLoading ? (
              <div className="col-span-full flex items-center justify-center py-3">
                <div className="animate-spin h-4 w-4 border-2 border-foreground/10 border-t-foreground/50 rounded-full" />
              </div>
            ) : stats ? (
              <>
                <div className="rounded-lg bg-foreground/[0.03] px-3 py-2.5 text-center">
                  <p className="text-[18px] font-semibold tabular-nums">{stats.total_accesses}</p>
                  <p className="text-[9px] text-muted-foreground uppercase tracking-wider mt-0.5">{t("shareDialog.analytics.totalViews", lang)}</p>
                </div>
                <div className="rounded-lg bg-foreground/[0.03] px-3 py-2.5 text-center">
                  <p className="text-[18px] font-semibold tabular-nums">{stats.unique_ips}</p>
                  <p className="text-[9px] text-muted-foreground uppercase tracking-wider mt-0.5">{t("shareDialog.analytics.uniqueVisitors", lang)}</p>
                </div>
                <div className="rounded-lg bg-foreground/[0.03] px-3 py-2.5 text-center">
                  <p className="text-[18px] font-semibold tabular-nums">{stats.authenticated_accesses}</p>
                  <p className="text-[9px] text-muted-foreground uppercase tracking-wider mt-0.5">{t("shareDialog.analytics.authenticated", lang)}</p>
                </div>
                {share.requires_pin && (
                  <div className="rounded-lg bg-foreground/[0.03] px-3 py-2.5 text-center">
                    <p className="text-[18px] font-semibold tabular-nums">{stats.failed_pin_attempts}</p>
                    <p className="text-[9px] text-muted-foreground uppercase tracking-wider mt-0.5">{t("shareDialog.analytics.failedPins", lang)}</p>
                  </div>
                )}
              </>
            ) : (
              <div className="rounded-lg bg-foreground/[0.03] px-3 py-2.5 text-center">
                <p className="text-[18px] font-semibold tabular-nums">{share.access_count}</p>
                <p className="text-[9px] text-muted-foreground uppercase tracking-wider mt-0.5">{t("shareDialog.analytics.totalViews", lang)}</p>
              </div>
            )}
          </div>

          {/* Detail row */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
            <span>{fieldSummaryLabel(share, lang)}</span>
            {share.max_access_count && <span>{t("shares.viewLimit", lang)}: {share.max_access_count}</span>}
            {share.expires_at && (
              <span>
                <svg width="10" height="10" viewBox="0 0 16 16" fill="none" className="inline mr-0.5 -mt-px"><circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.5" /><path d="M8 5v3.5l2.5 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
                {formatDateShort(share.expires_at, lang)}
              </span>
            )}
          </div>

          {/* Actions */}
          {isLive && (
            <div className="flex items-center gap-1.5 pt-1 border-t border-border/40">
              <button onClick={(e) => { e.stopPropagation(); onEdit(); }}
                className="h-7 px-3 rounded-lg text-[11px] font-medium bg-foreground/[0.05] text-foreground/70 hover:bg-foreground/[0.09] transition-colors">
                {t("shares.editSettings", lang)}
              </button>
              {isActive && (
                <button onClick={handlePause} disabled={actionLoading}
                  className="h-7 px-3 rounded-lg text-[11px] text-muted-foreground hover:bg-foreground/[0.04] transition-colors disabled:opacity-40">
                  {t("shares.pause", lang)}
                </button>
              )}
              {isPaused && (
                <button onClick={handleResume} disabled={actionLoading}
                  className="h-7 px-3 rounded-lg text-[11px] font-medium text-foreground/70 hover:bg-foreground/[0.04] transition-colors disabled:opacity-40">
                  {t("shares.resume", lang)}
                </button>
              )}
              <div className="flex-1" />
              {!confirmRevoke ? (
                <button onClick={(e) => { e.stopPropagation(); setConfirmRevoke(true); }}
                  className="h-7 px-3 rounded-lg text-[11px] text-muted-foreground hover:text-destructive hover:bg-destructive/[0.06] transition-colors">
                  {t("shares.revoke", lang)}
                </button>
              ) : (
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-destructive/70">{t("shares.revokeConfirm", lang)}</span>
                  <button onClick={handleRevoke} disabled={actionLoading}
                    className="h-7 px-3 rounded-lg text-[11px] font-medium text-destructive bg-destructive/[0.08] hover:bg-destructive/[0.12] transition-colors disabled:opacity-40">
                    {t("shares.revoke", lang)}
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); setConfirmRevoke(false); }}
                    className="h-7 px-2 rounded-lg text-[11px] text-muted-foreground hover:text-foreground transition-colors">
                    {t("shares.cancel", lang)}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

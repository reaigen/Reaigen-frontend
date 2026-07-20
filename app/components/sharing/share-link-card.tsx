"use client";

import * as React from "react";
import { t, formatDate } from "../../lib/i18n";
import {
  pauseShare,
  resumeShare,
  revokeShare,
  getShareAnalytics,
} from "../../lib/api/client";
import type { ShareData } from "../../lib/tour-types";
import { Button } from "../../lib/ui/button";
import {
  copyToClipboard,
  shareUrl,
  fieldSummaryLabel,
  expiryLabel,
  STATUS_CONFIG,
  type ShareStats,
} from "../../lib/share-ui";

// ── Component ──────────────────────────────────────────────────────────

interface ShareLinkCardProps {
  share: ShareData;
  lang: string;
  dateFormat?: string | null;
  onUpdate: (updated: ShareData | null) => void;
  onEdit: () => void;
}

export function ShareLinkCard({ share, lang, dateFormat, onUpdate, onEdit }: ShareLinkCardProps) {
  const [copied, setCopied] = React.useState(false);
  const [actionLoading, setActionLoading] = React.useState(false);
  const [confirmRevoke, setConfirmRevoke] = React.useState(false);
  const [expanded, setExpanded] = React.useState(false);
  const [stats, setStats] = React.useState<ShareStats | null>(null);
  const [statsLoading, setStatsLoading] = React.useState(false);
  const [actionError, setActionError] = React.useState(false);

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
      getShareAnalytics(share.id).then((a) => setStats(a.stats)).catch(() => setActionError(true)).finally(() => setStatsLoading(false));
    }
  };

  const handlePause = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setActionError(false);
    setActionLoading(true);
    try { const r = await pauseShare(share.id); onUpdate(r.share); } catch { setActionError(true); }
    setActionLoading(false);
  };

  const handleResume = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setActionError(false);
    setActionLoading(true);
    try { const r = await resumeShare(share.id); onUpdate(r.share); } catch { setActionError(true); }
    setActionLoading(false);
  };

  const handleRevoke = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setActionError(false);
    setActionLoading(true);
    try { await revokeShare(share.id); onUpdate(null); } catch { setActionError(true); }
    setActionLoading(false);
  };

  return (
    <div className={`rounded-xl border transition-colors ${isLive ? "border-border/60 bg-background hover:border-border" : "border-border/40 bg-muted/20"}`}>
      {/* Collapsed row */}
      <div className="w-full px-3.5 py-2.5 flex items-center gap-2.5">
        <button type="button" onClick={handleToggleExpand} aria-expanded={expanded} className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
          <span className={`w-2 h-2 rounded-full shrink-0 ${cfg.dot}`} />

          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className={`text-[13px] font-semibold ${isLive ? "" : "text-foreground/50"}`}>
                {t("sharing.linkLabel", lang)}
              </span>
              {share.requires_pin && (
                <span className="shrink-0 inline-flex items-center gap-0.5 rounded bg-foreground/[0.07] px-1.5 py-px text-[11px] font-medium text-foreground/60 uppercase tracking-wider">
                  <svg aria-hidden="true" width="8" height="8" viewBox="0 0 16 16" fill="none"><rect x="3" y="7" width="10" height="7" rx="2" stroke="currentColor" strokeWidth="1.5" /><path d="M5 7V5a3 3 0 016 0v2" stroke="currentColor" strokeWidth="1.5" /></svg>
                  PIN
                </span>
              )}
              {expiry && (
                <span className="shrink-0 rounded bg-foreground/[0.07] px-1.5 py-px text-[11px] font-medium text-foreground/50">
                  {expiry}
                </span>
              )}
            </span>
            <span className="mt-0.5 flex items-center gap-2 text-[11px] text-foreground/60">
              <span className="tabular-nums">{share.access_count} {share.access_count === 1 ? t("shares.viewSingular", lang) : t("shares.viewPlural", lang)}</span>
              <span className="text-foreground/35">·</span>
              <span>{fieldSummaryLabel(share, lang)}</span>
              <span className="text-foreground/35">·</span>
              <span>{formatDate(share.created_at, dateFormat, lang)}</span>
            </span>
          </span>

          <span className={`shrink-0 inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${cfg.bg} ${cfg.text}`}>
            {t(cfg.labelKey, lang)}
          </span>

          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none" className={`shrink-0 text-foreground/35 transition-transform ${expanded ? "rotate-180" : ""}`}>
            <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        {isLive && (
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={handleCopy}
            className={`shrink-0 gap-1 text-[11px] [&_svg]:size-3 ${copied ? "border-foreground bg-foreground text-background hover:bg-foreground hover:text-background" : "text-foreground/70 hover:text-foreground"}`}
          >
            {copied ? (
              <svg aria-hidden="true" width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M3 8.5L6.5 12L13 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            ) : (
              <svg aria-hidden="true" width="12" height="12" viewBox="0 0 16 16" fill="none"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.5" /><path d="M10.5 5.5V3.5C10.5 2.67 9.83 2 9 2H3.5C2.67 2 2 2.67 2 3.5V9C2 9.83 2.67 10.5 3.5 10.5H5.5" stroke="currentColor" strokeWidth="1.5" /></svg>
            )}
            {copied ? t("shares.copied", lang) : t("shares.copyLink", lang)}
          </Button>
        )}
      </div>

      {/* Expanded panel */}
      <div className="grid transition-[grid-template-rows] duration-200 ease-out" style={{ gridTemplateRows: expanded ? "1fr" : "0fr" }}>
        <div className="overflow-hidden">
          <div className={`border-t border-border/40 px-3.5 py-3 space-y-3 ${expanded ? "" : "invisible"}`}>
          {isLive && (
            <div className="flex items-center gap-2 rounded-xl bg-foreground/[0.03] px-3 py-2">
              <p className="flex-1 text-[11px] font-mono text-foreground/70 truncate select-all">{shareUrl(share.token)}</p>
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
                <div className="rounded-xl bg-foreground/[0.03] px-3 py-2.5 text-center">
                  <p className="text-[17px] font-semibold tabular-nums leading-tight">{stats.total_accesses}</p>
                  <p className="text-[11px] text-foreground/50 mt-0.5">{t("shareDialog.analytics.totalViews", lang)}</p>
                </div>
                <div className="rounded-xl bg-foreground/[0.03] px-3 py-2.5 text-center">
                  <p className="text-[17px] font-semibold tabular-nums leading-tight">{stats.unique_ips}</p>
                  <p className="text-[11px] text-foreground/50 mt-0.5">{t("shareDialog.analytics.uniqueVisitors", lang)}</p>
                </div>
                <div className="rounded-xl bg-foreground/[0.03] px-3 py-2.5 text-center">
                  <p className="text-[17px] font-semibold tabular-nums leading-tight">{stats.authenticated_accesses}</p>
                  <p className="text-[11px] text-foreground/50 mt-0.5">{t("shareDialog.analytics.authenticated", lang)}</p>
                </div>
                {share.requires_pin && (
                  <div className="rounded-xl bg-foreground/[0.03] px-3 py-2.5 text-center">
                    <p className="text-[17px] font-semibold tabular-nums leading-tight">{stats.failed_pin_attempts}</p>
                    <p className="text-[11px] text-foreground/50 mt-0.5">{t("shareDialog.analytics.failedPins", lang)}</p>
                  </div>
                )}
              </>
            ) : (
              <div className="rounded-xl bg-foreground/[0.03] px-3 py-2.5 text-center">
                <p className="text-[17px] font-semibold tabular-nums leading-tight">{share.access_count}</p>
                <p className="text-[11px] text-foreground/50 mt-0.5">{t("shareDialog.analytics.totalViews", lang)}</p>
              </div>
            )}
          </div>

          {(share.max_access_count || share.expires_at) && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
              {share.max_access_count && <span>{t("shares.viewLimit", lang)}: {share.max_access_count}</span>}
              {share.expires_at && (
                <span>
                  <svg aria-hidden="true" width="10" height="10" viewBox="0 0 16 16" fill="none" className="inline mr-0.5 -mt-px"><circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.5" /><path d="M8 5v3.5l2.5 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
                  {formatDate(share.expires_at, dateFormat, lang)}
                </span>
              )}
            </div>
          )}

          {/* Actions */}
          {actionError && <p role="alert" className="text-[11px] text-destructive">{t("common.requestFailed", lang)}</p>}
          {isLive && (
            <div className="flex items-center gap-2 pt-2.5 border-t border-border/40">
              {!confirmRevoke ? (
                <>
                  <Button type="button" variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); onEdit(); }}
                    className="h-8 rounded-lg px-3.5 text-[12px] text-foreground/80 hover:text-foreground">
                    {t("shares.editSettings", lang)}
                  </Button>
                  {isActive && (
                    <Button type="button" variant="outline" size="sm" onClick={handlePause} disabled={actionLoading}
                      className="h-8 rounded-lg px-3.5 text-[12px] text-foreground/60 hover:text-foreground">
                      {t("shares.pause", lang)}
                    </Button>
                  )}
                  {isPaused && (
                    <Button type="button" variant="outline" size="sm" onClick={handleResume} disabled={actionLoading}
                      className="h-8 rounded-lg px-3.5 text-[12px] text-foreground/70 hover:text-foreground">
                      {t("shares.resume", lang)}
                    </Button>
                  )}
                  <div className="flex-1" />
                  <Button type="button" variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); setConfirmRevoke(true); }}
                    className="h-8 rounded-lg px-3.5 text-[12px] text-foreground/50 hover:border-destructive/30 hover:bg-destructive/[0.04] hover:text-destructive">
                    {t("shares.revoke", lang)}
                  </Button>
                </>
              ) : (
                <>
                  <span className="text-[11px] text-destructive/70">{t("shares.revokeConfirm", lang)}</span>
                  <div className="flex-1" />
                  <Button type="button" variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setConfirmRevoke(false); }}
                    className="h-8 rounded-lg px-3 text-[12px] text-foreground/50 hover:text-foreground">
                    {t("shares.cancel", lang)}
                  </Button>
                  <Button type="button" variant="destructive" size="sm" onClick={handleRevoke} disabled={actionLoading}
                    className="h-8 rounded-lg px-3.5 text-[12px]">
                    {t("shares.revoke", lang)}
                  </Button>
                </>
              )}
            </div>
          )}
          </div>
        </div>
      </div>
    </div>
  );
}

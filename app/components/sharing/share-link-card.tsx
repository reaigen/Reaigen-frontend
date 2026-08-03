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
import { AnalyticsGrid, type AnalyticsGridItem } from "../analytics-grid";
import {
  copyToClipboard,
  shareUrl,
  fieldSummaryLabel,
  expiryLabel,
  STATUS_CONFIG,
  type ShareStats,
} from "../../lib/share-ui";
import { StatusPill } from "../status-pill";
import { CheckIcon, ChevronDownIcon, ClockIcon, CopyIcon, ExternalLinkIcon, LockIcon } from "../icons";

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
  const canRevoke = share.status !== "revoked";
  const cfg = STATUS_CONFIG[share.status] ?? STATUS_CONFIG.revoked;
  const expiry = expiryLabel(share.expires_at, lang);
  const analyticsItems: AnalyticsGridItem[] = stats
    ? [
        { label: t("shareDialog.analytics.totalViews", lang), value: stats.total_accesses },
        { label: t("shareDialog.analytics.uniqueVisitors", lang), value: stats.unique_ips },
        { label: t("shareDialog.analytics.authenticated", lang), value: stats.authenticated_accesses },
        ...(share.requires_pin ? [{ label: t("shareDialog.analytics.failedPins", lang), value: stats.failed_pin_attempts }] : []),
      ]
    : [{ label: t("shareDialog.analytics.totalViews", lang), value: share.access_count }];

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
    <div className={`overflow-hidden border transition-colors ${isLive ? "floating-panel border-border/55 hover:border-foreground/20" : "floating-panel-shape border-border/35 bg-surface-subtle/75"}`}>
      {/* Collapsed row */}
      <div className="flex w-full flex-col gap-2.5 px-3.5 py-2.5 sm:flex-row sm:items-center">
        <button type="button" onClick={handleToggleExpand} aria-expanded={expanded} className="flex w-full min-w-0 flex-1 items-center gap-2.5 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className={`text-[13px] font-semibold ${isLive ? "" : "text-foreground/50"}`}>
                {t("sharing.linkLabel", lang)}
              </span>
              {share.requires_pin && (
                <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-foreground/[0.07] px-1.5 py-px text-[10px] font-semibold text-foreground/60 uppercase tracking-wider">
                  <LockIcon size={9} />
                  PIN
                </span>
              )}
              {expiry && (
                <span className="shrink-0 rounded-full bg-foreground/[0.07] px-1.5 py-px text-[10px] font-semibold text-foreground/50">
                  {expiry}
                </span>
              )}
            </span>
            <span className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px] leading-relaxed text-foreground/55 sm:text-[11px]">
              <span className="tabular-nums">{share.access_count} {share.access_count === 1 ? t("shares.viewSingular", lang) : t("shares.viewPlural", lang)}</span>
              <span aria-hidden="true" className="text-foreground/25">·</span>
              <span>{fieldSummaryLabel(share, lang)}</span>
              <span aria-hidden="true" className="text-foreground/25">·</span>
              <span>{formatDate(share.created_at, dateFormat, lang)}</span>
            </span>
          </span>

          <StatusPill tone={cfg.tone} dot className="shrink-0">
            {t(cfg.labelKey, lang)}
          </StatusPill>

          <ChevronDownIcon size={14} className={`shrink-0 text-foreground/35 transition-transform ${expanded ? "rotate-180" : ""}`} />
        </button>

        {isLive && (
          <div className="flex shrink-0 items-center gap-1.5 self-end sm:self-auto">
            {isActive ? (
              <Button asChild variant="outline" size="xs" className="gap-1 text-[11px] text-foreground/70 hover:text-foreground [&_svg]:size-3">
                <a href={shareUrl(share.token)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                  <ExternalLinkIcon size={12} />
                  {t("common.open", lang)}
                </a>
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={handleCopy}
              className={`gap-1 text-[11px] [&_svg]:size-3 ${copied ? "border-foreground bg-foreground text-background hover:bg-foreground hover:text-background" : "text-foreground/70 hover:text-foreground"}`}
            >
              {copied ? (
                <CheckIcon size={12} />
              ) : (
                <CopyIcon size={12} />
              )}
              {copied ? t("shares.copied", lang) : t("shares.copyLink", lang)}
            </Button>
          </div>
        )}
      </div>

      {/* Expanded panel */}
      <div className="grid transition-[grid-template-rows] duration-200 ease-out" style={{ gridTemplateRows: expanded ? "1fr" : "0fr" }}>
        <div className="overflow-hidden">
          <div className={`border-t border-border/40 px-3.5 py-3 space-y-3 ${expanded ? "" : "invisible"}`}>
          {isLive && (
            <div className="floating-capsule flex items-center gap-2 border px-3 py-2">
              <p className="flex-1 text-[11px] font-mono text-foreground/70 truncate select-all">{shareUrl(share.token)}</p>
            </div>
          )}

          <AnalyticsGrid items={analyticsItems} loading={statsLoading} />

          {(share.max_access_count || share.expires_at) && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
              {share.max_access_count && <span>{t("shares.viewLimit", lang)}: {share.max_access_count}</span>}
              {share.expires_at && (
                <span className="inline-flex items-center gap-1">
                  <ClockIcon size={10} />
                  {formatDate(share.expires_at, dateFormat, lang)}
                </span>
              )}
            </div>
          )}

          {/* Actions */}
          {actionError && <p role="alert" className="text-[11px] text-destructive">{t("common.requestFailed", lang)}</p>}
          {canRevoke && (
            <div className="flex flex-wrap items-center gap-2 border-t border-border/40 pt-2.5">
              {!confirmRevoke ? (
                <>
                  {isLive && (
                    <Button type="button" variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); onEdit(); }}
                      className="px-3.5 text-[12px] text-foreground/80 hover:text-foreground">
                      {t("shares.editSettings", lang)}
                    </Button>
                  )}
                  {isActive && (
                    <Button type="button" variant="outline" size="sm" onClick={handlePause} disabled={actionLoading}
                      className="px-3.5 text-[12px] text-foreground/60 hover:text-foreground">
                      {t("shares.pause", lang)}
                    </Button>
                  )}
                  {isPaused && (
                    <Button type="button" variant="outline" size="sm" onClick={handleResume} disabled={actionLoading}
                      className="px-3.5 text-[12px] text-foreground/70 hover:text-foreground">
                      {t("shares.resume", lang)}
                    </Button>
                  )}
                  <div className="hidden flex-1 sm:block" />
                  <Button type="button" variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); setConfirmRevoke(true); }}
                    className="px-3.5 text-[12px] text-foreground/50 hover:border-destructive/30 hover:bg-destructive/[0.04] hover:text-destructive">
                    {t("shares.revoke", lang)}
                  </Button>
                </>
              ) : (
                <>
                  <span className="mr-auto text-[11px] text-destructive/70">{t("shares.revokeConfirm", lang)}</span>
                  <div className="hidden flex-1 sm:block" />
                  <Button type="button" variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setConfirmRevoke(false); }}
                    className="px-3 text-[12px] text-foreground/50 hover:text-foreground">
                    {t("shares.cancel", lang)}
                  </Button>
                  <Button type="button" variant="destructive" size="sm" onClick={handleRevoke} disabled={actionLoading}
                    className="px-3.5 text-[12px]">
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

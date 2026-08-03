"use client";

import * as React from "react";
import Link from "next/link";

import type { ShareData } from "../lib/tour-types";
import {
  copyToClipboard,
  expiryLabel,
  fieldSummaryLabel,
  shareUrl,
  STATUS_CONFIG,
  type ShareStats,
} from "../lib/share-ui";
import { getShareAnalytics, pauseShare, resumeShare, revokeShare } from "../lib/api/client";
import { formatDate, t } from "../lib/i18n";
import { Button } from "../lib/ui/button";
import { AnalyticsGrid, type AnalyticsGridItem } from "./analytics-grid";
import {
  ArrowRightIcon,
  CheckIcon,
  ClockIcon,
  CopyIcon,
  ExternalLinkIcon,
  LockIcon,
} from "./icons";
import { SidePanel } from "./side-panel";
import { StatusPill } from "./status-pill";

type SharedRowProps = {
  share: ShareData;
  title: string;
  lang: string;
  dateFormat?: string | null;
  onManage: () => void;
};

export function ShareManagementRow({
  share,
  title,
  lang,
  dateFormat,
  onManage,
}: SharedRowProps) {
  const status = STATUS_CONFIG[share.status] ?? STATUS_CONFIG.revoked;

  return (
    <button
      type="button"
      onClick={onManage}
      className="group flex min-h-[4.25rem] w-full min-w-0 items-center gap-4 bg-card px-4 text-left transition-colors hover:bg-accent/45 focus-visible:relative focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      aria-label={`${t("shares.manage", lang)}: ${title}`}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold text-foreground/85">{title}</span>
        <span className="mt-1 block truncate text-[10px] text-muted-foreground">
          {t(status.labelKey, lang)} · {share.access_count} {share.access_count === 1 ? t("shares.viewSingular", lang) : t("shares.viewPlural", lang)} · {formatDate(share.created_at, dateFormat, lang)}
        </span>
      </span>
      <span className="shrink-0 text-[11px] font-semibold text-foreground/45 transition-colors group-hover:text-foreground">
        {t("shares.manage", lang)}
      </span>
    </button>
  );
}

type DetailsPanelProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  share: ShareData | null;
  title: string;
  tourLink: string | null;
  lang: string;
  dateFormat?: string | null;
  onUpdate: (updated: ShareData | null) => void;
  onEdit: () => void;
};

export function ShareManagementPanel({
  open,
  onOpenChange,
  share,
  title,
  tourLink,
  lang,
  dateFormat,
  onUpdate,
  onEdit,
}: DetailsPanelProps) {
  const [copied, setCopied] = React.useState(false);
  const [stats, setStats] = React.useState<ShareStats | null>(null);
  const [actionLoading, setActionLoading] = React.useState(false);
  const [actionError, setActionError] = React.useState(false);
  const [confirmRevoke, setConfirmRevoke] = React.useState(false);
  const shareId = share?.id;

  React.useEffect(() => {
    setCopied(false);
    setStats(null);
    setActionError(false);
    setConfirmRevoke(false);
    if (!open || shareId == null) return;
    let current = true;
    void getShareAnalytics(shareId)
      .then((response) => {
        if (current) setStats(response.stats);
      })
      .catch(() => {
        if (current) setActionError(true);
    });
    return () => { current = false; };
  }, [open, shareId]);

  if (!share) return null;

  const isActive = share.status === "active";
  const isPaused = share.status === "paused";
  const isLive = isActive || isPaused;
  const canRevoke = share.status !== "revoked";
  const status = STATUS_CONFIG[share.status] ?? STATUS_CONFIG.revoked;
  const expiry = expiryLabel(share.expires_at, lang);
  const analyticsItems: AnalyticsGridItem[] = [
    { label: t("shareDialog.analytics.totalViews", lang), value: stats?.total_accesses ?? share.access_count },
    { label: t("shareDialog.analytics.uniqueVisitors", lang), value: stats?.unique_ips ?? "—" },
    { label: t("shareDialog.analytics.authenticated", lang), value: stats?.authenticated_accesses ?? "—" },
    ...(share.requires_pin
      ? [{ label: t("shareDialog.analytics.failedPins", lang), value: stats?.failed_pin_attempts ?? "—" }]
      : []),
  ];

  const handleCopy = async () => {
    if (!await copyToClipboard(shareUrl(share.token))) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  const runAction = async (action: "pause" | "resume" | "revoke") => {
    setActionError(false);
    setActionLoading(true);
    try {
      if (action === "pause") {
        const response = await pauseShare(share.id);
        onUpdate(response.share);
      } else if (action === "resume") {
        const response = await resumeShare(share.id);
        onUpdate(response.share);
      } else {
        await revokeShare(share.id);
        onUpdate(null);
        onOpenChange(false);
      }
    } catch {
      setActionError(true);
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <SidePanel
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={t("shares.manage", lang)}
      lang={lang}
      headerAction={(
        <StatusPill tone={status.tone} dot className="shrink-0">
          {t(status.labelKey, lang)}
        </StatusPill>
      )}
      footer={(
        <div className="flex min-h-11 w-full items-center gap-2">
          {confirmRevoke ? (
            <>
              <span className="mr-auto hidden text-[11px] font-medium text-destructive/75 sm:inline">{t("shares.revokeConfirm", lang)}</span>
              <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmRevoke(false)} className="flex-1 sm:flex-none">
                {t("shares.cancel", lang)}
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={actionLoading}
                aria-label={t("shares.revokeConfirm", lang)}
                onClick={() => void runAction("revoke")}
                className="flex-1 sm:flex-none"
              >
                {t("shares.revoke", lang)}
              </Button>
            </>
          ) : (
            <>
              {isLive ? (
                <Button type="button" size="sm" onClick={onEdit}>{t("shares.editSettings", lang)}</Button>
              ) : null}
              {isActive ? (
                <Button type="button" variant="outline" size="sm" disabled={actionLoading} onClick={() => void runAction("pause")}>
                  {t("shares.pause", lang)}
                </Button>
              ) : null}
              {isPaused ? (
                <Button type="button" variant="outline" size="sm" disabled={actionLoading} onClick={() => void runAction("resume")}>
                  {t("shares.resume", lang)}
                </Button>
              ) : null}
              <span className="flex-1" />
              {canRevoke ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmRevoke(true)}
                  className="text-foreground/50 hover:bg-destructive/[0.05] hover:text-destructive"
                >
                  {t("shares.revoke", lang)}
                </Button>
              ) : null}
            </>
          )}
        </div>
      )}
    >
      <div className="space-y-6">
        {isLive ? (
          <section className="rounded-2xl border border-border/70 bg-card p-3 shadow-control">
            <p className="truncate px-1 font-mono text-[11px] text-foreground/60 select-all">{shareUrl(share.token)}</p>
            <div className="mt-3 flex gap-2">
              <Button type="button" size="sm" onClick={() => void handleCopy()} className="flex-1">
                {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
                {copied ? t("shares.copied", lang) : t("shares.copyLink", lang)}
              </Button>
              {isActive ? (
                <Button asChild variant="outline" size="sm" className="flex-1">
                  <a href={shareUrl(share.token)} target="_blank" rel="noreferrer">
                    <ExternalLinkIcon size={14} /> {t("common.open", lang)}
                  </a>
                </Button>
              ) : null}
            </div>
          </section>
        ) : null}

        <section>
          <h3 className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.045em] text-muted-foreground">
            {t("shares.analytics", lang)}
          </h3>
          <AnalyticsGrid items={analyticsItems} />
        </section>

        <section>
          <h3 className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.045em] text-muted-foreground">
            {t("shares.tableAccess", lang)}
          </h3>
          <dl className="overflow-hidden rounded-2xl border border-border/70 bg-card px-4">
            <div className="flex items-center justify-between gap-4 py-3 text-[12px]">
              <dt className="text-muted-foreground">{t("shares.created", lang)}</dt>
              <dd className="text-right font-medium">{formatDate(share.created_at, dateFormat, lang)}</dd>
            </div>
            <div className="flex items-center justify-between gap-4 border-t border-border/50 py-3 text-[12px]">
              <dt className="text-muted-foreground">{t("shares.tableAccess", lang)}</dt>
              <dd className="min-w-0 truncate text-right font-medium">{fieldSummaryLabel(share, lang)}</dd>
            </div>
            {expiry ? (
              <div className="flex items-center justify-between gap-4 border-t border-border/50 py-3 text-[12px]">
                <dt className="text-muted-foreground">{t("shares.expires", lang)}</dt>
                <dd className="inline-flex items-center gap-1.5 text-right font-medium"><ClockIcon size={12} /> {expiry}</dd>
              </div>
            ) : null}
            {share.max_access_count ? (
              <div className="flex items-center justify-between gap-4 border-t border-border/50 py-3 text-[12px]">
                <dt className="text-muted-foreground">{t("shares.viewLimit", lang)}</dt>
                <dd className="font-medium tabular-nums">{share.max_access_count}</dd>
              </div>
            ) : null}
            {share.requires_pin ? (
              <div className="flex items-center justify-between gap-4 border-t border-border/50 py-3 text-[12px]">
                <dt className="text-muted-foreground">{t("shares.pinProtected", lang)}</dt>
                <dd><LockIcon size={13} /></dd>
              </div>
            ) : null}
          </dl>
        </section>

        {tourLink ? (
          <Button asChild variant="outline" size="sm" className="w-full justify-between">
            <Link href={tourLink}>
              {t("shares.view", lang)} <ArrowRightIcon size={14} />
            </Link>
          </Button>
        ) : null}

        {actionError ? (
          <p role="alert" className="text-[11px] font-medium text-destructive">{t("common.requestFailed", lang)}</p>
        ) : null}
      </div>
    </SidePanel>
  );
}

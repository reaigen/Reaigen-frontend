"use client";

import * as React from "react";
import { Button } from "../lib/ui/button";
import { Input } from "../lib/ui/input";
import { Switch } from "../lib/ui/switch";
import { t, formatDateShort, type LocaleKey } from "../lib/i18n";
import type { ShareData } from "../lib/tour-types";
import {
  getSplatShare,
  createSplatShare,
  updateShare,
  pauseShare,
  resumeShare,
  revokeShare,
  getShareAnalytics,
} from "../lib/api/client";
import { getSafeApiErrorMessage } from "../lib/api/error-message";

// ─── Clipboard ────────────────────────────────────────────────────────────

async function copyToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(text); return true; } catch {}
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand("copy"); return true; } catch { return false; } finally { document.body.removeChild(ta); }
}

// ─── Expiry presets ──────────────────────────────────────────────────────

const EXPIRY_PRESETS = [
  { labelKey: "shareDialog.expiry.oneHour" as LocaleKey, hours: 1 },
  { labelKey: "shareDialog.expiry.twentyFourHours" as LocaleKey, hours: 24 },
  { labelKey: "shareDialog.expiry.sevenDays" as LocaleKey, hours: 168 },
  { labelKey: "shareDialog.expiry.thirtyDays" as LocaleKey, hours: 720 },
] as const;
const DEFAULT_EXPIRY_HOURS = 168;

function closestPreset(hours: number): number {
  let best: number = EXPIRY_PRESETS[0].hours;
  let bestDiff = Infinity;
  for (const p of EXPIRY_PRESETS) {
    const d = Math.abs(p.hours - hours);
    if (d < bestDiff) { bestDiff = d; best = p.hours; }
  }
  return best;
}

// ─── Component ────────────────────────────────────────────────────────────

interface ShareDialogProps {
  splatId: number;
  title: string;
  open: boolean;
  onClose: () => void;
  lang: string;
}

export function ShareDialog({ splatId, title, open, onClose, lang }: ShareDialogProps) {
  const [loading, setLoading] = React.useState(true);
  const [share, setShare] = React.useState<ShareData | null>(null);
  const [copied, setCopied] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [stats, setStats] = React.useState<{ total_accesses: number; unique_ips: number } | null>(null);
  const [confirmRevoke, setConfirmRevoke] = React.useState(false);
  const [actionLoading, setActionLoading] = React.useState(false);

  // Create form state
  const [usePin, setUsePin] = React.useState(false);
  const [pin, setPin] = React.useState("");
  const [useExpiry, setUseExpiry] = React.useState(true);
  const [expiryHours, setExpiryHours] = React.useState(DEFAULT_EXPIRY_HOURS);
  const [maxViews, setMaxViews] = React.useState("");

  const copiedTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    return () => { if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current); };
  }, []);

  // Load existing share
  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError(null);
    setShare(null);
    setStats(null);
    setConfirmRevoke(false);
    setCopied(false);
    setLoading(true);
    setUsePin(false);
    setUseExpiry(true);
    setExpiryHours(DEFAULT_EXPIRY_HOURS);
    setMaxViews("");
    setPin("");

    getSplatShare(splatId)
      .then(async (existing) => {
        if (cancelled) return;
        if (existing) {
          setShare(existing);
          setUsePin(existing.requires_pin);
          setUseExpiry(!!existing.expires_at);
          if (existing.expires_at) {
            const hrs = Math.max(1, Math.round((new Date(existing.expires_at).getTime() - Date.now()) / 3600000));
            setExpiryHours(closestPreset(hrs));
          }
          setMaxViews(existing.max_access_count ? String(existing.max_access_count) : "");
          try { const a = await getShareAnalytics(existing.id); if (!cancelled) setStats(a.stats); } catch {}
        }
        if (!cancelled) setLoading(false);
      })
      .catch((err) => {
        if (!cancelled) { setError(getSafeApiErrorMessage(err, lang)); setLoading(false); }
      });
    return () => { cancelled = true; };
  }, [open, splatId, lang]);

  const shareUrl = share ? `${window.location.origin}/shared/${share.token}` : "";

  const handleCopy = React.useCallback(async () => {
    if (!shareUrl) return;
    if (await copyToClipboard(shareUrl)) {
      setCopied(true);
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = setTimeout(() => setCopied(false), 2000);
    }
  }, [shareUrl]);

  const handleCreate = React.useCallback(async () => {
    if (usePin && pin.length < 4) { setError(t("shareDialog.errorPin", lang)); return; }
    const mv = parseInt(maxViews);
    const opts: Record<string, unknown> = {};
    if (usePin) { opts.share_type = "pin"; opts.pin = pin; }
    else if (useExpiry) { opts.share_type = "temporary"; }
    else { opts.share_type = "permanent"; }
    if (useExpiry) opts.expires_in_hours = expiryHours;
    if (mv > 0) opts.max_access_count = mv;

    setSaving(true);
    setError(null);
    try {
      const s = await createSplatShare(splatId, opts);
      setShare(s);
      const url = `${window.location.origin}/shared/${s.token}`;
      copyToClipboard(url).then((ok) => {
        if (ok) { setCopied(true); copiedTimerRef.current = setTimeout(() => setCopied(false), 3000); }
      });
    } catch (err) { setError(getSafeApiErrorMessage(err, lang) || t("shareDialog.errorCreate", lang)); }
    finally { setSaving(false); }
  }, [splatId, usePin, pin, useExpiry, expiryHours, maxViews, lang]);

  const handlePause = React.useCallback(async () => {
    if (!share) return;
    setActionLoading(true);
    try { const r = await pauseShare(share.id); setShare(r.share); } catch { setError(t("shareDialog.errorPause", lang)); }
    setActionLoading(false);
  }, [share, lang]);

  const handleResume = React.useCallback(async () => {
    if (!share) return;
    setActionLoading(true);
    try { const r = await resumeShare(share.id); setShare(r.share); } catch { setError(t("shareDialog.errorResume", lang)); }
    setActionLoading(false);
  }, [share, lang]);

  const handleRevoke = React.useCallback(async () => {
    if (!share) return;
    setActionLoading(true);
    try {
      await revokeShare(share.id);
      onClose();
    } catch { setError(t("shareDialog.errorRevoke", lang)); }
    setActionLoading(false);
  }, [share, lang, onClose]);

  // Escape key
  React.useEffect(() => {
    if (!open) return;
    const handleEsc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [open, onClose]);

  if (!open) return null;

  const isActive = share?.status === "active";
  const isPaused = share?.status === "paused";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px] animate-fade-in" onClick={onClose} />

      <div className="relative w-full max-w-md overflow-hidden rounded-t-2xl border border-border/70 bg-background shadow-xl animate-slide-up sm:animate-fade-in-scale sm:rounded-xl sm:mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border/70">
          <div className="min-w-0">
            <h2 className="text-[14px] font-semibold">{t("shareDialog.title", lang)}</h2>
            <p className="text-[11px] text-muted-foreground truncate mt-0.5">{title}</p>
          </div>
          <button onClick={onClose} className="shrink-0 p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground" aria-label={t("common.close", lang)}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 max-h-[70dvh] overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin h-5 w-5 border-2 border-foreground/15 border-t-foreground/60 rounded-full" />
            </div>
          ) : !share ? (
            /* ── Create new share ── */
            <div className="space-y-4">
              {error && <p className="text-[12px] text-destructive">{error}</p>}

              <div className="space-y-0 rounded-xl border border-border/70 divide-y divide-border/70">
                {/* PIN */}
                <div className="px-4 py-3 space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium">{t("shareDialog.requirePin", lang)}</p>
                      <p className="text-[11px] text-muted-foreground">{t("shareDialog.requirePinCreateHint", lang)}</p>
                    </div>
                    <Switch checked={usePin} onCheckedChange={(v) => { setUsePin(v); if (!v) setPin(""); }} size="sm" />
                  </div>
                  {usePin && (
                    <Input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      placeholder={t("shareDialog.pinPlaceholder", lang)}
                      value={pin}
                      onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 10))}
                      className="h-9 text-[13px]"
                      autoFocus
                    />
                  )}
                </div>

                {/* Expiry */}
                <div className="px-4 py-3 space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium">{t("shareDialog.autoExpire", lang)}</p>
                      <p className="text-[11px] text-muted-foreground">{t("shareDialog.autoExpireCreateHint", lang)}</p>
                    </div>
                    <Switch checked={useExpiry} onCheckedChange={setUseExpiry} size="sm" />
                  </div>
                  {useExpiry && (
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {EXPIRY_PRESETS.map((p) => (
                        <button
                          key={p.hours}
                          type="button"
                          onClick={() => setExpiryHours(p.hours)}
                          className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all ${
                            expiryHours === p.hours
                              ? "bg-foreground text-background"
                              : "bg-muted text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          {t(p.labelKey, lang)}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Max views */}
                <div className="px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium">{t("shareDialog.viewLimit", lang)}</p>
                      <p className="text-[11px] text-muted-foreground">{t("shareDialog.viewLimitCreateHint", lang)}</p>
                    </div>
                    <Input
                      type="number"
                      min={1}
                      placeholder={t("common.none", lang)}
                      value={maxViews}
                      onChange={(e) => setMaxViews(e.target.value)}
                      className="h-9 w-24 text-[13px] text-right"
                    />
                  </div>
                </div>
              </div>

              {!usePin && !useExpiry && (
                <p className="text-[11px] text-muted-foreground px-1">
                  {t("shareDialog.publicWarning", lang)}
                </p>
              )}

              <Button
                className="w-full"
                size="sm"
                onClick={handleCreate}
                disabled={saving || (usePin && pin.length < 4)}
                loading={saving}
              >
                {t("shareDialog.createAndCopy", lang)}
              </Button>
            </div>
          ) : (
            /* ── Existing share ── */
            <div className="space-y-4">
              {error && <p className="text-[12px] text-destructive">{error}</p>}

              {/* Copy link — primary area */}
              <div className="rounded-xl border border-border/70 overflow-hidden">
                <div
                  className="px-4 py-3 bg-muted/30 cursor-text"
                  onClick={(e) => {
                    const range = document.createRange();
                    range.selectNodeContents(e.currentTarget);
                    window.getSelection()?.removeAllRanges();
                    window.getSelection()?.addRange(range);
                  }}
                >
                  <p className="text-[12px] font-mono truncate text-foreground select-all">{shareUrl}</p>
                </div>
                <div className="px-4 py-2.5 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`w-1.5 h-1.5 rounded-full ${isActive ? "bg-foreground/70" : isPaused ? "bg-foreground/30" : "bg-foreground/10"}`} />
                    <span className="text-[11px] text-muted-foreground">
                      {isActive ? t("shares.statusActive", lang) : t("shares.statusPaused", lang)}
                    </span>
                  </div>
                  <button
                    onClick={handleCopy}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-all ${
                      copied
                        ? "bg-foreground text-background"
                        : "bg-foreground/[0.06] text-foreground/70 hover:bg-foreground/[0.1]"
                    }`}
                  >
                    {copied ? (
                      <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M3 8.5L6.5 12L13 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    ) : (
                      <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.5" /><path d="M10.5 5.5V3.5C10.5 2.67 9.83 2 9 2H3.5C2.67 2 2 2.67 2 3.5V9C2 9.83 2.67 10.5 3.5 10.5H5.5" stroke="currentColor" strokeWidth="1.5" /></svg>
                    )}
                    {copied ? t("shares.copied", lang) : t("shares.copyLink", lang)}
                  </button>
                </div>
              </div>

              {/* Info badges */}
              {(share.requires_pin || share.expires_at || share.max_access_count || stats) && (
                <div className="flex flex-wrap items-center gap-2">
                  {stats && (
                    <span className="inline-flex items-center rounded-md bg-foreground/[0.04] px-2 py-0.5 text-[10px] font-medium text-foreground/60">
                      {stats.total_accesses} {stats.total_accesses === 1 ? t("shares.viewSingular", lang) : t("shares.viewPlural", lang)}
                      {share.max_access_count ? ` / ${share.max_access_count}` : ""}
                    </span>
                  )}
                  {share.requires_pin && (
                    <span className="inline-flex items-center gap-1 rounded-md bg-foreground/[0.04] px-2 py-0.5 text-[10px] font-medium text-foreground/60">
                      <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><rect x="3" y="7" width="10" height="7" rx="2" stroke="currentColor" strokeWidth="1.5" /><path d="M5 7V5a3 3 0 016 0v2" stroke="currentColor" strokeWidth="1.5" /></svg>
                      PIN
                    </span>
                  )}
                  {share.expires_at && (
                    <span className="inline-flex items-center gap-1 rounded-md bg-foreground/[0.04] px-2 py-0.5 text-[10px] font-medium text-foreground/60">
                      <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.5" /><path d="M8 5v3.5l2.5 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
                      {formatDateShort(share.expires_at, lang)}
                    </span>
                  )}
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center gap-2 pt-1 border-t border-border/50">
                {isActive && (
                  <button onClick={handlePause} disabled={actionLoading}
                    className="text-[11px] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40">
                    {t("shares.pause", lang)}
                  </button>
                )}
                {isPaused && (
                  <button onClick={handleResume} disabled={actionLoading}
                    className="text-[11px] font-medium text-foreground/70 hover:text-foreground transition-colors disabled:opacity-40">
                    {t("shares.resume", lang)}
                  </button>
                )}
                <span className="text-foreground/15">|</span>
                {!confirmRevoke ? (
                  <button onClick={() => setConfirmRevoke(true)}
                    className="text-[11px] text-muted-foreground hover:text-destructive transition-colors">
                    {t("shares.revoke", lang)}
                  </button>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-destructive">{t("shares.revokeConfirm", lang)}</span>
                    <button onClick={handleRevoke} disabled={actionLoading}
                      className="text-[11px] font-medium text-destructive disabled:opacity-40">
                      {t("shares.revoke", lang)}
                    </button>
                    <button onClick={() => setConfirmRevoke(false)}
                      className="text-[11px] text-muted-foreground hover:text-foreground transition-colors">
                      {t("shares.cancel", lang)}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

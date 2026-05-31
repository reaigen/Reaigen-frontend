"use client";

import * as React from "react";
import { Button } from "../lib/ui/button";
import { Input } from "../lib/ui/input";
import { Switch } from "../lib/ui/switch";
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

// ─── Clipboard (HTTP-safe) ───────────────────────────────────────────────

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

// ─── Icons ───────────────────────────────────────────────────────────────

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className={className}>
      <path d="M3 8.5L6.5 12L13 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CopyIcon({ className }: { className?: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className={className}>
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10.5 5.5V3.5C10.5 2.67 9.83 2 9 2H3.5C2.67 2 2 2.67 2 3.5V9C2 9.83 2.67 10.5 3.5 10.5H5.5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function LinkIcon({ className }: { className?: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className={className}>
      <path d="M6.5 9.5L9.5 6.5M7 11L5.5 12.5a2.121 2.121 0 01-3-3L4 8m5-3l1.5-1.5a2.121 2.121 0 013 3L12 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ─── Expiry presets ──────────────────────────────────────────────────────

const EXPIRY_PRESETS = [
  { label: "1 hour", hours: 1 },
  { label: "24 hours", hours: 24 },
  { label: "7 days", hours: 168 },
  { label: "30 days", hours: 720 },
] as const;

function closestPreset(hours: number): number {
  let best: number = EXPIRY_PRESETS[0].hours;
  let bestDiff = Infinity;
  for (const p of EXPIRY_PRESETS) {
    const d = Math.abs(p.hours - hours);
    if (d < bestDiff) { bestDiff = d; best = p.hours; }
  }
  return best;
}

// ─── Component ───────────────────────────────────────────────────────────

interface ShareDialogProps {
  splatId: number;
  title: string;
  open: boolean;
  onClose: () => void;
}

export function ShareDialog({ splatId, title, open, onClose }: ShareDialogProps) {
  const [loading, setLoading] = React.useState(true);
  const [share, setShare] = React.useState<ShareData | null>(null);
  const [copied, setCopied] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [saveSuccess, setSaveSuccess] = React.useState(false);
  const [stats, setStats] = React.useState<{ total_accesses: number; unique_ips: number } | null>(null);
  const [confirmRevoke, setConfirmRevoke] = React.useState(false);
  const [actionLoading, setActionLoading] = React.useState(false);
  const [showSettings, setShowSettings] = React.useState(false);

  // Settings
  const [usePin, setUsePin] = React.useState(false);
  const [pin, setPin] = React.useState("");
  const [changingPin, setChangingPin] = React.useState(false);
  const [useExpiry, setUseExpiry] = React.useState(false);
  const [expiryHours, setExpiryHours] = React.useState(168);
  const [maxViews, setMaxViews] = React.useState("");

  const copiedTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const successTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup timers on unmount
  React.useEffect(() => {
    return () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      if (successTimerRef.current) clearTimeout(successTimerRef.current);
    };
  }, []);

  // Load on open — auto-create if no existing share
  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError(null);
    setShare(null);
    setStats(null);
    setConfirmRevoke(false);
    setCopied(false);
    setSaveSuccess(false);
    setLoading(true);
    setShowSettings(false);
    setPin("");
    setChangingPin(false);

    getSplatShare(splatId).then(async (existing) => {
      if (cancelled) return;
      if (existing) {
        setShare(existing);
        setUsePin(existing.requires_pin);
        setUseExpiry(!!existing.expires_at);
        if (existing.expires_at) {
          const hrs = Math.max(1, Math.round((new Date(existing.expires_at).getTime() - Date.now()) / 3600000));
          setExpiryHours(closestPreset(hrs));
        } else {
          setUseExpiry(false);
          setExpiryHours(168);
        }
        setMaxViews(existing.max_access_count ? String(existing.max_access_count) : "");
        try { const a = await getShareAnalytics(existing.id); if (!cancelled) setStats(a.stats); } catch {}
        if (!cancelled) setLoading(false);
      } else {
        // Auto-create a permanent share immediately
        try {
          const s = await createSplatShare(splatId, {});
          if (cancelled) return;
          setShare(s);
          setUsePin(false);
          setUseExpiry(false);
          setExpiryHours(168);
          setMaxViews("");
          // Auto-copy the new link
          const url = `${window.location.origin}/shared/${s.token}`;
          copyToClipboard(url).then((ok) => {
            if (ok && !cancelled) {
              setCopied(true);
              copiedTimerRef.current = setTimeout(() => setCopied(false), 3000);
            }
          });
        } catch {
          if (!cancelled) setError("Failed to create share link");
        }
        if (!cancelled) setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [open, splatId]);

  const shareUrl = share ? `${window.location.origin}/shared/${share.token}` : "";

  // ── Copy ──
  const handleCopy = React.useCallback(async () => {
    if (!shareUrl) return;
    if (await copyToClipboard(shareUrl)) {
      setCopied(true);
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = setTimeout(() => setCopied(false), 2000);
    }
  }, [shareUrl]);

  // ── Save settings ──
  const handleSave = React.useCallback(async () => {
    if (!share) return;
    // Validate PIN if being set/changed
    if (usePin && !share.requires_pin && pin.length < 4) {
      setError("Enter a 4-10 digit PIN");
      return;
    }
    if (usePin && changingPin && pin.length < 4) {
      setError("Enter a 4-10 digit PIN");
      return;
    }
    setSaving(true);
    setError(null);
    setSaveSuccess(false);
    try {
      const patch: Record<string, unknown> = {};

      // PIN
      if (usePin && pin.length >= 4) {
        patch.share_type = "pin";
        patch.pin = pin;
      } else if (usePin && share.requires_pin) {
        patch.share_type = "pin";
      } else if (!usePin && share.requires_pin) {
        patch.share_type = useExpiry ? "temporary" : "permanent";
      }

      // Expiry
      if (useExpiry) {
        patch.expires_in_hours = expiryHours;
        if (!patch.share_type) patch.share_type = share.requires_pin ? "pin" : "temporary";
      } else if (share.expires_at && !useExpiry) {
        if (!patch.share_type) patch.share_type = "permanent";
      }

      // Max views
      const mv = parseInt(maxViews);
      patch.max_access_count = mv > 0 ? mv : null;

      const updated = await updateShare(share.id, patch);
      setShare(updated);
      setPin("");
      setChangingPin(false);
      setUsePin(updated.requires_pin);
      setUseExpiry(!!updated.expires_at);
      if (updated.expires_at) {
        const hrs = Math.max(1, Math.round((new Date(updated.expires_at).getTime() - Date.now()) / 3600000));
        setExpiryHours(closestPreset(hrs));
      }
      setMaxViews(updated.max_access_count ? String(updated.max_access_count) : "");
      setSaveSuccess(true);
      if (successTimerRef.current) clearTimeout(successTimerRef.current);
      successTimerRef.current = setTimeout(() => setSaveSuccess(false), 2000);
    } catch {
      setError("Failed to update settings");
    } finally {
      setSaving(false);
    }
  }, [share, usePin, pin, changingPin, useExpiry, expiryHours, maxViews]);

  const handlePause = React.useCallback(async () => {
    if (!share) return;
    setActionLoading(true);
    try { const r = await pauseShare(share.id); setShare(r.share); } catch { setError("Failed to pause"); }
    setActionLoading(false);
  }, [share]);

  const handleResume = React.useCallback(async () => {
    if (!share) return;
    setActionLoading(true);
    try { const r = await resumeShare(share.id); setShare(r.share); } catch { setError("Failed to resume"); }
    setActionLoading(false);
  }, [share]);

  const handleRevoke = React.useCallback(async () => {
    if (!share) return;
    setActionLoading(true);
    try {
      await revokeShare(share.id);
      setShare(null);
      setConfirmRevoke(false);
      setShowSettings(false);
      setUsePin(false); setPin(""); setUseExpiry(false); setExpiryHours(168); setMaxViews("");
    } catch { setError("Failed to revoke"); }
    setActionLoading(false);
  }, [share]);

  // Escape key
  React.useEffect(() => {
    if (!open) return;
    const handleEsc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [open, onClose]);

  if (!open) return null;

  const isActive = share && share.status === "active";
  const isPaused = share && share.status === "paused";
  const viewCount = stats?.total_accesses ?? share?.access_count ?? 0;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label={`Share ${title}`}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      <div className="relative mx-0 w-full max-w-sm max-h-[min(92dvh,48rem)] overflow-y-auto rounded-t-3xl border border-border bg-background shadow-2xl sm:mx-4 sm:max-h-[90dvh] sm:rounded-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border">
          <div className="flex items-center gap-2">
            <LinkIcon className="text-muted-foreground" />
            <h2 className="text-sm font-semibold">Share link</h2>
          </div>
          <button onClick={onClose} className="shrink-0 p-1.5 rounded-lg hover:bg-accent transition-colors text-muted-foreground">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
          </button>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-12 gap-2">
            <div className="animate-spin h-5 w-5 border-2 border-foreground/20 border-t-foreground rounded-full" />
            <p className="text-xs text-muted-foreground">Creating link...</p>
          </div>
        ) : !share ? (
          /* No share (revoked or failed to create) */
          <div className="px-5 py-6 space-y-3 text-center">
            {error && (
              <div className="rounded-lg bg-destructive/5 border border-destructive/20 px-3 py-2">
                <p className="text-xs text-destructive">{error}</p>
              </div>
            )}
            <p className="text-sm text-muted-foreground">No active share link.</p>
            <Button
              className="w-full h-9"
              onClick={async () => {
                setSaving(true);
                setError(null);
                try {
                  const s = await createSplatShare(splatId, {});
                  setShare(s);
                  setUsePin(false);
                  setUseExpiry(false);
                  const url = `${window.location.origin}/shared/${s.token}`;
                  copyToClipboard(url).then((ok) => {
                    if (ok) {
                      setCopied(true);
                      copiedTimerRef.current = setTimeout(() => setCopied(false), 3000);
                    }
                  });
                } catch {
                  setError("Failed to create link");
                }
                setSaving(false);
              }}
              loading={saving}
            >
              Create new link
            </Button>
          </div>
        ) : (
          <div className="px-5 py-4 space-y-3">
            {/* Error */}
            {error && (
              <div className="rounded-lg bg-destructive/5 border border-destructive/20 px-3 py-2">
                <p className="text-xs text-destructive">{error}</p>
              </div>
            )}

            {/* Tour title */}
            <p className="text-xs text-muted-foreground truncate">{title}</p>

            {/* ── Link URL + Copy ── */}
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div
                className="flex-1 min-w-0 bg-muted/50 rounded-lg px-3 py-2.5 cursor-text"
                onClick={(e) => {
                  const range = document.createRange();
                  range.selectNodeContents(e.currentTarget);
                  window.getSelection()?.removeAllRanges();
                  window.getSelection()?.addRange(range);
                }}
              >
                <p className="text-xs font-mono truncate text-foreground select-all">{shareUrl}</p>
              </div>
              <Button
                variant={copied ? "default" : "outline"}
                size="sm"
                onClick={handleCopy}
                className={`h-9 w-full shrink-0 gap-1.5 px-3 transition-all duration-200 sm:w-auto ${
                  copied ? "bg-foreground hover:bg-foreground text-background border-foreground" : ""
                }`}
              >
                {copied ? <CheckIcon /> : <CopyIcon />}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>

            {/* Status + stats row */}
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full ${
                  isActive ? "bg-foreground/10 text-foreground" : "bg-amber-500/10 text-amber-600"
                }`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${isActive ? "bg-foreground" : "bg-amber-500"}`} />
                  {isActive ? "Active" : "Paused"}
                </span>
                {viewCount > 0 && (
                  <span className="text-[11px] text-muted-foreground">
                    {viewCount} view{viewCount !== 1 ? "s" : ""}
                    {stats && stats.unique_ips > 0 && ` (${stats.unique_ips} unique)`}
                  </span>
                )}
              </div>

              {/* Pause/Resume toggle */}
              {isActive && (
                <button
                  onClick={handlePause}
                  disabled={actionLoading}
                  className="text-[11px] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
                >
                  Pause
                </button>
              )}
              {isPaused && (
                <button
                  onClick={handleResume}
                  disabled={actionLoading}
                  className="text-[11px] text-primary hover:text-primary/80 font-medium transition-colors disabled:opacity-40"
                >
                  Resume
                </button>
              )}
            </div>

            {/* ── Settings toggle ── */}
            <button
              type="button"
              onClick={() => setShowSettings((v) => !v)}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors w-full"
            >
              <svg
                width="12" height="12" viewBox="0 0 16 16" fill="none"
                className={`transition-transform duration-200 ${showSettings ? "rotate-90" : ""}`}
              >
                <path d="M6 4L10 8L6 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Link settings
              {(share.requires_pin || share.expires_at || share.max_access_count) && (
                <span className="text-[10px] text-muted-foreground/60">
                  ({[
                    share.requires_pin && "PIN",
                    share.expires_at && "expires",
                    share.max_access_count && "limited",
                  ].filter(Boolean).join(", ")})
                </span>
              )}
            </button>

            {/* ── Collapsible settings ── */}
            {showSettings && (
              <div className="space-y-3 animate-in slide-in-from-top-1 duration-200">
                <div className="space-y-0 rounded-xl border border-border divide-y divide-border">
                  {/* PIN */}
                  <div className="px-3.5 py-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium">Require PIN</p>
                        <p className="text-[11px] text-muted-foreground">Viewers enter a code to access</p>
                      </div>
                      <Switch checked={usePin} onCheckedChange={(v) => {
                        setUsePin(v);
                        if (!v) { setPin(""); setChangingPin(false); }
                        if (v && !share?.requires_pin) setChangingPin(true);
                      }} size="sm" />
                    </div>
                    {usePin && share?.requires_pin && !changingPin && (
                      <div className="flex flex-col gap-2 rounded-lg bg-muted/50 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex items-center gap-1.5">
                          <CheckIcon className="text-foreground w-3 h-3" />
                          <span className="text-xs text-muted-foreground">PIN is set</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => setChangingPin(true)}
                          className="text-xs font-medium text-primary hover:underline"
                        >
                          Change
                        </button>
                      </div>
                    )}
                    {usePin && (changingPin || !share?.requires_pin) && (
                      <Input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        placeholder="Enter 4-10 digit PIN"
                        value={pin}
                        onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 10))}
                        className="h-8 text-sm"
                        autoFocus
                      />
                    )}
                  </div>

                  {/* Expiry */}
                  <div className="px-3.5 py-3 space-y-2">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">Auto-expire</p>
                        <p className="text-[11px] text-muted-foreground">Link stops working after time</p>
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
                            className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
                              expiryHours === p.hours
                                ? "bg-foreground text-background"
                                : "bg-muted text-muted-foreground hover:text-foreground"
                            }`}
                          >
                            {p.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Max views */}
                  <div className="px-3.5 py-3">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">View limit</p>
                        <p className="text-[11px] text-muted-foreground">Max number of opens</p>
                      </div>
                      <Input
                        type="number"
                        min={1}
                        placeholder="None"
                        value={maxViews}
                        onChange={(e) => setMaxViews(e.target.value)}
                        className="h-8 w-full max-w-[7rem] text-sm text-right"
                      />
                    </div>
                  </div>
                </div>

                {/* Save + Revoke */}
                <div className="space-y-2">
                  <Button
                    className={`w-full h-9 gap-1.5 transition-all duration-200 ${
                      saveSuccess ? "bg-foreground hover:bg-foreground" : ""
                    }`}
                    onClick={handleSave}
                    disabled={saving}
                    loading={saving}
                  >
                    {saveSuccess ? (
                      <><CheckIcon /> Saved</>
                    ) : (
                      "Save settings"
                    )}
                  </Button>

                  <div className="pt-1 border-t border-border">
                    {!confirmRevoke ? (
                      <button
                        type="button"
                        onClick={() => setConfirmRevoke(true)}
                        className="w-full text-xs text-muted-foreground hover:text-destructive transition-colors py-1.5"
                      >
                        Revoke link permanently
                      </button>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2 py-1">
                        <span className="text-xs text-destructive flex-1">This cannot be undone</span>
                        <Button
                          variant="destructive"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={handleRevoke}
                          disabled={actionLoading}
                          loading={actionLoading}
                        >
                          Revoke
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => setConfirmRevoke(false)}
                        >
                          Cancel
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

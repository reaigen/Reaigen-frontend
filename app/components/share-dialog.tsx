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
  const [stats, setStats] = React.useState<{ total_accesses: number; unique_ips: number } | null>(null);
  const [confirmRevoke, setConfirmRevoke] = React.useState(false);
  const [actionLoading, setActionLoading] = React.useState(false);

  // Settings
  const [usePin, setUsePin] = React.useState(false);
  const [pin, setPin] = React.useState("");
  const [changingPin, setChangingPin] = React.useState(false);
  const [useExpiry, setUseExpiry] = React.useState(false);
  const [expiryHours, setExpiryHours] = React.useState(72);
  const [maxViews, setMaxViews] = React.useState("");

  // Load on open
  React.useEffect(() => {
    if (!open) return;
    setError(null);
    setShare(null);
    setStats(null);
    setConfirmRevoke(false);
    setCopied(false);
    setLoading(true);
    setUsePin(false);
    setPin("");
    setChangingPin(false);
    setUseExpiry(false);
    setExpiryHours(72);
    setMaxViews("");

    getSplatShare(splatId).then(async (existing) => {
      if (existing) {
        setShare(existing);
        setUsePin(existing.requires_pin);
        setUseExpiry(!!existing.expires_at);
        if (existing.expires_at) {
          setExpiryHours(Math.max(1, Math.round((new Date(existing.expires_at).getTime() - Date.now()) / 3600000)));
        }
        setMaxViews(existing.max_access_count ? String(existing.max_access_count) : "");
        try { const a = await getShareAnalytics(existing.id); setStats(a.stats); } catch {}
      }
      setLoading(false);
    });
  }, [open, splatId]);

  const shareUrl = share ? `${window.location.origin}/shared/${share.token}` : "";

  // ── Create new share ──
  const handleCreate = React.useCallback(async () => {
    if (usePin && pin.length < 4) {
      setError("Enter a 4-10 digit PIN");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const opts: Record<string, unknown> = {};
      if (usePin && pin.length >= 4) opts.pin = pin;
      if (useExpiry) opts.expires_in_hours = expiryHours;
      const mv = parseInt(maxViews);
      if (mv > 0) opts.max_access_count = mv;

      const s = await createSplatShare(splatId, opts as any);
      setShare(s);
      setPin("");
      setChangingPin(false);
      setUsePin(s.requires_pin);
      setUseExpiry(!!s.expires_at);
      if (s.expires_at) {
        setExpiryHours(Math.max(1, Math.round((new Date(s.expires_at).getTime() - Date.now()) / 3600000)));
      }
      setMaxViews(s.max_access_count ? String(s.max_access_count) : "");
    } catch {
      setError("Failed to create link");
    } finally {
      setSaving(false);
    }
  }, [splatId, usePin, pin, useExpiry, expiryHours, maxViews]);

  // ── Update existing share (PATCH — keeps token, keeps PIN if not changed) ──
  const handleUpdate = React.useCallback(async () => {
    if (!share) return;
    // If enabling PIN for the first time, or changing PIN, need digits
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
    try {
      const patch: Record<string, unknown> = {};

      // PIN changes
      if (usePin && pin.length >= 4) {
        patch.share_type = "pin";
        patch.pin = pin;
      } else if (usePin && share.requires_pin) {
        // Keep existing PIN, don't change share_type
        patch.share_type = "pin";
      } else if (!usePin && share.requires_pin) {
        // Removing PIN
        patch.share_type = useExpiry ? "temporary" : "permanent";
      }

      // Expiry
      if (useExpiry) {
        patch.expires_in_hours = expiryHours;
        if (!patch.share_type) patch.share_type = share.requires_pin ? "pin" : "temporary";
      } else if (share.expires_at && !useExpiry) {
        // Removing expiry
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
        setExpiryHours(Math.max(1, Math.round((new Date(updated.expires_at).getTime() - Date.now()) / 3600000)));
      }
      setMaxViews(updated.max_access_count ? String(updated.max_access_count) : "");
    } catch {
      setError("Failed to update");
    } finally {
      setSaving(false);
    }
  }, [share, usePin, pin, useExpiry, expiryHours, maxViews]);

  const handleCopy = React.useCallback(async () => {
    if (!shareUrl) return;
    if (await copyToClipboard(shareUrl)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [shareUrl]);

  const handlePause = React.useCallback(async () => {
    if (!share) return;
    setActionLoading(true);
    try { const r = await pauseShare(share.id); setShare(r.share); } catch { setError("Failed"); }
    setActionLoading(false);
  }, [share]);

  const handleResume = React.useCallback(async () => {
    if (!share) return;
    setActionLoading(true);
    try { const r = await resumeShare(share.id); setShare(r.share); } catch { setError("Failed"); }
    setActionLoading(false);
  }, [share]);

  const handleRevoke = React.useCallback(async () => {
    if (!share) return;
    setActionLoading(true);
    try {
      await revokeShare(share.id);
      setShare(null);
      setConfirmRevoke(false);
      setUsePin(false); setPin(""); setUseExpiry(false); setExpiryHours(72); setMaxViews("");
    } catch { setError("Failed"); }
    setActionLoading(false);
  }, [share]);

  if (!open) return null;

  const isActive = share && share.status === "active";
  const isPaused = share && share.status === "paused";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-sm mx-4 bg-background border border-border rounded-2xl shadow-elevated overflow-hidden animate-fade-up">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border">
          <h2 className="text-sm font-semibold truncate pr-4">{title}</h2>
          <button onClick={onClose} className="shrink-0 p-1 rounded-lg hover:bg-accent transition-colors text-muted-foreground">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin h-5 w-5 border-2 border-foreground/20 border-t-foreground rounded-full" />
          </div>
        ) : (
          <div className="px-5 py-4 space-y-4">
            {error && (
              <p className="text-xs text-destructive">{error}</p>
            )}

            {/* ── Link (when share exists) ── */}
            {share && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <div className="flex-1 min-w-0 bg-muted/50 rounded-lg px-3 py-2 cursor-text" onClick={(e) => {
                    const range = document.createRange();
                    range.selectNodeContents(e.currentTarget);
                    window.getSelection()?.removeAllRanges();
                    window.getSelection()?.addRange(range);
                  }}>
                    <p className="text-xs font-mono truncate text-muted-foreground select-all">{shareUrl}</p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCopy}
                    className={`shrink-0 h-8 px-3 ${copied ? "bg-success/10 text-success border-success/30" : ""}`}
                  >
                    {copied ? "Copied" : "Copy"}
                  </Button>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${
                    isActive ? "bg-success/10 text-success" : "bg-amber-500/10 text-amber-600"
                  }`}>
                    {isActive ? "Active" : "Paused"}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {stats?.total_accesses ?? share.access_count} views
                    {stats && stats.unique_ips > 0 && ` / ${stats.unique_ips} unique`}
                  </span>
                </div>
              </div>
            )}

            {/* ── Security settings ── */}
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
                  <div className="flex items-center justify-between bg-muted/50 rounded-lg px-3 py-2">
                    <span className="text-xs text-muted-foreground">PIN is set</span>
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
                    placeholder="4-10 digit PIN"
                    value={pin}
                    onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 10))}
                    className="h-8 text-sm"
                    autoFocus
                  />
                )}
              </div>

              {/* Expiry */}
              <div className="px-3.5 py-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">Auto-expire</p>
                    <p className="text-[11px] text-muted-foreground">Link stops working after time</p>
                  </div>
                  <Switch checked={useExpiry} onCheckedChange={setUseExpiry} size="sm" />
                </div>
                {useExpiry && (
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={1}
                      max={8760}
                      value={expiryHours}
                      onChange={(e) => setExpiryHours(Math.max(1, parseInt(e.target.value) || 1))}
                      className="h-8 w-20 text-sm"
                    />
                    <span className="text-xs text-muted-foreground">
                      hours ({Math.floor(expiryHours / 24)}d {expiryHours % 24}h)
                    </span>
                  </div>
                )}
              </div>

              {/* Max views */}
              <div className="px-3.5 py-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">View limit</p>
                    <p className="text-[11px] text-muted-foreground">Max number of opens</p>
                  </div>
                  <Input
                    type="number"
                    min={1}
                    placeholder="No limit"
                    value={maxViews}
                    onChange={(e) => setMaxViews(e.target.value)}
                    className="h-8 w-20 text-sm text-right"
                  />
                </div>
              </div>
            </div>

            {/* ── Action buttons ── */}
            <div className="space-y-2">
              <Button
                className="w-full h-9"
                onClick={share ? handleUpdate : handleCreate}
                disabled={saving}
                loading={saving}
              >
                {share ? "Save changes" : "Create link"}
              </Button>

              {share && (
                <div className="flex items-center gap-2">
                  {isActive && (
                    <Button variant="outline" size="sm" className="flex-1 h-8" onClick={handlePause} disabled={actionLoading}>
                      Pause
                    </Button>
                  )}
                  {isPaused && (
                    <Button variant="outline" size="sm" className="flex-1 h-8" onClick={handleResume} disabled={actionLoading}>
                      Resume
                    </Button>
                  )}
                  {!confirmRevoke ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="flex-1 h-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                      onClick={() => setConfirmRevoke(true)}
                    >
                      Delete link
                    </Button>
                  ) : (
                    <Button
                      variant="destructive"
                      size="sm"
                      className="flex-1 h-8"
                      onClick={handleRevoke}
                      disabled={actionLoading}
                    >
                      Confirm delete
                    </Button>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

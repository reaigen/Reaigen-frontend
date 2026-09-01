"use client";

import { useEffect, useState } from "react";
import { cn } from "../lib/utils";
import { ReaigenWordmark } from "./reaigen-wordmark";

/**
 * The app's single loading identity, mirroring the iOS launch screen
 * (`Reai UI/AppStartupView.swift`): the wordmark centred in the box, the
 * progress rail parked against the bottom edge.
 *
 * There used to be two compositions — this one drew a short rail directly under
 * a 29px mark, while the full-page loader drew a 48px mark with the rail at the
 * bottom. Both appear in the same session (this one behind the 3D viewport and
 * the tour editor, the other on every route change), so the mark visibly jumped
 * size and the rail teleported as one replaced the other. They are now the same
 * component, so nothing moves.
 *
 * It positions itself with `absolute inset-0`, so every caller must be a
 * positioned box — all three are (`fixed inset-0` or `absolute inset-0`).
 */
export function ReaigenLoadingMark({
  status,
  slowStatus,
  retryLabel,
  cancelLabel,
  onRetry,
  onCancel,
  className,
  tone = "light",
}: {
  status?: string;
  slowStatus?: string;
  retryLabel?: string;
  cancelLabel?: string;
  onRetry?: () => void;
  onCancel?: () => void;
  className?: string;
  tone?: "light" | "dark";
}) {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    if (!slowStatus) return undefined;
    // "Slow" means stuck, not merely long: a large scene on mobile data
    // legitimately spends the better part of a minute downloading, and the
    // old flat 12s-from-mount timer showed the warning over perfectly
    // healthy loads. The timer restarts every time the load advances to a
    // new phase, so the warning only appears after 30s with no progress.
    setSlow(false);
    const timer = window.setTimeout(() => setSlow(true), 30_000);
    return () => window.clearTimeout(timer);
  }, [slowStatus, status]);

  return (
    <div className={cn("absolute inset-0 flex items-center justify-center px-6", className)}>
      {/*
        Shrink-to-fit column: its width is set by the wordmark, the only child
        with an intrinsic width, and the rail then stretches to exactly that.
        The rail used to be a fixed 180px, which is narrower than the mark on a
        desktop but *wider* than it on a phone — the line visibly overhung the
        logo it belonged to. Tying one to the other means they agree at every
        size the clamp below can produce.
      */}
      <div className="relative inline-flex flex-col items-stretch gap-4">
        {/*
          The vw term is what phones actually get; the ceiling applies from
          ~430px up, so desktop settles at 40px while a 393px handset drops to
          ~37px. The rail is sized off this mark, so it narrows with it and the
          pair stays in proportion.

          This is a wait, not a splash. At 60px the mark filled a third of a
          laptop viewport for something that is often gone inside a second, and
          the bigger it is the more any change in it — a font swapping in, a
          remount replaying the entrance — reads as movement rather than as a
          logo sitting still.
        */}
        {/*
          No entrance animation. The mark had faded in — originally with a
          scale, then opacity alone — but this loader mounts on route changes
          and again behind the viewport and the editor, several times in a
          session, and every mount replays it. Repeated often enough, a logo
          that keeps fading up does not read as an entrance; it reads as
          flickering. The rail underneath already carries the "working" signal,
          so the mark can simply be present and hold still.
        */}
        <ReaigenWordmark className={cn(
          "text-[clamp(32px,9vw,40px)] leading-none tracking-[-0.02em]",
          tone === "dark" ? "text-white" : "text-foreground",
        )} />

        {/* iOS drives this determinately from AppStartupManager.progress; the
            web has no equivalent signal, so it runs indeterminate. */}
        <div
          className={cn("loading-progress-track w-full", tone === "dark" && "loading-progress-track-on-dark")}
          role="progressbar"
          aria-label={status || "Loading"}
        >
          <span className="loading-progress-indeterminate" />
        </div>

        <div
          className="absolute left-1/2 top-full mt-3 w-[min(19rem,80vw)] -translate-x-1/2 text-center"
          aria-live="polite"
        >
          {slow && slowStatus ? (
            <div data-testid="viewer-loading-slow">
              <p className={cn("text-[11px] leading-relaxed", tone === "dark" ? "text-white/55" : "text-muted-foreground")}>{slowStatus}</p>
              {onRetry || onCancel ? (
                <div className="mt-3 flex items-center justify-center gap-2">
                  {onCancel && cancelLabel ? (
                    <button
                      type="button"
                      onClick={onCancel}
                      className={cn(
                        "min-h-9 rounded-full border px-3 text-[11px] font-medium focus-visible:outline-none focus-visible:ring-2",
                        tone === "dark"
                          ? "border-white/15 bg-black/50 text-white/75 hover:bg-black/65 hover:text-white focus-visible:ring-white/60"
                          : "border-border/70 bg-card text-foreground/70 hover:bg-accent hover:text-foreground focus-visible:ring-ring",
                      )}
                    >
                      {cancelLabel}
                    </button>
                  ) : null}
                  {onRetry && retryLabel ? (
                    <button
                      type="button"
                      onClick={onRetry}
                      className={cn(
                        "min-h-9 rounded-full px-3 text-[11px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
                        tone === "dark"
                          ? "bg-white text-black hover:bg-white/90 focus-visible:ring-white/70 focus-visible:ring-offset-black"
                          : "bg-foreground text-background hover:bg-foreground/85 focus-visible:ring-ring",
                      )}
                    >
                      {retryLabel}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

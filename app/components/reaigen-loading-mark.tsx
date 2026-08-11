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
  className,
}: {
  status?: string;
  className?: string;
}) {
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
      <div className="inline-flex flex-col items-stretch gap-4">
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
        <ReaigenWordmark className="animate-startup-mark text-[clamp(32px,9vw,40px)] leading-none tracking-[-0.02em] text-foreground" />

        {/* iOS drives this determinately from AppStartupManager.progress; the
            web has no equivalent signal, so it runs indeterminate. */}
        <div
          className="loading-progress-track w-full"
          role="progressbar"
          aria-label={status || "Loading"}
        >
          <span className="loading-progress-indeterminate" />
        </div>
      </div>
    </div>
  );
}

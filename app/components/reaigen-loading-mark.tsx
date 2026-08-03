import { cn } from "../lib/utils";
import { ReaigenWordmark } from "./reaigen-wordmark";

export function ReaigenLoadingMark({
  status,
  className,
}: {
  status?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center gap-4", className)}>
      <ReaigenWordmark className="text-[29px] text-foreground/80" />
      <div
        className="h-[3px] w-16 overflow-hidden rounded-full bg-foreground/10"
        role="progressbar"
        aria-label={status || "Loading"}
      >
        <span className="block h-full w-1/2 animate-[shimmer-bar_1.2s_ease-in-out_infinite] rounded-full bg-foreground/40" />
      </div>
      <span
        className="h-5 w-[min(16rem,calc(100vw-2rem))] truncate text-center text-[12px] text-muted-foreground"
        role="status"
        aria-live="polite"
      >
        {status || "\u00A0"}
      </span>
    </div>
  );
}

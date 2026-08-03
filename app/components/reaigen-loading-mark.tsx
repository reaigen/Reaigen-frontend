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
        className="loading-progress-track w-16"
        role="progressbar"
        aria-label={status || "Loading"}
      >
        <span className="loading-progress-indeterminate" />
      </div>
      <span
        className="h-5 w-[min(16rem,calc(100vw-2rem))] truncate text-center text-[12px] text-muted-foreground"
        aria-hidden="true"
      >
        {"\u00A0"}
      </span>
    </div>
  );
}

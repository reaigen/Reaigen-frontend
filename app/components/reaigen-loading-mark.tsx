import { cn } from "../lib/utils";
import { LoadingDots } from "./loading-dots";
import { ReaigenWordmark } from "./reaigen-wordmark";

export function ReaigenLoadingMark({
  status,
  className,
}: {
  status?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center gap-3", className)}>
      <ReaigenWordmark className="text-[29px] text-foreground/80" />
      <LoadingDots label={status || "Loading"} className="text-foreground/45" />
    </div>
  );
}

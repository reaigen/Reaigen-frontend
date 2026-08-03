import { cn } from "../lib/utils";
import { LoadingDots } from "./loading-dots";

export function CollectionLoading({
  label,
  className,
}: {
  label: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "async-stable-region flex min-h-32 items-start justify-center pt-8",
        className,
      )}
      role="status"
      aria-busy="true"
      aria-label={label}
    >
      <LoadingDots label={label} className="text-foreground/45" />
    </div>
  );
}

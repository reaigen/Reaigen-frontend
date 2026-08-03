import { cn } from "../lib/utils";

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
      <span className="sr-only">{label}</span>
    </div>
  );
}

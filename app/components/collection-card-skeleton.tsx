import { cn } from "../lib/utils";

export function CollectionCardSkeleton({ className }: { className?: string }) {
  return (
    <article
      aria-hidden="true"
      className={cn(
        "relative aspect-[16/10] overflow-hidden rounded-[1.5rem] border border-border/70 bg-card sm:rounded-2xl",
        className,
      )}
    >
      <div className="draft-skeleton-shape absolute inset-0" />
      <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-foreground/[0.11] to-transparent" />
      <div className="draft-skeleton-shape absolute left-4 top-4 h-7 w-24 rounded-full sm:left-5 sm:top-5" />
      <div className="absolute inset-x-4 bottom-4 flex items-end justify-between gap-4 sm:inset-x-5 sm:bottom-5">
        <div className="min-w-0 flex-1 space-y-2.5">
          <div className="draft-skeleton-shape h-4 w-[58%] rounded-full" />
          <div className="draft-skeleton-shape h-3 w-[38%] rounded-full opacity-80" />
        </div>
        <div className="draft-skeleton-shape h-9 w-24 rounded-full" />
      </div>
    </article>
  );
}

export function CollectionCardSkeletons({
  label,
  count = 4,
  columns = 2,
  className,
}: {
  label: string;
  count?: number;
  columns?: 1 | 2;
  className?: string;
}) {
  return (
    <div
      data-testid="collection-card-skeletons"
      role="status"
      aria-busy="true"
      aria-label={label}
      className={cn(
        "grid grid-cols-1 gap-5 xl:gap-6",
        columns === 2 ? "md:grid-cols-2" : "mx-auto max-w-2xl",
        className,
      )}
    >
      <span className="sr-only">{label}</span>
      {Array.from({ length: count }, (_, index) => (
        <CollectionCardSkeleton key={index} />
      ))}
    </div>
  );
}

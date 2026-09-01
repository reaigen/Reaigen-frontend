import { cn } from "../lib/utils";

function SkeletonShape({ className }: { className: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("draft-skeleton-shape block", className)}
    />
  );
}

function DraftDetailSkeletonContent({
  label,
  className,
}: {
  label: string;
  className?: string;
}) {
  return (
    <div
      data-testid="draft-detail-skeleton"
      className={cn(
        "draft-detail-page relative mx-auto w-full max-w-[1360px] pb-24 md:pb-12",
        className,
      )}
      role="status"
      aria-busy="true"
      aria-label={label}
    >
      <span className="sr-only">{label}</span>

      {/* The mobile detail route owns its back action below the global header. */}
      <div aria-hidden="true" className="mb-4 flex md:hidden">
        <div className="flex h-11 w-28 items-center gap-2 rounded-full border border-border/60 bg-card px-3.5">
          <SkeletonShape className="h-4 w-4 rounded-full" />
          <SkeletonShape className="h-3 w-14 rounded-full" />
        </div>
      </div>

      {/*
        Mirror the loaded draft's continuous summary/media workspace. Keeping
        the same ordering, radii and breakpoints avoids a second layout jump
        when the real title, facts and gallery replace these silhouettes.
      */}
      <div className="draft-mobile-workspace flex flex-col overflow-hidden border-0 bg-transparent shadow-none md:rounded-[1.65rem] md:border md:border-border/65 md:bg-card md:shadow-card">
        <section aria-hidden="true" className="order-first min-w-0 bg-transparent px-1 pb-5 pt-1 md:bg-card md:p-6">
          <div className="flex flex-wrap items-center gap-2">
            <SkeletonShape className="h-7 w-20 rounded-full" />
            <SkeletonShape className="h-7 w-24 rounded-full" />
            <SkeletonShape className="hidden h-7 w-24 rounded-full sm:block" />
          </div>

          <div className="mt-4 space-y-2.5">
            <SkeletonShape className="h-8 w-[min(78%,38rem)] rounded-xl sm:h-10" />
            <SkeletonShape className="h-4 w-[min(62%,27rem)] rounded-full" />
          </div>
          <SkeletonShape className="mt-4 h-7 w-36 rounded-lg sm:h-8 sm:w-44" />

          <div className="mt-5 flex gap-2.5 overflow-hidden border-border/70 pb-1 sm:grid sm:grid-cols-3 md:border-t md:pb-0 md:pt-5">
            {[0, 1, 2].map((index) => (
              <div
                key={index}
                className="flex h-[4.15rem] w-[9.75rem] flex-none items-center gap-2.5 rounded-[1.125rem] border border-border/45 bg-surface-subtle px-3 sm:w-auto md:rounded-xl"
              >
                <SkeletonShape className="h-8 w-8 shrink-0 rounded-full bg-foreground/[0.085]" />
                <span className="min-w-0 flex-1 space-y-2">
                  <SkeletonShape className="h-3.5 w-3/4 rounded-full" />
                  <SkeletonShape className="h-2.5 w-full rounded-full" />
                </span>
              </div>
            ))}
          </div>

          <div className="mt-5 hidden border-t border-border/70 pt-5 md:block">
            <div className="flex min-h-12 items-center gap-2 rounded-full border border-border/68 bg-card p-1">
              <SkeletonShape className="h-10 w-40 rounded-full" />
              <SkeletonShape className="h-10 flex-1 rounded-full" />
              <SkeletonShape className="h-10 flex-1 rounded-full" />
              <SkeletonShape className="h-10 flex-1 rounded-full" />
            </div>
          </div>
        </section>

        <div aria-hidden="true" className="draft-mobile-media min-w-0 space-y-3 border-0 p-0 md:space-y-4 md:border-t md:border-border/60 md:p-5">
          <div className="hidden h-10 w-52 items-center gap-1 rounded-full border border-border/65 bg-card p-1 sm:flex">
            <SkeletonShape className="h-8 flex-1 rounded-full" />
            <SkeletonShape className="h-8 flex-1 rounded-full" />
          </div>
          <div className="detail-hero-frame overflow-hidden rounded-[1.5rem] md:rounded-2xl md:ring-1 md:ring-border/70">
            <SkeletonShape className="detail-hero-gallery aspect-[4/3] w-full rounded-[1.5rem] sm:aspect-[16/10] md:aspect-video md:rounded-xl" />
          </div>
        </div>

        <div aria-hidden="true" className="mx-1 mt-3 grid grid-cols-3 gap-1 rounded-full border border-border/55 bg-card p-1 md:hidden">
          <SkeletonShape className="h-10 rounded-full" />
          <SkeletonShape className="h-10 rounded-full" />
          <SkeletonShape className="h-10 rounded-full" />
        </div>
      </div>

      {/* Reserve the first supporting-detail row instead of ending at a blank fold. */}
      <div aria-hidden="true" className="mt-6 grid gap-6 md:mt-8 md:gap-7 lg:mt-10 lg:grid-cols-2">
        <section>
          <div className="mb-3 flex items-center gap-2">
            <SkeletonShape className="h-5 w-5 rounded-md" />
            <SkeletonShape className="h-4 w-32 rounded-full" />
          </div>
          <div className="rounded-[1.5rem] border border-border/60 bg-card p-5 sm:rounded-2xl sm:p-6">
            <div className="space-y-3">
              <SkeletonShape className="h-3.5 w-full rounded-full" />
              <SkeletonShape className="h-3.5 w-[92%] rounded-full" />
              <SkeletonShape className="h-3.5 w-[78%] rounded-full" />
              <SkeletonShape className="h-3.5 w-[86%] rounded-full" />
            </div>
          </div>
        </section>
        <section>
          <div className="mb-3 flex items-center gap-2">
            <SkeletonShape className="h-5 w-5 rounded-md" />
            <SkeletonShape className="h-4 w-28 rounded-full" />
          </div>
          <div className="grid grid-cols-2 gap-3 rounded-[1.5rem] border border-border/60 bg-card p-5 sm:rounded-2xl sm:p-6">
            {[0, 1, 2, 3].map((index) => (
              <div key={index} className="space-y-2 border-b border-border/45 pb-3">
                <SkeletonShape className="h-2.5 w-20 rounded-full" />
                <SkeletonShape className="h-4 w-28 max-w-full rounded-full" />
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

export function DraftDetailSkeleton({
  label = "Loading",
  standalone = false,
  className,
}: {
  label?: string;
  standalone?: boolean;
  className?: string;
}) {
  if (!standalone) {
    return <DraftDetailSkeletonContent label={label} className={className} />;
  }

  return (
    <div
      data-testid="draft-detail-skeleton-shell"
      className="fixed inset-0 z-50 overflow-y-auto bg-background"
    >
      {/* Cold loads precede the authenticated AppShell. Trace its fixed chrome
          here so authentication never exposes an unstructured white canvas. */}
      <aside aria-hidden="true" className="fixed inset-y-0 left-0 z-[60] hidden w-[5.5rem] flex-col bg-card md:flex">
        <div className="flex h-[var(--header-total-h)] shrink-0 items-center justify-center">
          <span className="text-[28px] font-normal leading-none tracking-[-0.025em]" style={{ fontFamily: "var(--font-brand), ui-serif, Georgia, serif" }}>Re</span>
        </div>
        <div className="flex flex-1 flex-col items-center gap-4 px-2.5 pb-4 pt-4">
          <SkeletonShape className="h-12 w-12 rounded-full" />
          <SkeletonShape className="h-12 w-12 rounded-full" />
          <SkeletonShape className="h-12 w-12 rounded-full" />
          <SkeletonShape className="mt-auto h-12 w-12 rounded-full" />
        </div>
      </aside>

      <header aria-hidden="true" className="fixed inset-x-0 top-0 z-50 bg-card md:left-[5.5rem]">
        <div className="flex h-[var(--header-total-h)] items-center gap-3 px-4 pt-safe md:gap-4 md:px-5">
          <span className="text-[29px] font-normal leading-none tracking-[-0.025em] md:hidden" style={{ fontFamily: "var(--font-brand), ui-serif, Georgia, serif" }}>Reaigen</span>
          <div className="hidden min-w-0 flex-1 items-center gap-3 md:flex">
            <SkeletonShape className="h-10 w-10 shrink-0 rounded-full" />
            <div className="space-y-2">
              <SkeletonShape className="h-2.5 w-20 rounded-full" />
              <SkeletonShape className="h-4 w-48 rounded-full" />
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <SkeletonShape className="h-10 w-24 rounded-full" />
            <SkeletonShape className="h-10 w-10 rounded-full" />
          </div>
        </div>
      </header>

      <main className="min-h-dvh px-4 pb-7 pt-[calc(var(--header-total-h)+1.5rem)] md:ml-[5.5rem] md:px-8 md:pt-[calc(var(--header-total-h)+1.25rem)] xl:px-10 2xl:px-12">
        <DraftDetailSkeletonContent label={label} className={className} />
      </main>
    </div>
  );
}

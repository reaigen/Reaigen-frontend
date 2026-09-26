import { AgentIcon } from "./icons";

/**
 * Stands in for the agent panel while its chunk loads.
 *
 * The first open used to show a blank card for as long as the agent bundle
 * took to arrive, and then the intro, chips and composer popped in. This
 * silhouette uses the panel's own geometry (padding, intro, three chips,
 * composer) so the real card replaces it without anything moving. The
 * loading fallback gets no props, so the compact phone layout is matched with
 * the same breakpoint the shell uses for `compact` (below 768px).
 *
 * Keep it static and light: it ships with the shell, not with the agent.
 */
export function ReaiAgentSkeleton() {
  return (
    <div
      data-testid="agent-panel-skeleton"
      role="status"
      aria-busy="true"
      className="async-stable-region relative flex h-full min-h-0 flex-col p-4 pb-[max(1rem,env(safe-area-inset-bottom))] max-md:p-3 max-md:pb-[max(1rem,env(safe-area-inset-bottom))]"
    >
      <div aria-hidden="true" className="mt-4 flex min-h-0 flex-1 flex-col gap-3 max-md:mt-1 max-md:gap-2">
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 pb-8">
          <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-border/65 bg-card text-foreground/35 shadow-control">
            <AgentIcon size={22} strokeWidth={1.7} />
          </span>
          <div className="flex w-full max-w-[300px] flex-col items-center gap-2 py-1">
            <span className="draft-skeleton-shape h-3 w-[86%] rounded-full" />
            <span className="draft-skeleton-shape h-3 w-[58%] rounded-full" />
          </div>
        </div>
        <div className="flex flex-wrap justify-center gap-2 max-md:flex-nowrap max-md:justify-start max-md:overflow-hidden">
          <span className="draft-skeleton-shape h-11 w-32 shrink-0 rounded-2xl" />
          <span className="draft-skeleton-shape h-11 w-28 shrink-0 rounded-2xl max-[359px]:hidden" />
          <span className="draft-skeleton-shape h-11 w-36 shrink-0 rounded-2xl max-md:hidden" />
        </div>
        <div className="w-full min-w-0 shrink-0 rounded-[20px] border border-border/80 bg-card shadow-control">
          <div className="min-h-16 px-4 pb-2 pt-3">
            <span className="draft-skeleton-shape mt-1.5 block h-3 w-2/5 rounded-full opacity-70" />
          </div>
          <div className="flex min-w-0 items-center gap-2 px-2 pb-2">
            <span className="h-11 w-24 shrink-0 rounded-[20px] bg-foreground/[0.04]" />
            <span className="min-w-0 flex-1" />
            <span className="h-11 w-11 shrink-0 rounded-[20px] bg-foreground/[0.06]" />
          </div>
        </div>
      </div>
    </div>
  );
}

import * as React from "react";
import { cn } from "../lib/utils";

export function PageHeader({
  eyebrow,
  title,
  meta,
  description,
  actions,
  actionPlacement = "end",
  className,
}: {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  /**
   * Small line about the list itself — a count, a filter state. Distinct from
   * `description`, which is desktop orientation copy and hidden on phones:
   * this stays visible everywhere because it is about what is on screen right
   * now rather than what the page is for.
   */
  meta?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  actionPlacement?: "start" | "end";
  className?: string;
}) {
  return (
    <header
      className={cn(
        // A row at every width. This used to stack on phones, which gave the
        // action a full-width band of its own between the title and the list —
        // a third horizontal rule of chrome to scroll past before reaching any
        // content. Beside the title it costs nothing.
        actionPlacement === "end"
          && "flex items-start justify-between gap-3 sm:items-end sm:gap-4",
        className,
      )}
    >
      <div className="min-w-0">
        {eyebrow ? (
          <div className="mb-2 text-[11px] font-semibold tracking-[0.035em] text-muted-foreground sm:text-[12px]">
            {eyebrow}
          </div>
        ) : null}
        {/*
          Steps down hard on phones. At 32px a one-word title was over a tenth
          of the screen, and it sat above the action rather than beside it, so
          the two together pushed the list most of the way down the fold.
          Desktop keeps the display size, where there is room for it.
        */}
        {/*
          Wraps rather than truncates. Sharing the row with the action means a
          long title and a long button cannot both fit a phone: "Virtuálne
          prehliadky" beside "Vytvoriť prehliadku" left the title reading
          "Virtuálne pre…", which is worse than any amount of height. Two lines
          costs ~28px; a clipped page title costs the user the page's name.
          `text-balance` keeps the break near the middle instead of leaving one
          word stranded.
        */}
        {/*
          Working-page scale, not display scale. With the brand now anchored in
          the app header, a 40px page title was the loudest thing on every
          desktop screen — the title names the view, it doesn't headline it.
        */}
        <h1 className="text-balance text-[24px] font-bold leading-[1.12] tracking-[-0.03em] text-foreground sm:text-[28px] sm:leading-[1.15]">
          {title}
        </h1>
        {meta ? (
          <div className="mt-0.5 truncate text-[13px] font-medium text-muted-foreground tabular-nums sm:mt-1.5">
            {meta}
          </div>
        ) : null}
        {/*
          Desktop orientation copy. On a phone it cost two full lines above the
          fold and pushed the working list off-screen, so the list wins there.
        */}
        {description ? (
          <p className="mt-3 hidden max-w-2xl text-[14px] leading-relaxed text-muted-foreground sm:block sm:text-[15px]">
            {description}
          </p>
        ) : null}
        {actions && actionPlacement === "start" ? <div className="mt-4 flex items-center gap-2">{actions}</div> : null}
      </div>
      {actions && actionPlacement === "end" ? (
        <div className="flex shrink-0 items-center gap-2 pt-0.5 sm:pb-0.5 sm:pt-0">
          {actions}
        </div>
      ) : null}
    </header>
  );
}

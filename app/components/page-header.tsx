import * as React from "react";
import { cn } from "../lib/utils";

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  actionPlacement = "end",
  className,
}: {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  actionPlacement?: "start" | "end";
  className?: string;
}) {
  return (
    <header className={cn(actionPlacement === "end" && "flex flex-col items-start gap-4 sm:flex-row sm:justify-between sm:items-end", className)}>
      <div className="min-w-0">
        {eyebrow ? (
          <div className="mb-2 text-[11px] font-semibold tracking-[0.035em] text-muted-foreground sm:text-[12px]">
            {eyebrow}
          </div>
        ) : null}
        <h1 className="text-[32px] font-bold leading-[1.08] tracking-[-0.035em] text-foreground sm:text-[40px]">
          {title}
        </h1>
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
      {/*
        On phones the action row spans the full width and splits, so page meta
        sits at one end and the action at the other instead of the two crowding
        together as look-alike pills.
      */}
      {actions && actionPlacement === "end" ? (
        <div className="flex w-full shrink-0 items-center justify-between gap-2 sm:w-auto sm:justify-end sm:pb-0.5">
          {actions}
        </div>
      ) : null}
    </header>
  );
}

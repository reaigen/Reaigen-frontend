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
        {description ? (
          <p className="mt-3 max-w-2xl text-[14px] leading-relaxed text-muted-foreground sm:text-[15px]">
            {description}
          </p>
        ) : null}
        {actions && actionPlacement === "start" ? <div className="mt-4 flex items-center gap-2">{actions}</div> : null}
      </div>
      {actions && actionPlacement === "end" ? <div className="flex shrink-0 items-center gap-2 sm:pb-0.5">{actions}</div> : null}
    </header>
  );
}

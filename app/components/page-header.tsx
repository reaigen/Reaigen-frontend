import * as React from "react";
import { cn } from "../lib/utils";

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex flex-row items-start justify-between gap-3 md:items-end", className)}>
      <div className="min-w-0">
        {eyebrow ? (
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            {eyebrow}
          </div>
        ) : null}
        <h1 className="text-[20px] font-semibold leading-tight tracking-[-0.02em] text-foreground sm:text-[24px]">
          {title}
        </h1>
        {description ? (
          <p className="mt-1 hidden max-w-2xl text-[13px] leading-relaxed text-muted-foreground sm:block">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}

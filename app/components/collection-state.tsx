import * as React from "react";
import { cn } from "../lib/utils";

export function CollectionState({
  icon,
  title,
  description,
  action,
  kind = "empty",
  className,
}: {
  icon: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  kind?: "empty" | "error";
  className?: string;
}) {
  return (
    <section
      role={kind === "error" ? "alert" : "status"}
      className={cn(
        "flex min-h-[260px] flex-col items-center justify-center rounded-2xl border border-border bg-card px-6 py-14 text-center shadow-card",
        className,
      )}
    >
      <span
        className={cn(
          "mb-4 flex h-11 w-11 items-center justify-center rounded-xl border bg-surface-subtle",
          kind === "error" ? "border-destructive/15 text-destructive/65" : "border-border/45 text-foreground/35",
        )}
        aria-hidden="true"
      >
        {icon}
      </span>
      <h2 className="text-[14px] font-semibold tracking-[-0.01em] text-foreground">{title}</h2>
      {description ? (
        <p className="mt-1.5 max-w-sm text-[12px] leading-relaxed text-muted-foreground">{description}</p>
      ) : null}
      {action ? <div className="mt-4 flex items-center justify-center gap-2">{action}</div> : null}
    </section>
  );
}

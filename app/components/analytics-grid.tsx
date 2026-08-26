import * as React from "react";
import { cn } from "../lib/utils";

export interface AnalyticsGridItem {
  label: string;
  value: React.ReactNode;
}

export function AnalyticsGrid({
  items,
  loading = false,
  className,
}: {
  items: AnalyticsGridItem[];
  loading?: boolean;
  className?: string;
}) {
  if (loading) {
    return (
      <div className={cn("flex min-h-16 items-center justify-center rounded-lg bg-surface-subtle", className)} role="status">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-foreground/10 border-t-foreground/50" aria-hidden="true" />
      </div>
    );
  }

  const columns = items.length >= 4
    ? "grid-cols-2 sm:grid-cols-4"
    : items.length === 3
      ? "grid-cols-2 sm:grid-cols-3"
      : items.length === 2
        ? "grid-cols-2"
        : "grid-cols-1";

  return (
    <dl className={cn("grid gap-2.5", columns, className)}>
      {items.map((item, index) => (
        <div
          key={item.label}
          className={cn(
            "flex min-w-0 flex-col rounded-[1.1rem] border border-border/55 bg-card/72 px-3.5 py-3 text-left shadow-[inset_0_1px_0_rgba(255,255,255,.92),0_7px_20px_-18px_rgba(0,0,0,.28)] backdrop-blur-xl",
            items.length === 3 && index === 2 && "col-span-2 sm:col-span-1",
          )}
        >
          <dt className="order-2 mt-1 truncate text-[10px] font-medium text-foreground/48" title={item.label}>{item.label}</dt>
          <dd className="order-1 text-[19px] font-semibold leading-none tracking-[-0.025em] tabular-nums">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

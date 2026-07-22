import * as React from "react";
import { cn } from "../lib/utils";

export function PropertyFactTile({
  label,
  value,
  className,
  compact = false,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div className={cn("min-w-0 flex-1 rounded-lg border border-border/45 bg-surface-subtle px-2.5 py-2", className)}>
      <p className={cn("truncate font-semibold uppercase tracking-[0.075em] text-muted-foreground", compact ? "text-[8px]" : "text-[9px]")}>{label}</p>
      <p className={cn("mt-0.5 truncate font-semibold text-foreground tabular-nums", compact ? "text-[12px]" : "text-[13px]")}>{value}</p>
    </div>
  );
}

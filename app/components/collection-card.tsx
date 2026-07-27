import * as React from "react";
import { cn } from "../lib/utils";

export function CollectionCard({
  children,
  revealIndex,
  loading = false,
  className,
  style,
  ...props
}: React.HTMLAttributes<HTMLElement> & {
  revealIndex?: number;
  loading?: boolean;
}) {
  return (
    <article
      className={cn(
        "group relative overflow-hidden rounded-[1.5rem] border bg-card shadow-card sm:rounded-2xl",
        loading
          ? "animate-pulse border-border/65"
          : "border-border/75 transition-[transform,box-shadow,border-color] duration-300 hover:-translate-y-0.5 hover:border-foreground/20 hover:shadow-[0_14px_34px_-20px_rgba(39,34,28,0.32)] focus-within:ring-2 focus-within:ring-ring/80 focus-within:ring-offset-2 focus-within:ring-offset-background",
        revealIndex !== undefined && "opacity-0 animate-fade-in [animation-fill-mode:forwards]",
        className,
      )}
      style={{
        ...style,
        ...(revealIndex !== undefined ? { animationDelay: `${Math.min(revealIndex, 6) * 45}ms` } : {}),
      }}
      {...props}
    >
      {children}
    </article>
  );
}

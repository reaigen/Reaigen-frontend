import * as React from "react";
import { cn } from "../lib/utils";

export function CollectionCard({
  children,
  className,
  style,
  ...props
}: React.HTMLAttributes<HTMLElement>) {
  return (
    <article
      className={cn(
        "group relative overflow-hidden rounded-[1.5rem] border border-border/75 bg-card shadow-card transition-[transform,box-shadow,border-color] duration-300 hover:-translate-y-0.5 hover:border-foreground/20 hover:shadow-[0_14px_34px_-20px_rgba(39,34,28,0.32)] focus-within:ring-2 focus-within:ring-ring/80 focus-within:ring-offset-2 focus-within:ring-offset-background sm:rounded-2xl",
        className,
      )}
      style={style}
      {...props}
    >
      {children}
    </article>
  );
}

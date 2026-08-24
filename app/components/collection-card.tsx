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
        "group relative overflow-hidden rounded-[1.5rem] border border-border/75 bg-card shadow-card focus-within:ring-2 focus-within:ring-ring/80 focus-within:ring-offset-2 focus-within:ring-offset-background sm:rounded-2xl",
        /*
         * Hover is pointer-only. On a touchscreen the lift latches after a tap
         * and stays raised until you touch something else, so a scrolled list
         * left a trail of stuck cards.
         */
        "[@media(hover:hover)]:transition-[transform,box-shadow,border-color] [@media(hover:hover)]:duration-300",
        "[@media(hover:hover)]:hover:-translate-y-0.5 [@media(hover:hover)]:hover:border-foreground/20 [@media(hover:hover)]:hover:shadow-[0_14px_34px_-20px_rgba(39,34,28,0.32)]",
        // Touch gets the feedback it can actually use: an immediate press.
        "transition-transform duration-100 active:scale-[0.985] motion-reduce:active:scale-100",
        className,
      )}
      style={style}
      {...props}
    >
      {children}
    </article>
  );
}

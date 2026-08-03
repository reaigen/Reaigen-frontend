import * as React from "react";

import { cn } from "../lib/utils";

export function LoadingDots({
  label,
  size = "md",
  className,
  decorative = false,
}: {
  label?: string;
  size?: "xs" | "sm" | "md";
  className?: string;
  decorative?: boolean;
}) {
  return (
    <span
      className={cn("loading-dots", `loading-dots-${size}`, className)}
      role={decorative ? undefined : "status"}
      aria-label={decorative ? undefined : (label || "Loading")}
      aria-live={decorative ? undefined : "polite"}
      aria-hidden={decorative ? true : undefined}
    >
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          className="loading-dot"
          style={{ "--loading-dot-index": index } as React.CSSProperties}
        />
      ))}
    </span>
  );
}

"use client";

import * as React from "react";
import * as SwitchPrimitives from "@radix-ui/react-switch";
import { cn } from "../utils";

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root> & {
    size?: "sm" | "default" | "lg";
  }
>(({ className, size = "default", ...props }, ref) => {
  const sizes = {
    sm: {
      root: "h-9 w-9",
      track: "left-1 h-4 w-7",
      thumb: "left-1.5 h-3 w-3 data-[state=checked]:translate-x-3",
    },
    default: {
      root: "h-11 w-11",
      track: "left-0 h-6 w-11",
      thumb: "left-0.5 h-5 w-5 data-[state=checked]:translate-x-5",
    },
    lg: {
      root: "h-11 w-14",
      track: "left-0 h-7 w-14",
      thumb: "left-0.5 h-6 w-6 data-[state=checked]:translate-x-7",
    },
  };

  return (
    <SwitchPrimitives.Root
      className={cn(
        "group/switch peer relative inline-flex shrink-0 cursor-pointer items-center rounded-full bg-transparent",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "disabled:cursor-not-allowed disabled:opacity-50",
        sizes[size].root,
        className
      )}
      {...props}
      ref={ref}
    >
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute top-1/2 -translate-y-1/2 rounded-full bg-muted transition-colors duration-200 group-data-[state=checked]/switch:bg-primary",
          sizes[size].track,
        )}
      />
      <SwitchPrimitives.Thumb
        className={cn(
          "pointer-events-none absolute top-1/2 block -translate-y-1/2 rounded-full bg-background shadow-lg ring-0 transition-transform",
          sizes[size].thumb
        )}
      />
    </SwitchPrimitives.Root>
  );
});
Switch.displayName = SwitchPrimitives.Root.displayName;

export { Switch };

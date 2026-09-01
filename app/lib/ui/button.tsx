"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../utils";

const buttonVariants = cva(
  // `min-w-0 overflow-hidden` is a containment guard, not styling: the label is
  // `whitespace-nowrap`, so in any narrow flex/grid cell it used to escape the
  // pill and overlap whatever sat beside it — which happened repeatedly in the
  // longer locales (sk/cs/de) before it was ever noticed in English.
  // The focus ring is a box-shadow and is painted outside the border box, so it
  // is not clipped by this.
  "inline-flex min-w-0 items-center justify-center gap-2 overflow-hidden whitespace-nowrap rounded-xl border border-transparent text-sm font-medium transition-[background-color,border-color,color,opacity] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "border-primary bg-primary text-primary-foreground shadow-none hover:bg-primary/90 active:bg-primary/90",
        secondary:
          "border-border/80 bg-surface-subtle text-secondary-foreground shadow-none hover:border-foreground/25 hover:bg-muted",
        outline:
          "border-border/85 bg-card text-foreground shadow-none hover:border-foreground/28 hover:bg-surface-subtle/70",
        ghost:
          "bg-transparent shadow-none hover:bg-foreground/[0.055] hover:text-foreground",
        destructive:
          "border-destructive bg-destructive text-destructive-foreground shadow-none hover:bg-destructive/90",
        success:
          "border-success bg-success text-success-foreground shadow-none hover:bg-success/90",
        link:
          "h-auto border-0 p-0 text-primary underline-offset-4 hover:underline",
      },
      size: {
        xs: "h-[var(--floating-status)] px-2.5 text-xs",
        sm: "h-[var(--floating-control-sm)] px-3",
        default: "h-[var(--floating-control)] px-5",
        lg: "h-12 px-8 text-base",
        xl: "h-[var(--floating-header)] px-10 text-base",
        icon: "h-[var(--floating-control)] w-[var(--floating-control)]",
        "icon-sm": "h-[var(--floating-control-sm)] w-[var(--floating-control-sm)]",
        "icon-lg": "h-[var(--floating-header)] w-[var(--floating-header)]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading, children, disabled, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={disabled || loading}
        {...props}
      >
        {loading ? (
          <>
            <svg className="animate-spin -ml-1 h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            {children}
          </>
        ) : (
          children
        )}
      </Comp>
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };

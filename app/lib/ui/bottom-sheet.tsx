"use client";

import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { cn } from "../utils";

/**
 * A focused surface for one task: a bottom sheet on phones, a centered
 * dialog from `sm` up.
 *
 * Phones get the native-app gesture language — a scrim, a card sliding up
 * from the bottom edge, a grab handle, safe-area padding — instead of a
 * desktop popover shrunk to fit. The same component centers itself as an
 * ordinary modal on wider screens so callers don't fork their flows per
 * breakpoint.
 *
 * Radix supplies the behavior that the popovers this replaces had to hand
 * roll: focus trap and return, Escape and scrim dismissal, aria wiring.
 */
export function BottomSheet({
  open,
  onOpenChange,
  title,
  description,
  hideTitle,
  children,
  contentClassName,
  ...contentProps
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Announced as the dialog title; rendered unless hideTitle. */
  title: string;
  /** Optional supporting line under the title. */
  description?: string;
  /** Keep the title for screen readers only (the content carries its own header). */
  hideTitle?: boolean;
  children: React.ReactNode;
  contentClassName?: string;
} & Omit<React.ComponentPropsWithoutRef<typeof Dialog.Content>, "title" | "className" | "children">) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        {/* Above the mobile header (z-50) and content messages (z-70), below the confirm dialog (z-10000). */}
        <Dialog.Overlay className="fixed inset-0 z-[95] bg-black/35 backdrop-blur-[2px] data-[state=closed]:animate-[fadeOut_140ms_ease-in] data-[state=open]:animate-[fadeIn_200ms_var(--motion-ease-smooth)] motion-reduce:animate-none" />
        <Dialog.Content
          {...contentProps}
          className={cn(
            "fixed inset-x-0 bottom-0 z-[95] max-h-[calc(100dvh-3rem)] overflow-y-auto overscroll-contain",
            "rounded-t-[28px] border-t border-border/60 bg-card px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-2.5 shadow-soft outline-none",
            "data-[state=closed]:animate-[sheetDown_180ms_ease-in] data-[state=open]:animate-[sheetUp_260ms_var(--motion-ease-smooth)]",
            "sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:max-w-[26rem] sm:-translate-x-1/2 sm:-translate-y-1/2",
            "sm:rounded-[var(--floating-panel-radius,1.5rem)] sm:border sm:p-6 sm:data-[state=closed]:animate-[fadeOut_140ms_ease-in] sm:data-[state=open]:animate-[fadeIn_200ms_var(--motion-ease-smooth)]",
            "motion-reduce:animate-none",
            contentClassName,
          )}
        >
          {/* Grab handle — the sheet affordance; meaningless on the centered dialog. */}
          <div aria-hidden="true" className="mx-auto mb-3 h-1 w-9 rounded-full bg-foreground/15 sm:hidden" />
          {hideTitle ? (
            <Dialog.Title className="sr-only">{title}</Dialog.Title>
          ) : (
            <Dialog.Title className="text-[17px] font-semibold leading-tight tracking-[-0.02em] text-foreground">
              {title}
            </Dialog.Title>
          )}
          {description ? (
            <Dialog.Description className={cn("text-[13px] leading-relaxed text-muted-foreground", hideTitle ? "sr-only" : "mt-1.5")}>
              {description}
            </Dialog.Description>
          ) : (
            // Radix warns when Content has no Description; stay silent rather
            // than inventing prose.
            <Dialog.Description className="sr-only">{title}</Dialog.Description>
          )}
          <div className={hideTitle ? undefined : "mt-4"}>{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

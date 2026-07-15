"use client";

import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { CloseIcon } from "./icons";
import { cn } from "../lib/utils";

export function SidePanel({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[80] bg-black/25 backdrop-blur-[2px] data-[state=closed]:animate-[fadeOut_160ms_ease-in] data-[state=open]:animate-fade-in" />
        <Dialog.Content
          className={cn(
            "fixed inset-y-0 right-0 z-[90] flex w-full flex-col border-l border-border/55 bg-background shadow-[-24px_0_80px_-32px_rgba(0,0,0,0.28)] outline-none",
            "data-[state=closed]:animate-[panelOut_180ms_ease-in] data-[state=open]:animate-[panelIn_220ms_var(--motion-ease-smooth)]",
            "sm:max-w-[520px]",
            className,
          )}
        >
          <header className="flex min-h-16 shrink-0 items-start justify-between gap-4 border-b border-border/45 px-5 py-4 sm:px-6">
            <div className="min-w-0">
              <Dialog.Title className="text-[16px] font-semibold tracking-[-0.01em]">{title}</Dialog.Title>
              {description ? <Dialog.Description className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">{description}</Dialog.Description> : null}
            </div>
            <Dialog.Close asChild>
              <button type="button" aria-label="Close" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-foreground/40 transition hover:bg-foreground/[0.055] hover:text-foreground">
                <CloseIcon size={17} />
              </button>
            </Dialog.Close>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 scrollbar-thin sm:px-6">{children}</div>
          {footer ? <footer className="shrink-0 border-t border-border/45 bg-background/95 px-5 py-3 backdrop-blur-xl sm:px-6">{footer}</footer> : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

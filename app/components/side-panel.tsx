"use client";

import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ArrowLeftIcon, CloseIcon } from "./icons";
import { t } from "../lib/i18n";
import { cn } from "../lib/utils";

export function SidePanel({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  headerAction,
  headerMode = "default",
  className,
  style,
  contentClassName,
  contentRef,
  initialFocusRef,
  closeIcon = "close",
  onBack,
  lang = "en",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  headerAction?: React.ReactNode;
  headerMode?: "default" | "editor";
  className?: string;
  style?: React.CSSProperties;
  contentClassName?: string;
  contentRef?: React.RefObject<HTMLDivElement | null>;
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  closeIcon?: "close" | "back";
  onBack?: () => void;
  lang?: string;
}) {
  const [phoneViewport, setPhoneViewport] = React.useState<{ height: number; offsetTop: number } | null>(null);

  React.useEffect(() => {
    if (!open) {
      setPhoneViewport(null);
      return;
    }
    const compact = window.matchMedia("(max-width: 639px)");
    const viewport = window.visualViewport;
    const syncViewport = () => {
      if (!compact.matches || !viewport) {
        setPhoneViewport(null);
        return;
      }
      const next = {
        height: Math.round(viewport.height),
        offsetTop: Math.round(viewport.offsetTop),
      };
      setPhoneViewport((current) => (
        current?.height === next.height && current.offsetTop === next.offsetTop ? current : next
      ));
    };
    syncViewport();
    viewport?.addEventListener("resize", syncViewport);
    viewport?.addEventListener("scroll", syncViewport);
    compact.addEventListener("change", syncViewport);
    return () => {
      viewport?.removeEventListener("resize", syncViewport);
      viewport?.removeEventListener("scroll", syncViewport);
      compact.removeEventListener("change", syncViewport);
    };
  }, [open]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[80] bg-black/25 backdrop-blur-[2px] data-[state=closed]:animate-[fadeOut_160ms_ease-in] data-[state=open]:animate-fade-in" />
        <Dialog.Content
          style={{
            ...(phoneViewport ? {
              bottom: "auto",
              height: `${phoneViewport.height}px`,
              top: `${phoneViewport.offsetTop}px`,
            } : {}),
            ...style,
          }}
          onOpenAutoFocus={(event) => {
            if (!initialFocusRef?.current) return;
            event.preventDefault();
            initialFocusRef.current.focus({ preventScroll: true });
          }}
          className={cn(
            "fixed inset-y-0 right-0 z-[90] flex w-full flex-col border-l border-border/60 shadow-[-24px_0_80px_-32px_rgba(0,0,0,0.28)] outline-none",
            "data-[state=closed]:animate-[panelOut_180ms_ease-in] data-[state=open]:animate-[panelIn_220ms_var(--motion-ease-smooth)]",
            "sm:max-w-[520px]",
            headerMode === "editor"
              ? "bg-background/90 backdrop-blur-2xl sm:inset-y-3 sm:right-3 sm:overflow-hidden sm:rounded-[2rem] sm:border"
              : "bg-background",
            className,
          )}
        >
          {headerMode === "editor" ? (
            <header className={cn(
              "grid min-h-[4.25rem] shrink-0 items-center gap-2 border-b border-border/50 bg-card/85 px-3 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] backdrop-blur-xl sm:grid-cols-[5.5rem_minmax(0,1fr)_5.5rem] sm:px-4 sm:pt-2",
              headerAction
                ? "grid-cols-[3rem_minmax(0,1fr)_auto]"
                : "grid-cols-[3rem_minmax(0,1fr)_3rem]",
            )}>
              <div className="flex justify-start">
                {closeIcon === "back" && onBack ? (
                  <button type="button" onClick={onBack} aria-label={t("common.back", lang)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-foreground/50 transition-colors hover:bg-foreground/[0.055] hover:text-foreground focus-visible:bg-foreground/[0.045] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 sm:h-9 sm:w-9">
                    <ArrowLeftIcon size={18} />
                  </button>
                ) : (
                  <Dialog.Close asChild>
                    <button type="button" aria-label={t(closeIcon === "back" ? "common.back" : "common.close", lang)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-foreground/50 transition-colors hover:bg-foreground/[0.055] hover:text-foreground focus-visible:bg-foreground/[0.045] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 sm:h-9 sm:w-9">
                      {closeIcon === "back" ? <ArrowLeftIcon size={18} /> : <CloseIcon size={17} />}
                    </button>
                  </Dialog.Close>
                )}
              </div>
              <div className="min-w-0 text-center">
                <Dialog.Title className="truncate text-[15px] font-semibold tracking-[-0.01em]">{title}</Dialog.Title>
                {description ? <Dialog.Description className="mt-0.5 truncate text-[11px] text-muted-foreground">{description}</Dialog.Description> : null}
              </div>
              <div className="flex justify-end [&_button]:min-h-11 sm:[&_button]:min-h-9">{headerAction}</div>
            </header>
          ) : (
            <header className="flex min-h-16 shrink-0 items-start justify-between gap-4 border-b border-border/40 px-5 pb-4 pt-[max(1rem,env(safe-area-inset-top))] sm:px-6">
              <div className="min-w-0">
                <Dialog.Title className="text-[15px] font-semibold tracking-[-0.01em]">{title}</Dialog.Title>
                {description ? <Dialog.Description className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">{description}</Dialog.Description> : null}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {headerAction}
                <Dialog.Close asChild>
                  <button type="button" aria-label={t("common.close", lang)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-foreground/40 transition-colors hover:bg-foreground/[0.055] hover:text-foreground focus-visible:bg-foreground/[0.045] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 sm:h-8 sm:w-8">
                    <CloseIcon size={17} />
                  </button>
                </Dialog.Close>
              </div>
            </header>
          )}
          <div
            ref={contentRef}
            data-side-panel-scroll
            className={cn("min-h-0 flex-1 overscroll-contain overflow-y-auto px-5 py-5 scrollbar-thin sm:px-6", contentClassName)}
          >
            {children}
          </div>
          {footer ? <footer className="shrink-0 border-t border-border/40 bg-background/95 px-5 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur-xl [&_button]:min-h-11 sm:px-6 sm:[&_button]:min-h-9">{footer}</footer> : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

"use client";

import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Button } from "./button";
import { cn } from "../utils";

export interface ConfirmRequest {
  title: string;
  description?: string;
  /** Label on the button that proceeds. Defaults to the caller's own wording. */
  confirmLabel: string;
  cancelLabel: string;
  /** Renders the confirming action as destructive. */
  destructive?: boolean;
}

/**
 * Ask the user to confirm, in the app's own chrome.
 *
 * These were `window.confirm`, which is the one dialog the product cannot
 * style. The browser draws it in its own colours, sizes it its own way, stamps
 * it with the origin — "app-reaigen.publicrouter.sk says" — and, in an app
 * shipped in four languages, pairs the translated question with OS-supplied
 * buttons that do not follow the user's chosen locale. It also blocks the main
 * thread outright, which in the tour editor means the render loop stops dead
 * behind it.
 *
 * The promise is the point: a caller can keep reading as a straight line,
 * `if (!(await confirm(...))) return;`, exactly as it read with the native
 * call. Anything requiring a provider or a callback would have meant
 * restructuring every guard that uses it.
 *
 * Usage — the caller renders `dialog` once, anywhere in its tree:
 *
 *   const { confirm, dialog } = useConfirm();
 *   ...
 *   if (!(await confirm({ title, confirmLabel, cancelLabel }))) return;
 *   ...
 *   return <>{dialog}...</>;
 */
export function useConfirm(): {
  confirm: (request: ConfirmRequest) => Promise<boolean>;
  dialog: React.ReactNode;
} {
  const [request, setRequest] = React.useState<ConfirmRequest | null>(null);
  // Held in a ref rather than state: settling the promise must not depend on a
  // re-render having happened, or a fast confirm-then-close can drop it.
  const resolveRef = React.useRef<((value: boolean) => void) | null>(null);
  const cancelRef = React.useRef<HTMLButtonElement | null>(null);

  const settle = React.useCallback((value: boolean) => {
    const resolve = resolveRef.current;
    resolveRef.current = null;
    setRequest(null);
    resolve?.(value);
  }, []);

  const confirm = React.useCallback((next: ConfirmRequest) => {
    // A second ask while one is open would otherwise strand the first caller
    // awaiting a promise nothing can settle.
    resolveRef.current?.(false);
    setRequest(next);
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
    });
  }, []);

  // Unmounting mid-question — a route change while the dialog is open — has to
  // settle too, for the same reason.
  React.useEffect(() => () => resolveRef.current?.(false), []);

  const dialog = (
    <Dialog.Root
      open={request !== null}
      onOpenChange={(open) => { if (!open) settle(false); }}
    >
      <Dialog.Portal>
        {/*
          Above the side panels (z-90) and the image lightbox (z-9999): a
          question about losing work has to sit over whatever raised it.
        */}
        <Dialog.Overlay className="fixed inset-0 z-[10000] bg-black/30 backdrop-blur-[2px] data-[state=closed]:animate-[fadeOut_140ms_ease-in] data-[state=open]:animate-[fadeIn_180ms_var(--motion-ease-smooth)]" />
        <Dialog.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-[10000] w-[calc(100vw-2rem)] max-w-[24rem]",
            "-translate-x-1/2 -translate-y-1/2 rounded-[var(--floating-panel-radius,1rem)]",
            "border border-border/60 bg-background p-5 shadow-soft outline-none",
            "data-[state=open]:animate-[fadeIn_180ms_var(--motion-ease-smooth)]",
          )}
          onOpenAutoFocus={(event) => {
            // Focus lands on Cancel, not on the confirming button. These are
            // asked when something is about to be lost, and a stray Enter or
            // Space in flight from the action that opened it must not be what
            // discards the work.
            event.preventDefault();
            cancelRef.current?.focus();
          }}
        >
          <Dialog.Title className="text-[15px] font-semibold text-foreground">
            {request?.title}
          </Dialog.Title>
          {request?.description ? (
            <Dialog.Description className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
              {request.description}
            </Dialog.Description>
          ) : (
            // Radix warns when Content has no Description; say nothing visibly
            // rather than inventing prose for a question that needs none.
            <Dialog.Description className="sr-only">{request?.title}</Dialog.Description>
          )}

          <div className="mt-5 flex justify-end gap-2">
            <Button
              ref={cancelRef}
              type="button"
              variant="outline"
              size="sm"
              onClick={() => settle(false)}
            >
              {request?.cancelLabel}
            </Button>
            <Button
              type="button"
              variant={request?.destructive ? "destructive" : "default"}
              size="sm"
              onClick={() => settle(true)}
            >
              {request?.confirmLabel}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );

  return { confirm, dialog };
}

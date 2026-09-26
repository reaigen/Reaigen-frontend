"use client";

import * as React from "react";

/** The part of an element the focus return reads; a plain object in tests. */
export interface FocusReturnCandidate {
  isConnected: boolean;
  hasAttribute(name: string): boolean;
  getAttribute(name: string): string | null;
  closest(selector: string): unknown;
  focus(options?: FocusOptions): void;
}

/**
 * Whether focus can go back to the control that opened a dialog.
 *
 * It may have left the page (the listing it belonged to closed), been
 * disabled while the dialog was open, or sit inside something hidden from
 * assistive technology; focusing it then would put the keyboard nowhere.
 */
export function canReturnFocusTo(element: FocusReturnCandidate | null | undefined): element is FocusReturnCandidate {
  return Boolean(
    element
    && element.isConnected
    && !element.hasAttribute("disabled")
    && element.getAttribute("aria-hidden") !== "true"
    && !element.closest("[inert]"),
  );
}

/**
 * Focus goes back to the control that opened a dialog when the dialog closes.
 *
 * Radix returns focus to its `Dialog.Trigger`. The app opens its dialogs from
 * state and never renders a trigger, so a closed modal focused a trigger that
 * did not exist and the keyboard landed on <body> (Bench 07 UI03, B07-F05).
 * `remember` runs as the dialog opens — before Radix moves focus inside — and
 * `restore` as it closes, so Escape, the close button and a save all return
 * to the Edit button, and a nested dialog to the control in its parent.
 *
 *   const focusReturn = useDialogFocusReturn();
 *   <Dialog.Content
 *     onOpenAutoFocus={() => focusReturn.remember()}
 *     onCloseAutoFocus={focusReturn.restore}
 *   />
 */
export function useDialogFocusReturn() {
  const returnTo = React.useRef<HTMLElement | null>(null);
  const remember = React.useCallback(() => {
    const active = typeof document === "undefined" ? null : document.activeElement;
    returnTo.current = active instanceof HTMLElement && active !== document.body ? active : null;
  }, []);
  const restore = React.useCallback((event: Event) => {
    event.preventDefault();
    const target = returnTo.current;
    returnTo.current = null;
    if (canReturnFocusTo(target)) target.focus({ preventScroll: true });
  }, []);
  return { remember, restore };
}

"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useConfirm } from "./ui/confirm-dialog";
import { leavingDestination } from "./unsaved-changes";

export interface LeaveQuestion {
  title: string;
  description: string;
  leave: string;
  stay: string;
}

/**
 * While `active`, a link out of the page asks `question` first (the app's own
 * dialog, focus on Stay) and a reload or tab close gets the browser's prompt.
 * Render the returned node once in the guarded page.
 */
export function useUnsavedChangesGuard(active: boolean, question: LeaveQuestion): React.ReactNode {
  const router = useRouter();
  const { confirm, dialog } = useConfirm();
  const questionRef = React.useRef(question);
  React.useEffect(() => {
    questionRef.current = question;
  }, [question]);

  React.useEffect(() => {
    if (!active) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    const interceptLink = (event: MouseEvent) => {
      const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(anchor instanceof HTMLAnchorElement)) return;
      const destination = leavingDestination(
        { href: anchor.href, target: anchor.target, download: anchor.hasAttribute("download") },
        window.location.href,
        event,
      );
      if (!destination) return;
      // Captured at the document, before Next's <Link> sees the click.
      event.preventDefault();
      event.stopPropagation();
      const { title, description, leave, stay } = questionRef.current;
      void confirm({ title, description, confirmLabel: leave, cancelLabel: stay, destructive: true }).then((leaving) => {
        if (leaving) router.push(destination);
      });
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    document.addEventListener("click", interceptLink, true);
    return () => {
      window.removeEventListener("beforeunload", warnBeforeUnload);
      document.removeEventListener("click", interceptLink, true);
    };
  }, [active, confirm, router]);

  return dialog;
}

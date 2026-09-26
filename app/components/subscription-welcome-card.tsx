"use client";

import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";

import {
  acknowledgeSubscriptionWelcome,
  getSubscriptionWelcome,
  type SubscriptionWelcomeNotice,
} from "../lib/api/client";
import { SUBSCRIPTION_WELCOME_REFRESH_EVENT } from "../lib/subscription-welcome-events";
import { Button } from "../lib/ui/button";
import { cn } from "../lib/utils";

export function SubscriptionWelcomeDialog({
  notice,
  acknowledging,
  error,
  onAcknowledge,
}: {
  notice: SubscriptionWelcomeNotice | null;
  acknowledging: boolean;
  error: string;
  onAcknowledge: (start?: boolean) => void;
}) {
  const actionRef = React.useRef<HTMLButtonElement>(null);

  return (
    <Dialog.Root
      open={notice !== null}
      onOpenChange={(open) => {
        if (!open && notice && !acknowledging) onAcknowledge();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[10000] bg-black/35 backdrop-blur-[2px] data-[state=closed]:animate-[fadeOut_140ms_ease-in] data-[state=open]:animate-[fadeIn_180ms_var(--motion-ease-smooth)]" />
        <Dialog.Content
          data-testid="subscription-welcome-card"
          className={cn(
            "fixed left-1/2 top-1/2 z-[10000] max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-[36rem]",
            "-translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[1.75rem] border border-border/65 bg-card shadow-soft outline-none",
            "data-[state=closed]:animate-[fadeOut_140ms_ease-in] data-[state=open]:animate-[fadeIn_180ms_var(--motion-ease-smooth)]",
          )}
          onEscapeKeyDown={(event) => {
            event.preventDefault();
            if (!acknowledging) onAcknowledge();
          }}
          onPointerDownOutside={(event) => event.preventDefault()}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            actionRef.current?.focus();
          }}
        >
          {notice ? (
            <>
              <header className="border-b border-border/60 px-6 pb-5 pt-6 sm:px-8 sm:pb-6 sm:pt-8">
                <Dialog.Title className="text-[27px] font-semibold leading-tight tracking-[-0.035em] text-foreground sm:text-[31px]">
                  {notice.title}
                </Dialog.Title>
                <Dialog.Description className="mt-2.5 max-w-[31rem] text-[14px] leading-relaxed text-muted-foreground">
                  {notice.description}
                </Dialog.Description>
              </header>

              <div className="px-6 py-5 sm:px-8 sm:py-6">
                {notice.items.length > 0 ? (
                  <section aria-labelledby="subscription-welcome-capabilities">
                    <h2
                      id="subscription-welcome-capabilities"
                      className="text-[12px] font-semibold uppercase tracking-[0.08em] text-foreground/55"
                    >
                      {notice.section_title}
                    </h2>
                    <ul className="mt-3 divide-y divide-border/55 border-y border-border/55">
                      {notice.items.map((item) => (
                        <li
                          key={`${item.kind}:${item.code}`}
                          className="flex items-start gap-3 py-3.5"
                        >
                          <span
                            aria-hidden="true"
                            className="mt-[0.45rem] size-1.5 shrink-0 rounded-full bg-foreground/35"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-baseline justify-between gap-4">
                              <span className="text-[14px] font-semibold leading-snug text-foreground">
                                {item.name}
                              </span>
                              {item.display_value ? (
                                <span className="shrink-0 text-[12px] font-semibold text-foreground/65">
                                  {item.display_value}
                                </span>
                              ) : null}
                            </span>
                            {item.description ? (
                              <span className="mt-0.5 block text-[12px] leading-relaxed text-muted-foreground">
                                {item.description}
                              </span>
                            ) : null}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}

                {error ? (
                  <p
                    role="alert"
                    className="mt-4 rounded-xl border border-destructive/25 bg-destructive/[0.06] px-3 py-2.5 text-[12px] leading-relaxed text-destructive"
                  >
                    {error}
                  </p>
                ) : null}

                <div className="mt-6 flex justify-end">
                  <Button
                    ref={actionRef}
                    type="button"
                    loading={acknowledging}
                    onClick={() => onAcknowledge(true)}
                  >
                    {notice.action_label}
                  </Button>
                </div>
              </div>
            </>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * `onStart` runs after the action button is acknowledged, never after Escape
 * or a close: the server's label promises a way into creation, so it has to
 * lead there (Bench 06 EF07 — it only closed the dialog and left the creator
 * on the Settings page it opened over).
 */
export function SubscriptionWelcomeCard({
  userId,
  language,
  onStart,
}: {
  userId: number;
  language: string;
  onStart?: () => void;
}) {
  const [notice, setNotice] = React.useState<SubscriptionWelcomeNotice | null>(null);
  const [acknowledging, setAcknowledging] = React.useState(false);
  const [error, setError] = React.useState("");
  const requestVersion = React.useRef(0);
  const acknowledgingRef = React.useRef(false);

  const refresh = React.useCallback(async () => {
    if (acknowledgingRef.current) return;
    const version = ++requestVersion.current;
    try {
      const payload = await getSubscriptionWelcome(language);
      if (requestVersion.current !== version) return;
      // A body without a notice (an empty list from a stub, a proxy page) is
      // "no notice": `undefined` passed the dialog's `!== null` check and
      // opened an empty modal over the workspace.
      setNotice(payload?.notice ?? null);
      setError("");
    } catch {
      // This is non-blocking account presentation. A transient request failure
      // must not disturb the workspace or discard a notice already on screen.
    }
  }, [language]);

  React.useEffect(() => {
    setNotice(null);
    setError("");
    void refresh();
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const refreshOnEvent = () => void refresh();
    const poll = window.setInterval(refreshWhenVisible, 60_000);
    window.addEventListener("focus", refreshOnEvent);
    window.addEventListener(
      SUBSCRIPTION_WELCOME_REFRESH_EVENT,
      refreshOnEvent,
    );
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      requestVersion.current += 1;
      window.clearInterval(poll);
      window.removeEventListener("focus", refreshOnEvent);
      window.removeEventListener(
        SUBSCRIPTION_WELCOME_REFRESH_EVENT,
        refreshOnEvent,
      );
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [refresh, userId]);

  const acknowledge = React.useCallback(async (start = false) => {
    if (!notice || acknowledgingRef.current) return;
    acknowledgingRef.current = true;
    requestVersion.current += 1;
    setAcknowledging(true);
    setError("");
    try {
      await acknowledgeSubscriptionWelcome(notice.id);
      setNotice((current) => current?.id === notice.id ? null : current);
      if (start) onStart?.();
    } catch {
      setError(notice.error_message);
    } finally {
      acknowledgingRef.current = false;
      setAcknowledging(false);
    }
  }, [notice, onStart]);

  return (
    <SubscriptionWelcomeDialog
      notice={notice}
      acknowledging={acknowledging}
      error={error}
      onAcknowledge={(start) => void acknowledge(start)}
    />
  );
}

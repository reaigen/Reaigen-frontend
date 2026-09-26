"use client";

import { useEffect, useId, useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";
import { AGENT_ATTACHMENT_ACCEPT } from "../lib/agent-attachments";
import { AGENT_MESSAGE_LIMIT, canSendAgentMessage, resizeAgentComposer, shouldSendAgentMessage } from "../lib/agent-composer";
import { t } from "../lib/i18n";
import { ArrowUpIcon, PlusIcon } from "./icons";

/** Presentation only: every file and message still goes through the card's guarded handlers. */
export function AgentComposer({
  value, onChange, onSend, onFiles, textareaRef, onFocusChange, placeholder,
  canAttach, busy, busyLabel, hasContext, children, lang,
}: {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onFiles: (files: File[]) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  onFocusChange: (focused: boolean) => void;
  placeholder: string;
  canAttach: boolean;
  busy: boolean;
  busyLabel: string;
  hasContext: boolean;
  children?: ReactNode;
  lang: string;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const helpId = useId();
  const canSend = canSendAgentMessage(value, busy);

  useLayoutEffect(() => {
    if (textareaRef.current) resizeAgentComposer(textareaRef.current);
  }, [textareaRef, value]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea || typeof ResizeObserver === "undefined") return;
    let lastWidth = -1;
    const observer = new ResizeObserver(([entry]) => {
      if (entry && entry.contentRect.width !== lastWidth) {
        lastWidth = entry.contentRect.width;
        resizeAgentComposer(textarea);
      }
    });
    observer.observe(textarea);
    return () => observer.disconnect();
  }, [textareaRef]);

  return (
    <div
      role="group"
      aria-label={t("reai.composer.label", lang)}
      data-testid="agent-composer"
      // One calm field (2026-09-26, operator: "this pool where we type — better
      // UI"): a soft lift instead of a hard outline, a quieter focus ring, and
      // round controls that sit inside it.
      className="w-full min-w-0 shrink-0 rounded-[26px] border border-border/60 bg-card shadow-[0_1px_2px_rgba(17,17,17,0.04),0_10px_32px_-12px_rgba(17,17,17,0.14)] transition-[border-color,box-shadow] focus-within:border-foreground/25 focus-within:shadow-[0_1px_2px_rgba(17,17,17,0.05),0_14px_40px_-14px_rgba(17,17,17,0.22)]"
    >
      {hasContext && (
        <div data-testid="agent-composer-context" className="max-h-40 space-y-2 overflow-y-auto overscroll-contain border-b border-border/50 p-2.5">
          {children}
        </div>
      )}
      <textarea
        ref={textareaRef}
        data-agent-composer
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onFocus={() => onFocusChange(true)}
        onBlur={() => onFocusChange(false)}
        aria-label={t("reai.composer.message", lang)}
        aria-describedby={helpId}
        maxLength={AGENT_MESSAGE_LIMIT}
        rows={1}
        placeholder={placeholder}
        onKeyDown={(event) => {
          if (shouldSendAgentMessage({
            key: event.key, shiftKey: event.shiftKey, altKey: event.altKey,
            isComposing: event.nativeEvent.isComposing,
            keyCode: event.nativeEvent.keyCode, repeat: event.repeat,
          }, value, busy)) {
            event.preventDefault();
            onSend();
          }
        }}
        className="block max-h-40 min-h-12 w-full resize-none rounded-t-[26px] bg-transparent px-5 pb-1 pt-4 text-[16px] leading-6 text-foreground outline-none placeholder:text-foreground/40 sm:text-[14.5px]"
      />
      <p id={helpId} className="sr-only">{t("reai.composer.keyboardHint", lang)}</p>
      <div data-testid="agent-composer-toolbar" className="flex min-w-0 items-center gap-1.5 px-2.5 pb-2.5">
        {canAttach && <>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={AGENT_ATTACHMENT_ACCEPT}
            disabled={busy}
            className="hidden"
            onChange={(event) => {
              const files = Array.from(event.currentTarget.files ?? []);
              event.currentTarget.value = "";
              if (!busy && files.length) onFiles(files);
            }}
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => fileInputRef.current?.click()}
            aria-label={t("reai.attachments.add", lang)}
            title={t("reai.attachments.add", lang)}
            className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full text-foreground/60 transition-colors hover:bg-foreground/[0.06] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
          >
            <PlusIcon size={20} aria-hidden="true" />
            <span className="sr-only">{t("reai.composer.addFiles", lang)}</span>
          </button>
        </>}
        <span className="min-w-0 flex-1" />
        {value.length >= AGENT_MESSAGE_LIMIT - 200 && (
          <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground" aria-label={t("reai.composer.remaining", lang).replace("{count}", String(Math.max(0, AGENT_MESSAGE_LIMIT - value.length)))}>
            {value.length}/{AGENT_MESSAGE_LIMIT}
          </span>
        )}
        <button
          type="button"
          disabled={!canSend}
          onClick={() => { if (canSend) onSend(); }}
          aria-label={busy ? busyLabel : t("reai.ask", lang)}
          title={busy ? busyLabel : t("reai.ask", lang)}
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-foreground text-background shadow-[0_2px_8px_-2px_rgba(17,17,17,0.35)] transition-[background-color,transform] hover:bg-foreground/90 active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-foreground/[0.07] disabled:text-foreground/30 disabled:shadow-none"
        >
          {busy ? (
            <svg className="h-4 w-4 animate-spin motion-reduce:animate-none" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle className="opacity-25" cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
              <path d="M12 3a9 9 0 0 1 9 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          ) : <ArrowUpIcon size={20} aria-hidden="true" />}
        </button>
      </div>
    </div>
  );
}

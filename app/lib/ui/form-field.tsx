"use client";

import * as React from "react";
import { cn } from "../utils";
import { Label } from "./label";

export interface FormControlState {
  id: string;
  error: boolean;
  "aria-invalid"?: true;
  "aria-describedby"?: string;
}

/** A field's message line: a small mark and the text, in the error tone. */
export function FieldMessage({ id, children, className }: { id?: string; children: React.ReactNode; className?: string }) {
  return (
    <p id={id} role="alert" className={cn("flex animate-fade-in items-start gap-1.5 text-[12px] leading-[1.25rem] text-destructive", className)}>
      <svg aria-hidden="true" viewBox="0 0 16 16" className="mt-[3px] h-3.5 w-3.5 shrink-0" fill="currentColor">
        <path d="M8 1.5a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13Zm0 3.25a.75.75 0 0 0-.75.75v3a.75.75 0 0 0 1.5 0v-3A.75.75 0 0 0 8 4.75Zm0 5.5a.875.875 0 1 0 0 1.75.875.875 0 0 0 0-1.75Z" />
      </svg>
      <span>{children}</span>
    </p>
  );
}

/** Move keyboard focus to the first invalid control after a rejected submit. */
export function focusFirstInvalidField(ids: Array<string | false | null | undefined>) {
  const first = ids.find((id): id is string => Boolean(id));
  if (!first || typeof window === "undefined") return;
  window.requestAnimationFrame(() => document.getElementById(first)?.focus());
}

/**
 * One accessible field contract for setup and account forms. Labels, optional
 * state, guidance, errors and control relationships must not drift per field.
 */
export function FormField({
  id,
  label,
  optionalLabel,
  hint,
  error,
  action,
  reserveMessage = false,
  sharedMessageId,
  className,
  children,
}: {
  id: string;
  label: string;
  optionalLabel?: string;
  hint?: string;
  error?: string | null;
  action?: React.ReactNode;
  /**
   * Keep a line open under the control for its message, so a message that
   * appears fills that line instead of pushing the fields below it down.
   */
  reserveMessage?: boolean;
  /**
   * The message is shown once for a row of fields (first + last name) under
   * this id; the control points to it and this field renders none itself.
   */
  sharedMessageId?: string;
  className?: string;
  children: (control: FormControlState) => React.ReactNode;
}) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? sharedMessageId ?? `${id}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(" ") || undefined;

  return (
    <div
      className={cn("min-w-0 space-y-1.5", className)}
      data-form-field
      data-invalid={error ? "true" : "false"}
    >
      <div className="flex min-h-5 items-center justify-between gap-3">
        <Label htmlFor={id} className="text-[13px] leading-5 text-foreground/85">{label}</Label>
        {action ?? (optionalLabel ? (
          <span className="shrink-0 text-[11px] font-medium leading-5 text-muted-foreground">
            {optionalLabel}
          </span>
        ) : null)}
      </div>
      {children({
        id,
        error: Boolean(error),
        "aria-invalid": error ? true : undefined,
        "aria-describedby": describedBy,
      })}
      {sharedMessageId ? null : reserveMessage ? (
        <div className="min-h-[1.25rem]">
          {error ? <FieldMessage id={errorId}>{error}</FieldMessage> : null}
        </div>
      ) : error ? (
        <p id={errorId} role="alert" className="text-[12px] leading-relaxed text-destructive">
          {error}
        </p>
      ) : null}
      {hint ? (
        <p id={hintId} className="text-[12px] leading-relaxed text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

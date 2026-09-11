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
  className,
  children,
}: {
  id: string;
  label: string;
  optionalLabel?: string;
  hint?: string;
  error?: string | null;
  action?: React.ReactNode;
  className?: string;
  children: (control: FormControlState) => React.ReactNode;
}) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
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
      {error ? (
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

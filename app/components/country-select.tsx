"use client";

import * as React from "react";
import { ChevronDownIcon } from "@radix-ui/react-icons";
import type { CountryCode } from "libphonenumber-js/min";
import { t } from "../lib/i18n";
import { getPhoneCountries, isPhoneCountry } from "../lib/phone";
import { cn } from "../lib/utils";
import { CountryPickerSheet } from "./country-picker-sheet";

/** Searchable country field that stores an ISO alpha-2 value. */
export function CountrySelect({
  id,
  value,
  onChange,
  lang,
  disabled,
  error,
  allowClear,
  className,
  "aria-describedby": ariaDescribedBy,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  lang: string;
  disabled?: boolean;
  error?: boolean;
  allowClear?: boolean;
  className?: string;
  "aria-describedby"?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const country = isPhoneCountry(value) ? value.toUpperCase() as CountryCode : null;
  const countries = React.useMemo(() => getPhoneCountries(lang), [lang]);
  const selected = country ? countries.find((option) => option.code === country) : null;

  return (
    <>
      <button
        id={id}
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-describedby={ariaDescribedBy}
        data-invalid={error ? "true" : "false"}
        className={cn(
          "flex h-11 w-full items-center gap-2 rounded-xl border border-input bg-card px-4 py-2 text-left text-sm ring-offset-background",
          "transition-[background-color,border-color,box-shadow] duration-150 hover:border-foreground/30",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className,
          error && "border-destructive focus-visible:border-destructive focus-visible:ring-destructive/30",
        )}
      >
        {selected ? (
          <>
            <span aria-hidden="true" className="text-[18px] leading-none">{selected.flag}</span>
            <span className="min-w-0 flex-1 truncate font-medium">{selected.name}</span>
            <span className="text-[12px] tabular-nums text-muted-foreground">{selected.code}</span>
          </>
        ) : (
          <span className="min-w-0 flex-1 truncate text-muted-foreground">{t("country.placeholder", lang)}</span>
        )}
        <ChevronDownIcon aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
      </button>
      <CountryPickerSheet
        open={open}
        onOpenChange={setOpen}
        value={country}
        onSelect={onChange}
        onClear={allowClear ? () => onChange("") : undefined}
        lang={lang}
        mode="country"
      />
    </>
  );
}

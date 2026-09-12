"use client";

import * as React from "react";
import { t } from "../lib/i18n";
import { flagEmoji, getPhoneCountries } from "../lib/phone";
import { cn } from "../lib/utils";
import { CountryPickerSheet, type CountryPickerOption } from "./country-picker-sheet";
import { ChevronDownIcon } from "./icons";

/** Searchable country field that stores an ISO alpha-2 value. */
export function CountrySelect({
  id,
  value,
  onChange,
  lang,
  disabled,
  error,
  allowClear,
  options,
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
  options?: ReadonlyArray<{ code: string; name: string }>;
  className?: string;
  "aria-describedby"?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const country = /^[A-Za-z]{2}$/.test(value.trim()) ? value.trim().toUpperCase() : null;
  const phoneCountries = React.useMemo(() => getPhoneCountries(lang), [lang]);
  const countries = React.useMemo<CountryPickerOption[]>(() => {
    if (options === undefined) return phoneCountries;
    const phoneCountryByCode = new Map<string, (typeof phoneCountries)[number]>(
      phoneCountries.map((option) => [option.code, option]),
    );
    return options.flatMap((option): CountryPickerOption[] => {
      const code = option.code.trim().toUpperCase();
      if (!/^[A-Z]{2}$/.test(code)) return [];
      const phoneCountry = phoneCountryByCode.get(code);
      return [{
        code,
        name: option.name,
        callingCode: phoneCountry?.callingCode ?? "",
        flag: phoneCountry?.flag ?? flagEmoji(code),
      }];
    });
  }, [options, phoneCountries]);
  const selected = country ? countries.find((option) => option.code === country) : null;

  return (
    <>
      <button
        id={id}
        type="button"
        value={country ?? ""}
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
        <span
          aria-hidden="true"
          className={cn(
            "flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-foreground/[0.07] text-foreground/75 transition-transform duration-200",
            open && "rotate-180",
          )}
        >
          <ChevronDownIcon size={15} className="block" />
        </span>
      </button>
      <CountryPickerSheet
        open={open}
        onOpenChange={setOpen}
        value={country}
        onSelect={onChange}
        onClear={allowClear ? () => onChange("") : undefined}
        lang={lang}
        mode="country"
        countries={countries}
      />
    </>
  );
}

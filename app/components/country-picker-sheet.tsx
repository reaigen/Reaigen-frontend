"use client";

import * as React from "react";
import type { CountryCode } from "libphonenumber-js/min";
import { t } from "../lib/i18n";
import type { LocaleKey } from "../lib/locales";
import { getPhoneCountries } from "../lib/phone";
import { BottomSheet } from "../lib/ui/bottom-sheet";
import { cn } from "../lib/utils";
import { CheckIcon } from "./icons";
import { SearchField } from "./search-field";

function searchable(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase();
}

const COPY: Record<"country" | "phone", {
  title: LocaleKey;
  description: LocaleKey;
  search: LocaleKey;
  clear: LocaleKey;
  empty: LocaleKey;
}> = {
  country: {
    title: "country.pickerTitle",
    description: "country.pickerDescription",
    search: "country.search",
    clear: "country.clearSearch",
    empty: "country.noCountries",
  },
  phone: {
    title: "phone.countryPickerTitle",
    description: "phone.countryPickerDescription",
    search: "phone.countrySearch",
    clear: "phone.clearSearch",
    empty: "phone.noCountries",
  },
};

/** One searchable region catalogue shared by country and calling-code fields. */
export function CountryPickerSheet({
  open,
  onOpenChange,
  value,
  onSelect,
  onClear,
  lang,
  mode,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: CountryCode | null;
  onSelect: (country: CountryCode) => void;
  onClear?: () => void;
  lang: string;
  mode: "country" | "phone";
}) {
  const [query, setQuery] = React.useState("");
  const countries = React.useMemo(() => getPhoneCountries(lang), [lang]);
  const copy = COPY[mode];
  const filteredCountries = React.useMemo(() => {
    const needle = searchable(query.trim()).replace(/^\+/, "");
    if (!needle) return countries;
    return countries.filter((option) => (
      searchable(option.name).includes(needle)
      || searchable(option.code).includes(needle)
      || option.callingCode.includes(needle)
    ));
  }, [countries, query]);

  return (
    <BottomSheet
      open={open}
      onOpenChange={(nextOpen) => {
        onOpenChange(nextOpen);
        if (!nextOpen) setQuery("");
      }}
      title={t(copy.title, lang)}
      description={t(copy.description, lang)}
      contentClassName="sm:max-w-[32rem]"
    >
      <SearchField
        value={query}
        onChange={setQuery}
        placeholder={t(copy.search, lang)}
        clearLabel={t(copy.clear, lang)}
        className="mb-3"
      />
      <ul
        className="-mx-2 max-h-[min(25rem,55dvh)] overflow-y-auto overscroll-contain px-2"
        aria-label={t(copy.title, lang)}
      >
        {mode === "country" && onClear ? (
          <li className="mb-1 border-b border-border/60 pb-1">
            <button
              type="button"
              onClick={() => {
                onClear();
                onOpenChange(false);
                setQuery("");
              }}
              className="flex min-h-11 w-full items-center rounded-xl px-3 text-left text-[13px] font-medium text-muted-foreground transition-colors hover:bg-foreground/[0.045] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t("country.clearSelection", lang)}
            </button>
          </li>
        ) : null}
        {filteredCountries.length ? filteredCountries.map((option) => {
          const active = option.code === value;
          return (
            <li key={option.code}>
              <button
                type="button"
                aria-pressed={active}
                onClick={() => {
                  onSelect(option.code);
                  onOpenChange(false);
                  setQuery("");
                }}
                className={cn(
                  "flex min-h-12 w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors",
                  "hover:bg-foreground/[0.045] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active && "bg-accent/70",
                )}
              >
                <span aria-hidden="true" className="text-[20px] leading-none">{option.flag}</span>
                <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{option.name}</span>
                <span className="shrink-0 text-[13px] tabular-nums text-muted-foreground">
                  {mode === "phone" ? `+${option.callingCode}` : option.code}
                </span>
                <span
                  aria-hidden="true"
                  className={cn(
                    "flex h-5 w-5 shrink-0 items-center justify-center rounded-full transition-colors",
                    active ? "bg-foreground text-background" : "text-transparent",
                  )}
                >
                  <CheckIcon size={12} className="block" />
                </span>
              </button>
            </li>
          );
        }) : (
          <li className="px-4 py-10 text-center text-[13px] text-muted-foreground">{t(copy.empty, lang)}</li>
        )}
      </ul>
    </BottomSheet>
  );
}

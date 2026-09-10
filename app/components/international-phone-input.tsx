"use client";

import * as React from "react";
import type { CountryCode } from "libphonenumber-js/min";
import { BottomSheet } from "../lib/ui/bottom-sheet";
import { t } from "../lib/i18n";
import { cn } from "../lib/utils";
import {
  getPhoneCountries,
  interpretPhoneInput,
  phoneInputDisplay,
  resolvePhoneCountry,
} from "../lib/phone";
import { SearchField } from "./search-field";

function searchable(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase();
}

/**
 * One phone editor for every web flow. The country catalogue is metadata-
 * driven, searchable and complete; callers always receive a compact E.164
 * value, while people edit the familiar national format.
 */
export function InternationalPhoneInput({
  id,
  value,
  onChange,
  lang,
  preferredCountry,
  disabled,
  error,
  className,
  inputClassName,
  onBlur,
  "aria-describedby": ariaDescribedBy,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  lang: string;
  preferredCountry?: string | null;
  disabled?: boolean;
  error?: boolean;
  className?: string;
  inputClassName?: string;
  onBlur?: React.FocusEventHandler<HTMLInputElement>;
  "aria-describedby"?: string;
}) {
  const initialCountry = resolvePhoneCountry(value, preferredCountry, lang);
  const [country, setCountry] = React.useState<CountryCode>(initialCountry);
  const [display, setDisplay] = React.useState(() => phoneInputDisplay(value, initialCountry));
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const emittedValue = React.useRef<string | null>(null);
  const countries = React.useMemo(() => getPhoneCountries(lang), [lang]);
  const selected = countries.find((option) => option.code === country) ?? countries[0];

  React.useEffect(() => {
    if (value === emittedValue.current) {
      emittedValue.current = null;
      return;
    }
    emittedValue.current = null;
    const nextCountry = resolvePhoneCountry(value, preferredCountry, lang);
    setCountry(nextCountry);
    setDisplay(phoneInputDisplay(value, nextCountry));
  }, [lang, preferredCountry, value]);

  React.useEffect(() => {
    if (value || preferredCountry || typeof navigator === "undefined") return;
    setCountry(resolvePhoneCountry("", null, navigator.language));
  }, [preferredCountry, value]);

  const filteredCountries = React.useMemo(() => {
    const needle = searchable(query.trim()).replace(/^\+/, "");
    if (!needle) return countries;
    return countries.filter((option) => (
      searchable(option.name).includes(needle)
      || searchable(option.code).includes(needle)
      || option.callingCode.includes(needle)
    ));
  }, [countries, query]);

  function emit(raw: string, currentCountry = country) {
    const interpreted = interpretPhoneInput(raw, currentCountry);
    setCountry(interpreted.country);
    setDisplay(interpreted.display);
    emittedValue.current = interpreted.e164;
    onChange(interpreted.e164);
  }

  function chooseCountry(nextCountry: CountryCode) {
    setCountry(nextCountry);
    const localDigits = display.startsWith("+") ? "" : display;
    const interpreted = interpretPhoneInput(localDigits, nextCountry);
    setDisplay(interpreted.display);
    emittedValue.current = interpreted.e164;
    onChange(interpreted.e164);
    setQuery("");
    setPickerOpen(false);
  }

  if (!selected) return null;

  return (
    <>
      <div
        className={cn(
          "flex h-11 w-full overflow-hidden rounded-xl border border-input bg-card ring-offset-background transition-colors duration-200",
          "hover:border-foreground/30 focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-0",
          disabled && "cursor-not-allowed opacity-50",
          error && "border-destructive focus-within:ring-destructive/30",
          className,
        )}
      >
        <button
          type="button"
          disabled={disabled}
          onClick={() => setPickerOpen(true)}
          aria-label={`${t("phone.changeCountry", lang)}: ${selected.name}, +${selected.callingCode}`}
          aria-haspopup="dialog"
          aria-expanded={pickerOpen}
          className="flex min-w-[7.25rem] shrink-0 items-center gap-2 border-r border-border/70 bg-foreground/[0.025] px-3 text-left transition-colors hover:bg-foreground/[0.055] focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:pointer-events-none"
        >
          <span aria-hidden="true" className="text-[18px] leading-none">{selected.flag}</span>
          <span className="text-[13px] font-semibold tabular-nums">+{selected.callingCode}</span>
          <span aria-hidden="true" className="ml-auto text-[10px] text-muted-foreground">▾</span>
        </button>
        <input
          id={id}
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          disabled={disabled}
          value={display}
          onChange={(event) => emit(event.target.value)}
          onBlur={onBlur}
          onPaste={(event) => {
            const pasted = event.clipboardData.getData("text");
            if (!/^\s*(?:\+|00)/.test(pasted)) return;
            event.preventDefault();
            emit(pasted);
          }}
          placeholder={t("phone.numberPlaceholder", lang)}
          aria-invalid={error || undefined}
          aria-describedby={ariaDescribedBy}
          className={cn(
            "min-w-0 flex-1 border-0 bg-transparent px-3.5 py-2 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed",
            inputClassName,
          )}
        />
      </div>

      <BottomSheet
        open={pickerOpen}
        onOpenChange={(open) => {
          setPickerOpen(open);
          if (!open) setQuery("");
        }}
        title={t("phone.countryPickerTitle", lang)}
        description={t("phone.countryPickerDescription", lang)}
        contentClassName="sm:max-w-[32rem]"
      >
        <SearchField
          value={query}
          onChange={setQuery}
          placeholder={t("phone.countrySearch", lang)}
          clearLabel={t("phone.clearSearch", lang)}
          className="mb-3"
        />
        <ul
          className="-mx-2 max-h-[min(25rem,55dvh)] overflow-y-auto overscroll-contain px-2"
          aria-label={t("phone.countryPickerTitle", lang)}
        >
          {filteredCountries.length ? filteredCountries.map((option) => {
            const active = option.code === country;
            return (
              <li key={option.code}>
                <button
                  type="button"
                  aria-pressed={active}
                  onClick={() => chooseCountry(option.code)}
                  className={cn(
                    "flex min-h-12 w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors",
                    "hover:bg-foreground/[0.045] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    active && "bg-foreground/[0.065]",
                  )}
                >
                  <span aria-hidden="true" className="text-[20px] leading-none">{option.flag}</span>
                  <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{option.name}</span>
                  <span className="shrink-0 text-[13px] tabular-nums text-muted-foreground">+{option.callingCode}</span>
                  <span aria-hidden="true" className={cn("w-4 text-center text-[12px]", active ? "text-foreground" : "text-transparent")}>✓</span>
                </button>
              </li>
            );
          }) : (
            <li className="px-4 py-10 text-center text-[13px] text-muted-foreground">{t("phone.noCountries", lang)}</li>
          )}
        </ul>
      </BottomSheet>
    </>
  );
}

import {
  AsYouType,
  getCountries,
  getCountryCallingCode,
  isValidPhoneNumber,
  parsePhoneNumberFromString,
  type CountryCode,
} from "libphonenumber-js/min";

/**
 * Phone-number boundary shared by account setup, Settings and recovery.
 *
 * The metadata package is the JavaScript distribution of Google's phone
 * numbering catalogue. Django validates the emitted E.164 value with the
 * Python distribution of the same catalogue, so the browser never maintains
 * a second hand-written prefix list.
 */

export interface PhoneCountry {
  code: CountryCode;
  name: string;
  callingCode: string;
  flag: string;
}

const COUNTRY_CODES = getCountries();
const COUNTRY_CODE_SET = new Set<string>(COUNTRY_CODES);

/** Regional-indicator flag for an ISO 3166-1 alpha-2 code ("SK" -> flag). */
export function flagEmoji(iso: string): string {
  if (!/^[A-Za-z]{2}$/.test(iso)) return "";
  return Array.from(iso.toUpperCase(), (character) => (
    String.fromCodePoint(0x1f1e6 + character.charCodeAt(0) - 65)
  )).join("");
}

export function isPhoneCountry(value: string | null | undefined): value is CountryCode {
  return Boolean(value && COUNTRY_CODE_SET.has(value.toUpperCase()));
}

function normalizedLocale(locale: string): string {
  return locale.trim().replace("_", "-") || "en";
}

/** Complete, localized country/prefix catalogue for the picker. */
export function getPhoneCountries(locale = "en"): PhoneCountry[] {
  const safeLocale = normalizedLocale(locale);
  let displayNames: Intl.DisplayNames | null = null;
  try {
    displayNames = new Intl.DisplayNames([safeLocale, "en"], { type: "region" });
  } catch {
    // Old WebViews can lack DisplayNames. ISO codes remain an honest fallback.
  }
  const collator = new Intl.Collator(safeLocale, { sensitivity: "base" });
  return COUNTRY_CODES.map((code) => ({
    code,
    name: displayNames?.of(code) ?? code,
    callingCode: getCountryCallingCode(code),
    flag: flagEmoji(code),
  })).sort((left, right) => collator.compare(left.name, right.name));
}

function localeCountry(locale: string | null | undefined): CountryCode | null {
  if (!locale) return null;
  const pieces = normalizedLocale(locale).split("-");
  const explicitRegion = pieces.find((piece, index) => index > 0 && /^[A-Za-z]{2}$/.test(piece));
  if (isPhoneCountry(explicitRegion)) return explicitRegion.toUpperCase() as CountryCode;
  const languageDefault: Record<string, CountryCode> = { sk: "SK", cs: "CZ", de: "DE" };
  return languageDefault[pieces[0].toLowerCase()] ?? null;
}

function normalizedInternationalCandidate(raw: string): string {
  const trimmed = raw.trim();
  const international = trimmed.startsWith("00") ? `+${trimmed.slice(2)}` : trimmed;
  if (!international.startsWith("+")) return international;
  return `+${international.slice(1).replace(/\D/g, "")}`;
}

function countryFromCallingCode(raw: string, preferred?: CountryCode | null): CountryCode | null {
  const digits = normalizedInternationalCandidate(raw).replace(/^\+/, "");
  if (!digits) return preferred ?? null;
  const matches = COUNTRY_CODES.filter((code) => digits.startsWith(getCountryCallingCode(code)));
  if (preferred && matches.includes(preferred)) return preferred;
  return matches[0] ?? null;
}

/** Pick a country from an existing number, profile country, or browser locale. */
export function resolvePhoneCountry(
  value: string | null | undefined,
  preferredCountry?: string | null,
  locale?: string | null,
): CountryCode {
  const preferred = isPhoneCountry(preferredCountry)
    ? preferredCountry.toUpperCase() as CountryCode
    : null;
  const candidate = normalizedInternationalCandidate(value ?? "");
  if (candidate.startsWith("+")) {
    const parsed = parsePhoneNumberFromString(candidate);
    if (parsed?.country) return parsed.country;
    const prefixCountry = countryFromCallingCode(candidate, preferred);
    if (prefixCountry) return prefixCountry;
  }
  return preferred ?? localeCountry(locale) ?? "SK";
}

export interface PhoneInputState {
  country: CountryCode;
  display: string;
  e164: string;
}

/**
 * Convert a paste or national-number edit into display text plus the E.164
 * value sent to Django. Partial input remains partial and is never considered
 * valid by `isValidInternationalPhone`.
 */
export function interpretPhoneInput(raw: string, country: CountryCode): PhoneInputState {
  const trimmed = raw.trim();
  if (!trimmed) return { country, display: "", e164: "" };

  const looksInternational = trimmed.startsWith("+") || trimmed.startsWith("00");
  if (looksInternational) {
    const candidate = normalizedInternationalCandidate(trimmed);
    const detected = resolvePhoneCountry(candidate, country);
    const formatter = new AsYouType();
    const display = formatter.input(candidate);
    const number = formatter.getNumber();
    return {
      country: number?.country ?? detected,
      display: display || candidate,
      e164: number?.number ?? candidate,
    };
  }

  const formatter = new AsYouType(country);
  const display = formatter.input(trimmed);
  const number = formatter.getNumber();
  const digits = trimmed.replace(/\D/g, "");
  return {
    country,
    display: display || trimmed,
    e164: number?.number ?? (digits ? `+${getCountryCallingCode(country)}${digits}` : ""),
  };
}

/** Re-render a controlled E.164 value in the selected country's national form. */
export function phoneInputDisplay(value: string | null | undefined, country: CountryCode): string {
  const candidate = normalizedInternationalCandidate(value ?? "");
  if (!candidate) return "";
  const parsed = parsePhoneNumberFromString(candidate);
  if (parsed && parsed.country === country) return parsed.formatNational();
  if (candidate.startsWith("+")) {
    const callingCode = getCountryCallingCode(country);
    if (candidate.slice(1).startsWith(callingCode)) {
      return new AsYouType(country).input(candidate.slice(callingCode.length + 1));
    }
  }
  return candidate;
}

export function isValidInternationalPhone(value: string | null | undefined): boolean {
  const candidate = normalizedInternationalCandidate(value ?? "");
  return candidate.startsWith("+") && isValidPhoneNumber(candidate);
}

/** Human-readable phone summary for Settings and verification confirmations. */
export function formatPhoneDisplay(raw: string | null | undefined): { display: string; flag: string | null } {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return { display: "", flag: null };
  const candidate = normalizedInternationalCandidate(trimmed);
  const parsed = candidate.startsWith("+") ? parsePhoneNumberFromString(candidate) : undefined;
  if (parsed) {
    return {
      display: parsed.formatInternational(),
      flag: parsed.country ? flagEmoji(parsed.country) : null,
    };
  }
  return { display: trimmed, flag: null };
}

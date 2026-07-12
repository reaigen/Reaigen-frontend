import { locales, type LocaleKey } from "./locales";

export const SUPPORTED_LOCALES = ["en", "sk", "cs", "de"] as const;

export function normalizeLanguage(lang?: string | null): string {
  const code = lang?.slice(0, 2).toLowerCase() ?? "en";
  return SUPPORTED_LOCALES.includes(code as (typeof SUPPORTED_LOCALES)[number]) ? code : "en";
}

/**
 * Translate a key to the given language, falling back to English.
 *
 * Usage:
 *   t("auth.login.title", "sk")  // → "Vitajte späť"
 *   t("nav.dashboard", "en")     // → "Dashboard"
 */
export function t(key: LocaleKey, lang: string): string {
  const code = normalizeLanguage(lang);
  return locales[code]?.[key] ?? locales.en[key] ?? key;
}

/** Extract the preferred language code from a user's localization object. */
export function getUserLanguage(localization?: { language?: string } | null): string {
  return normalizeLanguage(localization?.language);
}

export function getBrowserLanguage(): string {
  if (typeof navigator === "undefined") return "en";
  return normalizeLanguage(navigator.language);
}

/**
 * Format a date string according to the user's date_format preference.
 * Supports "EU" (DD.MM.YYYY), "US" (MM/DD/YYYY), "ISO" (YYYY-MM-DD).
 * Falls back to locale-aware short format.
 */
export function formatDate(dateStr: string | null | undefined, dateFormat?: string | null, lang?: string): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return "";
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  if (dateFormat === "US") return `${month}/${day}/${year}`;
  if (dateFormat === "ISO") return `${year}-${month}-${day}`;
  if (dateFormat === "EU") return `${day}.${month}.${year}`;
  // Fallback: locale-aware short date
  return d.toLocaleDateString(normalizeLanguage(lang), { year: "numeric", month: "short", day: "numeric" });
}

/** Format a date as relative short (e.g. "Jun 11") for compact display. */
export function formatDateShort(dateStr: string | null | undefined, lang?: string): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(normalizeLanguage(lang), { month: "short", day: "numeric" });
}

export type { LocaleKey };

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

export type { LocaleKey };

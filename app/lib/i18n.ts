import { locales, type LocaleKey } from "./locales";

/**
 * Translate a key to the given language, falling back to English.
 *
 * Usage:
 *   t("auth.login.title", "sk")  // → "Vitajte späť"
 *   t("nav.dashboard", "en")     // → "Dashboard"
 */
export function t(key: LocaleKey, lang: string): string {
  return locales[lang]?.[key] ?? locales.en[key] ?? key;
}

/** Extract the preferred language code from a user's localization object. */
export function getUserLanguage(localization?: { language?: string } | null): string {
  return localization?.language ?? "en";
}

export type { LocaleKey };

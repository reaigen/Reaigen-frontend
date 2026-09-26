import { formatDate, normalizeLanguage } from "./i18n";
import type { LocaleKey } from "./locales";

/**
 * Human labels and a real preview for Settings → Language & region.
 *
 * The backend sends codes with English catalogue names ("sk · Slovencina",
 * "SQM · Square Meter", "EU · EU"), and the preview printed the date
 * format's code ("Dátum EU") and "1.4 m" (Bench 06 B06-F08). Names now come
 * from the browser's Intl data in the interface language, units from our
 * own locale strings, and the preview formats real sample values.
 */

const UNIT_NAME_KEYS: Record<string, LocaleKey> = {
  SQM: "units.name.SQM",
  SQCM: "units.name.SQCM",
  SQKM: "units.name.SQKM",
  HECTARE: "units.name.HECTARE",
  ARE: "units.name.ARE",
  SQFT: "units.name.SQFT",
  SQYD: "units.name.SQYD",
  SQIN: "units.name.SQIN",
  ACRE: "units.name.ACRE",
  SQMI: "units.name.SQMI",
  M: "units.name.M",
  CM: "units.name.CM",
  MM: "units.name.MM",
  KM: "units.name.KM",
  FT: "units.name.FT",
  IN: "units.name.IN",
  YD: "units.name.YD",
  MI: "units.name.MI",
};

/** A walking-distance sample that reads naturally in each unit. */
const DISTANCE_SAMPLES: Record<string, number> = {
  M: 850, KM: 1.4, CM: 85000, MM: 850000, FT: 2800, YD: 930, IN: 33500, MI: 0.9,
};

/** An apartment-sized area sample in each unit. */
const AREA_SAMPLES: Record<string, number> = {
  SQM: 82, SQCM: 820000, SQKM: 0.00008, HECTARE: 0.0082, ARE: 0.82, SQFT: 883, SQYD: 98, SQIN: 127100, ACRE: 0.02, SQMI: 0.00003,
};

function capitalize(text: string, lang: string): string {
  return text ? text.charAt(0).toLocaleUpperCase(normalizeLanguage(lang)) + text.slice(1) : text;
}

function displayName(type: "language" | "currency", code: string, lang: string): string | null {
  try {
    const name = new Intl.DisplayNames([normalizeLanguage(lang)], { type }).of(code);
    return name && name.toLowerCase() !== code.toLowerCase() ? capitalize(name, lang) : null;
  } catch {
    return null;
  }
}

export function unitNameKey(code: string): LocaleKey | null {
  return UNIT_NAME_KEYS[code.toUpperCase()] ?? null;
}

/** A language is named in itself ("Slovenčina", "Deutsch"), so everyone can find their own. */
export function languageLabel(code: string, fallback: string): string {
  return displayName("language", code, code) ?? fallback;
}

export function currencyLabel(code: string, fallback: string, symbol: string | undefined, lang: string): string {
  const name = displayName("currency", code, lang) ?? fallback;
  return symbol && symbol !== code ? `${name} (${symbol})` : `${name} (${code})`;
}

export function formatPreviewNumber(value: number, lang: string): string {
  return new Intl.NumberFormat(normalizeLanguage(lang), { maximumFractionDigits: value < 1 ? 5 : 1 }).format(value);
}

export function currencySample(code: string, lang: string): string {
  if (!code) return "";
  try {
    return new Intl.NumberFormat(normalizeLanguage(lang), { style: "currency", currency: code, maximumFractionDigits: 0 }).format(245000);
  } catch {
    return `245 000 ${code}`;
  }
}

export function areaSample(code: string, symbol: string, lang: string): string {
  return `${formatPreviewNumber(AREA_SAMPLES[code.toUpperCase()] ?? 82, lang)} ${symbol}`;
}

export function distanceSample(code: string, symbol: string, lang: string): string {
  return `${formatPreviewNumber(DISTANCE_SAMPLES[code.toUpperCase()] ?? 1.4, lang)} ${symbol}`;
}

/** Today's date in a date-format code — the label is the format itself. */
export function dateFormatSample(code: string, lang: string, today: Date = new Date()): string {
  return formatDate(today.toISOString(), code, lang);
}

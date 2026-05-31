/**
 * Locale registry.
 *
 * To add a new language:
 *   1. Create `lib/locales/<code>.ts` implementing LocaleStrings.
 *   2. Import it here and add to the `locales` map.
 *   3. TypeScript ensures every key from en.ts is translated.
 */

import en, { type LocaleKey, type LocaleStrings } from "./en";
import sk from "./sk";
import cs from "./cs";
import de from "./de";

export type { LocaleKey, LocaleStrings };

export const locales: Record<string, LocaleStrings> = { en, sk, cs, de };

/**
 * Typed approval of an Agent action plan.
 *
 * A plan can create a listing and spend allowance, so a typed reply may only
 * approve it when the whole message is an unambiguous yes. Substring matching —
 * which is enough for "apply" on a single field edit — would read "yes, but
 * change the price first" or Slovak "ja chcem najprv…" ("I want to first…") as
 * consent. So: every word must belong to an accepted phrase, the message stays
 * short, and any hedge word anywhere rejects it. The accepted phrases are the
 * English set plus the account language's own; "ja" is German for yes but
 * Slovak for "I", which is why lists are not merged across languages.
 */

const MAX_CONFIRMATION_WORDS = 4;

const ENGLISH_CONFIRMATIONS = [
  "yes",
  "yes please",
  "ok",
  "okay",
  "go ahead",
  "do it",
  "run it",
  "run the plan",
  "confirm",
  "sounds good",
];

const LOCAL_CONFIRMATIONS: Record<string, readonly string[]> = {
  sk: ["ano", "ano spusti", "spusti", "spusti to", "potvrd", "potvrdzujem", "urob to", "pokracuj"],
  cs: ["ano", "jo", "spust", "spust to", "spustit", "potvrd", "potvrzuji", "udelej to", "pokracuj"],
  de: ["ja", "ja bitte", "los", "mach das", "mach es", "ausfuhren", "bestatigen", "bestatige", "weiter", "passt"],
};

/** Any of these anywhere means the creator is hedging, refusing or deferring. */
const HEDGE_WORDS = new Set([
  "no",
  "not",
  "don't",
  "dont",
  "nie",
  "ne",
  "nein",
  "nicht",
  "stop",
  "wait",
  "pockaj",
  "pockej",
  "warte",
  "ale",
  "aber",
  "but",
  "later",
  "neskor",
  "pozdeji",
  "spater",
]);

const STOP_WORDS = new Set(["stop", "zastav", "zastavit", "stopp", "cancel", "zrus", "abbrechen"]);

function planWords(text: string): string[] {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLocaleLowerCase("en")
    .replace(/[’‘`]/g, "'")
    // Commas and sentence marks separate phrases ("áno, spusti"); an apostrophe
    // stays part of its word so "don't" is still recognised as a refusal.
    .replace(/[^\p{L}\p{N}']+/gu, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

function languageCode(accountLanguage: string | null | undefined): string {
  return String(accountLanguage || "en").toLocaleLowerCase("en").split(/[-_]/)[0];
}

/**
 * True only when the whole message is one accepted phrase, or accepted phrases
 * joined together ("yes, go ahead", "ja, los"), in English or the account
 * language.
 */
export function isPlanConfirmation(text: string, accountLanguage: string | null | undefined): boolean {
  const words = planWords(text);
  if (words.length === 0 || words.length > MAX_CONFIRMATION_WORDS) return false;
  if (words.some((word) => HEDGE_WORDS.has(word))) return false;
  const phrases = [...ENGLISH_CONFIRMATIONS, ...(LOCAL_CONFIRMATIONS[languageCode(accountLanguage)] ?? [])]
    .map((phrase) => phrase.split(" "));
  // reachable[i]: the first i words are a sequence of whole accepted phrases.
  const reachable = new Array<boolean>(words.length + 1).fill(false);
  reachable[0] = true;
  for (let start = 0; start < words.length; start += 1) {
    if (!reachable[start]) continue;
    for (const phrase of phrases) {
      const end = start + phrase.length;
      if (end > words.length) continue;
      if (phrase.every((word, offset) => words[start + offset] === word)) reachable[end] = true;
    }
  }
  return reachable[words.length];
}

/** True when the whole message is a request to stop the running plan. */
export function isPlanStop(text: string): boolean {
  const words = planWords(text);
  return words.length === 1 && STOP_WORDS.has(words[0]);
}

/**
 * Typed approval of an Agent action plan.
 *
 * A plan can create a listing and spend allowance, so a typed reply may only
 * approve it when the whole message is an unambiguous yes. Substring matching —
 * is unsafe even for a single field edit — would read "yes, but
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

/** A field edit or viewer mutation requires a whole, affirmative command. */
export function isProposalConfirmation(text: string, accountLanguage: string): boolean {
  // A question about applying is not authorization, even if it is one word.
  if (text.includes("?")) return false;
  const normalized = planWords(text).join(" ");
  const phrases: Record<string, string[]> = {
    en: ["save", "save it", "save this", "apply", "apply it", "apply this", "apply the changes", "confirm", "use it", "use this", "use that", "use this change"],
    sk: ["uloz", "uloz to", "pouzi", "pouzi to", "potvrd", "potvrdzujem", "aplikuj"],
    cs: ["uloz", "uloz to", "pouzij", "pouzij to", "potvrd", "potvrzuji", "aplikuj"],
    de: ["speichern", "anwenden", "bestatigen", "bestatige", "ubernehmen"],
  };
  const accepted = [...phrases.en, ...(phrases[languageCode(accountLanguage)] ?? [])];
  if (accepted.some((phrase) => [phrase, `${phrase} please`, `please ${phrase}`, `yes ${phrase}`].includes(normalized))) return true;
  // "Apply the pending change.", "Now apply the earlier proposal.", "Apply
  // that diff.", "použi tú zmenu", "übernimm den Vorschlag": the card's own
  // proposal, named. Anything more than the command and its object is not
  // a confirmation ("apply the discount to the price").
  return PENDING_CONFIRMATION.test(normalized);
}

const PENDING_CONFIRMATION = new RegExp(
  "^(?:(?:now|please|ok|okay|so|then|yes|dobre|tak|teraz|prosim|ano|bitte|jetzt|ja)\\s+)*"
  + "(?:apply|use|confirm|commit|pouzi|pouzit|pouzite|aplikuj|potvrd|potvrdte|uloz|ulozit|ulozte|pouzij|potvrdit|ubernimm|ubernehmen|anwenden|bestatige|speichere|speichern)"
  + "(?:\\s+(?:the|that|this|it|tu|to|tuto|ten|die|das|den|es))?"
  + "(?:\\s+(?:pending|earlier|previous|last|proposed|prepared|open|cakajucu|navrhovanu|predchadzajucu|poslednu|pripravenu|vorherigen|letzten|offenen))*"
  + "(?:\\s+(?:change|changes|proposal|edit|diff|update|zmenu|zmeny|navrh|upravu|anderung|anderungen|vorschlag))?"
  + "(?:\\s+(?:please|prosim|bitte|now|teraz|jetzt))?$",
);

const PENDING_CANCELLATION = new RegExp(
  "^(?:(?:please|ok|okay|no|nie|ne|nein|prosim|bitte)\\s+)*"
  + "(?:cancel|discard|drop|forget|withdraw|dismiss|scrap|zrus|zrusit|zruste|zahod|zabudni|zabudnite|nechaj to tak|nechajte to tak|abbrechen|verwerfen|verwirf|vergiss)"
  + "(?:\\s+(?:that|this|it|the|to|tu|tuto|ten|das|den|die|es))?"
  + "(?:\\s+(?:title|price|area|proposed|pending|last|earlier|navrhovanu|poslednu|cakajucu|vorherigen|letzten))*"
  + "(?:\\s+(?:change|changes|proposal|edit|zmenu|zmeny|navrh|upravu|anderung|anderungen|vorschlag))?"
  + "(?:\\s+(?:keep|leave|nechaj|ponechaj|nechajte|behalte|lass)\\b.*)?$",
);

/** The whole message withdraws the card's pending proposal: "cancel that change", "zruš to", "Cancel the title change. Keep the saved title." */
export function isProposalCancellation(text: string, accountLanguage: string): boolean {
  if (text.includes("?")) return false;
  void accountLanguage;
  const normalized = planWords(text).join(" ");
  return normalized.length > 0 && PENDING_CANCELLATION.test(normalized);
}

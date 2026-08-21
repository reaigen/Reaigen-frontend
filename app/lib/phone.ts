/**
 * Presentation formatting for phone numbers.
 *
 * Numbers are stored the way the user typed them (usually E.164, `+421910362284`)
 * and that raw form stays in inputs and `tel:` hrefs. This module only shapes
 * what the eye reads: `+421 910 362 284`, with the country's flag resolved from
 * the dialing code.
 *
 * Deliberately not libphonenumber: display grouping for the markets the product
 * serves doesn't justify a 140 kB dependency. Unknown prefixes degrade to
 * generic three-digit grouping, never to garbage.
 */

// Longest-prefix-wins table of dialing codes → ISO country, covering Europe
// plus the North-American plan. Order does not matter; matching tries 3-, then
// 2-, then 1-digit prefixes.
const DIAL_CODES: Record<string, string> = {
  "1": "US",
  "7": "RU",
  "20": "EG",
  "27": "ZA",
  "30": "GR",
  "31": "NL",
  "32": "BE",
  "33": "FR",
  "34": "ES",
  "36": "HU",
  "39": "IT",
  "40": "RO",
  "41": "CH",
  "43": "AT",
  "44": "GB",
  "45": "DK",
  "46": "SE",
  "47": "NO",
  "48": "PL",
  "49": "DE",
  "90": "TR",
  "351": "PT",
  "352": "LU",
  "353": "IE",
  "354": "IS",
  "358": "FI",
  "359": "BG",
  "370": "LT",
  "371": "LV",
  "372": "EE",
  "380": "UA",
  "385": "HR",
  "386": "SI",
  "387": "BA",
  "389": "MK",
  "420": "CZ",
  "421": "SK",
  "423": "LI",
};

/** Regional-indicator flag for an ISO 3166-1 alpha-2 code ("SK" → 🇸🇰). */
function flagEmoji(iso: string): string {
  return Array.from(iso.toUpperCase(), (c) => String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65)).join("");
}

/** Left-to-right groups of three; a trailing lone digit joins the previous group. */
function groupDigits(digits: string): string {
  const groups: string[] = [];
  for (let i = 0; i < digits.length; i += 3) groups.push(digits.slice(i, i + 3));
  if (groups.length > 1 && groups[groups.length - 1].length === 1) {
    const lone = groups.pop() as string;
    groups[groups.length - 1] += lone;
  }
  return groups.join(" ");
}

export function formatPhoneDisplay(raw: string | null | undefined): { display: string; flag: string | null } {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return { display: "", flag: null };
  const compact = trimmed.replace(/[\s().\/-]+/g, "");
  // Anything that isn't a plain (possibly +-prefixed) digit run is left as typed.
  if (!/^\+?\d{4,15}$/.test(compact)) return { display: trimmed, flag: null };

  if (compact.startsWith("+")) {
    const digits = compact.slice(1);
    for (const length of [3, 2, 1]) {
      const iso = DIAL_CODES[digits.slice(0, length)];
      if (iso) {
        const national = digits.slice(length);
        const grouped = national ? ` ${groupDigits(national)}` : "";
        return { display: `+${digits.slice(0, length)}${grouped}`, flag: flagEmoji(iso) };
      }
    }
    return { display: `+${groupDigits(digits)}`, flag: null };
  }
  return { display: groupDigits(compact), flag: null };
}

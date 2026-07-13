/**
 * Localized room names — mirrors iOS RoomTypeCode.displayName.
 *
 * Drafts store room names two ways:
 *   - `room_N_type` / `room_type_code` — a stable code ("KITCHEN") we can
 *     translate directly, and
 *   - `room_N_label` — display text frozen in whatever language the scanning
 *     device used ("Kitchen", "Kuchyňa"). For those we reverse-map the text
 *     to a room-type code (across every locale we ship, diacritics ignored)
 *     and re-localize; custom names that match nothing stay as typed.
 */

import { locales, type LocaleKey } from "./locales";
import { t } from "./i18n";

const ROOM_TYPE_CODES = [
  "living_room",
  "dining_room",
  "kitchen",
  "bedroom",
  "master_bedroom",
  "kids_room",
  "bathroom",
  "master_bathroom",
  "half_bathroom",
  "office",
  "laundry",
  "closet",
  "pantry",
  "mudroom",
  "hallway",
  "foyer",
  "staircase",
  "garage",
  "basement",
  "attic",
  "balcony",
  "terrace",
  "patio",
  "other",
] as const;

/** Legacy / regional spellings the iOS app has produced over time. */
const NAME_ALIASES: Record<string, string> = {
  "master bedroom": "master_bedroom",
  "laundry room": "laundry",
  wc: "half_bathroom",
  "polovicna kupelna": "half_bathroom",
  toaleta: "half_bathroom",
  "utility room": "mudroom",
  "technicka miestnost": "mudroom",
  "entry hall": "foyer",
  "vstupna hala": "foyer",
  "vstupni hala": "foyer",
  predsien: "foyer",
};

const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

let reverseMap: Record<string, string> | null = null;

function nameToCode(): Record<string, string> {
  if (reverseMap) return reverseMap;
  const map: Record<string, string> = { ...NAME_ALIASES };
  for (const dict of Object.values(locales)) {
    for (const code of ROOM_TYPE_CODES) {
      const name = dict[`rooms.${code}` as LocaleKey];
      if (name) map[normalize(name)] = code;
    }
  }
  reverseMap = map;
  return map;
}

function translateCode(code: string, lang: string): string | null {
  const key = `rooms.${code.toLowerCase()}` as LocaleKey;
  const name = t(key, lang);
  return name === key ? null : name; // t() echoes unknown keys
}

/**
 * Best localized name for a room. `label` wins when it's a custom name;
 * recognizable stock names and type codes are re-localized to `lang`.
 * Returns null when there is nothing to show.
 */
export function localizedRoomName(
  label: string | null | undefined,
  typeCode: string | null | undefined,
  lang: string
): string | null {
  const trimmed = label?.trim();
  if (trimmed) {
    const code = nameToCode()[normalize(trimmed)];
    if (code) return translateCode(code, lang) ?? trimmed;
    return trimmed; // custom user name — keep as typed
  }
  if (typeCode) return translateCode(typeCode, lang);
  return null;
}

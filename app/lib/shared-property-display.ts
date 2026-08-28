import { t } from "./i18n";
import {
  PROPERTY_FIELD_SECTIONS,
  subtypeOptions,
  type PropertyFieldDefinition,
  type PropertySpecSection,
  type PropertyType,
} from "./property-field-registry";
import { baseUnitForCategory, resolveUnit, unitLabel, type UnitLookup } from "./unit-catalog";

export interface SharedPropertyDatum {
  key: string;
  value: string;
}

export interface SharedPropertyDisplayItem {
  key: string;
  label: string;
  value: string;
  section: PropertySpecSection;
}

const PUBLIC_FIELD_ORDER = PROPERTY_FIELD_SECTIONS.flatMap((section) => (
  section.fields.map((field) => ({ field, section: section.key }))
));

const AREA_FIELDS = new Set([
  "floor_area", "land_area", "basement_area", "balcony_area", "loggia_area",
  "terrace_area", "garden_area", "front_garden_area", "built_up_area",
  "office_area", "warehouse_area",
]);

const LENGTH_FIELDS = new Set(["plot_width", "plot_length", "ceiling_height"]);

const MONEY_FIELDS = new Set([
  "utilities_advance", "deposit", "agency_fee", "furnishing_separate_price",
  "parking_standalone_price", "storage_price", "monthly_repair_fund",
  "monthly_management_fee", "monthly_heating", "monthly_water",
  "monthly_electricity", "monthly_waste", "monthly_internet_tv", "monthly_other",
]);

const PROPERTY_TYPES = new Set<PropertyType>(["apartment", "house", "land", "commercial", "other"]);

function parseValue(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if ((trimmed.startsWith("[") && trimmed.endsWith("]")) || (trimmed.startsWith("{") && trimmed.endsWith("}"))) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed;
    }
  }
  return trimmed;
}

function optionLabel(field: PropertyFieldDefinition, value: string, lang: string, propertyType: PropertyType) {
  const options = field.kind === "subtype" ? subtypeOptions(propertyType) : field.options;
  const option = options?.find((candidate) => candidate.value.toLowerCase() === value.toLowerCase());
  return option ? t(option.labelKey, lang) : null;
}

function humanize(value: string, lang: string) {
  const normalized = value.replace(/[._-]+/g, " ").trim();
  if (!normalized) return "";
  return normalized.charAt(0).toLocaleUpperCase(lang) + normalized.slice(1);
}

function formatNumber(value: number, lang: string) {
  return new Intl.NumberFormat(lang, { maximumFractionDigits: 2 }).format(value);
}

function formatValue(
  field: PropertyFieldDefinition,
  raw: unknown,
  lang: string,
  propertyType: PropertyType,
  units: readonly UnitLookup[],
  currency: string | null | undefined,
  areaUnitToken: string | null | undefined,
) {
  if (raw == null || raw === "") return "";
  if (Array.isArray(raw)) {
    const values = raw
      .map((item) => optionLabel(field, String(item), lang, propertyType) ?? humanize(String(item), lang))
      .filter(Boolean);
    return values.length ? new Intl.ListFormat(lang, { style: "long", type: "conjunction" }).format(values) : "";
  }
  if (typeof raw === "object") return "";

  const stringValue = String(raw).trim();
  if (!stringValue) return "";
  if (field.kind === "boolean") {
    const truthy = raw === true || /^(true|1|yes|ano|áno)$/i.test(stringValue);
    const falsy = raw === false || /^(false|0|no|nie|ne)$/i.test(stringValue);
    return truthy ? t("common.yes", lang) : falsy ? t("common.no", lang) : "";
  }
  if (field.kind === "select" || field.kind === "subtype") {
    return optionLabel(field, stringValue, lang, propertyType) ?? humanize(stringValue, lang);
  }
  if (field.kind === "multiselect") {
    const values = stringValue.split(",").map((value) => value.trim()).filter(Boolean);
    return new Intl.ListFormat(lang, { style: "long", type: "conjunction" }).format(
      values.map((value) => optionLabel(field, value, lang, propertyType) ?? humanize(value, lang)),
    );
  }

  const numeric = Number(stringValue);
  if (Number.isFinite(numeric) && (field.kind === "number" || field.kind === "decimal")) {
    if (MONEY_FIELDS.has(field.key)) {
      const currencyUnit = resolveUnit(units, currency, "CURRENCY");
      const currencyCode = currencyUnit?.code ?? currency?.trim().toUpperCase();
      if (currencyCode) {
        try {
          return new Intl.NumberFormat(lang, {
            style: "currency",
            currency: currencyCode,
            maximumFractionDigits: 2,
          }).format(numeric);
        } catch {
          // The backend catalog can contain a custom currency code. In that
          // case retain the localized number and the catalog's own symbol.
        }
      }
      return `${formatNumber(numeric, lang)}${unitLabel(currencyUnit) ? ` ${unitLabel(currencyUnit)}` : ""}`;
    }
    if (AREA_FIELDS.has(field.key)) {
      const areaUnit = resolveUnit(units, areaUnitToken, "AREA") ?? baseUnitForCategory(units, "AREA");
      return `${formatNumber(numeric, lang)}${unitLabel(areaUnit) ? ` ${unitLabel(areaUnit)}` : ""}`;
    }
    if (LENGTH_FIELDS.has(field.key)) {
      const distanceUnit = baseUnitForCategory(units, "DISTANCE");
      return `${formatNumber(numeric, lang)}${unitLabel(distanceUnit) ? ` ${unitLabel(distanceUnit)}` : ""}`;
    }
    if (field.key === "vat_rate") return `${formatNumber(numeric, lang)} %`;
    return formatNumber(numeric, lang);
  }
  return stringValue;
}

/**
 * Convert the backend's broad draft_data payload into a strict public view.
 * Internal transport metadata and AI inputs are intentionally omitted: a
 * public share only renders fields registered as property attributes.
 */
export function sharedPropertyDisplayItems(
  data: readonly SharedPropertyDatum[] | null | undefined,
  lang: string,
  units: readonly UnitLookup[] = [],
  currency?: string | null,
  areaUnit?: string | null,
): SharedPropertyDisplayItem[] {
  if (!data?.length) return [];
  const values = new Map(data.map((item) => [item.key.split(".").at(-1) ?? item.key, item.value]));
  const rawPropertyType = String(values.get("property_type") ?? "other").toLowerCase();
  const propertyType = PROPERTY_TYPES.has(rawPropertyType as PropertyType) ? rawPropertyType as PropertyType : "other";
  const seen = new Set<string>();

  return PUBLIC_FIELD_ORDER.flatMap(({ field, section }) => {
    const key = field.key;
    if (seen.has(key)) return [];
    seen.add(key);
    const itemValue = values.get(key);
    if (itemValue == null) return [];
    const value = formatValue(field, parseValue(itemValue), lang, propertyType, units, currency, areaUnit);
    if (!value) return [];
    return [{
      key,
      label: t(field.labelKey, lang),
      value,
      section,
    }];
  });
}

const COUNTRY_CODES = new Map<string, string>([
  ["us", "US"], ["usa", "US"], ["united states", "US"], ["united states of america", "US"],
  ["spojene staty", "US"], ["spojené štáty", "US"], ["spojené státy", "US"], ["vereinigte staaten", "US"],
  ["sk", "SK"], ["slovakia", "SK"], ["slovensko", "SK"], ["slowakei", "SK"],
  ["cz", "CZ"], ["czechia", "CZ"], ["czech republic", "CZ"], ["česko", "CZ"], ["tschechien", "CZ"],
  ["de", "DE"], ["germany", "DE"], ["nemecko", "DE"], ["německo", "DE"], ["deutschland", "DE"],
  ["at", "AT"], ["austria", "AT"], ["rakúsko", "AT"], ["rakousko", "AT"], ["österreich", "AT"],
  ["ch", "CH"], ["switzerland", "CH"], ["švajčiarsko", "CH"], ["švýcarsko", "CH"], ["schweiz", "CH"],
  ["gb", "GB"], ["uk", "GB"], ["united kingdom", "GB"], ["spojené kráľovstvo", "GB"], ["spojené království", "GB"], ["vereinigtes königreich", "GB"],
]);

function normalizeCountry(value: string) {
  return value.trim().toLocaleLowerCase("en").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function localizeCountryName(country: string | null | undefined, lang: string) {
  if (!country?.trim()) return "";
  const normalized = normalizeCountry(country);
  const code = COUNTRY_CODES.get(normalized) ?? COUNTRY_CODES.get(country.trim().toLocaleLowerCase("en"));
  if (!code) return country.trim();
  try {
    return new Intl.DisplayNames([lang], { type: "region" }).of(code) ?? country.trim();
  } catch {
    return country.trim();
  }
}

export function localizeSharedAddress(
  displayAddress: string | null | undefined,
  city: string | null | undefined,
  state: string | null | undefined,
  country: string | null | undefined,
  lang: string,
) {
  const localizedCountry = localizeCountryName(country, lang);
  if (displayAddress?.trim()) {
    if (country?.trim() && localizedCountry && localizedCountry !== country.trim()) {
      const index = displayAddress.toLocaleLowerCase("en").lastIndexOf(country.trim().toLocaleLowerCase("en"));
      if (index >= 0) return `${displayAddress.slice(0, index)}${localizedCountry}${displayAddress.slice(index + country.trim().length)}`;
    }
    return displayAddress.trim();
  }
  return [city, state, localizedCountry].filter(Boolean).join(", ");
}

"use client";

import * as React from "react";
import { Button } from "../lib/ui/button";
import { Input } from "../lib/ui/input";
import { Label } from "../lib/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../lib/ui/select";
import { getSafeApiErrorMessage } from "../lib/api/error-message";
import { updateDraft, type DraftUpdatePayload } from "../lib/api/client";
import { t } from "../lib/i18n";
import {
  formatEditableNumber,
  numericUnitLabel,
  parseNumericExpression,
  type NumericInputContext,
} from "../lib/numeric-expression";
import {
  baseUnitForCategory,
  convertUnitValue,
  findUnit,
  findUnitById,
  unitsForCategory,
  type UnitLookup,
} from "../lib/unit-catalog";
import {
  advancedPropertySections,
  subtypeOptions,
  type OfferType,
  type PropertyFieldDefinition,
  type PropertySpecSection,
  type PropertyType,
} from "../lib/property-field-registry";
import type { DraftDetailItem } from "../lib/tour-types";
import { cn } from "../lib/utils";
import {
  LockIcon,
  LayoutIcon,
  RulerIcon,
  PriceIcon,
  DocumentIcon,
  TechnicalIcon,
  UtilitiesIcon,
  StarIcon,
  InfoIcon,
  MapPinIcon,
  ChevronDownIcon,
  CloseIcon,
  EditIcon,
  MinusIcon,
  PlusIcon,
  type IconProps,
} from "./icons";
import { SearchField } from "./search-field";
import { SegmentedControl } from "./segmented-control";
import { SidePanel } from "./side-panel";

type EditorValues = {
  title: string;
  description: string;
  price: string;
  currency: string;
  area: string;
  lotSize: string;
  bedrooms: string;
  bathrooms: string;
  yearBuilt: string;
  address: string;
  city: string;
  state: string;
  country: string;
  postalCode: string;
};

type EditorUnitValues = {
  area: string;
  lot: string;
};

type EditorNumericEnvironment = {
  units: readonly UnitLookup[];
  areaUnit: string;
  lotUnit: string;
  distanceUnit: string;
  currency: string;
};

type SpecsValues = Record<string, Record<string, unknown>>;
type EditorMode = "basic" | "advanced";
type MobileEditorPanel = "basics" | "property" | "location";

function nestedValue(draft: DraftDetailItem, section: string, key: string) {
  const value = draft.specs?.[section];
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  return String((value as Record<string, unknown>)[key] ?? "");
}

function valuesFromDraft(draft: DraftDetailItem, units: readonly UnitLookup[] = []): EditorValues {
  const fallbackCurrency = baseUnitForCategory(units, "CURRENCY")
    ?? unitsForCategory(units, "CURRENCY")[0];
  return {
    title: draft.title ?? "",
    description: draft.description ?? "",
    price: draft.price == null ? "" : String(draft.price),
    currency: draft.currency || fallbackCurrency?.code || "",
    area: draft.area == null ? "" : String(draft.area),
    lotSize: draft.lot_size == null ? "" : String(draft.lot_size),
    bedrooms: nestedValue(draft, "layout", "bedrooms"),
    bathrooms: nestedValue(draft, "layout", "bathrooms"),
    yearBuilt: draft.year_built != null && Number(draft.year_built) > 0 ? String(draft.year_built) : "",
    address: draft.address ?? "",
    city: draft.city ?? "",
    state: draft.state ?? "",
    country: draft.country ?? "",
    postalCode: draft.postal_code ?? "",
  };
}

function unitValuesFromDraft(draft: DraftDetailItem, units: readonly UnitLookup[]): EditorUnitValues {
  const fallbackArea = baseUnitForCategory(units, "AREA")
    ?? unitsForCategory(units, "AREA")[0];
  const area = findUnitById(units, draft.area_unit)
    ?? findUnit(units, draft.area_unit_code, "AREA")
    ?? findUnit(units, draft.area_unit_display, "AREA")
    ?? fallbackArea;
  const lot = findUnitById(units, draft.lot_size_unit)
    ?? area
    ?? fallbackArea;
  return {
    area: area?.code ?? draft.area_unit_code ?? draft.area_unit_display ?? "",
    lot: lot?.code ?? "",
  };
}

function specsFromDraft(draft: DraftDetailItem): SpecsValues {
  const next: SpecsValues = {};
  for (const [section, value] of Object.entries(draft.specs ?? {})) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      next[section] = { ...(value as Record<string, unknown>) };
    }
  }
  return next;
}

function normalizedPropertyType(value: unknown): PropertyType {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["apartment", "house", "land", "commercial", "other"].includes(normalized)) return normalized as PropertyType;
  if (["flat", "studio", "loft", "penthouse", "duplex"].includes(normalized)) return "apartment";
  if (["villa", "townhouse", "bungalow", "cottage", "condo"].includes(normalized)) return "house";
  if (["office", "retail", "warehouse", "restaurant", "hotel", "production"].includes(normalized)) return "commercial";
  return "apartment";
}

function normalizedOfferType(value: unknown): OfferType {
  return String(value ?? "").trim().toLowerCase() === "rent" ? "rent" : "sale";
}

function hasRecordedValue(value: unknown) {
  return value !== undefined && value !== null && value !== "" && (!Array.isArray(value) || value.length > 0);
}

function hasRecordedFieldValue(field: PropertyFieldDefinition, value: unknown) {
  if (field.kind === "boolean") {
    return value === true
      || value === false
      || String(value).toLowerCase() === "true"
      || String(value).toLowerCase() === "false";
  }
  return hasRecordedValue(value);
}

function localizedFieldValue(field: PropertyFieldDefinition, value: unknown, propertyType: PropertyType, lang: string) {
  if (!hasRecordedFieldValue(field, value)) return null;
  if (field.kind === "boolean") {
    const enabled = value === true || String(value).toLowerCase() === "true";
    return `${t(field.labelKey, lang)} ${t(enabled ? "common.yes" : "common.no", lang)}`;
  }

  const options = field.kind === "subtype" ? subtypeOptions(propertyType) : field.options ?? [];
  if (field.kind === "multiselect") {
    const selected = Array.isArray(value)
      ? value.map(String)
      : String(value).split(",").map((item) => item.trim()).filter(Boolean);
    const labels = selected.map((entry) => {
      const option = options.find((item) => item.value === entry);
      return option ? t(option.labelKey, lang) : entry.replace(/_/g, " ");
    });
    return labels.slice(0, 2).join(", ");
  }

  const raw = String(value);
  const option = options.find((item) => item.value === raw);
  return option ? t(option.labelKey, lang) : raw.replace(/_/g, " ");
}

function advancedSectionSummary(
  fields: PropertyFieldDefinition[],
  values: Record<string, unknown> | undefined,
  propertyType: PropertyType,
  lang: string,
) {
  const fragments = fields.flatMap((field) => {
    const display = localizedFieldValue(field, values?.[field.key], propertyType, lang);
    if (!display) return [];
    if (field.kind === "boolean") return [display];
    return [`${t(field.labelKey, lang)} ${display}`];
  });
  return fragments.slice(0, 2).join(" · ");
}

function stringValue(value: unknown) {
  if (value == null || Array.isArray(value) || typeof value === "object") return "";
  return String(value);
}

const plainNumberContext: NumericInputContext = { kind: "plain" };

function optionalNumber(value: string, context: NumericInputContext = plainNumberContext): number | null {
  return parseNumericExpression(value, context)?.value ?? null;
}

function numericContextForField(
  section: PropertySpecSection,
  field: PropertyFieldDefinition,
  environment: EditorNumericEnvironment,
): NumericInputContext {
  if (section === "areas") {
    if (field.key === "plot_width" || field.key === "plot_length") {
      return { kind: "length", targetUnit: environment.distanceUnit, units: environment.units };
    }
    return {
      kind: "area",
      targetUnit: field.key === "land_area" ? environment.lotUnit : environment.areaUnit,
      units: environment.units,
    };
  }
  if (section === "technical" && field.key === "ceiling_height") {
    return { kind: "length", targetUnit: environment.distanceUnit, units: environment.units };
  }
  if (section === "pricing_extra") {
    if (field.kind === "decimal") return { kind: "money", targetUnit: environment.currency, units: environment.units };
  }
  return plainNumberContext;
}

function numberMeetsConstraints(
  value: string,
  context: NumericInputContext,
  options: { integer?: boolean; min?: number; max?: number; step?: number } = {},
) {
  if (!value.trim()) return true;
  const parsed = optionalNumber(value, context);
  if (parsed == null) return false;
  if (options.integer && !Number.isInteger(parsed)) return false;
  if (options.min != null && parsed < options.min) return false;
  if (options.max != null && parsed > options.max) return false;
  if (options.step != null) {
    const origin = options.min ?? 0;
    const steps = (parsed - origin) / options.step;
    if (Math.abs(steps - Math.round(steps)) > 0.000001) return false;
  }
  return true;
}

function editorNumbersValid(values: EditorValues, specs: SpecsValues, environment: EditorNumericEnvironment) {
  if (!numberMeetsConstraints(values.price, { kind: "money", targetUnit: environment.currency, units: environment.units })) return false;
  if (!numberMeetsConstraints(values.area, { kind: "area", targetUnit: environment.areaUnit, units: environment.units })) return false;
  if (!numberMeetsConstraints(values.lotSize, { kind: "area", targetUnit: environment.lotUnit, units: environment.units })) return false;
  if (!numberMeetsConstraints(values.bedrooms, plainNumberContext, { integer: true, min: 0, max: 20, step: 1 })) return false;
  if (!numberMeetsConstraints(values.bathrooms, plainNumberContext, { integer: true, min: 0, max: 10, step: 1 })) return false;
  if (!numberMeetsConstraints(values.yearBuilt, plainNumberContext, { integer: true, min: 1850, max: new Date().getFullYear() })) return false;

  const propertyType = normalizedPropertyType(specs.taxonomy?.property_type);
  const offerType = normalizedOfferType(specs.taxonomy?.offer_type);
  return advancedPropertySections(propertyType, offerType).every((section) => (
    section.fields.every((field) => {
      if (field.kind !== "number" && field.kind !== "decimal") return true;
      const value = specs[section.key]?.[field.key];
      if (!hasRecordedValue(value)) return true;
      return numberMeetsConstraints(
        String(value),
        numericContextForField(section.key, field, environment),
        {
          integer: field.kind === "number",
          min: field.min,
          max: field.max,
          step: field.kind === "number" ? 1 : undefined,
        },
      );
    })
  ));
}

function normalizedSpecsNumbers(
  specs: SpecsValues,
  environment: EditorNumericEnvironment,
): SpecsValues {
  const propertyType = normalizedPropertyType(specs.taxonomy?.property_type);
  const offerType = normalizedOfferType(specs.taxonomy?.offer_type);
  const normalized: SpecsValues = Object.fromEntries(
    Object.entries(specs).map(([section, values]) => [section, { ...values }]),
  );

  for (const section of advancedPropertySections(propertyType, offerType)) {
    const nextSection = normalized[section.key] ?? {};
    for (const field of section.fields) {
      if (field.kind !== "number" && field.kind !== "decimal") continue;
      const raw = stringValue(nextSection[field.key]);
      if (!raw) continue;
      const parsed = optionalNumber(raw, numericContextForField(section.key, field, environment));
      if (parsed != null) nextSection[field.key] = field.kind === "number" ? Math.round(parsed) : parsed;
    }
    normalized[section.key] = nextSection;
  }
  return normalized;
}

const fieldClass = "editor-control-capsule h-12 rounded-full border !bg-card/90 px-4 text-[16px] focus-visible:ring-2 focus-visible:ring-ring/20 focus-visible:ring-offset-0 sm:h-11 sm:text-[14px]";

function Field({ id, label, children }: { id: string; label: React.ReactNode; children: React.ReactNode }) {
  return <div className="space-y-1.5"><Label htmlFor={id} className="text-[13px] font-medium text-foreground/70">{label}</Label>{children}</div>;
}

function UnitPicker({
  value,
  units,
  category,
  label,
  onChange,
  showCode = false,
}: {
  value: string;
  units: readonly UnitLookup[];
  category: "AREA" | "CURRENCY";
  label: string;
  onChange: (code: string) => void;
  showCode?: boolean;
}) {
  const options = unitsForCategory(units, category);
  const selected = findUnit(options, value, category);
  if (options.length === 0) return null;

  return (
    <Select value={selected?.code ?? ""} onValueChange={onChange}>
      <SelectTrigger
        aria-label={label}
        className={cn(
          "pen-touch-target !h-full !min-h-0 shrink-0 rounded-full border-border/65 bg-surface-subtle px-3 text-[12px] font-semibold shadow-none hover:bg-secondary focus:ring-2",
          category === "CURRENCY"
            ? "!w-[5.25rem] !min-w-[5.25rem]"
            : "!w-[4.625rem] !min-w-[4.625rem]",
        )}
      >
        <span className="tabular-nums">
          {selected ? (showCode ? selected.code : selected.symbol) : "—"}
        </span>
      </SelectTrigger>
      <SelectContent align="end" className="min-w-[15rem]">
        {options.map((unit) => (
          <SelectItem key={unit.id} value={unit.code}>
            <span className="flex w-full items-center justify-between gap-4">
              <span>{unit.name}</span>
              <span className="font-semibold tabular-nums text-muted-foreground">
                {showCode ? unit.code : unit.symbol}
              </span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function DirectValueField({
  id,
  label,
  labelText,
  value,
  onChange,
  lang,
  numeric = false,
  numericContext = plainNumberContext,
  integer = false,
  numericMin,
  numericMax,
  placeholder,
  required = false,
  selectOnFocus = false,
  maxLength,
  autoComplete,
  unitControl,
  className,
}: {
  id: string;
  label: React.ReactNode;
  labelText: string;
  value: string;
  onChange: (value: string) => void;
  lang: string;
  numeric?: boolean;
  numericContext?: NumericInputContext;
  integer?: boolean;
  numericMin?: number;
  numericMax?: number;
  placeholder?: string;
  required?: boolean;
  selectOnFocus?: boolean;
  maxLength?: number;
  autoComplete?: string;
  unitControl?: React.ReactNode;
  className?: string;
}) {
  const parsed = numeric ? parseNumericExpression(value, numericContext) : null;
  const invalid = numeric && Boolean(value.trim()) && (
    !parsed
    || (integer && !Number.isInteger(parsed.value))
    || (parsed != null && numericMin != null && parsed.value < numericMin)
    || (parsed != null && numericMax != null && parsed.value > numericMax)
  );
  const unitLabel = numeric ? numericUnitLabel(numericContext) : null;
  const showClear = Boolean(value) && !required;
  const showStaticUnit = Boolean(unitLabel) && !unitControl;
  const preview = parsed && (parsed.usedMath || parsed.usedUnit)
    ? `= ${formatEditableNumber(parsed.value, integer)}${unitLabel ? ` ${unitLabel}` : ""}`
    : null;
  const commitNumericValue = () => {
    if (!numeric || !value.trim()) return;
    const result = parseNumericExpression(value, numericContext);
    if (result != null && (!integer || Number.isInteger(result.value))) {
      onChange(formatEditableNumber(result.value, integer));
    }
  };

  return (
    <Field id={id} label={label}>
      <div className="relative">
        <Input
          id={id}
          value={value}
          required={required}
          inputMode={numeric ? "text" : undefined}
          autoComplete={autoComplete}
          maxLength={maxLength ?? (numeric ? 64 : undefined)}
          placeholder={placeholder}
          aria-invalid={invalid || undefined}
          onFocus={selectOnFocus || numeric ? (event) => event.currentTarget.select() : undefined}
          onBlur={commitNumericValue}
          onChange={(event) => {
            const next = numeric
              ? event.target.value.replace(/[\r\n]/g, "")
              : event.target.value;
            onChange(next);
          }}
          className={cn(
            fieldClass,
            unitControl && showClear ? "pr-[8.5rem]" : unitControl ? "pr-[5.5rem]" : showStaticUnit && showClear ? "pr-[8.5rem]" : showStaticUnit ? "pr-[5.5rem]" : showClear ? "pr-12" : undefined,
            invalid && "border-destructive/60 focus-visible:ring-destructive/20",
            className,
          )}
        />
        {unitControl || showStaticUnit || showClear ? (
          <span className="absolute inset-y-0 right-0 flex items-center">
            {unitControl}
            {showStaticUnit ? (
              <span className="pointer-events-none flex h-full min-h-0 w-[4.625rem] shrink-0 items-center justify-center rounded-full border border-border/65 bg-surface-subtle px-3 text-[12px] font-semibold tabular-nums text-foreground/65">
                {unitLabel}
              </span>
            ) : null}
            {showClear ? (
              <button
                type="button"
                onClick={() => onChange("")}
                className="pen-touch-target flex h-full w-12 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                aria-label={`${t("draft.editor.clearValue", lang)}: ${labelText}`}
              >
                <CloseIcon size={14} />
              </button>
            ) : null}
          </span>
        ) : null}
      </div>
      {preview ? <p className="px-1 text-right text-[11px] font-medium tabular-nums text-foreground/55" aria-live="polite">{preview}</p> : null}
    </Field>
  );
}

// Web translation of the iOS 40pt GlassIconTile: cool, opaque, and restrained.
function IconTile({ icon: Icon }: { icon: React.ComponentType<IconProps> }) {
  return (
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[0.9rem] border border-border/45 bg-surface-subtle text-foreground/70 shadow-control">
      <Icon size={17} />
    </span>
  );
}

function NumericStepper({
  id,
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  numericContext = plainNumberContext,
  optional = false,
  emptyDefault,
  lang,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  min: number;
  max: number;
  step?: number;
  numericContext?: NumericInputContext;
  optional?: boolean;
  emptyDefault?: number;
  lang: string;
}) {
  const parsed = parseNumericExpression(value, numericContext);
  const fallbackValue = Math.min(max, Math.max(min, emptyDefault ?? 0));
  const numericValue = parsed?.value ?? fallbackValue;
  const steps = (numericValue - min) / step;
  const invalid = Boolean(value.trim()) && (
    !parsed
    || numericValue < min
    || numericValue > max
    || Math.abs(steps - Math.round(steps)) > 0.000001
  );
  const unitLabel = numericUnitLabel(numericContext);
  const preview = parsed && (parsed.usedMath || parsed.usedUnit)
    ? `= ${formatEditableNumber(parsed.value)}${unitLabel ? ` ${unitLabel}` : ""}`
    : null;
  const adjust = (direction: -1 | 1) => {
    const next = Math.min(max, Math.max(min, numericValue + (direction * step)));
    onChange(Number.isInteger(next) ? String(next) : String(Number(next.toFixed(2))));
  };
  const startValue = () => {
    onChange(Number.isInteger(fallbackValue) ? String(fallbackValue) : String(Number(fallbackValue.toFixed(2))));
  };

  return (
    <Field id={id} label={label}>
      <div
        className={cn(
          "editor-control-capsule flex h-12 items-center rounded-full border sm:h-11",
          invalid ? "border-destructive/60" : "border-border/65",
        )}
      >
        {optional && !value.trim() ? (
          <button
            type="button"
            className="pen-touch-target flex h-full w-full min-w-0 items-center justify-between gap-2 rounded-full pl-4 text-left transition-colors hover:bg-foreground/[0.035] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            onClick={startValue}
            aria-label={`${t("draft.editor.addValue", lang)}: ${label}`}
          >
            <span className="min-w-0 flex-1 truncate text-[14px] text-muted-foreground">
              {t("draft.editor.noValue", lang)}
            </span>
            <span className="inline-flex h-full shrink-0 items-center gap-2 rounded-full bg-surface-subtle px-3 text-[12px] font-semibold text-foreground">
              <PlusIcon size={14} />
              {t("common.add", lang)}
            </span>
          </button>
        ) : (
          <div
            className={cn(
              "grid h-full w-full min-w-0 items-center",
              optional
                ? "grid-cols-[2.75rem_minmax(5.5rem,1fr)_2.75rem_2.75rem]"
                : "grid-cols-[2.75rem_minmax(4rem,1fr)_2.75rem]",
            )}
          >
            <button
              type="button"
              onClick={() => adjust(-1)}
              disabled={numericValue <= min}
              className="pen-touch-target flex h-full w-full items-center justify-center rounded-full bg-surface-subtle text-foreground/70 transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:text-muted-foreground disabled:opacity-45"
              aria-label={`${label}: −`}
            >
              <MinusIcon size={14} />
            </button>
            <div className="flex h-full min-w-0 items-center justify-center px-1">
              <input
                id={id}
                inputMode={min < 0 ? "text" : Number.isInteger(step) ? "numeric" : "decimal"}
                value={value}
                maxLength={64}
                aria-invalid={invalid || undefined}
                placeholder="—"
                onChange={(event) => onChange(event.target.value.replace(/[\r\n]/g, ""))}
                onFocus={(event) => event.currentTarget.select()}
                onBlur={() => {
                  if (!value.trim() || !parsed) return;
                  const clamped = Math.min(max, Math.max(min, parsed.value));
                  const snapped = min + (Math.round((clamped - min) / step) * step);
                  onChange(formatEditableNumber(snapped));
                }}
                className="h-full w-full min-w-0 flex-1 border-0 bg-transparent px-1 text-center text-[16px] font-semibold tabular-nums text-foreground outline-none"
              />
              {unitLabel ? <span className="shrink-0 pr-1 text-[10px] font-semibold text-foreground/50">{unitLabel}</span> : null}
            </div>
            <button
              type="button"
              onClick={() => adjust(1)}
              disabled={numericValue >= max}
              className="pen-touch-target flex h-full w-full items-center justify-center rounded-full bg-surface-subtle text-foreground/70 transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:text-muted-foreground disabled:opacity-45"
              aria-label={`${label}: +`}
            >
              <PlusIcon size={14} />
            </button>
            {optional ? (
              <button
                type="button"
                onClick={() => onChange("")}
                className="pen-touch-target flex h-full w-full items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                aria-label={`${t("draft.editor.clearValue", lang)}: ${label}`}
              >
                <CloseIcon size={14} />
              </button>
            ) : null}
          </div>
        )}
      </div>
      {preview ? <p className="px-1 text-right text-[11px] font-medium tabular-nums text-foreground/55" aria-live="polite">{preview}</p> : null}
    </Field>
  );
}

// Maps a spec section to the same icon the iOS app uses for it.
function sectionIcon(key: string): React.ComponentType<IconProps> {
  if (key.includes("layout")) return LayoutIcon;
  if (key.includes("area")) return RulerIcon;
  if (key.includes("pricing") || key.includes("price")) return PriceIcon;
  if (key.includes("legal")) return DocumentIcon;
  if (key.includes("technical")) return TechnicalIcon;
  if (key.includes("utilit")) return UtilitiesIcon;
  if (key.includes("feature")) return StarIcon;
  return InfoIcon;
}

// Grouped card, mirroring the iOS app's inset-grouped edit sections.
function Section({ title, icon: Icon, children }: { title: React.ReactNode; icon?: React.ComponentType<IconProps>; children: React.ReactNode }) {
  return (
    <section className="space-y-5 rounded-[1.75rem] border border-border/65 bg-card p-4 shadow-card sm:p-5">
      <div className="flex items-center gap-3">
        {Icon ? <IconTile icon={Icon} /> : null}
        <h3 className="text-[16px] font-semibold tracking-[-0.015em] text-foreground">{title}</h3>
      </div>
      {children}
    </section>
  );
}

function AdvancedField({
  section,
  field,
  value,
  propertyType,
  offerType,
  numericEnvironment,
  lang,
  onChange,
}: {
  section: PropertySpecSection;
  field: PropertyFieldDefinition;
  value: unknown;
  propertyType: PropertyType;
  offerType: OfferType;
  numericEnvironment: EditorNumericEnvironment;
  lang: string;
  onChange: (section: PropertySpecSection, key: string, value: unknown) => void;
}) {
  const id = `draft-spec-${section}-${field.key}`;
  const label = t(field.labelKey, lang);
  const options = (field.kind === "subtype" ? subtypeOptions(propertyType) : field.options ?? [])
    .filter((option) => !(section === "taxonomy" && field.key === "property_type" && offerType === "rent" && option.value === "land"));
  const numericContext = numericContextForField(section, field, numericEnvironment);

  if (field.kind === "boolean") {
    const recorded = hasRecordedFieldValue(field, value);
    const enabled = value === true || String(value).toLowerCase() === "true";
    return (
      <Field id={id} label={label}>
        <div
          id={id}
          className="editor-control-capsule grid h-12 grid-cols-3 rounded-full border sm:h-11"
          role="group"
          aria-label={label}
        >
          {([
            { key: "unset", label: t("draft.editor.noValue", lang), ariaLabel: t("common.notRecorded", lang), active: !recorded, value: undefined },
            { key: "yes", label: t("common.yes", lang), ariaLabel: t("common.yes", lang), active: recorded && enabled, value: true },
            { key: "no", label: t("common.no", lang), ariaLabel: t("common.no", lang), active: recorded && !enabled, value: false },
          ] as const).map((option) => (
            <button
              key={option.key}
              type="button"
              aria-label={`${label}: ${option.ariaLabel}`}
              aria-pressed={option.active}
              onClick={() => onChange(section, field.key, option.value)}
              className="pen-touch-target flex min-w-0 items-center justify-center px-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
            >
              <span
                className={cn(
                  "flex h-9 w-full min-w-0 items-center justify-center truncate rounded-full px-2 text-[11px] font-semibold transition-colors",
                  option.active ? "bg-foreground text-background shadow-sm" : "text-muted-foreground hover:bg-surface-subtle hover:text-foreground",
                )}
              >
                {option.label}
              </span>
            </button>
          ))}
        </div>
      </Field>
    );
  }

  if (field.kind === "multiselect") {
    const selected = Array.isArray(value)
      ? value.map(String)
      : typeof value === "string" ? value.split(",").map((item) => item.trim()).filter(Boolean) : [];
    return (
      <Field id={id} label={label}>
        <div id={id} className="editor-control-capsule flex flex-wrap gap-2 rounded-[1.35rem] border p-2">
          {options.map((item) => {
            const active = selected.includes(item.value);
            return (
              <button
                key={item.value}
                type="button"
                onClick={() => {
                  const next = active ? selected.filter((entry) => entry !== item.value) : [...selected, item.value];
                  onChange(section, field.key, next.length > 0 ? next : undefined);
                }}
                className={cn(
                  "pen-touch-target min-h-11 rounded-full border px-3.5 py-2 text-[12px] font-medium transition-colors",
                  active ? "border-foreground bg-foreground text-background" : "border-border/70 bg-surface text-foreground/65 hover:border-foreground/25 hover:text-foreground",
                )}
                aria-pressed={active}
              >
                {t(item.labelKey, lang)}
              </button>
            );
          })}
        </div>
      </Field>
    );
  }

  if (field.kind === "select" || field.kind === "subtype") {
    const currentValue = stringValue(value);
    const hasLegacyValue = Boolean(currentValue) && !options.some((item) => item.value === currentValue);
    return (
      <Field id={id} label={label}>
        <Select
          value={currentValue || "__not_recorded__"}
          onValueChange={(nextValue) => onChange(section, field.key, nextValue === "__not_recorded__" ? undefined : nextValue)}
        >
          <SelectTrigger id={id} className={`${fieldClass} w-full`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__not_recorded__">{t("common.notRecorded", lang)}</SelectItem>
            {hasLegacyValue ? <SelectItem value={currentValue}>{currentValue.replace(/_/g, " ")}</SelectItem> : null}
            {options.map((item) => <SelectItem key={item.value} value={item.value}>{t(item.labelKey, lang)}</SelectItem>)}
          </SelectContent>
        </Select>
      </Field>
    );
  }

  if (field.kind === "number") {
    const min = field.min ?? 0;
    const max = field.max ?? (field.key.includes("year") ? new Date().getFullYear() : 9999);
    const emptyDefault = field.key.includes("year")
      ? new Date().getFullYear()
      : Math.min(max, Math.max(min, 0));
    return (
      <NumericStepper
        id={id}
        label={label}
        value={stringValue(value)}
        onChange={(next) => onChange(section, field.key, next || undefined)}
        min={min}
        max={max}
        emptyDefault={emptyDefault}
        optional
        lang={lang}
        numericContext={numericContext}
      />
    );
  }

  return (
    <DirectValueField
      id={id}
      label={label}
      labelText={label}
      value={stringValue(value)}
      onChange={(next) => onChange(section, field.key, next || undefined)}
      lang={lang}
      numeric={field.kind === "decimal"}
      numericContext={numericContext}
      numericMin={field.min}
      numericMax={field.max}
      placeholder={field.kind === "decimal" ? t("common.notRecorded", lang) : undefined}
    />
  );
}

const AREA_SPEC_KEYS_USING_AREA_UNIT = new Set([
  "floor_area",
  "basement_area",
  "balcony_area",
  "loggia_area",
  "terrace_area",
  "garden_area",
  "front_garden_area",
  "built_up_area",
  "office_area",
  "warehouse_area",
]);

function convertedNumericText(
  raw: string,
  fromCode: string,
  toCode: string,
  units: readonly UnitLookup[],
) {
  if (!raw.trim() || fromCode === toCode) return raw;
  const from = findUnit(units, fromCode, "AREA");
  const to = findUnit(units, toCode, "AREA");
  if (!from || !to) return raw;
  const parsed = parseNumericExpression(raw, { kind: "area", targetUnit: from.code, units });
  if (!parsed) return raw;
  const converted = convertUnitValue(parsed.value, from, to);
  return converted == null ? raw : formatEditableNumber(converted);
}

function descriptionMetrics(value: string) {
  const trimmed = value.trim();
  return {
    characters: Array.from(trimmed).length,
    words: trimmed ? trimmed.split(/\s+/u).length : 0,
  };
}

export function DraftEditor({
  open,
  onOpenChange,
  draft,
  units,
  lang,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draft: DraftDetailItem;
  units: readonly UnitLookup[];
  lang: string;
  onSaved: (draft: DraftDetailItem) => void;
}) {
  const [values, setValues] = React.useState<EditorValues>(() => valuesFromDraft(draft, units));
  const [baseline, setBaseline] = React.useState<EditorValues>(() => valuesFromDraft(draft, units));
  const [specs, setSpecs] = React.useState<SpecsValues>(() => specsFromDraft(draft));
  const [baselineSpecs, setBaselineSpecs] = React.useState<SpecsValues>(() => specsFromDraft(draft));
  const [unitValues, setUnitValues] = React.useState<EditorUnitValues>(() => unitValuesFromDraft(draft, units));
  const [baselineUnitValues, setBaselineUnitValues] = React.useState<EditorUnitValues>(() => unitValuesFromDraft(draft, units));
  const [mode, setMode] = React.useState<EditorMode>("basic");
  const [mobilePanel, setMobilePanel] = React.useState<MobileEditorPanel>("basics");
  const [advancedQuery, setAdvancedQuery] = React.useState("");
  const [expandedSections, setExpandedSections] = React.useState<Set<PropertySpecSection>>(() => new Set(["taxonomy"]));
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = React.useState(false);
  const [editorFieldFocused, setEditorFieldFocused] = React.useState(false);
  const [descriptionEditorOpen, setDescriptionEditorOpen] = React.useState(false);
  const [descriptionDraft, setDescriptionDraft] = React.useState(values.description);
  const [confirmDescriptionDiscard, setConfirmDescriptionDiscard] = React.useState(false);
  const editorScrollRef = React.useRef<HTMLDivElement>(null);
  const editorFormRef = React.useRef<HTMLFormElement>(null);
  const descriptionTextareaRef = React.useRef<HTMLTextAreaElement>(null);
  const currency = values.currency.trim().toUpperCase();
  const distanceUnit = baseUnitForCategory(units, "DISTANCE")?.code ?? "";
  const numericEnvironment = React.useMemo<EditorNumericEnvironment>(() => ({
    units,
    areaUnit: unitValues.area,
    lotUnit: unitValues.lot,
    distanceUnit,
    currency,
  }), [currency, distanceUnit, unitValues.area, unitValues.lot, units]);

  React.useEffect(() => {
    if (!open) return;
    const next = valuesFromDraft(draft, units);
    const nextSpecs = specsFromDraft(draft);
    const nextUnits = unitValuesFromDraft(draft, units);
    setValues(next);
    setBaseline(next);
    setSpecs(nextSpecs);
    setBaselineSpecs(nextSpecs);
    setUnitValues(nextUnits);
    setBaselineUnitValues(nextUnits);
    setMode("basic");
    setMobilePanel("basics");
    setAdvancedQuery("");
    setExpandedSections(new Set(["taxonomy"]));
    setError(null);
    setConfirmDiscard(false);
    setEditorFieldFocused(false);
    setDescriptionDraft(next.description);
    setDescriptionEditorOpen(false);
    setConfirmDescriptionDiscard(false);
  }, [draft, open, units]);

  const dirty = JSON.stringify(values) !== JSON.stringify(baseline)
    || JSON.stringify(specs) !== JSON.stringify(baselineSpecs)
    || JSON.stringify(unitValues) !== JSON.stringify(baselineUnitValues);
  const numbersValid = editorNumbersValid(values, specs, numericEnvironment);
  const set = (key: keyof EditorValues) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setValues((current) => ({ ...current, [key]: event.target.value }));
    setError(null);
    setConfirmDiscard(false);
  };
  const setValue = React.useCallback((key: keyof EditorValues, value: string) => {
    setValues((current) => ({ ...current, [key]: value }));
    setError(null);
    setConfirmDiscard(false);
  }, []);

  const showMobilePanel = (panel: MobileEditorPanel) => {
    setMobilePanel(panel);
    editorScrollRef.current?.scrollTo({ top: 0, behavior: "auto" });
  };

  const refreshEditorFieldFocus = () => {
    const active = document.activeElement;
    setEditorFieldFocused(Boolean(
      active
      && editorFormRef.current?.contains(active)
      && (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement),
    ));
  };

  const openDescriptionEditor = () => {
    setDescriptionDraft(values.description);
    setConfirmDescriptionDiscard(false);
    setDescriptionEditorOpen(true);
  };

  const requestDescriptionEditorOpenChange = (next: boolean) => {
    if (next) {
      openDescriptionEditor();
      return;
    }
    if (descriptionDraft !== values.description) {
      descriptionTextareaRef.current?.blur();
      setConfirmDescriptionDiscard(true);
      return;
    }
    setDescriptionEditorOpen(false);
  };

  const applyDescriptionDraft = () => {
    setValue("description", descriptionDraft);
    setConfirmDescriptionDiscard(false);
    setDescriptionEditorOpen(false);
  };

  const discardDescriptionDraft = () => {
    setDescriptionDraft(values.description);
    setConfirmDescriptionDiscard(false);
    setDescriptionEditorOpen(false);
  };

  const formatDescriptionSelection = (marker: "*" | "**") => {
    const textarea = descriptionTextareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart ?? descriptionDraft.length;
    const end = textarea.selectionEnd ?? start;
    const selected = descriptionDraft.slice(start, end);
    const next = `${descriptionDraft.slice(0, start)}${marker}${selected}${marker}${descriptionDraft.slice(end)}`;
    const nextStart = start + marker.length;
    const nextEnd = selected ? end + marker.length : nextStart;
    setDescriptionDraft(next);
    window.requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(nextStart, nextEnd);
    });
  };

  const setSpecValue = React.useCallback((section: PropertySpecSection, key: string, value: unknown) => {
    setSpecs((current) => {
      const nextSection = { ...(current[section] ?? {}) };
      if (value === undefined || value === null || value === "") delete nextSection[key];
      else nextSection[key] = value;

      if (section === "taxonomy" && key === "property_type") delete nextSection.property_subtype;
      if (section === "taxonomy" && key === "offer_type" && value === "rent" && nextSection.property_type === "land") {
        delete nextSection.property_type;
        delete nextSection.property_subtype;
      }
      return { ...current, [section]: nextSection };
    });
    setError(null);
    setConfirmDiscard(false);
  }, []);

  const changeAreaUnit = React.useCallback((nextCode: string) => {
    const previousCode = unitValues.area;
    setValues((current) => ({
      ...current,
      area: convertedNumericText(current.area, previousCode, nextCode, units),
    }));
    setSpecs((current) => {
      const currentAreas = current.areas ?? {};
      const nextAreas = { ...currentAreas };
      for (const key of AREA_SPEC_KEYS_USING_AREA_UNIT) {
        const raw = stringValue(currentAreas[key]);
        if (raw) nextAreas[key] = convertedNumericText(raw, previousCode, nextCode, units);
      }
      return { ...current, areas: nextAreas };
    });
    setUnitValues((current) => ({ ...current, area: nextCode }));
    setError(null);
    setConfirmDiscard(false);
  }, [unitValues.area, units]);

  const changeLotUnit = React.useCallback((nextCode: string) => {
    const previousCode = unitValues.lot;
    setValues((current) => ({
      ...current,
      lotSize: convertedNumericText(current.lotSize, previousCode, nextCode, units),
    }));
    setSpecs((current) => {
      const currentAreas = current.areas ?? {};
      const raw = stringValue(currentAreas.land_area);
      return {
        ...current,
        areas: {
          ...currentAreas,
          ...(raw ? { land_area: convertedNumericText(raw, previousCode, nextCode, units) } : {}),
        },
      };
    });
    setUnitValues((current) => ({ ...current, lot: nextCode }));
    setError(null);
    setConfirmDiscard(false);
  }, [unitValues.lot, units]);

  const requestOpenChange = (next: boolean) => {
    if (!next && dirty && !saving) {
      setConfirmDiscard(true);
      return;
    }
    onOpenChange(next);
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!values.title.trim() || !numbersValid || saving) return;
    setSaving(true);
    setError(null);
    try {
      const normalizedSpecs = normalizedSpecsNumbers(specs, numericEnvironment);
      const currentLayout = normalizedSpecs.layout ?? {};
      const currentAreas = normalizedSpecs.areas ?? {};
      const currentTechnical = normalizedSpecs.technical ?? {};
      const nextArea = optionalNumber(values.area, { kind: "area", targetUnit: numericEnvironment.areaUnit, units });
      const nextLotSize = optionalNumber(values.lotSize, { kind: "area", targetUnit: numericEnvironment.lotUnit, units });
      const nextYearBuilt = optionalNumber(values.yearBuilt);
      const nextSpecs: SpecsValues = {
        ...normalizedSpecs,
        layout: {
          ...currentLayout,
          bedrooms: optionalNumber(values.bedrooms),
          bathrooms: optionalNumber(values.bathrooms),
        },
        areas: {
          ...currentAreas,
          floor_area: nextArea,
          land_area: nextLotSize,
        },
        technical: {
          ...currentTechnical,
          year_built: nextYearBuilt,
        },
      };
      const areaUnit = findUnit(units, numericEnvironment.areaUnit, "AREA");
      const lotUnit = findUnit(units, numericEnvironment.lotUnit, "AREA");
      const payload: DraftUpdatePayload = {
        title: values.title.trim(),
        description: values.description.trim(),
        price: optionalNumber(values.price, { kind: "money", targetUnit: currency, units }),
        currency,
        area: nextArea,
        lot_size: nextLotSize,
        year_built: nextYearBuilt,
        address: values.address.trim(),
        city: values.city.trim(),
        state: values.state.trim(),
        country: values.country.trim(),
        postal_code: values.postalCode.trim(),
        bedrooms: optionalNumber(values.bedrooms),
        bathrooms: optionalNumber(values.bathrooms),
        specs: nextSpecs,
      };
      if (areaUnit) payload.area_unit = areaUnit.id;
      if (lotUnit) payload.lot_size_unit = lotUnit.id;
      const updated = await updateDraft(draft.id, payload);
      onSaved(updated);
      onOpenChange(false);
    } catch (reason) {
      setError(getSafeApiErrorMessage(reason, lang));
    } finally {
      setSaving(false);
    }
  };

  const propertyType = normalizedPropertyType(specs.taxonomy?.property_type);
  const offerType = normalizedOfferType(specs.taxonomy?.offer_type);
  const query = advancedQuery.trim().toLocaleLowerCase(lang);
  const advancedSections = advancedPropertySections(propertyType, offerType)
    .map((section) => {
      const allFields = section.fields;
      return {
        ...section,
        allFields,
        fields: query
          ? allFields.filter((field) => t(field.labelKey, lang).toLocaleLowerCase(lang).includes(query) || field.key.includes(query))
          : allFields,
      };
    })
    .filter((section) => section.fields.length > 0);
  const hasAreaUnits = unitsForCategory(units, "AREA").length > 0;
  const hasCurrencyUnits = unitsForCategory(units, "CURRENCY").length > 0;
  const currentDescriptionMetrics = descriptionMetrics(values.description);
  const draftDescriptionMetrics = descriptionMetrics(descriptionDraft);

  return (
    <>
    <SidePanel
      open={open}
      onOpenChange={requestOpenChange}
      title={t("draft.editor.title", lang)}
      description={draft.title}
      lang={lang}
      headerMode="editor"
      contentRef={editorScrollRef}
      headerAction={!confirmDiscard ? (
        <Button
          type="submit"
          form="draft-editor-form"
          size="xs"
          className="h-11 min-w-[4.75rem] px-3 sm:h-9"
          loading={saving}
          disabled={!dirty || !values.title.trim() || !numbersValid}
          aria-label={t("draft.editor.save", lang)}
        >
          {t("shareDialog.save", lang)}
        </Button>
      ) : undefined}
      footer={confirmDiscard ? (
        <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center sm:gap-3">
          <p className="col-span-2 min-w-0 text-[11px] leading-relaxed text-foreground/60 sm:flex-1">{t("draft.editor.discardPrompt", lang)}</p>
          <Button type="button" variant="ghost" size="sm" className="w-full sm:w-auto" onClick={() => setConfirmDiscard(false)}>{t("shares.cancel", lang)}</Button>
          <Button type="button" variant="destructive" size="sm" className="w-full sm:w-auto" onClick={() => onOpenChange(false)}>{t("draft.editor.discard", lang)}</Button>
        </div>
      ) : undefined}
      className="sm:max-w-[640px]"
    >
      <form
        ref={editorFormRef}
        id="draft-editor-form"
        onSubmit={save}
        onFocusCapture={(event) => {
          if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
            setEditorFieldFocused(true);
          }
        }}
        onBlurCapture={() => window.requestAnimationFrame(refreshEditorFieldFocus)}
        className="space-y-6"
      >
        <div className={cn(
          "space-y-2.5",
          editorFieldFocused && "hidden sm:block",
        )}>
          <SegmentedControl
            value={mode}
            onChange={setMode}
            ariaLabel={t("draft.editor.title", lang)}
            className="grid w-full grid-cols-2"
            itemClassName="w-full text-[14px] font-semibold"
            options={[
              { value: "basic", label: t("draft.editor.modeBasic", lang) },
              { value: "advanced", label: t("draft.editor.modeAdvanced", lang) },
            ]}
          />
          {mode === "basic" ? (
            <SegmentedControl
              value={mobilePanel}
              onChange={showMobilePanel}
              ariaLabel={t("draft.editor.sections", lang)}
              className="grid w-full grid-cols-3 sm:hidden"
              itemClassName="w-full gap-1.5 px-2 text-[11px] font-semibold"
              options={[
                { value: "basics", label: <span className="truncate">{t("draft.editor.panelBasics", lang)}</span>, icon: <InfoIcon size={13} /> },
                { value: "property", label: <span className="truncate">{t("draft.editor.panelProperty", lang)}</span>, icon: <LayoutIcon size={13} /> },
                { value: "location", label: <span className="truncate">{t("draft.editor.panelLocation", lang)}</span>, icon: <MapPinIcon size={13} /> },
              ]}
            />
          ) : null}
        </div>

        {mode === "basic" ? (
          <>
            <div className={cn(mobilePanel !== "basics" && "hidden sm:block")}>
              <Section title={t("draft.editor.basics", lang)} icon={InfoIcon}>
              <DirectValueField
                id="draft-title"
                label={t("shareDialog.field.title", lang)}
                labelText={t("shareDialog.field.title", lang)}
                value={values.title}
                onChange={(value) => setValue("title", value)}
                lang={lang}
                required
                maxLength={255}
              />
              <div className="sm:hidden">
                <Field id="draft-description-mobile" label={t("shareDialog.field.description", lang)}>
                  <button
                    id="draft-description-mobile"
                    type="button"
                    onClick={openDescriptionEditor}
                    className="group w-full rounded-2xl border border-border/65 bg-card px-4 py-4 text-left shadow-control transition-[border-color,box-shadow] hover:border-foreground/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20"
                  >
                    <span className={cn(
                      "block whitespace-pre-wrap text-[16px] leading-7",
                      values.description ? "line-clamp-4 text-foreground" : "text-muted-foreground",
                    )}>
                      {values.description || t("draft.editor.descriptionPlaceholder", lang)}
                    </span>
                    <span className="mt-4 flex items-center justify-between gap-2 border-t border-border/45 pt-3">
                      <span className="inline-flex min-w-0 items-center gap-1.5 whitespace-nowrap text-[12px] font-semibold text-foreground/70 group-hover:text-foreground">
                        <EditIcon size={14} />
                        {t("draft.editor.editDescription", lang)}
                      </span>
                      {currentDescriptionMetrics.characters > 0 ? (
                        <span className="shrink-0 text-[11px] font-medium tabular-nums text-muted-foreground">
                          {t("draft.editor.descriptionChars", lang).replace("{count}", String(currentDescriptionMetrics.characters))}
                          <span className="hidden min-[360px]:inline">
                            <span className="px-1.5 text-foreground/25">·</span>
                            {t("draft.editor.descriptionWords", lang).replace("{count}", String(currentDescriptionMetrics.words))}
                          </span>
                        </span>
                      ) : null}
                    </span>
                  </button>
                </Field>
              </div>
              <div className="hidden sm:block">
                <Field id="draft-description" label={t("shareDialog.field.description", lang)}>
                  <textarea id="draft-description" value={values.description} onChange={set("description")} rows={7} className="w-full resize-y rounded-xl border border-border/65 bg-card px-4 py-3 text-[14px] leading-relaxed shadow-control outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground focus:border-foreground/30 focus:ring-2 focus:ring-ring/20" />
                </Field>
              </div>
              </Section>
            </div>

            <div className={cn(mobilePanel !== "property" && "hidden sm:block")}>
              <Section title={t("draft.editor.property", lang)} icon={LayoutIcon}>
              <div className="space-y-3">
                {!hasAreaUnits || !hasCurrencyUnits ? (
                  <p className="rounded-2xl border border-border/55 bg-surface-subtle px-3.5 py-3 text-[11px] leading-relaxed text-muted-foreground">
                    {t("draft.editor.unitsUnavailable", lang)}
                  </p>
                ) : null}
                <DirectValueField
                  id="draft-price"
                  label={t("shareDialog.field.price", lang)}
                  labelText={t("shareDialog.field.price", lang)}
                  value={values.price}
                  onChange={(value) => setValue("price", value)}
                  lang={lang}
                  numeric
                  numericContext={{ kind: "money", targetUnit: currency, units }}
                  unitControl={hasCurrencyUnits ? (
                    <UnitPicker
                      value={currency}
                      units={units}
                      category="CURRENCY"
                      label={t("shareDialog.field.currency", lang)}
                      onChange={(value) => setValue("currency", value)}
                      showCode
                    />
                  ) : undefined}
                />
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <DirectValueField
                    id="draft-area"
                    label={t("draft.area", lang)}
                    labelText={t("draft.area", lang)}
                    value={values.area}
                    onChange={(value) => setValue("area", value)}
                    lang={lang}
                    placeholder={t("common.notRecorded", lang)}
                    numeric
                    numericContext={{ kind: "area", targetUnit: numericEnvironment.areaUnit, units }}
                    unitControl={hasAreaUnits ? (
                      <UnitPicker
                        value={numericEnvironment.areaUnit}
                        units={units}
                        category="AREA"
                        label={t("shareDialog.field.area_unit", lang)}
                        onChange={changeAreaUnit}
                      />
                    ) : undefined}
                  />
                  <DirectValueField
                    id="draft-lot-size"
                    label={t("draft.lotSize", lang)}
                    labelText={t("draft.lotSize", lang)}
                    value={values.lotSize}
                    onChange={(value) => setValue("lotSize", value)}
                    lang={lang}
                    placeholder={t("common.notRecorded", lang)}
                    numeric
                    numericContext={{ kind: "area", targetUnit: numericEnvironment.lotUnit, units }}
                    unitControl={hasAreaUnits ? (
                      <UnitPicker
                        value={numericEnvironment.lotUnit}
                        units={units}
                        category="AREA"
                        label={t("shareDialog.field.lot_size_unit", lang)}
                        onChange={changeLotUnit}
                      />
                    ) : undefined}
                  />
                </div>
                <div className="grid grid-cols-1 gap-3 min-[720px]:grid-cols-3">
                  <NumericStepper
                    id="draft-year-built"
                    label={t("draft.yearBuilt", lang)}
                    value={values.yearBuilt}
                    onChange={(value) => setValue("yearBuilt", value)}
                    min={1850}
                    max={new Date().getFullYear()}
                    emptyDefault={new Date().getFullYear()}
                    optional
                    lang={lang}
                  />
                  <NumericStepper id="draft-bedrooms" label={t("draft.bedrooms", lang)} value={values.bedrooms} onChange={(value) => setValue("bedrooms", value)} min={0} max={20} lang={lang} />
                  <NumericStepper id="draft-bathrooms" label={t("draft.bathrooms", lang)} value={values.bathrooms} onChange={(value) => setValue("bathrooms", value)} min={0} max={10} lang={lang} />
                </div>
              </div>
              </Section>
            </div>

            <div className={cn(mobilePanel !== "location" && "hidden sm:block")}>
              <Section title={t("draft.location", lang)} icon={MapPinIcon}>
              <DirectValueField id="draft-address" label={<span className="inline-flex flex-wrap items-center gap-1.5">{t("settings.seller.address", lang)} <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[10px] font-semibold text-muted-foreground"><LockIcon size={10} />{t("draft.editor.private", lang)}</span></span>} labelText={t("settings.seller.address", lang)} value={values.address} onChange={(value) => setValue("address", value)} lang={lang} autoComplete="street-address" />
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <DirectValueField id="draft-city" label={t("settings.seller.city", lang)} labelText={t("settings.seller.city", lang)} value={values.city} onChange={(value) => setValue("city", value)} lang={lang} autoComplete="address-level2" />
                <DirectValueField id="draft-state" label={t("settings.seller.state", lang)} labelText={t("settings.seller.state", lang)} value={values.state} onChange={(value) => setValue("state", value)} lang={lang} autoComplete="address-level1" />
                <DirectValueField id="draft-country" label={t("settings.seller.country", lang)} labelText={t("settings.seller.country", lang)} value={values.country} onChange={(value) => setValue("country", value)} lang={lang} autoComplete="country-name" />
                <DirectValueField id="draft-postal-code" label={t("settings.seller.postalCode", lang)} labelText={t("settings.seller.postalCode", lang)} value={values.postalCode} onChange={(value) => setValue("postalCode", value)} lang={lang} autoComplete="postal-code" />
              </div>
              </Section>
            </div>
          </>
        ) : (
          <div className="space-y-4">
            <p className="rounded-2xl bg-surface-subtle px-4 py-3 text-[11px] leading-relaxed text-muted-foreground">{t("draft.editor.advancedHint", lang)}</p>
            <SearchField
              value={advancedQuery}
              onChange={setAdvancedQuery}
              placeholder={t("draft.editor.searchAttributes", lang)}
              clearLabel={t("dashboard.clearSearch", lang)}
            />

            {advancedSections.length > 0 ? advancedSections.map((section) => {
              const expanded = Boolean(query) || expandedSections.has(section.key);
              const recorded = section.allFields.filter((field) => hasRecordedFieldValue(field, specs[section.key]?.[field.key])).length;
              const summary = advancedSectionSummary(section.allFields, specs[section.key], propertyType, lang);
              return (
                <section key={section.key} className="overflow-hidden rounded-[1.75rem] border border-border/65 bg-card shadow-card">
                  <button
                    type="button"
                    onClick={() => setExpandedSections((current) => {
                      const next = new Set(current);
                      if (next.has(section.key)) next.delete(section.key);
                      else next.add(section.key);
                      return next;
                    })}
                    className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left transition-colors hover:bg-foreground/[0.025] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-5 sm:py-4"
                    aria-expanded={expanded}
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <IconTile icon={sectionIcon(section.key)} />
                      <span className="min-w-0">
                        <span className="block truncate text-[15px] font-semibold tracking-[-0.01em]">{t(section.labelKey, lang)}</span>
                        <span className="mt-1 block truncate text-[11px] font-medium text-muted-foreground">
                          {summary || t("common.notRecorded", lang)}
                        </span>
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className={cn("rounded-full border px-2.5 py-1.5 text-[10px] font-semibold tabular-nums", recorded > 0 ? "border-foreground/15 bg-foreground/[0.055] text-foreground/70" : "border-border/60 bg-surface-subtle text-muted-foreground")}>
                        {recorded}/{section.allFields.length}
                      </span>
                      <ChevronDownIcon size={14} className={cn("transition-transform", expanded && "rotate-180")} />
                    </span>
                  </button>
                  {expanded ? (
                    <div className="grid items-start gap-x-4 gap-y-4 border-t border-border/45 bg-surface-subtle/35 px-4 py-4 sm:grid-cols-2 sm:px-5 sm:py-5">
                      {section.fields.map((field) => (
                        <div key={field.key} className={cn(field.kind === "multiselect" && "sm:col-span-2")}>
                          <AdvancedField
                            section={section.key}
                            field={field}
                            value={specs[section.key]?.[field.key]}
                            propertyType={propertyType}
                            offerType={offerType}
                            numericEnvironment={numericEnvironment}
                            lang={lang}
                            onChange={setSpecValue}
                          />
                        </div>
                      ))}
                    </div>
                  ) : null}
                </section>
              );
            }) : (
              <p className="rounded-[1.75rem] border border-dashed border-border/60 px-4 py-10 text-center text-[12px] text-muted-foreground">{t("draft.editor.emptyAdvanced", lang)}</p>
            )}
          </div>
        )}

        {error ? <p role="alert" className="rounded-xl border border-destructive/20 bg-destructive/[0.045] px-3 py-2.5 text-[12px] text-destructive">{error}</p> : null}
      </form>
    </SidePanel>
    <SidePanel
      open={descriptionEditorOpen}
      onOpenChange={requestDescriptionEditorOpenChange}
      title={t("shareDialog.field.description", lang)}
      description={[
        t("draft.editor.descriptionChars", lang).replace("{count}", String(draftDescriptionMetrics.characters)),
        t("draft.editor.descriptionWords", lang).replace("{count}", String(draftDescriptionMetrics.words)),
      ].join(" · ")}
      lang={lang}
      headerMode="editor"
      closeIcon="back"
      initialFocusRef={descriptionTextareaRef}
      headerAction={!confirmDescriptionDiscard ? (
        <Button
          type="button"
          size="xs"
          className="h-11 min-w-[4.75rem] px-3 sm:h-9"
          onClick={applyDescriptionDraft}
        >
          {t("draft.editor.descriptionDone", lang)}
        </Button>
      ) : undefined}
      footer={confirmDescriptionDiscard ? (
        <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center sm:gap-3">
          <p className="col-span-2 min-w-0 text-[11px] leading-relaxed text-foreground/60 sm:flex-1">{t("draft.editor.discardPrompt", lang)}</p>
          <Button type="button" variant="ghost" size="sm" className="w-full sm:w-auto" onClick={() => setConfirmDescriptionDiscard(false)}>{t("common.cancel", lang)}</Button>
          <Button type="button" variant="destructive" size="sm" className="w-full sm:w-auto" onClick={discardDescriptionDraft}>{t("draft.editor.discard", lang)}</Button>
        </div>
      ) : undefined}
      className="border-0 sm:hidden"
      contentClassName="flex flex-col overflow-hidden bg-card p-0 sm:p-0"
    >
      <div className="relative min-h-0 flex-1 bg-card">
        {!descriptionDraft ? (
          <div className="pointer-events-none absolute inset-x-5 top-5 z-10">
            <p className="text-[17px] font-medium text-foreground/35">{t("draft.editor.descriptionPlaceholder", lang)}</p>
            <p className="mt-2 text-[14px] leading-relaxed text-foreground/25">{t("draft.editor.descriptionHint", lang)}</p>
          </div>
        ) : null}
        <textarea
          ref={descriptionTextareaRef}
          value={descriptionDraft}
          onChange={(event) => {
            setDescriptionDraft(event.target.value);
            setConfirmDescriptionDiscard(false);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              applyDescriptionDraft();
            }
          }}
          autoCapitalize="sentences"
          autoCorrect="on"
          spellCheck
          aria-label={t("shareDialog.field.description", lang)}
          className="absolute inset-0 h-full w-full resize-none overflow-y-auto bg-transparent px-5 py-5 text-[17px] leading-7 text-foreground outline-none scrollbar-thin"
        />
      </div>
      <div className="flex shrink-0 items-center gap-1 border-t border-border/45 bg-card px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2">
        <button
          type="button"
          onClick={() => formatDescriptionSelection("**")}
          aria-label={t("draft.editor.descriptionBold", lang)}
          title={t("draft.editor.descriptionBold", lang)}
          className="flex h-11 min-w-11 items-center justify-center rounded-full px-3 text-[16px] font-bold text-foreground/70 transition-colors hover:bg-foreground/[0.055] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          B
        </button>
        <button
          type="button"
          onClick={() => formatDescriptionSelection("*")}
          aria-label={t("draft.editor.descriptionItalic", lang)}
          title={t("draft.editor.descriptionItalic", lang)}
          className="flex h-11 min-w-11 items-center justify-center rounded-full px-3 text-[16px] italic text-foreground/70 transition-colors hover:bg-foreground/[0.055] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          I
        </button>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => descriptionTextareaRef.current?.blur()}
          aria-label={t("draft.editor.hideKeyboard", lang)}
          title={t("draft.editor.hideKeyboard", lang)}
          className="flex h-11 w-11 items-center justify-center rounded-full text-foreground/70 transition-colors hover:bg-foreground/[0.055] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronDownIcon size={18} />
        </button>
      </div>
    </SidePanel>
    </>
  );
}

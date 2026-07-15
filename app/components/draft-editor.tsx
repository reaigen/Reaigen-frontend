"use client";

import * as React from "react";
import { Button } from "../lib/ui/button";
import { Input } from "../lib/ui/input";
import { Label } from "../lib/ui/label";
import { Switch } from "../lib/ui/switch";
import { getSafeApiErrorMessage } from "../lib/api/error-message";
import { updateDraft } from "../lib/api/client";
import { t } from "../lib/i18n";
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
import { LockIcon } from "./icons";
import { SearchField } from "./search-field";
import { SidePanel } from "./side-panel";

type EditorValues = {
  title: string;
  description: string;
  price: string;
  currency: string;
  area: string;
  bedrooms: string;
  bathrooms: string;
  yearBuilt: string;
  address: string;
  city: string;
  state: string;
  country: string;
  postalCode: string;
};

type SpecsValues = Record<string, Record<string, unknown>>;
type EditorMode = "basic" | "advanced";

function nestedValue(draft: DraftDetailItem, section: string, key: string) {
  const value = draft.specs?.[section];
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  return String((value as Record<string, unknown>)[key] ?? "");
}

function valuesFromDraft(draft: DraftDetailItem): EditorValues {
  return {
    title: draft.title ?? "",
    description: draft.description ?? "",
    price: draft.price == null ? "" : String(draft.price),
    currency: draft.currency || "EUR",
    area: draft.area == null ? "" : String(draft.area),
    bedrooms: nestedValue(draft, "layout", "bedrooms"),
    bathrooms: nestedValue(draft, "layout", "bathrooms"),
    yearBuilt: draft.year_built == null ? "" : String(draft.year_built),
    address: draft.address ?? "",
    city: draft.city ?? "",
    state: draft.state ?? "",
    country: draft.country ?? "",
    postalCode: draft.postal_code ?? "",
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

function stringValue(value: unknown) {
  if (value == null || Array.isArray(value) || typeof value === "object") return "";
  return String(value);
}

function optionalNumber(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

const fieldClass = "h-10 rounded-xl border-border/65 bg-surface px-3 text-[13px] focus-visible:ring-2 focus-visible:ring-foreground/[0.08]";

function Field({ id, label, children }: { id: string; label: React.ReactNode; children: React.ReactNode }) {
  return <div className="space-y-1.5"><Label htmlFor={id} className="text-[11px] font-semibold text-foreground/60">{label}</Label>{children}</div>;
}

function Section({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
  return <section className="space-y-4 border-b border-border/40 pb-6 last:border-0 last:pb-0"><h3 className="text-[12px] font-semibold text-foreground">{title}</h3>{children}</section>;
}

function AdvancedField({
  section,
  field,
  value,
  propertyType,
  lang,
  onChange,
}: {
  section: PropertySpecSection;
  field: PropertyFieldDefinition;
  value: unknown;
  propertyType: PropertyType;
  lang: string;
  onChange: (section: PropertySpecSection, key: string, value: unknown) => void;
}) {
  const id = `draft-spec-${section}-${field.key}`;
  const label = t(field.labelKey, lang);
  const options = field.kind === "subtype" ? subtypeOptions(propertyType) : field.options ?? [];

  if (field.kind === "boolean") {
    return (
      <div className="flex min-h-10 items-center justify-between gap-4 rounded-xl border border-border/50 bg-surface px-3 py-2.5">
        <Label htmlFor={id} className="text-[12px] font-medium text-foreground/75">{label}</Label>
        <Switch id={id} checked={value === true} onCheckedChange={(checked) => onChange(section, field.key, checked)} />
      </div>
    );
  }

  if (field.kind === "multiselect") {
    const selected = Array.isArray(value)
      ? value.map(String)
      : typeof value === "string" ? value.split(",").map((item) => item.trim()).filter(Boolean) : [];
    return (
      <div className="space-y-2">
        <Label className="text-[11px] font-semibold text-foreground/60">{label}</Label>
        <div className="flex flex-wrap gap-1.5">
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
                  "rounded-full border px-3 py-1.5 text-[11px] font-medium transition-colors",
                  active ? "border-foreground bg-foreground text-background" : "border-border/70 bg-surface text-foreground/65 hover:border-foreground/25 hover:text-foreground",
                )}
                aria-pressed={active}
              >
                {t(item.labelKey, lang)}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  if (field.kind === "select" || field.kind === "subtype") {
    const currentValue = stringValue(value);
    const hasLegacyValue = Boolean(currentValue) && !options.some((item) => item.value === currentValue);
    return (
      <Field id={id} label={label}>
        <select
          id={id}
          value={currentValue}
          onChange={(event) => onChange(section, field.key, event.target.value || undefined)}
          className={`${fieldClass} w-full cursor-pointer pr-8 outline-none`}
        >
          <option value="">{t("common.notRecorded", lang)}</option>
          {hasLegacyValue ? <option value={currentValue}>{currentValue.replace(/_/g, " ")}</option> : null}
          {options.map((item) => <option key={item.value} value={item.value}>{t(item.labelKey, lang)}</option>)}
        </select>
      </Field>
    );
  }

  return (
    <Field id={id} label={label}>
      <Input
        id={id}
        type={field.kind === "number" || field.kind === "decimal" ? "number" : "text"}
        inputMode={field.kind === "number" ? "numeric" : field.kind === "decimal" ? "decimal" : undefined}
        step={field.kind === "decimal" ? "any" : field.kind === "number" ? "1" : undefined}
        min={field.min}
        max={field.max}
        value={stringValue(value)}
        onChange={(event) => onChange(section, field.key, event.target.value || undefined)}
        className={fieldClass}
      />
    </Field>
  );
}

export function DraftEditor({
  open,
  onOpenChange,
  draft,
  lang,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draft: DraftDetailItem;
  lang: string;
  onSaved: (draft: DraftDetailItem) => void;
}) {
  const [values, setValues] = React.useState<EditorValues>(() => valuesFromDraft(draft));
  const [baseline, setBaseline] = React.useState<EditorValues>(() => valuesFromDraft(draft));
  const [specs, setSpecs] = React.useState<SpecsValues>(() => specsFromDraft(draft));
  const [baselineSpecs, setBaselineSpecs] = React.useState<SpecsValues>(() => specsFromDraft(draft));
  const [mode, setMode] = React.useState<EditorMode>("basic");
  const [advancedQuery, setAdvancedQuery] = React.useState("");
  const [expandedSections, setExpandedSections] = React.useState<Set<PropertySpecSection>>(() => new Set(["taxonomy"]));
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    const next = valuesFromDraft(draft);
    const nextSpecs = specsFromDraft(draft);
    setValues(next);
    setBaseline(next);
    setSpecs(nextSpecs);
    setBaselineSpecs(nextSpecs);
    setMode("basic");
    setAdvancedQuery("");
    setExpandedSections(new Set(["taxonomy"]));
    setError(null);
    setConfirmDiscard(false);
  }, [draft, open]);

  const dirty = JSON.stringify(values) !== JSON.stringify(baseline) || JSON.stringify(specs) !== JSON.stringify(baselineSpecs);
  const set = (key: keyof EditorValues) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setValues((current) => ({ ...current, [key]: event.target.value }));
    setError(null);
    setConfirmDiscard(false);
  };

  const setSpecValue = React.useCallback((section: PropertySpecSection, key: string, value: unknown) => {
    setSpecs((current) => {
      const nextSection = { ...(current[section] ?? {}) };
      if (value === undefined || value === null || value === "") delete nextSection[key];
      else nextSection[key] = value;

      if (section === "taxonomy" && key === "property_type") delete nextSection.property_subtype;
      return { ...current, [section]: nextSection };
    });
    setError(null);
    setConfirmDiscard(false);
  }, []);

  const requestOpenChange = (next: boolean) => {
    if (!next && dirty && !saving) {
      setConfirmDiscard(true);
      return;
    }
    onOpenChange(next);
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!values.title.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const currentLayout = specs.layout ?? {};
      const currentAreas = specs.areas ?? {};
      const currentTechnical = specs.technical ?? {};
      const nextArea = optionalNumber(values.area);
      const nextYearBuilt = optionalNumber(values.yearBuilt);
      const nextSpecs: SpecsValues = {
        ...specs,
        layout: {
          ...currentLayout,
          bedrooms: optionalNumber(values.bedrooms),
          bathrooms: optionalNumber(values.bathrooms),
        },
        areas: {
          ...currentAreas,
          floor_area: nextArea,
        },
        technical: {
          ...currentTechnical,
          year_built: nextYearBuilt,
        },
      };
      const updated = await updateDraft(draft.id, {
        title: values.title.trim(),
        description: values.description.trim(),
        price: optionalNumber(values.price),
        currency: values.currency.trim().toUpperCase() || "EUR",
        area: nextArea,
        lot_size: optionalNumber(stringValue(nextSpecs.areas.land_area ?? draft.lot_size)),
        year_built: nextYearBuilt,
        address: values.address.trim(),
        city: values.city.trim(),
        state: values.state.trim(),
        country: values.country.trim(),
        postal_code: values.postalCode.trim(),
        bedrooms: optionalNumber(values.bedrooms),
        bathrooms: optionalNumber(values.bathrooms),
        specs: nextSpecs,
      });
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
    .map((section) => ({
      ...section,
      fields: query
        ? section.fields.filter((field) => t(field.labelKey, lang).toLocaleLowerCase(lang).includes(query) || field.key.includes(query))
        : section.fields,
    }))
    .filter((section) => section.fields.length > 0);

  return (
    <SidePanel
      open={open}
      onOpenChange={requestOpenChange}
      title={t("draft.editor.title", lang)}
      description={draft.title}
      footer={confirmDiscard ? (
        <div className="flex items-center gap-3">
          <p className="min-w-0 flex-1 text-[11px] leading-relaxed text-foreground/60">{t("draft.editor.discardPrompt", lang)}</p>
          <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmDiscard(false)}>{t("shares.cancel", lang)}</Button>
          <Button type="button" variant="destructive" size="sm" onClick={() => onOpenChange(false)}>{t("draft.editor.discard", lang)}</Button>
        </div>
      ) : (
        <div className="flex items-center justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => requestOpenChange(false)}>{t("shares.cancel", lang)}</Button>
          <Button type="submit" form="draft-editor-form" size="sm" loading={saving} disabled={!dirty || !values.title.trim()}>{t("draft.editor.save", lang)}</Button>
        </div>
      )}
    >
      <form id="draft-editor-form" onSubmit={save} className="space-y-6">
        <div className="grid grid-cols-2 rounded-full bg-foreground/[0.055] p-1" role="tablist" aria-label={t("draft.editor.title", lang)}>
          {(["basic", "advanced"] as const).map((item) => (
            <button
              key={item}
              type="button"
              role="tab"
              aria-selected={mode === item}
              onClick={() => setMode(item)}
              className={cn(
                "h-8 rounded-full text-[11px] font-semibold transition-colors",
                mode === item ? "bg-surface text-foreground shadow-sm" : "text-foreground/50 hover:text-foreground",
              )}
            >
              {t(item === "basic" ? "draft.editor.modeBasic" : "draft.editor.modeAdvanced", lang)}
            </button>
          ))}
        </div>

        {mode === "basic" ? (
          <>
            <Section title={t("draft.editor.basics", lang)}>
              <Field id="draft-title" label={t("shareDialog.field.title", lang)}>
                <Input id="draft-title" autoFocus value={values.title} onChange={set("title")} maxLength={255} className={fieldClass} />
              </Field>
              <Field id="draft-description" label={t("shareDialog.field.description", lang)}>
                <textarea id="draft-description" value={values.description} onChange={set("description")} rows={7} className="w-full resize-y rounded-xl border border-border/65 bg-surface px-3 py-2.5 text-[13px] leading-relaxed outline-none transition focus:border-foreground/30 focus:ring-2 focus:ring-foreground/[0.08]" />
              </Field>
            </Section>

            <Section title={t("draft.editor.property", lang)}>
              <div className="grid grid-cols-2 gap-3">
                <Field id="draft-price" label={t("shareDialog.field.price", lang)}><Input id="draft-price" inputMode="decimal" value={values.price} onChange={set("price")} className={fieldClass} /></Field>
                <Field id="draft-currency" label={t("shareDialog.field.currency", lang)}><Input id="draft-currency" value={values.currency} onChange={set("currency")} maxLength={3} className={`${fieldClass} uppercase`} /></Field>
                <Field id="draft-area" label={t("draft.area", lang)}><Input id="draft-area" inputMode="decimal" value={values.area} onChange={set("area")} className={fieldClass} /></Field>
                <Field id="draft-year-built" label={t("draft.yearBuilt", lang)}><Input id="draft-year-built" inputMode="numeric" value={values.yearBuilt} onChange={set("yearBuilt")} className={fieldClass} /></Field>
                <Field id="draft-bedrooms" label={t("draft.bedrooms", lang)}><Input id="draft-bedrooms" inputMode="numeric" value={values.bedrooms} onChange={set("bedrooms")} className={fieldClass} /></Field>
                <Field id="draft-bathrooms" label={t("draft.bathrooms", lang)}><Input id="draft-bathrooms" inputMode="decimal" value={values.bathrooms} onChange={set("bathrooms")} className={fieldClass} /></Field>
              </div>
            </Section>

            <Section title={t("draft.location", lang)}>
              <Field id="draft-address" label={<span className="inline-flex items-center gap-1.5">{t("settings.seller.address", lang)} <LockIcon size={12} /> <span className="font-normal text-muted-foreground">{t("draft.editor.private", lang)}</span></span>}>
                <Input id="draft-address" autoComplete="street-address" value={values.address} onChange={set("address")} className={fieldClass} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field id="draft-city" label={t("settings.seller.city", lang)}><Input id="draft-city" value={values.city} onChange={set("city")} className={fieldClass} /></Field>
                <Field id="draft-state" label={t("settings.seller.state", lang)}><Input id="draft-state" value={values.state} onChange={set("state")} className={fieldClass} /></Field>
                <Field id="draft-country" label={t("settings.seller.country", lang)}><Input id="draft-country" value={values.country} onChange={set("country")} className={fieldClass} /></Field>
                <Field id="draft-postal-code" label={t("settings.seller.postalCode", lang)}><Input id="draft-postal-code" value={values.postalCode} onChange={set("postalCode")} className={fieldClass} /></Field>
              </div>
            </Section>
          </>
        ) : (
          <div className="space-y-4">
            <p className="text-[11px] leading-relaxed text-muted-foreground">{t("draft.editor.advancedHint", lang)}</p>
            <div className="border-b border-border/50 pb-2">
              <SearchField
                value={advancedQuery}
                onChange={setAdvancedQuery}
                placeholder={t("draft.editor.searchAttributes", lang)}
                clearLabel={t("dashboard.clearSearch", lang)}
              />
            </div>

            {advancedSections.length > 0 ? advancedSections.map((section) => {
              const expanded = Boolean(query) || expandedSections.has(section.key);
              const recorded = section.fields.filter((field) => hasRecordedValue(specs[section.key]?.[field.key])).length;
              return (
                <section key={section.key} className="overflow-hidden rounded-2xl border border-border/60 bg-surface">
                  <button
                    type="button"
                    onClick={() => setExpandedSections((current) => {
                      const next = new Set(current);
                      if (next.has(section.key)) next.delete(section.key);
                      else next.add(section.key);
                      return next;
                    })}
                    className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left"
                    aria-expanded={expanded}
                  >
                    <span className="text-[12px] font-semibold">{t(section.labelKey, lang)}</span>
                    <span className="flex items-center gap-2 text-[10px] font-medium tabular-nums text-muted-foreground">
                      {recorded} / {section.fields.length}
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className={cn("transition-transform", expanded && "rotate-180")} aria-hidden="true">
                        <path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </span>
                  </button>
                  {expanded ? (
                    <div className="space-y-4 border-t border-border/45 px-4 py-4">
                      {section.fields.map((field) => (
                        <AdvancedField
                          key={field.key}
                          section={section.key}
                          field={field}
                          value={specs[section.key]?.[field.key]}
                          propertyType={propertyType}
                          lang={lang}
                          onChange={setSpecValue}
                        />
                      ))}
                    </div>
                  ) : null}
                </section>
              );
            }) : (
              <p className="rounded-2xl border border-dashed border-border/70 px-4 py-10 text-center text-[12px] text-muted-foreground">{t("draft.editor.emptyAdvanced", lang)}</p>
            )}
          </div>
        )}

        {error ? <p role="alert" className="rounded-xl border border-destructive/20 bg-destructive/[0.045] px-3 py-2.5 text-[12px] text-destructive">{error}</p> : null}
      </form>
    </SidePanel>
  );
}

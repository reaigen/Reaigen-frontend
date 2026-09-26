"use client";

import { useEffect, useState } from "react";
import { DraftFilters, activeFilterCount } from "../lib/draft-filters";
import { cn } from "../lib/utils";

export type { DraftFilters } from "../lib/draft-filters";
export { activeFilterCount, draftFilterParams } from "../lib/draft-filters";

/**
 * Dashboard filters (operator, 2026-09-26: "also with filters"). Each chip
 * maps to a parameter the drafts list reads in the database
 * (reaigen/draft_search.py): property_type, offer_type, price_min/max and
 * missing. The words are kept here, per language, while the locale files are
 * being reworked in parallel.
 */
const TEXT = {
  en: { apartment: "Flats", house: "Houses", land: "Land", sale: "For sale", rent: "For rent", price: "Price", from: "from", to: "to", noPhotos: "No photos", noDescription: "No description", noPrice: "No price", noAddress: "No address", clear: "Clear filters", label: "Filters" },
  sk: { apartment: "Byty", house: "Domy", land: "Pozemky", sale: "Predaj", rent: "Prenájom", price: "Cena", from: "od", to: "do", noPhotos: "Bez fotiek", noDescription: "Bez popisu", noPrice: "Bez ceny", noAddress: "Bez adresy", clear: "Zrušiť filtre", label: "Filtre" },
  cs: { apartment: "Byty", house: "Domy", land: "Pozemky", sale: "Prodej", rent: "Pronájem", price: "Cena", from: "od", to: "do", noPhotos: "Bez fotek", noDescription: "Bez popisu", noPrice: "Bez ceny", noAddress: "Bez adresy", clear: "Zrušit filtry", label: "Filtry" },
  de: { apartment: "Wohnungen", house: "Häuser", land: "Grundstücke", sale: "Verkauf", rent: "Miete", price: "Preis", from: "von", to: "bis", noPhotos: "Ohne Fotos", noDescription: "Ohne Beschreibung", noPrice: "Ohne Preis", noAddress: "Ohne Adresse", clear: "Filter löschen", label: "Filter" },
} as const;

function textFor(lang: string) {
  const code = String(lang || "").slice(0, 2).toLowerCase();
  return TEXT[code as keyof typeof TEXT] ?? TEXT.en;
}

const chip = "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-[12px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const chipIdle = "border-border/70 bg-card text-foreground/70 hover:bg-surface-subtle hover:text-foreground";
const chipOn = "border-foreground bg-foreground text-background";

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} className={cn(chip, on ? chipOn : chipIdle)}>
      {children}
    </button>
  );
}

export function DraftFilterBar({
  value,
  onChange,
  lang,
  className,
}: {
  value: DraftFilters;
  onChange: (next: DraftFilters) => void;
  lang: string;
  className?: string;
}) {
  const text = textFor(lang);
  const [priceOpen, setPriceOpen] = useState(Boolean(value.price_min || value.price_max));
  const [priceMin, setPriceMin] = useState(value.price_min ?? "");
  const [priceMax, setPriceMax] = useState(value.price_max ?? "");

  // Typing a price applies it after a pause, not on every key.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if ((value.price_min ?? "") === priceMin && (value.price_max ?? "") === priceMax) return;
      onChange({ ...value, price_min: priceMin || undefined, price_max: priceMax || undefined });
    }, 450);
    return () => window.clearTimeout(timer);
  }, [onChange, priceMax, priceMin, value]);

  const toggle = <K extends "property_type" | "offer_type">(key: K, option: NonNullable<DraftFilters[K]>) => {
    onChange({ ...value, [key]: value[key] === option ? undefined : option });
  };
  const toggleMissing = (field: NonNullable<DraftFilters["missing"]>[number]) => {
    const current = new Set(value.missing ?? []);
    if (current.has(field)) current.delete(field);
    else current.add(field);
    onChange({ ...value, missing: current.size ? Array.from(current) : undefined });
  };
  const clearAll = () => {
    setPriceMin("");
    setPriceMax("");
    setPriceOpen(false);
    onChange({});
  };
  const priceInput = "h-9 w-28 rounded-full border border-border/70 bg-card px-3.5 text-[12px] font-semibold tabular-nums text-foreground placeholder:text-foreground/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <div role="group" aria-label={text.label} className={cn("-mx-1 flex items-center gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden", className)}>
      <Chip on={value.property_type === "apartment"} onClick={() => toggle("property_type", "apartment")}>{text.apartment}</Chip>
      <Chip on={value.property_type === "house"} onClick={() => toggle("property_type", "house")}>{text.house}</Chip>
      <Chip on={value.property_type === "land"} onClick={() => toggle("property_type", "land")}>{text.land}</Chip>
      <span aria-hidden="true" className="mx-0.5 h-5 w-px shrink-0 bg-border/80" />
      <Chip on={value.offer_type === "sale"} onClick={() => toggle("offer_type", "sale")}>{text.sale}</Chip>
      <Chip on={value.offer_type === "rent"} onClick={() => toggle("offer_type", "rent")}>{text.rent}</Chip>
      <span aria-hidden="true" className="mx-0.5 h-5 w-px shrink-0 bg-border/80" />
      <Chip on={priceOpen || Boolean(value.price_min || value.price_max)} onClick={() => setPriceOpen((open) => !open)}>{text.price}</Chip>
      {priceOpen ? (
        <>
          <input inputMode="numeric" aria-label={`${text.price} ${text.from}`} placeholder={text.from} value={priceMin} onChange={(event) => setPriceMin(event.target.value.replace(/[^\d\s]/g, ""))} className={priceInput} />
          <input inputMode="numeric" aria-label={`${text.price} ${text.to}`} placeholder={text.to} value={priceMax} onChange={(event) => setPriceMax(event.target.value.replace(/[^\d\s]/g, ""))} className={priceInput} />
        </>
      ) : null}
      <span aria-hidden="true" className="mx-0.5 h-5 w-px shrink-0 bg-border/80" />
      <Chip on={Boolean(value.missing?.includes("photos"))} onClick={() => toggleMissing("photos")}>{text.noPhotos}</Chip>
      <Chip on={Boolean(value.missing?.includes("description"))} onClick={() => toggleMissing("description")}>{text.noDescription}</Chip>
      <Chip on={Boolean(value.missing?.includes("price"))} onClick={() => toggleMissing("price")}>{text.noPrice}</Chip>
      <Chip on={Boolean(value.missing?.includes("address"))} onClick={() => toggleMissing("address")}>{text.noAddress}</Chip>
      {activeFilterCount(value) ? (
        <button type="button" onClick={clearAll} className="ml-1 h-9 shrink-0 rounded-full px-3 text-[12px] font-semibold text-foreground/60 underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {text.clear}
        </button>
      ) : null}
    </div>
  );
}

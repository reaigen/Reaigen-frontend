"use client";

import { useState } from "react";
import { t } from "../lib/i18n";
import type { SharedDraftData } from "../lib/tour-types";
import { resolveUnit, unitLabel, type UnitLookup } from "../lib/unit-catalog";
import { ChevronDownIcon, DocumentIcon, MapPinIcon } from "./icons";

function formatPrice(price: string | number | null | undefined, currency?: string): string {
  if (price == null || price === "") return "";
  const num = typeof price === "string" ? parseFloat(price) : price;
  if (Number.isNaN(num) || num === 0) return "";
  try {
    return new Intl.NumberFormat(undefined, {
      style: currency ? "currency" : "decimal",
      currency: currency || undefined,
      maximumFractionDigits: 0,
    }).format(num);
  } catch {
    return num.toLocaleString();
  }
}

/** Floating overlay panel for the 3D tour viewer — shows property info on top of the splat. */
export function SharedPropertyPanel({
  draftData,
  lang,
  units,
  open: controlledOpen,
  onOpenChange,
}: {
  draftData: SharedDraftData;
  lang: string;
  units: readonly UnitLookup[];
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = (next: boolean) => {
    if (controlledOpen == null) setInternalOpen(next);
    onOpenChange?.(next);
  };
  const currency = resolveUnit(units, draftData.currency, "CURRENCY");
  const areaUnit = resolveUnit(units, draftData.area_unit, "AREA");
  const areaLabel = unitLabel(areaUnit);

  const hasPrice = draftData.price != null && draftData.price !== "";
  const hasAddress = !!draftData.display_address || !!draftData.city;
  const hasFacts = draftData.bedrooms != null || draftData.bathrooms != null || (draftData.area != null && draftData.area !== "") || draftData.year_built != null;
  const hasDescription = !!draftData.description;
  const hasPhotos = (draftData.uploads?.length ?? 0) > 0;
  const hasFeatures = (draftData.data?.length ?? 0) > 0;
  const hasAnyContent = hasPrice || hasAddress || hasFacts || hasDescription || hasPhotos || hasFeatures;

  if (!hasAnyContent) return null;

  const addressText = draftData.display_address || [draftData.city, draftData.state, draftData.country].filter(Boolean).join(", ");
  const photos = (draftData.uploads ?? []).slice(0, 6);

  return (
    <div className="absolute left-3 top-[calc(3.75rem+env(safe-area-inset-top,0px))] z-20 animate-fade-in sm:bottom-4 sm:left-4 sm:top-auto" style={{ width: "min(calc(100% - 1.5rem), 360px)" }}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex min-h-11 items-center gap-1.5 rounded-full border border-white/10 bg-black/40 px-3 py-2.5 text-[11px] font-medium text-white/70 backdrop-blur-xl transition-colors hover:bg-black/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 sm:min-h-0 sm:py-1.5"
      >
        <DocumentIcon size={12} />
        {t("shared.propertyInfo", lang)}
        <ChevronDownIcon size={10} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="mt-1.5 bg-black/50 backdrop-blur-xl border border-white/10 rounded-xl max-h-[50dvh] overflow-y-auto p-3.5 space-y-3">
          {hasPrice && (
            <p className="text-[16px] font-semibold text-white">{formatPrice(draftData.price, currency?.code)}</p>
          )}

          {hasAddress && addressText && (
            <div className="flex items-start gap-1.5">
              <MapPinIcon size={12} className="mt-0.5 shrink-0 text-white/50" />
              <p className="text-[12px] text-white/60 leading-snug">{addressText}</p>
            </div>
          )}

          {hasFacts && (
            <div className="flex flex-wrap gap-1.5">
              {draftData.bedrooms != null && <span className="bg-white/[0.08] text-white/70 rounded-full px-2.5 py-0.5 text-[11px]">{draftData.bedrooms} {t("shared.bed", lang)}</span>}
              {draftData.bathrooms != null && <span className="bg-white/[0.08] text-white/70 rounded-full px-2.5 py-0.5 text-[11px]">{draftData.bathrooms} {t("shared.bath", lang)}</span>}
              {draftData.area != null && draftData.area !== "" && <span className="bg-white/[0.08] text-white/70 rounded-full px-2.5 py-0.5 text-[11px]">{draftData.area}{areaLabel ? ` ${areaLabel}` : ""}</span>}
              {draftData.year_built != null && <span className="bg-white/[0.08] text-white/70 rounded-full px-2.5 py-0.5 text-[11px]">{draftData.year_built}</span>}
            </div>
          )}

          {hasDescription && <p className="text-[12px] text-white/50 leading-relaxed line-clamp-4">{draftData.description}</p>}

          {hasPhotos && (
            <div>
              <p className="text-[11px] text-white/40 font-medium mb-1.5">{t("shared.photos", lang)}</p>
              <div className="flex gap-1.5 overflow-x-auto pb-1">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {photos.map((p, i) => <img key={i} src={p.url} alt={p.name || ""} className="w-16 h-16 rounded-lg object-cover shrink-0 border border-white/10" />)}
              </div>
            </div>
          )}

          {hasFeatures && (
            <div className="flex flex-wrap gap-1">
              {draftData.data!.map((d, i) => (
                <span key={i} className="bg-white/[0.06] text-white/50 rounded px-1.5 py-0.5 text-[11px]">{d.key}: {d.value}</span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

"use client";

import { useState } from "react";
import { t } from "../lib/i18n";
import type { SharedDraftData } from "../lib/tour-types";

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
export function SharedPropertyPanel({ draftData, lang }: { draftData: SharedDraftData; lang: string }) {
  const [open, setOpen] = useState(false);

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
    <div className="absolute left-3 bottom-3 z-20 sm:left-4 sm:bottom-4 animate-fade-in" style={{ width: "min(calc(100% - 1.5rem), 360px)" }}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 bg-black/40 backdrop-blur-xl text-white/70 rounded-full px-3 py-1.5 text-[11px] font-medium border border-white/10 hover:bg-black/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <svg aria-hidden="true" width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M2 4h12M2 8h12M2 12h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
        {t("shared.propertyInfo", lang)}
        <svg aria-hidden="true" width="10" height="10" viewBox="0 0 16 16" fill="none" className={`transition-transform ${open ? "rotate-180" : ""}`}>
          <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="mt-1.5 bg-black/50 backdrop-blur-xl border border-white/10 rounded-xl max-h-[50dvh] overflow-y-auto p-3.5 space-y-3">
          {hasPrice && (
            <p className="text-[16px] font-semibold text-white">{formatPrice(draftData.price, draftData.currency)}</p>
          )}

          {hasAddress && addressText && (
            <div className="flex items-start gap-1.5">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" className="text-white/50 mt-0.5 shrink-0">
                <path d="M8 1C5.24 1 3 3.24 3 6c0 3.75 5 9 5 9s5-5.25 5-9c0-2.76-2.24-5-5-5z" stroke="currentColor" strokeWidth="1.5" />
                <circle cx="8" cy="6" r="1.5" stroke="currentColor" strokeWidth="1.5" />
              </svg>
              <p className="text-[12px] text-white/60 leading-snug">{addressText}</p>
            </div>
          )}

          {hasFacts && (
            <div className="flex flex-wrap gap-1.5">
              {draftData.bedrooms != null && <span className="bg-white/[0.08] text-white/70 rounded-md px-2 py-0.5 text-[11px]">{draftData.bedrooms} {t("shared.bed", lang)}</span>}
              {draftData.bathrooms != null && <span className="bg-white/[0.08] text-white/70 rounded-md px-2 py-0.5 text-[11px]">{draftData.bathrooms} {t("shared.bath", lang)}</span>}
              {draftData.area != null && draftData.area !== "" && <span className="bg-white/[0.08] text-white/70 rounded-md px-2 py-0.5 text-[11px]">{draftData.area} {draftData.area_unit || "m²"}</span>}
              {draftData.year_built != null && <span className="bg-white/[0.08] text-white/70 rounded-md px-2 py-0.5 text-[11px]">{draftData.year_built}</span>}
            </div>
          )}

          {hasDescription && <p className="text-[12px] text-white/50 leading-relaxed line-clamp-4">{draftData.description}</p>}

          {hasPhotos && (
            <div>
              <p className="text-[10px] text-white/40 font-medium mb-1.5">{t("shared.photos", lang)}</p>
              <div className="flex gap-1.5 overflow-x-auto pb-1">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {photos.map((p, i) => <img key={i} src={p.url} alt={p.name || ""} className="w-16 h-16 rounded-lg object-cover shrink-0 border border-white/10" />)}
              </div>
            </div>
          )}

          {hasFeatures && (
            <div className="flex flex-wrap gap-1">
              {draftData.data!.map((d, i) => (
                <span key={i} className="bg-white/[0.06] text-white/50 rounded px-1.5 py-0.5 text-[10px]">{d.key}: {d.value}</span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

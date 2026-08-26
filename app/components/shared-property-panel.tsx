"use client";

import Image from "next/image";
import { useState } from "react";
import { t } from "../lib/i18n";
import type { SharedDraftData } from "../lib/tour-types";
import { resolveUnit, unitLabel, type UnitLookup } from "../lib/unit-catalog";
import { ChevronDownIcon, CloseIcon, DocumentIcon, MapPinIcon } from "./icons";
import { FormattedDescription } from "./formatted-description";
import { PropertyFactTile } from "./property-fact-tile";

function formatPrice(price: string | number | null | undefined, currency: string | undefined, lang: string): string {
  if (price == null || price === "") return "";
  const num = typeof price === "string" ? parseFloat(price) : price;
  if (Number.isNaN(num) || num === 0) return "";
  try {
    return new Intl.NumberFormat(lang, {
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
  const photos = (draftData.uploads ?? [])
    .filter((upload) => !upload.mime_type || upload.mime_type.startsWith("image/"))
    .slice(0, 6);
  const hasPhotos = photos.length > 0;
  const hasFeatures = (draftData.data?.length ?? 0) > 0;
  const hasTitle = !!draftData.title;
  const hasAnyContent = hasTitle || hasPrice || hasAddress || hasFacts || hasDescription || hasPhotos || hasFeatures;

  if (!hasAnyContent) return null;

  const addressText = draftData.display_address || [draftData.city, draftData.state, draftData.country].filter(Boolean).join(", ");
  const facts = [
    draftData.bedrooms != null
      ? { label: t("draft.bedrooms", lang), value: String(draftData.bedrooms) }
      : null,
    draftData.bathrooms != null
      ? { label: t("draft.bathrooms", lang), value: String(draftData.bathrooms) }
      : null,
    draftData.area != null && draftData.area !== ""
      ? { label: t("draft.area", lang), value: `${draftData.area}${areaLabel ? ` ${areaLabel}` : ""}` }
      : null,
    draftData.year_built != null
      ? { label: t("draft.yearBuilt", lang), value: String(draftData.year_built) }
      : null,
  ].filter((fact): fact is { label: string; value: string } => fact !== null);

  return (
    <div
      className="pointer-events-none absolute left-3 top-[calc(3.75rem+env(safe-area-inset-top,0px))] z-20 animate-fade-in sm:bottom-4 sm:left-4 sm:top-auto"
      style={{ width: "min(calc(100% - 1.5rem), 24rem)" }}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="floating-control pointer-events-auto flex items-center gap-1.5 border border-border/60 bg-card/90 px-3 text-[11px] font-semibold text-foreground/70 shadow-elevated backdrop-blur-2xl transition-colors hover:bg-card hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <DocumentIcon size={12} />
        {t("shared.propertyInfo", lang)}
        <ChevronDownIcon size={10} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <section
          aria-label={t("shared.propertyInfo", lang)}
          className="floating-panel pointer-events-auto mt-2 max-h-[min(64dvh,36rem)] overflow-y-auto border border-border/60 bg-card/[0.92] p-4 text-foreground shadow-elevated backdrop-blur-2xl scrollbar-thin"
        >
          <header className="mb-3 flex items-start justify-between gap-3 border-b border-border/45 pb-3">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                {t("shared.propertyInfo", lang)}
              </p>
              {hasTitle ? (
                <h2 className="mt-1 truncate text-[15px] font-semibold tracking-[-0.015em]">
                  {draftData.title}
                </h2>
              ) : null}
            </div>
            <button
              type="button"
              aria-label={t("common.close", lang)}
              onClick={() => setOpen(false)}
              className="floating-icon-button -mr-1 -mt-1 shrink-0 text-foreground/45 hover:bg-foreground/[0.055] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <CloseIcon size={14} />
            </button>
          </header>

          {hasPrice ? (
            <p className="text-[18px] font-semibold tabular-nums">
              {formatPrice(draftData.price, currency?.code, lang)}
            </p>
          ) : null}

          {hasAddress && addressText && (
            <div className="mt-2 flex items-start gap-2">
              <MapPinIcon size={13} className="mt-0.5 shrink-0 text-muted-foreground" />
              <p className="text-[12px] leading-relaxed text-foreground/65">{addressText}</p>
            </div>
          )}

          {facts.length > 0 && (
            <div className="mt-3 grid grid-cols-2 gap-2">
              {facts.map((fact) => (
                <PropertyFactTile key={fact.label} label={fact.label} value={fact.value} compact />
              ))}
            </div>
          )}

          {hasDescription && (
            <div className="mt-4 border-t border-border/40 pt-3">
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                {t("draft.description", lang)}
              </p>
              <FormattedDescription
                text={draftData.description!}
                className="line-clamp-5 text-[12px] leading-relaxed text-foreground/65"
              />
            </div>
          )}

          {hasPhotos && (
            <div className="mt-4 border-t border-border/40 pt-3">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{t("shared.photos", lang)}</p>
              <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin">
                {photos.map((photo, index) => (
                  <Image
                    key={`${photo.url}-${index}`}
                    src={photo.url}
                    alt={photo.name || ""}
                    width={80}
                    height={64}
                    unoptimized
                    className="h-16 w-20 shrink-0 rounded-xl border border-border/50 bg-muted/20 object-cover"
                  />
                ))}
              </div>
            </div>
          )}

          {hasFeatures && (
            <div className="mt-4 flex flex-wrap gap-1.5 border-t border-border/40 pt-3">
              {draftData.data!.map((detail, index) => (
                <span key={`${detail.key}-${index}`} className="rounded-full border border-border/50 bg-surface-subtle px-2.5 py-1 text-[10px] font-medium text-foreground/60">
                  {detail.key}: {detail.value}
                </span>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

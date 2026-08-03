"use client";

import { t } from "../../lib/i18n";
import type { DraftDetailItem, DraftUpload } from "../../lib/tour-types";
import { currentGalleryUploads } from "../../lib/media";
import { resolveUnit, unitLabel, type UnitLookup } from "../../lib/unit-catalog";
import { PropertyFactTile } from "../property-fact-tile";
import { MainTourIcon, PlayIcon } from "../icons";
import type { ContentScope } from "./content-scope-selector";

interface SharePreviewProps {
  draft: DraftDetailItem;
  scope: ContentScope;
  hasTour: boolean;
  hasFloorplan: boolean;
  thumbUrl: string | null;
  units: readonly UnitLookup[];
  lang: string;
}

function getImages(uploads: DraftUpload[]) {
  return currentGalleryUploads(uploads, "image").map((upload) => ({
    url: upload.file_url,
  }));
}

function formatPreviewPrice(value: string | number | null | undefined, currency: string | null | undefined, lang: string): string | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n === 0) return null;
  if (!currency) return n.toLocaleString(lang);
  try {
    return new Intl.NumberFormat(lang, { style: "currency", currency, maximumFractionDigits: 0 }).format(n);
  } catch {
    return n.toLocaleString(lang);
  }
}

export function SharePreview({ draft, scope, hasTour, hasFloorplan, thumbUrl, units, lang }: SharePreviewProps) {
  const images = getImages(draft.raw_uploads);
  // Preferred (converted) price prominently, original smaller if different currency —
  // same pattern as the draft detail page.
  const preferredCurrency = resolveUnit(units, draft.price_preferred_currency, "CURRENCY");
  const storedCurrency = resolveUnit(units, draft.currency, "CURRENCY");
  const prefPrice = formatPreviewPrice(draft.price_preferred, preferredCurrency?.code, lang);
  const origPrice = formatPreviewPrice(draft.price, storedCurrency?.code, lang);
  const price = prefPrice || origPrice;
  const showOrigPrice = prefPrice && origPrice && preferredCurrency?.id !== storedCurrency?.id;
  const address = draft.display_address || [draft.city, draft.state, draft.country].filter(Boolean).join(", ");

  const fields = scope.selectedFields;
  const showTitle = fields.has("title");
  const detailsIncluded = scope.details;
  const showAddress = detailsIncluded && fields.has("display_address") && !!address;
  const showPrice = detailsIncluded && fields.has("price") && !!price;
  const specItems: Array<{ label: string; value: string }> = [];
  if (detailsIncluded && fields.has("bedrooms") && draft.specs?.layout?.bedrooms != null) {
    specItems.push({ label: t("draft.bedrooms", lang), value: String(draft.specs.layout.bedrooms) });
  }
  if (detailsIncluded && fields.has("bathrooms") && draft.specs?.layout?.bathrooms != null) {
    specItems.push({ label: t("draft.bathrooms", lang), value: String(draft.specs.layout.bathrooms) });
  }
  if (detailsIncluded && fields.has("area") && draft.area != null) {
    const usesPreferredArea = draft.area_preferred != null;
    const areaUnit = usesPreferredArea
      ? resolveUnit(units, draft.area_preferred_unit, "AREA")
      : resolveUnit(units, draft.area_unit, "AREA")
        ?? resolveUnit(units, draft.area_unit_code, "AREA")
        ?? resolveUnit(units, draft.area_unit_display, "AREA");
    const label = unitLabel(areaUnit);
    specItems.push({
      label: t("draft.area", lang),
      value: `${draft.area_preferred ?? draft.area}${label ? ` ${label}` : ""}`,
    });
  }

  const tourIncluded = scope.tour && hasTour;
  const photosIncluded = scope.photos && images.length > 0;
  const floorplanIncluded = scope.floorplan && hasFloorplan;

  // Hero image: tour thumbnail or first photo
  const heroUrl = tourIncluded && thumbUrl ? thumbUrl : photosIncluded ? images[0]?.url : null;
  const hasHero = !!heroUrl;

  // Checklist
  const items: { label: string; on: boolean }[] = [];
  if (showTitle) items.push({ label: t("shareDialog.field.title", lang), on: true });
  if (showAddress) items.push({ label: t("shareDialog.field.display_address", lang), on: true });
  if (showPrice) items.push({ label: t("shareDialog.field.price", lang), on: true });
  if (specItems.length > 0) items.push({ label: t("sharing.previewSpecs", lang), on: true });
  if (fields.has("description") && draft.description) items.push({ label: t("shareDialog.field.description", lang), on: detailsIncluded });
  if (images.length > 0) items.push({ label: `${t("shareDialog.field.uploads", lang)} (${images.length})`, on: photosIncluded });
  if (hasTour) items.push({ label: t("sharing.scopeTour", lang), on: tourIncluded });
  if (hasFloorplan) items.push({ label: t("sharing.scopeFloorplan", lang), on: floorplanIncluded });
  const includedItems = items.filter((item) => item.on);

  return (
    <div>
      <p className="mb-2.5 px-0.5 text-[12px] font-semibold text-foreground/60">
        {t("sharing.previewTitle", lang)}
      </p>

      {/* Preview card */}
      <div className="floating-panel overflow-hidden">
        {/* Hero */}
        {hasHero && (
          <div className="relative aspect-[16/10] bg-muted/30">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={heroUrl} alt="" decoding="async" className="h-full w-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/5 to-black/15" aria-hidden="true" />
            {tourIncluded && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="floating-icon-button flex items-center justify-center border border-white/15 bg-black/65 text-white shadow-sm backdrop-blur-md">
                  <PlayIcon size={16} />
                </div>
              </div>
            )}
            {tourIncluded && (
              <div className="glass-chip floating-status absolute left-2.5 top-2.5 flex items-center gap-1 text-[10px]">
                <MainTourIcon size={11} />
                {t("sharing.scopeTour", lang)}
              </div>
            )}
            {(showTitle || showPrice) && (
              <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-4">
                {showTitle ? (
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-[15px] font-semibold leading-tight text-white">{draft.title || t("dashboard.untitled", lang)}</h3>
                    {showAddress ? <p className="mt-1 truncate text-[11px] text-white/70">{address}</p> : null}
                  </div>
                ) : <span />}
                {showPrice ? (
                  <p className="glass-chip floating-status shrink-0 flex items-center px-3 text-[12px] tabular-nums">
                    {price}
                    {showOrigPrice ? <span className="ml-1.5 text-[10px] font-normal text-black/50">{origPrice}</span> : null}
                  </p>
                ) : null}
              </div>
            )}
          </div>
        )}

        {/* Property info */}
        <div className="space-y-2 bg-card px-4 py-3.5 sm:px-5">
          {showTitle && !hasHero && (
            <div>
              <h3 className="text-[14px] font-semibold leading-tight">{draft.title || t("dashboard.untitled", lang)}</h3>
              {showAddress && (
                <p className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1">
                  <svg width="10" height="10" viewBox="0 0 16 16" fill="none" className="shrink-0"><path d="M8 1.5a4.5 4.5 0 0 1 4.5 4.5c0 3.5-4.5 8.5-4.5 8.5S3.5 9.5 3.5 6A4.5 4.5 0 0 1 8 1.5Z" stroke="currentColor" strokeWidth="1.2"/></svg>
                  {address}
                </p>
              )}
            </div>
          )}

          {detailsIncluded && showPrice && !hasHero && (
            <p className="text-[14px] font-semibold tabular-nums">
              {price}
              {showOrigPrice && (
                <span className="ml-2 text-[11px] font-normal text-muted-foreground tabular-nums">{origPrice}</span>
              )}
            </p>
          )}

          {detailsIncluded && specItems.length > 0 && (
            <div className="flex gap-1.5">
              {specItems.map((item) => (
                <PropertyFactTile key={item.label} label={item.label} value={item.value} compact />
              ))}
            </div>
          )}

          {/* Photo row */}
          {photosIncluded && images.length > 1 && (
            <div className="mt-1 hidden gap-px overflow-hidden rounded-2xl border border-border/45 bg-border/50 sm:flex">
              {images.slice(0, 5).map((img, index) => (
                <div key={img.url} className="aspect-square flex-1 overflow-hidden bg-muted/20">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img.url} alt={`${t("draft.media.photo", lang)} ${index + 1}`} loading="lazy" decoding="async" className="h-full w-full object-cover" />
                </div>
              ))}
              {images.length > 5 && (
                <div className="flex aspect-square flex-1 items-center justify-center bg-surface">
                  <span className="text-[11px] text-foreground/50 font-medium">+{images.length - 5}</span>
                </div>
              )}
            </div>
          )}

          {/* Floorplan indicator */}
          {floorplanIncluded && (
            <div className="flex items-center gap-1.5 text-[11px] text-foreground/50">
              <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-foreground/25"><rect x="2" y="2" width="20" height="20" rx="2"/><path d="M2 8h20M8 2v20M14 8v14"/></svg>
              {t("sharing.scopeFloorplan", lang)}
            </div>
          )}
        </div>

        {/* Show only what recipients will actually get; crossed-out rows add noise. */}
        {includedItems.length > 0 ? (
          <div className="border-t border-border/40 px-4 py-3 sm:px-5">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-foreground/45">
              {t("sharing.previewChecklist", lang)}
            </p>
            <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5 scrollbar-hide sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0">
              {includedItems.map((item) => (
                <span key={item.label} className="floating-capsule floating-status inline-flex shrink-0 items-center gap-1.5 border text-[10px] text-foreground/65">
                  <svg width="10" height="10" viewBox="0 0 16 16" fill="none" className="shrink-0"><path d="M3 8l4 4 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  {item.label}
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

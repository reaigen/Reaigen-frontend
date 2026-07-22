"use client";

import { t } from "../../lib/i18n";
import type { DraftDetailItem, DraftUpload } from "../../lib/tour-types";
import { PropertyFactTile } from "../property-fact-tile";
import type { ContentScope } from "./content-scope-selector";

interface SharePreviewProps {
  draft: DraftDetailItem;
  scope: ContentScope;
  hasTour: boolean;
  thumbUrl: string | null;
  fpUrl: string | null;
  lang: string;
}

function getImages(uploads: DraftUpload[]) {
  return (uploads ?? [])
    .filter((u) => u.mime_type?.startsWith("image") || u.asset_type === "photo" || u.asset_type === "processed_image")
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((u) => ({ url: u.file_url }));
}

function formatPreviewPrice(value: string | number | null | undefined, currency: string | null | undefined, lang: string): string | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n === 0) return null;
  try {
    return new Intl.NumberFormat(lang, { style: "currency", currency: currency || "EUR", maximumFractionDigits: 0 }).format(n);
  } catch {
    return `${n.toLocaleString(lang)}${currency ? ` ${currency}` : ""}`;
  }
}

export function SharePreview({ draft, scope, hasTour, thumbUrl, fpUrl, lang }: SharePreviewProps) {
  const images = getImages(draft.raw_uploads);
  // Preferred (converted) price prominently, original smaller if different currency —
  // same pattern as the draft detail page.
  const prefPrice = formatPreviewPrice(draft.price_preferred, draft.price_preferred_currency, lang);
  const origPrice = formatPreviewPrice(draft.price, draft.currency, lang);
  const price = prefPrice || origPrice;
  const showOrigPrice = prefPrice && origPrice && draft.price_preferred_currency !== draft.currency;
  const address = draft.display_address || [draft.city, draft.state, draft.country].filter(Boolean).join(", ");

  const fields = scope.selectedFields;
  const showTitle = fields.has("title");
  const showAddress = fields.has("display_address") && !!address;
  const showPrice = fields.has("price") && !!price;
  const specItems: Array<{ label: string; value: string }> = [];
  if (fields.has("bedrooms") && draft.specs?.layout?.bedrooms != null) {
    specItems.push({ label: t("draft.bedrooms", lang), value: String(draft.specs.layout.bedrooms) });
  }
  if (fields.has("bathrooms") && draft.specs?.layout?.bathrooms != null) {
    specItems.push({ label: t("draft.bathrooms", lang), value: String(draft.specs.layout.bathrooms) });
  }
  if (fields.has("area") && draft.area != null) {
    specItems.push({
      label: t("draft.area", lang),
      value: `${draft.area_preferred ?? draft.area}${draft.area_preferred_unit ?? draft.area_unit_display ? ` ${draft.area_preferred_unit ?? draft.area_unit_display}` : ""}`,
    });
  }

  const tourIncluded = scope.tour && hasTour;
  const photosIncluded = scope.photos && images.length > 0;
  const detailsIncluded = scope.details;
  const floorplanIncluded = scope.floorplan && !!fpUrl;

  // Hero image: tour thumbnail or first photo
  const heroUrl = tourIncluded && thumbUrl ? thumbUrl : photosIncluded ? images[0]?.url : null;
  const hasHero = !!heroUrl;

  // Checklist
  const items: { label: string; on: boolean }[] = [];
  if (showTitle) items.push({ label: t("shareDialog.field.title", lang), on: detailsIncluded });
  if (showAddress) items.push({ label: t("shareDialog.field.display_address", lang), on: detailsIncluded });
  if (showPrice) items.push({ label: t("shareDialog.field.price", lang), on: detailsIncluded });
  if (specItems.length > 0) items.push({ label: t("sharing.previewSpecs", lang), on: detailsIncluded });
  if (fields.has("description") && draft.description) items.push({ label: t("shareDialog.field.description", lang), on: detailsIncluded });
  if (images.length > 0) items.push({ label: `${t("shareDialog.field.uploads", lang)} (${images.length})`, on: photosIncluded });
  if (hasTour) items.push({ label: t("sharing.scopeTour", lang), on: tourIncluded });
  if (fpUrl) items.push({ label: t("sharing.scopeFloorplan", lang), on: floorplanIncluded });

  return (
    <div>
      {/* Preview card */}
      <div className="overflow-hidden rounded-xl border border-border/55 bg-surface shadow-card">
        {/* Card header */}
        <div className="px-4 py-3 border-b border-border/30">
          <p className="text-[12px] font-medium text-foreground/50">
            {t("sharing.previewTitle", lang)}
          </p>
        </div>

        {/* Hero */}
        {hasHero && (
          <div className="relative aspect-[16/10] bg-muted/30">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={heroUrl} alt="" className="w-full h-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/5 to-black/15" aria-hidden="true" />
            {tourIncluded && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-black/65 text-white shadow-sm backdrop-blur-md">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="10,8 16,12 10,16"/></svg>
                </div>
              </div>
            )}
            {tourIncluded && (
              <div className="glass-chip absolute left-2.5 top-2.5 flex h-7 items-center gap-1 rounded-full px-2.5 text-[10px] font-semibold">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
                3D
              </div>
            )}
            {detailsIncluded && (showTitle || showPrice) && (
              <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-4">
                {showTitle ? (
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-[15px] font-semibold leading-tight text-white">{draft.title || t("dashboard.untitled", lang)}</h3>
                    {showAddress ? <p className="mt-1 truncate text-[11px] text-white/70">{address}</p> : null}
                  </div>
                ) : <span />}
                {showPrice ? (
                  <p className="glass-chip shrink-0 rounded-full px-3 py-1.5 text-[12px] font-semibold tabular-nums">
                    {price}
                    {showOrigPrice ? <span className="ml-1.5 text-[10px] font-normal text-black/50">{origPrice}</span> : null}
                  </p>
                ) : null}
              </div>
            )}
          </div>
        )}

        {/* Property info */}
        <div className="px-4 py-3 space-y-2">
          {detailsIncluded && showTitle && !hasHero && (
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
            <div className="mt-1 flex gap-px overflow-hidden rounded-lg bg-border/50">
              {images.slice(0, 5).map((img, i) => (
                <div key={i} className="aspect-square flex-1 overflow-hidden bg-muted/20">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img.url} alt="" className="w-full h-full object-cover" />
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

        {/* Checklist — inside card with divider */}
        <div className="border-t border-border/40 px-4 py-3">
          <p className="text-[11px] font-medium text-foreground/50 uppercase tracking-wider mb-1.5">
            {t("sharing.previewChecklist", lang)}
          </p>
          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
            {items.map((item) => (
              <div key={item.label} className="flex items-center gap-1.5">
                {item.on ? (
                  <svg width="10" height="10" viewBox="0 0 16 16" fill="none" className="text-foreground/50 shrink-0"><path d="M3 8l4 4 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                ) : (
                  <svg width="10" height="10" viewBox="0 0 16 16" fill="none" className="text-foreground/15 shrink-0"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                )}
                <span className={`text-[11px] truncate ${item.on ? "text-foreground/60" : "text-foreground/20 line-through"}`}>
                  {item.label}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

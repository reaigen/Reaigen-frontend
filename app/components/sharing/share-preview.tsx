"use client";

import { t } from "../../lib/i18n";
import type { DraftDetailItem, DraftUpload } from "../../lib/tour-types";
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

function formatPreviewPrice(value: string | number | null | undefined, currency: string | null | undefined): string | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n === 0) return null;
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: currency || "EUR", maximumFractionDigits: 0 }).format(n);
  } catch {
    return `${n.toLocaleString()}${currency ? ` ${currency}` : ""}`;
  }
}

export function SharePreview({ draft, scope, hasTour, thumbUrl, fpUrl, lang }: SharePreviewProps) {
  const images = getImages(draft.raw_uploads);
  const price = formatPreviewPrice(draft.price_preferred ?? draft.price, draft.price_preferred_currency ?? draft.currency);
  const address = draft.display_address || [draft.city, draft.state, draft.country].filter(Boolean).join(", ");

  const fields = scope.selectedFields;
  const showTitle = fields.has("title");
  const showAddress = fields.has("display_address") && !!address;
  const showPrice = fields.has("price") && !!price;
  const showSpecs = (fields.has("bedrooms") || fields.has("bathrooms") || fields.has("area"));

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
  if (showSpecs) items.push({ label: t("sharing.previewSpecs", lang), on: detailsIncluded });
  if (fields.has("description") && draft.description) items.push({ label: t("shareDialog.field.description", lang), on: detailsIncluded });
  if (images.length > 0) items.push({ label: `${t("shareDialog.field.uploads", lang)} (${images.length})`, on: photosIncluded });
  if (hasTour) items.push({ label: t("sharing.scopeTour", lang), on: tourIncluded });
  if (fpUrl) items.push({ label: t("sharing.scopeFloorplan", lang), on: floorplanIncluded });

  return (
    <div className="space-y-3">
      <p className="text-[11px] font-medium text-foreground/35 uppercase tracking-wider">
        {t("sharing.previewTitle", lang)}
      </p>

      {/* Mock device card */}
      <div className="rounded-2xl border border-border/60 bg-background shadow-sm overflow-hidden">
        {/* Hero */}
        {hasHero && (
          <div className="relative aspect-[16/9] bg-muted/30">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={heroUrl} alt="" className="w-full h-full object-cover" />
            {tourIncluded && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/10">
                <div className="w-10 h-10 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="white"><polygon points="10,8 16,12 10,16"/></svg>
                </div>
              </div>
            )}
            {tourIncluded && (
              <div className="absolute top-2.5 left-2.5 flex items-center gap-1 rounded-full bg-black/50 backdrop-blur-sm px-2 py-0.5 text-[9px] font-medium text-white/80">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
                3D
              </div>
            )}
          </div>
        )}

        {/* Property info */}
        <div className="px-4 py-3 space-y-2">
          {detailsIncluded && showTitle && (
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

          {detailsIncluded && showPrice && (
            <p className="text-[14px] font-semibold">{price}</p>
          )}

          {detailsIncluded && showSpecs && (
            <div className="flex items-center gap-3 text-[11px] text-foreground/50">
              {fields.has("bedrooms") && draft.specs?.layout?.bedrooms != null && (
                <span className="flex items-center gap-1">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-foreground/30"><path d="M2 4v16"/><path d="M2 8h18a2 2 0 0 1 2 2v10"/><path d="M2 17h20"/><path d="M6 8v9"/></svg>
                  {draft.specs.layout.bedrooms}
                </span>
              )}
              {fields.has("bathrooms") && draft.specs?.layout?.bathrooms != null && (
                <span className="flex items-center gap-1">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-foreground/30"><path d="M4 12h16a1 1 0 0 1 1 1v3a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4v-3a1 1 0 0 1 1-1Z"/><path d="M6 12V5a2 2 0 0 1 2-2h3v2.25"/></svg>
                  {draft.specs.layout.bathrooms}
                </span>
              )}
              {fields.has("area") && draft.area != null && (
                <span>{draft.area_preferred ?? draft.area} {draft.area_preferred_unit ?? draft.area_unit_display}</span>
              )}
            </div>
          )}

          {/* Photo row */}
          {photosIncluded && images.length > 1 && (
            <div className="flex gap-1 pt-1">
              {images.slice(0, 5).map((img, i) => (
                <div key={i} className="flex-1 aspect-square rounded-md overflow-hidden bg-muted/20">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img.url} alt="" className="w-full h-full object-cover" />
                </div>
              ))}
              {images.length > 5 && (
                <div className="flex-1 aspect-square rounded-md bg-foreground/[0.03] flex items-center justify-center">
                  <span className="text-[10px] text-foreground/30 font-medium">+{images.length - 5}</span>
                </div>
              )}
            </div>
          )}

          {/* Floorplan indicator */}
          {floorplanIncluded && (
            <div className="flex items-center gap-1.5 text-[11px] text-foreground/40">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-foreground/25"><rect x="2" y="2" width="20" height="20" rx="2"/><path d="M2 8h20M8 2v20M14 8v14"/></svg>
              {t("sharing.scopeFloorplan", lang)}
            </div>
          )}
        </div>
      </div>

      {/* Checklist */}
      <div className="rounded-lg border border-border/40 px-3 py-2.5">
        <p className="text-[9px] font-medium text-foreground/25 uppercase tracking-wider mb-1.5">
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
  );
}

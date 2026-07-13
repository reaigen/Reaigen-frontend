"use client";

/**
 * Full-page property listing view for shared drafts.
 * Rendered when a shared link has no 3D tour — shows property details,
 * photos with lightbox, specs, and description in a clean branded layout.
 */

import { useState, useCallback } from "react";
import { t } from "../lib/i18n";
import type { SharedDraftData, RoomData } from "../lib/tour-types";

// ── Helpers ────────────────────────────────────────────────────────────

function formatPrice(price: string | number | null | undefined, currency?: string): string {
  if (price == null || price === "") return "";
  const num = typeof price === "string" ? parseFloat(price) : price;
  if (Number.isNaN(num) || num === 0) return "";
  try {
    return new Intl.NumberFormat(undefined, { style: currency ? "currency" : "decimal", currency: currency || undefined, maximumFractionDigits: 0 }).format(num);
  } catch {
    return num.toLocaleString();
  }
}

// ── Icons ──────────────────────────────────────────────────────────────

const I = {
  bed:  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-foreground/40"><path d="M2 4v16"/><path d="M2 8h18a2 2 0 0 1 2 2v10"/><path d="M2 17h20"/><path d="M6 8v9"/></svg>,
  bath: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-foreground/40"><path d="M4 12h16a1 1 0 0 1 1 1v3a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4v-3a1 1 0 0 1 1-1Z"/><path d="M6 12V5a2 2 0 0 1 2-2h3v2.25"/></svg>,
  area: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-foreground/40"><rect x="3" y="3" width="18" height="18" rx="1"/><path d="M3 9h18"/><path d="M9 3v18"/></svg>,
  year: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-foreground/40"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/></svg>,
  lot:  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-foreground/40"><path d="M2 22l5-5"/><path d="M7 22H2v-5"/><path d="M22 2l-5 5"/><path d="M17 2h5v5"/><rect x="6" y="6" width="12" height="12" rx="1"/></svg>,
  pin:  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" className="text-muted-foreground shrink-0"><path d="M8 1.5a4.5 4.5 0 0 1 4.5 4.5c0 3.5-4.5 8.5-4.5 8.5S3.5 9.5 3.5 6A4.5 4.5 0 0 1 8 1.5Z" stroke="currentColor" strokeWidth="1.2"/><circle cx="8" cy="6" r="1.5" stroke="currentColor" strokeWidth="1.2"/></svg>,
};

// ── Lightbox ───────────────────────────────────────────────────────────

/** Image that fades in when loaded */
function LightboxImage({ src, alt }: { src: string; alt: string }) {
  const [loaded, setLoaded] = useState(false);
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      className={`max-h-[85dvh] max-w-[92vw] object-contain rounded-lg shadow-2xl transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-0"}`}
      onClick={(e) => e.stopPropagation()}
      onLoad={() => setLoaded(true)}
    />
  );
}

function Lightbox({ photos, index, onClose, onNav }: {
  photos: { url: string; name?: string }[];
  index: number;
  onClose: () => void;
  onNav: (i: number) => void;
}) {
  const multi = photos.length > 1;
  return (
    <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center animate-fade-in" onClick={onClose}>
      <button className="absolute top-4 right-4 text-white/60 hover:text-white p-2 z-10" onClick={onClose}>
        <svg width="20" height="20" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
      </button>
      {multi && (
        <>
          <button className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white/70 transition-colors z-10" onClick={(e) => { e.stopPropagation(); onNav((index - 1 + photos.length) % photos.length); }}>
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none"><path d="M10 12L6 8l4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          <button className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white/70 transition-colors z-10" onClick={(e) => { e.stopPropagation(); onNav((index + 1) % photos.length); }}>
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none"><path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
        </>
      )}
      <LightboxImage src={photos[index].url} alt={photos[index].name || ""} />
      {multi && <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white/50 text-[12px] font-medium bg-black/40 px-3 py-1 rounded-full">{index + 1} / {photos.length}</div>}
    </div>
  );
}

// ── Shared floorplan (composite + room labels, no geometry/zoom) ──────

function SharedFloorplan({ floorplanUrl, rooms, lang }: { floorplanUrl: string; rooms: RoomData[]; lang: string }) {
  const allPoints = rooms.flatMap((r) => r.boundary_points ?? []);
  const hasRooms = allPoints.length > 0;

  if (!hasRooms) {
    return (
      <div className="rounded-xl overflow-hidden border border-border/50 bg-white">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={floorplanUrl} alt={t("tour.floorplan.alt", lang)} className="w-full" loading="lazy" />
      </div>
    );
  }

  const xs = allPoints.map((p) => p[0]);
  const zs = allPoints.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);
  const rangeX = maxX - minX || 1;
  const rangeZ = maxZ - minZ || 1;
  const svgW = 600;
  const svgH = svgW * (rangeZ / rangeX);
  const pad = 20;
  const toSvg = (x: number, z: number): [number, number] => [
    pad + ((x - minX) / rangeX) * (svgW - 2 * pad),
    pad + ((z - minZ) / rangeZ) * (svgH - 2 * pad),
  ];

  return (
    <div className="relative rounded-xl overflow-hidden border border-border/50 bg-white">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={floorplanUrl} alt={t("tour.floorplan.alt", lang)} className="w-full block" loading="lazy" />
      <svg viewBox={`0 0 ${svgW} ${svgH}`} className="absolute inset-0 w-full h-full" style={{ pointerEvents: "none" }}>
        {rooms.map((room) => {
          const pts = room.boundary_points;
          if (!pts?.length) return null;
          const svgPts = pts.map(([x, z]) => toSvg(x, z));
          const pointsStr = svgPts.map(([x, z]) => `${x},${z}`).join(" ");
          const cx = room.center_x != null ? toSvg(room.center_x, room.center_z!)[0] : svgPts.reduce((s, p) => s + p[0], 0) / svgPts.length;
          const cy = room.center_x != null ? toSvg(room.center_x, room.center_z!)[1] : svgPts.reduce((s, p) => s + p[1], 0) / svgPts.length;
          return (
            <g key={room.id}>
              <polygon
                points={pointsStr}
                fill="rgba(0,0,0,0.04)"
                stroke="rgba(0,0,0,0.2)"
                strokeWidth={1}
              />
              <text
                x={cx}
                y={cy}
                textAnchor="middle"
                dominantBaseline="central"
                fill="rgba(0,0,0,0.55)"
                fontSize={10}
                fontWeight={500}
                className="select-none"
              >
                {room.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ── Component ──────────────────────────────────────────────────────────

export function SharedDraftView({ draftData, lang, hasTour, onOpenTour, floorplanUrl, rooms }: {
  draftData: SharedDraftData;
  lang: string;
  hasTour?: boolean;
  onOpenTour?: () => void;
  floorplanUrl?: string | null;
  rooms?: RoomData[];
}) {
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);

  const price = formatPrice(draftData.price, draftData.currency);
  const addressText = draftData.display_address || [draftData.city, draftData.state, draftData.country].filter(Boolean).join(", ");
  const photos = draftData.uploads ?? [];

  const has = {
    title: !!draftData.title,
    address: !!addressText,
    price: !!price,
    facts: draftData.bedrooms != null || draftData.bathrooms != null || (draftData.area != null && draftData.area !== "") || draftData.year_built != null,
    description: !!draftData.description,
    photos: photos.length > 0,
  };
  const hasAny = has.title || has.address || has.price || has.facts || has.description || has.photos;

  return (
    <div className="min-h-screen bg-background">
      {/* Branded header */}
      <header className="border-b border-border/40 px-5 py-3.5 sm:px-8">
        <span className="text-[20px] text-foreground/80" style={{ fontFamily: "var(--font-brand), ui-serif, Georgia, serif", fontWeight: 400, letterSpacing: "0.02em" }}>
          Reaigen
        </span>
      </header>

      <main className="mx-auto max-w-2xl px-5 py-8 sm:px-8 animate-fade-in">
        {/* Empty state */}
        {!hasAny && (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="w-14 h-14 rounded-full bg-foreground/[0.04] flex items-center justify-center mb-5">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="text-foreground/20"><rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="1.5"/><circle cx="8.5" cy="8.5" r="1.5" fill="currentColor"/><path d="M21 15l-5-5L5 21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </div>
            <p className="text-[15px] font-medium text-foreground/50">{t("shared.propertyInfo", lang)}</p>
            <p className="text-[13px] text-muted-foreground mt-1.5 max-w-[240px]">{t("shared.error.loadFailed", lang)}</p>
          </div>
        )}

        {hasAny && (
          <div className="space-y-6">
            {/* Hero photo */}
            {has.photos && (
              <div className="relative aspect-[16/9] rounded-2xl overflow-hidden bg-muted/20 cursor-pointer group" onClick={() => setLightboxIdx(0)}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photos[0].url} alt={photos[0].name || ""} className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.02]" />
                {photos.length > 1 && (
                  <div className="absolute bottom-3 right-3 bg-black/50 backdrop-blur-sm text-white text-[11px] font-medium rounded-full px-2.5 py-1 border border-white/10">
                    1 / {photos.length}
                  </div>
                )}
                {/* 3D Tour badge on hero */}
                {hasTour && onOpenTour && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onOpenTour(); }}
                    className="absolute top-3 left-3 flex items-center gap-1.5 bg-black/50 backdrop-blur-sm text-white rounded-full px-3 py-1.5 text-[11px] font-medium border border-white/10 hover:bg-black/60 transition-colors"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
                    {t("draft.viewTour", lang)}
                  </button>
                )}
              </div>
            )}

            {/* Tour CTA (shown when no hero photo) */}
            {hasTour && onOpenTour && !has.photos && (
              <button
                onClick={onOpenTour}
                className="w-full flex items-center justify-center gap-2 rounded-2xl border border-border/60 bg-foreground/[0.02] py-8 text-foreground/60 hover:bg-foreground/[0.04] hover:text-foreground transition-colors"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12"/></svg>
                <span className="text-[14px] font-medium">{t("draft.viewTour", lang)}</span>
              </button>
            )}

            {/* Title block */}
            {(has.title || has.address || has.price) && (
              <div className="space-y-1.5">
                {has.title && <h1 className="text-[24px] font-semibold tracking-tight leading-tight">{draftData.title}</h1>}
                {has.address && (
                  <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground">{I.pin} {addressText}</p>
                )}
                {has.price && <p className="text-[20px] font-semibold text-foreground mt-1">{price}</p>}
              </div>
            )}

            {/* Key facts */}
            {has.facts && (
              <div className="flex flex-wrap gap-2.5">
                {draftData.bedrooms != null && (
                  <div className="flex items-center gap-2 rounded-lg border border-border/60 px-3 py-2">
                    {I.bed}
                    <span className="text-[14px] font-semibold tabular-nums">{draftData.bedrooms}</span>
                    <span className="text-[11px] text-muted-foreground">{t("shared.bed", lang)}</span>
                  </div>
                )}
                {draftData.bathrooms != null && (
                  <div className="flex items-center gap-2 rounded-lg border border-border/60 px-3 py-2">
                    {I.bath}
                    <span className="text-[14px] font-semibold tabular-nums">{draftData.bathrooms}</span>
                    <span className="text-[11px] text-muted-foreground">{t("shared.bath", lang)}</span>
                  </div>
                )}
                {draftData.area != null && draftData.area !== "" && (
                  <div className="flex items-center gap-2 rounded-lg border border-border/60 px-3 py-2">
                    {I.area}
                    <span className="text-[14px] font-semibold tabular-nums">{draftData.area}</span>
                    <span className="text-[11px] text-muted-foreground">{draftData.area_unit || "m²"}</span>
                  </div>
                )}
                {draftData.year_built != null && (
                  <div className="flex items-center gap-2 rounded-lg border border-border/60 px-3 py-2">
                    {I.year}
                    <span className="text-[14px] font-semibold tabular-nums">{draftData.year_built}</span>
                  </div>
                )}
                {draftData.lot_size != null && draftData.lot_size !== "" && (
                  <div className="flex items-center gap-2 rounded-lg border border-border/60 px-3 py-2">
                    {I.lot}
                    <span className="text-[14px] font-semibold tabular-nums">{draftData.lot_size}</span>
                    <span className="text-[11px] text-muted-foreground">{draftData.lot_size_unit || "m²"}</span>
                  </div>
                )}
              </div>
            )}

            {/* Description */}
            {has.description && (
              <div className="rounded-xl border border-border/50 px-4 py-3.5">
                <p className="text-[13px] leading-[1.75] text-foreground/65 whitespace-pre-line">{draftData.description}</p>
              </div>
            )}

            {/* Floorplan (annotated composite) */}
            {floorplanUrl && (
              <SharedFloorplan floorplanUrl={floorplanUrl} rooms={rooms ?? []} lang={lang} />
            )}

            {/* 3D Tour button (between content and photo grid) */}
            {hasTour && onOpenTour && has.photos && (
              <button
                onClick={onOpenTour}
                className="w-full flex items-center justify-center gap-2.5 rounded-xl border border-foreground/15 bg-foreground text-background py-3 hover:bg-foreground/90 transition-colors"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12"/></svg>
                <span className="text-[14px] font-semibold">{t("draft.viewTour", lang)}</span>
              </button>
            )}

            {/* Photo grid */}
            {has.photos && photos.length > 1 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {photos.map((p, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setLightboxIdx(i)}
                    className="aspect-[4/3] rounded-xl overflow-hidden bg-muted/20 hover:opacity-90 transition-opacity opacity-0 animate-fade-in-up [animation-fill-mode:forwards]"
                    style={{ animationDelay: `${i * 60}ms` }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.url} alt={p.name || ""} className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-border/30 mt-8 px-5 py-4 sm:px-8 text-center">
        <span className="text-[11px] text-foreground/25" style={{ fontFamily: "var(--font-brand), ui-serif, Georgia, serif" }}>
          Shared via Reaigen
        </span>
      </footer>

      {/* Lightbox */}
      {lightboxIdx !== null && has.photos && (
        <Lightbox photos={photos} index={lightboxIdx} onClose={() => setLightboxIdx(null)} onNav={setLightboxIdx} />
      )}
    </div>
  );
}

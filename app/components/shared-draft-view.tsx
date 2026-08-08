"use client";

/**
 * Full-page property listing view for shared drafts.
 * Rendered when a shared link has no 3D tour — shows property details,
 * photos with lightbox, specs, and description in a clean branded layout.
 */

import { t } from "../lib/i18n";
import FloorplanViewer from "./floorplan-viewer";
import { DraftImageGallery } from "./draft-image-gallery";
import type { SharedDraftData, RoomData, SharedTourSummary } from "../lib/tour-types";
import { resolveUnit, unitLabel, type UnitLookup } from "../lib/unit-catalog";
import { ReaigenWordmark } from "./reaigen-wordmark";

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
  bed:  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-foreground/55"><path d="M2 4v16"/><path d="M2 8h18a2 2 0 0 1 2 2v10"/><path d="M2 17h20"/><path d="M6 8v9"/></svg>,
  bath: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-foreground/55"><path d="M4 12h16a1 1 0 0 1 1 1v3a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4v-3a1 1 0 0 1 1-1Z"/><path d="M6 12V5a2 2 0 0 1 2-2h3v2.25"/></svg>,
  area: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-foreground/55"><rect x="3" y="3" width="18" height="18" rx="1"/><path d="M3 9h18"/><path d="M9 3v18"/></svg>,
  year: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-foreground/55"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/></svg>,
  lot:  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-foreground/55"><path d="M2 22l5-5"/><path d="M7 22H2v-5"/><path d="M22 2l-5 5"/><path d="M17 2h5v5"/><rect x="6" y="6" width="12" height="12" rx="1"/></svg>,
  pin:  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" className="text-muted-foreground shrink-0"><path d="M8 1.5a4.5 4.5 0 0 1 4.5 4.5c0 3.5-4.5 8.5-4.5 8.5S3.5 9.5 3.5 6A4.5 4.5 0 0 1 8 1.5Z" stroke="currentColor" strokeWidth="1.2"/><circle cx="8" cy="6" r="1.5" stroke="currentColor" strokeWidth="1.2"/></svg>,
};

// ── Shared floorplan (composite + room labels, no geometry/zoom) ──────

function SharedFloorplan({ floorplanUrl, rooms, lang }: { floorplanUrl: string; rooms: RoomData[]; lang: string }) {
  const allPoints = rooms.flatMap((r) => r.boundary_points ?? []);
  const hasRooms = allPoints.length > 0;

  if (!hasRooms) {
    return (
      <div className="relative aspect-[4/3] overflow-hidden rounded-2xl border border-border/40 bg-background">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={floorplanUrl}
          alt={t("tour.floorplan.alt", lang)}
          className="absolute inset-0 h-full w-full object-contain"
          loading="lazy"
        />
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
    <div
      className="relative overflow-hidden rounded-2xl border border-border/40 bg-background"
      style={{ aspectRatio: `${svgW} / ${svgH}` }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={floorplanUrl} alt={t("tour.floorplan.alt", lang)} className="absolute inset-0 h-full w-full" loading="lazy" />
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

export function SharedDraftView({ draftData, lang, hasTour, tours, onOpenTour, floorplanUrl, rooms, units }: {
  draftData: SharedDraftData;
  lang: string;
  hasTour?: boolean;
  tours?: SharedTourSummary[];
  onOpenTour?: (tourId?: number) => void;
  floorplanUrl?: string | null;
  rooms?: RoomData[];
  units: readonly UnitLookup[];
}) {
  const currency = resolveUnit(units, draftData.currency, "CURRENCY");
  const areaUnit = resolveUnit(units, draftData.area_unit, "AREA");
  const lotUnit = resolveUnit(units, draftData.lot_size_unit, "AREA");
  const price = formatPrice(draftData.price, currency?.code);
  const addressText = draftData.display_address || [draftData.city, draftData.state, draftData.country].filter(Boolean).join(", ");
  const photos = (draftData.uploads ?? []).filter((upload) => !upload.mime_type || upload.mime_type.startsWith("image/"));
  const webTours = (tours ?? draftData.tours ?? [])
    .filter((tour) => !tour.targets.length || tour.targets.includes("web"))
    .sort((left, right) => left.sort_order - right.sort_order);
  const tourCopy = lang.toLowerCase().startsWith("sk")
    ? {
        title: "Virtuálne prehliadky",
        subtitle: "Vyberte si, ktorú verziu nehnuteľnosti chcete vidieť.",
        primary: "Predvolená",
        open: "Otvoriť",
        renovation: "Po rekonštrukcii",
        rescan: "Nové snímanie",
      }
    : {
        title: "Virtual tours",
        subtitle: "Choose which version of the property you want to explore.",
        primary: "Default",
        open: "Open",
        renovation: "After renovation",
        rescan: "New capture",
      };

  const has = {
    title: !!draftData.title,
    address: !!addressText,
    price: !!price,
    facts: draftData.bedrooms != null || draftData.bathrooms != null || (draftData.area != null && draftData.area !== "") || draftData.year_built != null,
    description: !!draftData.description,
    photos: photos.length > 0,
    floorplan: !!draftData.floorplan,
    tours: Boolean(hasTour),
  };
  const hasAny = has.title || has.address || has.price || has.facts || has.description || has.photos || has.floorplan || has.tours;

  return (
    <div className="min-h-screen bg-background">
      {/* Branded header */}
      <header className="border-b border-border/40 px-5 py-3.5 sm:px-8">
        <ReaigenWordmark className="text-[20px] text-foreground/80" />
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
            {/* One canonical gallery: original ratios in the viewer and fullscreen. */}
            {has.photos && (
              <DraftImageGallery images={photos} alt={draftData.title || t("shared.propertyInfo", lang)} lang={lang} />
            )}

            {/* Virtual tour is the primary shared-property action. */}
            {hasTour && onOpenTour && webTours.length <= 1 && (
              <button
                onClick={() => onOpenTour(webTours[0]?.tour_id)}
                className="flex w-full items-center justify-center gap-2.5 rounded-full bg-foreground py-3 text-background transition-colors hover:bg-foreground/90"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="M3.27 6.96 12 12.01l8.73-5.05M12 22.08V12"/></svg>
                <span className="text-[14px] font-semibold">{t("draft.viewTour", lang)}</span>
              </button>
            )}
            {hasTour && onOpenTour && webTours.length > 1 && (
              <section className="rounded-[1.5rem] border border-border/60 bg-card p-4 shadow-card sm:p-5">
                <div className="mb-4">
                  <h2 className="text-[16px] font-semibold tracking-[-0.015em]">{tourCopy.title}</h2>
                  <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{tourCopy.subtitle}</p>
                </div>
                <div className="space-y-2">
                  {webTours.map((tour) => {
                    const captured = new Date(tour.captured_at);
                    const date = Number.isNaN(captured.getTime())
                      ? ""
                      : new Intl.DateTimeFormat(lang, {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        }).format(captured);
                    const reason = tour.capture_reason === "renovation"
                      ? tourCopy.renovation
                      : tour.capture_reason === "rescan"
                        ? tourCopy.rescan
                        : date;
                    return (
                      <button
                        key={tour.tour_id}
                        type="button"
                        onClick={() => onOpenTour(tour.tour_id)}
                        className="flex w-full items-center gap-3 rounded-2xl border border-border/55 bg-background px-3.5 py-3 text-left transition-colors hover:bg-foreground/[0.025]"
                      >
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-foreground/[0.055] text-foreground/65">
                          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4a2 2 0 0 0 1-1.73Z"/><path d="m3.3 7 8.7 5 8.7-5M12 22V12"/></svg>
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="truncate text-[13px] font-semibold">{tour.name}</span>
                            {tour.is_primary ? (
                              <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[9px] font-semibold text-emerald-700">
                                {tourCopy.primary}
                              </span>
                            ) : null}
                          </span>
                          <span className="mt-0.5 block text-[10px] text-muted-foreground">
                            {[reason, date !== reason ? date : ""].filter(Boolean).join(" · ")}
                          </span>
                        </span>
                        <span className="text-[11px] font-semibold text-foreground/55">{tourCopy.open}</span>
                      </button>
                    );
                  })}
                </div>
              </section>
            )}

            {/* Title block */}
            {(has.title || has.address || has.price) && (
              <div className="space-y-1.5">
                {has.title && <h1 className="select-text text-[24px] font-semibold tracking-tight leading-tight">{draftData.title}</h1>}
                {has.address && (
                  <p className="flex select-text items-center gap-1.5 text-[13px] text-muted-foreground">{I.pin} {addressText}</p>
                )}
                {has.price && <p className="mt-1 select-text text-[20px] font-semibold text-foreground">{price}</p>}
              </div>
            )}

            {/* Key facts — same chip design as the draft detail page */}
            {has.facts && (
              <div className="flex flex-wrap gap-2">
                {([
                  [I.bed, draftData.bedrooms, t("shared.bed", lang)],
                  [I.bath, draftData.bathrooms, t("shared.bath", lang)],
                  [I.area, draftData.area, unitLabel(areaUnit) || null],
                  [I.year, draftData.year_built, null],
                  [I.lot, draftData.lot_size, unitLabel(lotUnit) || null],
                ] as [React.ReactNode, string | number | null | undefined, string | null][])
                  .filter(([, value]) => value != null && value !== "")
                  .map(([icon, value, label], i) => (
                    <div key={i} className="flex items-center gap-2.5 rounded-xl bg-foreground/[0.04] px-3 py-2">
                      {icon}
                      <div className="leading-tight">
                        <p className="text-[14px] font-semibold tabular-nums">{value}</p>
                        {label && <p className="text-[11px] text-muted-foreground">{label}</p>}
                      </div>
                    </div>
                  ))}
              </div>
            )}

            {/* Description */}
            {has.description && (
              <div>
                <h2 className="text-[14px] font-semibold mb-2">{t("draft.description", lang)}</h2>
                <div className="rounded-2xl bg-foreground/[0.03] px-4 py-3.5">
                  {/* Recipients copy listing copy out of the public page too. */}
                  <p className="select-text text-[13px] leading-[1.75] text-foreground/65 whitespace-pre-line">{draftData.description}</p>
                </div>
              </div>
            )}

            {/* Floorplan — same vector renderer as the app when the share
                includes the floorplan block; legacy composite as fallback */}
            {(draftData.floorplan || floorplanUrl) && (
              <div>
                <h2 className="text-[14px] font-semibold mb-2">{t("draft.floorplan", lang)}</h2>
                {draftData.floorplan ? (
                  <FloorplanViewer
                    draftData={draftData.floorplan.draft_data}
                    publicFloorplan={draftData.floorplan}
                    lang={lang}
                    units={units}
                    targetAreaUnit={draftData.area_unit}
                  />
                ) : (
                  <SharedFloorplan floorplanUrl={floorplanUrl!} rooms={rooms ?? []} lang={lang} />
                )}
              </div>
            )}

          </div>
        )}
      </main>

      {/* Footer — localized "Shared via {name}" with the brand span injected at the placeholder */}
      <footer className="border-t border-border/30 mt-8 px-5 py-4 sm:px-8 text-center">
        <span className="text-[11px] text-muted-foreground">
          {(() => {
            const [before, after = ""] = t("shared.footerSharedVia", lang).split("{name}");
            return (
              <>
                {before}
                <ReaigenWordmark className="text-foreground/60" />
                {after}
              </>
            );
          })()}
        </span>
      </footer>

    </div>
  );
}

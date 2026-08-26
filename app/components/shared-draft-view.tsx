"use client";

/**
 * Full-page property listing view for shared drafts.
 * Rendered when a shared link has no 3D tour — shows property details,
 * photos with lightbox, specs, and description in a clean branded layout.
 */

import { useState } from "react";
import { t } from "../lib/i18n";
import FloorplanViewer from "./floorplan-viewer";
import { DraftImageGallery } from "./draft-image-gallery";
import { GlassVideoPlayer } from "./glass-video-player";
import type { SharedDraftData, RoomData, SharedTourSummary } from "../lib/tour-types";
import { resolveUnit, unitLabel, type UnitLookup } from "../lib/unit-catalog";
import { ReaigenWordmark } from "./reaigen-wordmark";
import { FormattedDescription } from "./formatted-description";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  DocumentIcon,
  FloorplanIcon,
  ImageIcon,
  MapPinIcon,
  TechnicalIcon,
  TourIcon,
  VideoIcon,
} from "./icons";
import { cn } from "../lib/utils";

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
  const [activeMediaView, setActiveMediaView] = useState<"photos" | "video">("photos");
  const [activeVideoIndex, setActiveVideoIndex] = useState(0);
  const currency = resolveUnit(units, draftData.currency, "CURRENCY");
  const areaUnit = resolveUnit(units, draftData.area_unit, "AREA");
  const lotUnit = resolveUnit(units, draftData.lot_size_unit, "AREA");
  const price = formatPrice(draftData.price, currency?.code);
  const addressText = draftData.display_address || [draftData.city, draftData.state, draftData.country].filter(Boolean).join(", ");
  const photos = (draftData.uploads ?? []).filter((upload) => !upload.mime_type || upload.mime_type.startsWith("image/"));
  const videos = (draftData.uploads ?? []).filter((upload) => upload.mime_type?.startsWith("video/"));
  const videoIndex = Math.max(0, Math.min(activeVideoIndex, videos.length - 1));
  const activeVideo = videos[videoIndex] ?? null;
  const showingVideo = videos.length > 0 && (photos.length === 0 || activeMediaView === "video");
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
    facts: draftData.bedrooms != null || draftData.bathrooms != null || (draftData.area != null && draftData.area !== "") || (draftData.lot_size != null && draftData.lot_size !== "") || draftData.year_built != null,
    description: !!draftData.description,
    photos: photos.length > 0 || videos.length > 0,
    floorplan: !!draftData.floorplan,
    tours: Boolean(hasTour),
    features: (draftData.data?.length ?? 0) > 0,
  };
  const hasSummary = has.title || has.address || has.price || has.facts;
  const hasAny = hasSummary || has.description || has.photos || has.floorplan || has.tours || has.features;

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="h-[calc(4rem+env(safe-area-inset-top))] shrink-0 border-b border-border/75 bg-card/92 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-safe backdrop-blur-xl sm:px-8 sm:pt-safe">
        <div className="mx-auto flex h-full w-full max-w-[1120px] items-center">
          <ReaigenWordmark className="text-[29px] leading-none text-foreground min-[390px]:text-[31px]" />
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1120px] flex-1 pb-[max(1.5rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-5 sm:px-8 sm:py-7 animate-fade-in">
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
          <div className="flex flex-col gap-7">
            {has.photos ? (
              <section className="space-y-3" aria-label={t("draft.media.title", lang)}>
                {photos.length > 0 && videos.length > 0 ? (
                  <div
                    role="tablist"
                    aria-label={t("draft.media.title", lang)}
                    className="inline-flex items-center gap-1 rounded-full border border-border/65 bg-card p-1 shadow-sm"
                  >
                    <button
                      type="button"
                      role="tab"
                      aria-selected={!showingVideo}
                      onClick={() => setActiveMediaView("photos")}
                      className={cn(
                        "inline-flex h-9 items-center gap-2 rounded-full px-3.5 text-[12px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        !showingVideo ? "glossy-capsule text-foreground" : "text-muted-foreground hover:bg-surface-subtle hover:text-foreground",
                      )}
                    >
                      <ImageIcon size={14} /> {t("draft.media.gallery", lang)}
                      <span className={cn("tabular-nums", !showingVideo ? "text-foreground/45" : "text-foreground/35")}>{photos.length}</span>
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={showingVideo}
                      onClick={() => setActiveMediaView("video")}
                      className={cn(
                        "inline-flex h-9 items-center gap-2 rounded-full px-3.5 text-[12px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        showingVideo ? "glossy-capsule text-foreground" : "text-muted-foreground hover:bg-surface-subtle hover:text-foreground",
                      )}
                    >
                      <VideoIcon size={14} /> {t("draft.media.video", lang)}
                      <span className={cn("tabular-nums", showingVideo ? "text-foreground/45" : "text-foreground/35")}>{videos.length}</span>
                    </button>
                  </div>
                ) : null}

                {!showingVideo && photos.length > 0 ? (
                  <div className="detail-hero-frame overflow-hidden rounded-[1.5rem] shadow-card ring-1 ring-border/75 sm:rounded-2xl">
                    <DraftImageGallery
                      images={photos}
                      alt={draftData.title || t("shared.propertyInfo", lang)}
                      lang={lang}
                      mobileOverviewLabel
                    />
                  </div>
                ) : null}

                {showingVideo && activeVideo ? (
                  <div className="relative aspect-video w-full overflow-hidden rounded-[1.5rem] bg-black shadow-card ring-1 ring-border/75 sm:rounded-2xl">
                    <GlassVideoPlayer key={activeVideo.url} src={activeVideo.url} ariaLabel={activeVideo.name || t("draft.media.video", lang)} />
                    {videos.length > 1 ? (
                      <>
                        <button
                          type="button"
                          onClick={() => setActiveVideoIndex(Math.max(0, videoIndex - 1))}
                          disabled={videoIndex === 0}
                          className="floating-icon-button absolute left-3 top-1/2 -translate-y-1/2 border border-white/20 bg-black/55 text-white backdrop-blur-md hover:bg-black/75 disabled:invisible"
                          aria-label={t("draft.gallery.previous", lang)}
                        ><ArrowLeftIcon size={18} /></button>
                        <button
                          type="button"
                          onClick={() => setActiveVideoIndex(Math.min(videos.length - 1, videoIndex + 1))}
                          disabled={videoIndex === videos.length - 1}
                          className="floating-icon-button absolute right-3 top-1/2 -translate-y-1/2 border border-white/20 bg-black/55 text-white backdrop-blur-md hover:bg-black/75 disabled:invisible"
                          aria-label={t("draft.gallery.next", lang)}
                        ><ArrowRightIcon size={18} /></button>
                      </>
                    ) : null}
                  </div>
                ) : null}
              </section>
            ) : null}

            {hasSummary ? (
              <section
                aria-label={t("shared.propertyInfo", lang)}
                className={cn(
                  "relative z-10 rounded-[1.65rem] border border-border/65 bg-card p-4 shadow-card sm:p-6",
                  has.photos && "mx-2 -mt-16 sm:mx-5 sm:-mt-20",
                )}
              >
                <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                  <div className="min-w-0">
                    <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                      {t("shared.propertyInfo", lang)}
                    </p>
                    {has.title ? (
                      <h1 className="select-text text-[28px] font-semibold leading-[1.05] tracking-[-0.035em] sm:text-[38px]">
                        {draftData.title}
                      </h1>
                    ) : null}
                    {has.address ? (
                      <p className="mt-2 flex select-text items-start gap-2 text-[13px] leading-relaxed text-muted-foreground sm:text-[14px]">
                        <MapPinIcon size={15} className="mt-0.5 shrink-0 text-foreground/45" />
                        <span>{addressText}</span>
                      </p>
                    ) : null}
                  </div>
                  {has.price ? (
                    <div className="glossy-capsule rounded-2xl px-4 py-3 text-foreground sm:min-w-40 sm:text-right">
                      <p className="select-text text-[24px] font-semibold leading-none tabular-nums sm:text-[28px]">{price}</p>
                      <p className="mt-2 text-[9px] font-semibold uppercase tracking-[0.14em] text-foreground/48">
                        {lang.toLowerCase().startsWith("sk") ? "Cena" : "Price"}
                      </p>
                    </div>
                  ) : null}
                </div>

                {has.facts ? (
                  <div className="mt-5 grid grid-cols-2 gap-2 border-t border-border/55 pt-4 sm:grid-cols-3 lg:grid-cols-5">
                    {([
                      [I.bed, draftData.bedrooms, t("shared.bed", lang)],
                      [I.bath, draftData.bathrooms, t("shared.bath", lang)],
                      [I.area, draftData.area != null && draftData.area !== "" ? `${draftData.area}${unitLabel(areaUnit) ? ` ${unitLabel(areaUnit)}` : ""}` : null, t("draft.area", lang)],
                      [I.year, draftData.year_built, t("draft.yearBuilt", lang)],
                      [I.lot, draftData.lot_size != null && draftData.lot_size !== "" ? `${draftData.lot_size}${unitLabel(lotUnit) ? ` ${unitLabel(lotUnit)}` : ""}` : null, t("draft.lotSize", lang)],
                    ] as [React.ReactNode, string | number | null | undefined, string | null][])
                      .filter(([, value]) => value != null && value !== "")
                      .map(([icon, value, label], index) => (
                        <div key={index} className="flex min-w-0 items-center gap-2.5 rounded-xl bg-surface-subtle px-3 py-2.5">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-card text-foreground/65 shadow-control">{icon}</span>
                          <span className="min-w-0 leading-tight">
                            <span className="block select-text truncate text-[13px] font-semibold tabular-nums">{value}</span>
                            {label ? <span className="mt-1 block truncate text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{label}</span> : null}
                          </span>
                        </div>
                      ))}
                  </div>
                ) : null}
              </section>
            ) : null}

            {/* Virtual tour is the primary shared-property action. */}
            {hasTour && onOpenTour && webTours.length <= 1 && (
              <button
                onClick={() => onOpenTour(webTours[0]?.tour_id)}
                className="glossy-primary-capsule flex min-h-11 w-full items-center justify-center gap-2.5 rounded-full px-5 py-2.5 text-background transition-[filter,transform] hover:brightness-[1.08] active:scale-[0.99] sm:w-auto"
              >
                <TourIcon size={18} />
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
                          <TourIcon size={17} />
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

            {/* Description */}
            {has.description && (
              <section className="rounded-[1.35rem] border border-border/60 bg-card p-4 shadow-sm sm:p-5">
                <div className="mb-3 flex items-center gap-2.5">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-surface-subtle text-foreground/60"><DocumentIcon size={16} /></span>
                  <h2 className="text-[16px] font-semibold tracking-[-0.015em]">{t("draft.description", lang)}</h2>
                </div>
                <div className="max-w-3xl">
                  {/* Recipients copy listing copy out of the public page too. */}
                  <FormattedDescription text={draftData.description!} className="select-text text-[15px] leading-[1.75] text-foreground/72" />
                </div>
              </section>
            )}

            {has.features ? (
              <section className="rounded-[1.35rem] border border-border/60 bg-card p-4 shadow-sm sm:p-5">
                <div className="mb-3 flex items-center gap-2.5">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-surface-subtle text-foreground/60"><TechnicalIcon size={16} /></span>
                  <h2 className="text-[16px] font-semibold tracking-[-0.015em]">{t("draft.details", lang)}</h2>
                </div>
                <dl className="grid gap-x-8 sm:grid-cols-2">
                  {draftData.data!.map((detail, index) => (
                    <div key={`${detail.key}-${index}`} className="flex items-baseline justify-between gap-4 border-t border-border/45 py-3 first:border-t-0 sm:[&:nth-child(2)]:border-t-0">
                      <dt className="text-[12px] text-muted-foreground">{detail.key}</dt>
                      <dd className="select-text text-right text-[13px] font-semibold text-foreground/80">{detail.value}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            ) : null}

            {/* Floorplan — same vector renderer as the app when the share
                includes the floorplan block; legacy composite as fallback */}
            {(draftData.floorplan || floorplanUrl) && (
              <section className="rounded-[1.35rem] border border-border/60 bg-card p-4 shadow-sm sm:p-5">
                <div className="mb-3 flex items-center gap-2.5">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-surface-subtle text-foreground/60"><FloorplanIcon size={16} /></span>
                  <h2 className="text-[16px] font-semibold tracking-[-0.015em]">{t("draft.floorplan", lang)}</h2>
                </div>
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
              </section>
            )}

          </div>
        )}
      </main>

      {/* Footer — localized "Shared via {name}" with the brand span injected at the placeholder */}
      <footer className="mt-auto shrink-0 border-t border-border/30 bg-background pb-[max(1rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-4 sm:px-8 sm:py-5">
        <div className="mx-auto flex w-full max-w-[1120px] items-center justify-center text-center">
        <span className="glossy-capsule inline-flex min-h-10 items-baseline gap-2 rounded-full px-4 text-[10px] font-medium tracking-[0.01em] text-foreground/58">
          {(() => {
            const [before, after = ""] = t("shared.footerSharedVia", lang).split("{name}");
            return (
              <>
                {before.trim()}
                <ReaigenWordmark className="inline-block text-[18px] leading-none text-foreground/86" />
                {after.trim()}
              </>
            );
          })()}
        </span>
        </div>
      </footer>

    </div>
  );
}

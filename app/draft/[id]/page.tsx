"use client";

import { useEffect, useRef, useState, use, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "../../components/hooks/use-auth";
import { AppShell } from "../../components/app-shell";
import { Button } from "../../lib/ui/button";
import { getDraft, getDraftTourAssets, getSplatsByDraft, listUnits, refreshDraft, translateDraftDescription } from "../../lib/api/client";
import { isApiNotFound } from "../../lib/api/error-message";
import { writeDragItem } from "../../lib/agent-pool";
import { getUserLanguage, t } from "../../lib/i18n";
import { currentGalleryUploads } from "../../lib/media";
import { readDraftDetailCache, writeDraftDetailCache } from "../../lib/resilient-draft-cache";
import { DraftImageGallery } from "../../components/draft-image-gallery";
import { DraftCacheNotice } from "../../components/draft-cache-notice";
import FloorplanViewer from "../../components/floorplan-viewer";
import FloorplanEditor from "../../components/floorplan-editor";
import { VolumesEditor } from "../../components/volumes-editor";
import type { DraftDetailItem, DraftTourAssetsPayload, DraftUpload, SplatsByDraftPayload } from "../../lib/tour-types";
import { baseUnitForCategory, resolveUnit, unitLabel, type UnitLookup } from "../../lib/unit-catalog";
import { currencyDisplaySymbol } from "../../lib/currency-display";
import { PageLoading } from "../../components/page-loading";
import { CollectionLoading } from "../../components/collection-loading";
import { cn } from "../../lib/utils";
import { DraftEditor } from "../../components/draft-editor";
import { DraftVersionManager } from "../../components/draft-version-manager";
import { DraftMediaManager, type DraftMediaManagerHandle } from "../../components/draft-media-manager";
import { DraftTourAssetsPanel } from "../../components/draft-tour-assets-panel";
import { DraftSharingDock } from "../../components/draft-sharing-dock";
import { FloorplanLightbox } from "../../components/floorplan-lightbox";
import { GlassVideoPlayer } from "../../components/glass-video-player";
import { FormattedDescription } from "../../components/formatted-description";
import { PropertyMapCard } from "../../components/property-map-card";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  DocumentIcon,
  EditIcon,
  FloorplanIcon,
  InfoIcon,
  ImageIcon,
  MapPinIcon,
  PlusIcon,
  PriceIcon,
  SearchIcon,
  ShareIcon,
  StarIcon,
  TourIcon,
  VideoIcon,
  VersionsIcon,
} from "../../components/icons";
import { StatusPill } from "../../components/status-pill";
import { selectShareableTour } from "../../lib/tour-sharing";
import {
  REAI_VIEWER_ACTION_EVENT,
  readReaiViewerAction,
  type ReaiViewerAction,
} from "../../lib/reai-viewer-actions";

// ── Formatting ────────────────────────────────────────────────────────────

function fmt(value: string | number | null | undefined, lang: string) {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return String(value);
  return new Intl.NumberFormat(lang, { maximumFractionDigits: n % 1 === 0 ? 0 : 1 }).format(n);
}

function fmtMoney(value: string | number | null | undefined, currency: string | null | undefined, lang: string) {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n === 0) return null;
  if (!currency) return fmt(n, lang);
  try {
    return new Intl.NumberFormat(lang, { style: "currency", currency, maximumFractionDigits: 0 }).format(n);
  } catch {
    return fmt(n, lang);
  }
}

function fmtWithUnit(value: unknown, unit: UnitLookup | null, lang: string) {
  const formatted = fmt(value as string | number | null | undefined, lang);
  if (!formatted) return null;
  const label = unitLabel(unit);
  return `${formatted}${label ? ` ${label}` : ""}`;
}

function humanize(s: string) {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Translate a backend enum value using the enum.* i18n keys. Falls back to humanize. */
function enumT(prefix: string, value: unknown, lang: string): string | null {
  if (value == null || value === "" || typeof value === "boolean") return null;
  const v = String(value).toLowerCase();
  const key = `enum.${prefix}.${v}` as import("../../lib/locales/en").LocaleKey;
  const translated = t(key, lang);
  return translated === key ? humanize(String(value)) : translated;
}

// ── Data extraction ───────────────────────────────────────────────────────

function getImages(uploads: DraftUpload[], lang: string) {
  return currentGalleryUploads(uploads, "image")
    .map((upload, index) => ({ id: upload.id, url: upload.file_url, name: `${t("draft.media.photo", lang)} ${index + 1}` }));
}

function getVideos(uploads: DraftUpload[], lang: string) {
  return currentGalleryUploads(uploads, "video")
    .map((upload, index) => ({ id: upload.id, url: upload.file_url, name: `${t("draft.media.video", lang)} ${index + 1}` }));
}

/** Read from a specific spec section, e.g. sec("technical", "condition") */
function sec(draft: DraftDetailItem, section: string, key: string): unknown {
  const s = draft.specs?.[section];
  if (s && typeof s === "object" && !Array.isArray(s)) {
    return (s as Record<string, unknown>)[key] ?? null;
  }
  return null;
}

// ── Icons (16×16 SVG strokes) ─────────────────────────────────────────────

const I = {
  bed: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-foreground/55 flex-shrink-0"><path d="M2 4v16"/><path d="M2 8h18a2 2 0 0 1 2 2v10"/><path d="M2 17h20"/><path d="M6 8v9"/></svg>,
  bath: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-foreground/55 flex-shrink-0"><path d="M4 12h16a1 1 0 0 1 1 1v3a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4v-3a1 1 0 0 1 1-1Z"/><path d="M6 12V5a2 2 0 0 1 2-2h3v2.25"/><path d="M4 21l1-1.5"/><path d="M20 21l-1-1.5"/></svg>,
  rooms: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-foreground/55 flex-shrink-0"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 12h18"/><path d="M12 3v18"/></svg>,
  area: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-foreground/55 flex-shrink-0"><rect x="3" y="3" width="18" height="18" rx="1"/><path d="M3 9h18"/><path d="M9 3v18"/></svg>,
  lot: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-foreground/55 flex-shrink-0"><path d="M2 22l5-5"/><path d="M7 22H2v-5"/><path d="M22 2l-5 5"/><path d="M17 2h5v5"/><rect x="6" y="6" width="12" height="12" rx="1"/></svg>,
  year: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-foreground/55 flex-shrink-0"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/></svg>,
  building: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-foreground/55 flex-shrink-0"><rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01M16 6h.01M12 6h.01M12 10h.01M12 14h.01M16 10h.01M16 14h.01M8 10h.01M8 14h.01"/></svg>,
  floor: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-foreground/55 flex-shrink-0"><path d="M22 20H2"/><path d="M6 20v-4"/><path d="M10 20V10"/><path d="M14 20V6"/><path d="M18 20V4"/></svg>,
  condition: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-foreground/55 flex-shrink-0"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>,
  energy: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-foreground/55 flex-shrink-0"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8Z"/></svg>,
  heating: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-foreground/55 flex-shrink-0"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14 0-5.5 2.5-7 .75 1.5 1 2.5 1 4 0 2.5-1.5 3-2.5 5s-.5 3 1 5"/><path d="M12.5 18a2.5 2.5 0 0 0 0-5 2.5 2.5 0 0 0 0 5Z"/></svg>,
  elevator: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-foreground/55 flex-shrink-0"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 7l4-4 4 4"/><path d="M8 17l4 4 4-4"/></svg>,
  parking: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-foreground/55 flex-shrink-0"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 17V7h4a3 3 0 0 1 0 6H9"/></svg>,
  compass: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-foreground/55 flex-shrink-0"><circle cx="12" cy="12" r="10"/><path d="M16.24 7.76l-2.12 6.36-6.36 2.12 2.12-6.36 6.36-2.12Z"/></svg>,
  water: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-foreground/55 flex-shrink-0"><path d="M12 2s-6 7-6 11a6 6 0 0 0 12 0c0-4-6-11-6-11Z"/></svg>,
  legal: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-foreground/55 flex-shrink-0"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/></svg>,
  dot: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-foreground/55 flex-shrink-0"><circle cx="12" cy="12" r="4"/></svg>,
  check: <svg width="10" height="10" viewBox="0 0 16 16" fill="none" className="text-foreground/30 flex-shrink-0"><path d="M2 8l4 4 8-8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>,
};

function currencyIcon(
  currency: string | null | undefined,
  lang: string,
  catalogSymbol?: string | null,
): ReactNode {
  const symbol = currencyDisplaySymbol(currency, lang, catalogSymbol);
  return (
    <span
      aria-hidden="true"
      className="inline-flex min-w-4 items-center justify-center text-[18px] font-medium leading-none tracking-[-0.04em] text-foreground/58"
    >
      {symbol}
    </span>
  );
}

// ── Facts grid (hero stats like iOS) ──────────────────────────────────────

/**
 * `path` is the canonical field address the Agent acts on when this parameter
 * is dragged into the Agent window. It is optional: a derived or composite
 * value has no single field behind it, and stays undraggable rather than
 * pointing the agent at the wrong one.
 */
interface Fact { icon: ReactNode; value: string; label: string; sub?: string; path?: string }

function buildFacts(d: DraftDetailItem, lang: string, units: readonly UnitLookup[]): Fact[] {
  const facts: Fact[] = [];
  const addFact = (icon: ReactNode, value: unknown, label: string, sub?: string | null, path?: string) => {
    if (value != null && value !== "" && value !== 0) facts.push({ icon, value: String(value), label, sub: sub || undefined, path });
  };
  addFact(I.bed, sec(d, "layout", "bedrooms"), t("draft.bedrooms", lang), null, "specs.layout.bedrooms");
  addFact(I.bath, sec(d, "layout", "bathrooms"), t("draft.bathrooms", lang), null, "specs.layout.bathrooms");

  // Area: show preferred, with original as sub if different unit
  const storedAreaUnit = resolveUnit(units, d.area_unit, "AREA")
    ?? resolveUnit(units, d.area_unit_code, "AREA")
    ?? resolveUnit(units, d.area_unit_display, "AREA");
  const preferredAreaUnit = resolveUnit(units, d.area_preferred_unit, "AREA");
  const usingPreferredArea = d.area_preferred != null;
  const area = usingPreferredArea ? d.area_preferred : d.area;
  const areaUnit = usingPreferredArea ? preferredAreaUnit : storedAreaUnit;
  const origAreaStr = d.area && usingPreferredArea && storedAreaUnit && preferredAreaUnit?.id !== storedAreaUnit.id
    ? fmtWithUnit(d.area, storedAreaUnit, lang)
    : null;
  if (area) addFact(I.area, fmtWithUnit(area, areaUnit, lang), t("draft.area", lang), origAreaStr, "area");

  addFact(I.floor, sec(d, "layout", "floors") ?? sec(d, "technical", "total_floors"), t("draft.totalFloors", lang), null, "specs.layout.floors");
  addFact(I.parking, sec(d, "layout", "parking_spaces"), t("draft.parkingSpaces", lang), null, "specs.layout.parking_spaces");
  addFact(I.year, d.year_built ?? sec(d, "technical", "year_built"), t("draft.yearBuilt", lang), null, "year_built");
  return facts;
}

// ── Row builder (detail params — excludes facts shown in grid) ────────────

interface Row { icon: ReactNode; label: string; value: string; path?: string }

function buildRows(d: DraftDetailItem, lang: string, units: readonly UnitLookup[]): Row[] {
  const rows: Row[] = [];
  const push = (icon: ReactNode, label: string, value: unknown, path?: string) => {
    if (value == null || value === "" || value === false) return;
    rows.push({ icon, label, value: value === true ? t("common.yes", lang) : String(value), path });
  };
  type LK = import("../../lib/locales/en").LocaleKey;
  const storedAreaUnit = resolveUnit(units, d.area_unit, "AREA")
    ?? resolveUnit(units, d.area_unit_code, "AREA")
    ?? resolveUnit(units, d.area_unit_display, "AREA");
  const areaUnit = d.area_preferred != null
    ? resolveUnit(units, d.area_preferred_unit, "AREA")
    : storedAreaUnit;
  const storedLotUnit = resolveUnit(units, d.lot_size_unit, "AREA");
  const lotUnit = d.lot_size_preferred != null
    ? resolveUnit(units, d.lot_size_preferred_unit, "AREA")
    : storedLotUnit;
  const distanceUnit = baseUnitForCategory(units, "DISTANCE");
  const currencyUnit = resolveUnit(units, d.currency, "CURRENCY");
  const currencyCode = currencyUnit?.code
    ?? (typeof d.currency === "string" && /^[a-z]{3}$/i.test(d.currency.trim()) ? d.currency : null);
  const moneyIcon = currencyIcon(currencyCode, lang, currencyUnit?.symbol);
  const fmtArea = (v: unknown) => v && Number(v) > 0 ? fmtWithUnit(v, areaUnit, lang) : null;
  const fmtLotArea = (v: unknown) => v && Number(v) > 0 ? fmtWithUnit(v, lotUnit, lang) : null;
  const fmtStoredMoney = (v: unknown) => fmtMoney(v as string | number | null | undefined, currencyCode, lang);

  // ── Layout parameters (rooms beyond facts grid) ──
  push(I.rooms, t("draft.rooms", lang), sec(d, "layout", "rooms"));
  const layoutFields: [string, LK][] = [
    ["living_rooms", "draft.livingRooms"], ["kitchens", "draft.kitchens"],
    ["kitchenettes", "draft.kitchenettes"], ["toilets", "draft.toilets"],
    ["separate_toilets", "draft.separateToilets"], ["wardrobes", "draft.wardrobes"],
    ["pantries", "draft.pantries"], ["floors_above_ground", "draft.floorsAboveGround"],
    ["open_space_zones", "draft.openSpaceZones"], ["meeting_rooms", "draft.meetingRooms"],
    ["storage_rooms", "draft.storageRooms"],
  ];
  for (const [k, tKey] of layoutFields) {
    const v = sec(d, "layout", k);
    if (v && Number(v) > 0) push(I.rooms, t(tKey, lang), v);
  }

  // ── Areas ──
  const lot = d.lot_size_preferred ?? d.lot_size;
  if (lot && Number(lot) > 0) push(I.lot, t("draft.lotSize", lang), fmtWithUnit(lot, lotUnit, lang));

  const areaFields: [string, LK][] = [
    ["floor_area", "draft.floorArea"], ["land_area", "draft.landArea"],
    ["basement_area", "draft.basementArea"], ["balcony_area", "draft.balconyArea"],
    ["loggia_area", "draft.loggiaArea"], ["terrace_area", "draft.terraceArea"],
    ["garden_area", "draft.gardenArea"], ["front_garden_area", "draft.frontGardenArea"],
    ["built_up_area", "draft.builtUpArea"], ["office_area", "draft.officeArea"],
    ["warehouse_area", "draft.warehouseArea"],
  ];
  for (const [k, tKey] of areaFields) {
    const v = sec(d, "areas", k);
    const formatted = k === "land_area" ? fmtLotArea(v) : fmtArea(v);
    if (formatted) push(I.area, t(tKey, lang), formatted, `specs.areas.${k}`);
  }
  // Plot dimensions (not area-formatted)
  const plotW = sec(d, "areas", "plot_width");
  if (plotW && Number(plotW) > 0) push(I.lot, t("draft.plotWidth", lang), fmtWithUnit(plotW, distanceUnit, lang));
  const plotL = sec(d, "areas", "plot_length");
  if (plotL && Number(plotL) > 0) push(I.lot, t("draft.plotLength", lang), fmtWithUnit(plotL, distanceUnit, lang));

  // ── Taxonomy ──
  const propTypeVal = enumT("property", sec(d, "taxonomy", "property_type"), lang);
  push(I.building, t("draft.propertyType", lang), propTypeVal, "specs.taxonomy.property_type");
  const subtype = sec(d, "taxonomy", "property_subtype");
  const subtypeVal = subtype ? enumT("subtype", subtype, lang) : null;
  if (subtypeVal && subtypeVal !== propTypeVal) push(I.building, t("draft.propertySubtype", lang), subtypeVal, "specs.taxonomy.property_subtype");

  // ── Technical / Additional details ──
  push(I.condition, t("draft.condition", lang), enumT("condition", sec(d, "technical", "condition"), lang), "specs.technical.condition");
  const constrType = sec(d, "technical", "construction_type");
  if (constrType) push(I.building, t("draft.constructionType", lang), enumT("construction", constrType, lang), "specs.technical.construction_type");
  const renovYear = sec(d, "technical", "renovation_year");
  if (renovYear) push(I.year, t("draft.renovationYear", lang), renovYear, "specs.technical.renovation_year");
  push(I.floor, t("draft.floor", lang), sec(d, "technical", "floor"), "specs.technical.floor");
  push(I.elevator, t("draft.elevator", lang), sec(d, "technical", "elevator"), "specs.technical.elevator");
  push(I.energy, t("draft.energyRating", lang), enumT("energy", sec(d, "technical", "energy_certificate"), lang));
  const energyClass = sec(d, "technical", "energy_class");
  if (energyClass) push(I.energy, t("draft.energyClass", lang), enumT("energy", energyClass, lang));
  push(I.compass, t("draft.orientation", lang), enumT("orientation", sec(d, "technical", "orientation"), lang), "specs.technical.orientation");
  const roofType = sec(d, "technical", "roof_type");
  if (roofType) push(I.building, t("draft.roofType", lang), enumT("roof", roofType, lang));
  const view = sec(d, "technical", "view");
  if (view) push(I.compass, t("draft.view", lang), humanize(String(view)));
  const ceilingH = sec(d, "technical", "ceiling_height");
  if (ceilingH && Number(ceilingH) > 0) push(I.floor, t("draft.ceilingHeight", lang), fmtWithUnit(ceilingH, distanceUnit, lang));

  // ── Utilities ──
  push(I.heating, t("draft.heating", lang), enumT("heating", sec(d, "utilities", "heating_source"), lang));
  const heatDist = sec(d, "utilities", "heat_distribution");
  if (heatDist) {
    const hdArr = Array.isArray(heatDist) ? heatDist : [heatDist];
    const hdStr = hdArr.map(h => enumT("heat_dist", h, lang) ?? humanize(String(h))).join(", ");
    push(I.heating, t("draft.heatDistribution", lang), hdStr);
  }
  const cooling = sec(d, "utilities", "cooling") ?? sec(d, "utilities", "cooling_types");
  if (cooling) {
    // cooling_types can be an array or comma-separated string
    const coolingArr = Array.isArray(cooling) ? cooling : String(cooling).split(",").map(s => s.trim()).filter(Boolean);
    const coolingStr = coolingArr.map(c => enumT("cooling", c, lang) ?? humanize(String(c))).join(", ");
    push(I.dot, t("draft.cooling", lang), coolingStr);
  }
  const waterVal = sec(d, "utilities", "water");
  // water can be a boolean (has connection) or enum string (source type) — only show enum strings as rows
  if (waterVal && typeof waterVal === "string") push(I.water, t("draft.water", lang), enumT("water", waterVal, lang));
  const furnishing = sec(d, "utilities", "furnishing_level");
  if (furnishing) push(I.dot, t("draft.furnishing", lang), enumT("furnishing", furnishing, lang));

  // ── Legal ──
  const ownership = sec(d, "legal", "ownership");
  if (ownership) push(I.legal, t("draft.ownership", lang), enumT("ownership", ownership, lang));
  const approvalStatus = sec(d, "legal", "approval_status");
  if (approvalStatus) push(I.legal, t("draft.approvalStatus", lang), humanize(String(approvalStatus)));
  const encumbrances = sec(d, "legal", "encumbrances");
  if (encumbrances) push(I.legal, t("draft.encumbrances", lang), String(encumbrances));
  const zoningInfo = sec(d, "legal", "zoning_info");
  if (zoningInfo) push(I.legal, t("draft.zoningInfo", lang), String(zoningInfo));
  const landUsePlan = sec(d, "legal", "land_use_plan");
  if (landUsePlan) push(I.legal, t("draft.landUsePlan", lang), String(landUsePlan));
  const buildability = sec(d, "legal", "buildability") ?? sec(d, "layout", "buildability");
  if (buildability) push(I.legal, t("draft.buildability", lang), enumT("buildability", buildability, lang));
  const accessRoad = sec(d, "legal", "access_road") ?? sec(d, "layout", "access_road");
  if (accessRoad) push(I.legal, t("draft.accessRoad", lang), enumT("access_road", accessRoad, lang));

  // ── Pricing extras ──
  const deposit = sec(d, "pricing_extra", "deposit");
  if (deposit && Number(deposit) > 0) push(moneyIcon, t("draft.deposit", lang), fmtStoredMoney(deposit));
  const agencyFee = sec(d, "pricing_extra", "agency_fee");
  if (agencyFee && Number(agencyFee) > 0) push(moneyIcon, t("draft.agencyFee", lang), fmtStoredMoney(agencyFee));
  const utilitiesAdv = sec(d, "pricing_extra", "utilities_advance");
  if (utilitiesAdv && Number(utilitiesAdv) > 0) push(moneyIcon, t("draft.utilitiesAdvance", lang), fmtStoredMoney(utilitiesAdv));
  const furnSepPrice = sec(d, "pricing_extra", "furnishing_separate_price");
  if (furnSepPrice && Number(furnSepPrice) > 0) push(moneyIcon, t("draft.furnishingSeparatePrice", lang), fmtStoredMoney(furnSepPrice));
  const parkPrice = sec(d, "pricing_extra", "parking_standalone_price");
  if (parkPrice && Number(parkPrice) > 0) push(moneyIcon, t("draft.parkingStandalonePrice", lang), fmtStoredMoney(parkPrice));
  const storPrice = sec(d, "pricing_extra", "storage_price");
  if (storPrice && Number(storPrice) > 0) push(moneyIcon, t("draft.storagePrice", lang), fmtStoredMoney(storPrice));
  const vatMode = sec(d, "pricing_extra", "vat_mode");
  if (vatMode) push(moneyIcon, t("draft.vatMode", lang), enumT("vat", vatMode, lang));
  const vatRate = sec(d, "pricing_extra", "vat_rate");
  if (vatRate && Number(vatRate) > 0) push(moneyIcon, t("draft.vatRate", lang), fmt(vatRate as number, lang));

  return rows;
}

// ── Monthly costs builder ────────────────────────────────────────────────

function buildMonthlyCosts(d: DraftDetailItem, lang: string, units: readonly UnitLookup[]): Row[] {
  const rows: Row[] = [];
  const currencyUnit = resolveUnit(units, d.currency, "CURRENCY");
  const currencyCode = currencyUnit?.code
    ?? (typeof d.currency === "string" && /^[a-z]{3}$/i.test(d.currency.trim()) ? d.currency : null);
  const moneyIcon = currencyIcon(currencyCode, lang, currencyUnit?.symbol);
  const push = (label: string, value: unknown) => {
    if (value == null || value === "") return;
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return;
    rows.push({ icon: moneyIcon, label, value: fmtMoney(n, currencyCode, lang)! });
  };
  type LK = import("../../lib/locales/en").LocaleKey;
  const monthlyFields: [string, LK][] = [
    ["monthly_repair_fund", "draft.monthlyRepairFund"],
    ["monthly_management_fee", "draft.monthlyManagementFee"],
    ["monthly_heating", "draft.monthlyHeating"],
    ["monthly_water", "draft.monthlyWater"],
    ["monthly_electricity", "draft.monthlyElectricity"],
    ["monthly_waste", "draft.monthlyWaste"],
    ["monthly_internet_tv", "draft.monthlyInternetTv"],
    ["monthly_other", "draft.monthlyOther"],
  ];
  for (const [k, tKey] of monthlyFields) {
    push(t(tKey, lang), sec(d, "pricing_extra", k));
  }
  return rows;
}

/** Keys already shown as attribute rows — exclude from feature chips to avoid duplication */
const ATTR_FEATURE_KEYS = new Set(["elevator", "garage"]);

/** Boolean fields in specs.utilities that represent infrastructure/amenities */
const UTILITY_FEATURE_KEYS = ["electricity", "water", "sewer", "gas", "optic_internet", "kitchen_with_appliances"];

/** Boolean fields in specs.technical that represent amenities */
const TECHNICAL_FEATURE_KEYS = ["photovoltaics", "smart_features", "recuperation", "ventilation", "loading_ramp", "reception", "pool", "attic"];

/** Boolean fields in specs.legal that represent property attributes */
const LEGAL_FEATURE_KEYS = ["permanent_residence_allowed", "mortgage_eligible"];

function getFeatureChips(d: DraftDetailItem, lang: string): string[] {
  const chips: string[] = [];
  const seen = new Set<string>();

  function addChip(k: string) {
    if (seen.has(k) || ATTR_FEATURE_KEYS.has(k)) return;
    seen.add(k);
    const key = `draft.feat.${k}` as import("../../lib/locales/en").LocaleKey;
    const translated = t(key, lang);
    chips.push(translated === key ? humanize(k) : translated);
  }

  // Primary features section
  const features = d.specs?.features;
  if (features && typeof features === "object" && !Array.isArray(features)) {
    for (const [k, v] of Object.entries(features as Record<string, unknown>)) {
      if (v === true) addChip(k);
    }
  }

  // Boolean flags from utilities (infrastructure connections)
  const utilities = d.specs?.utilities;
  if (utilities && typeof utilities === "object" && !Array.isArray(utilities)) {
    for (const k of UTILITY_FEATURE_KEYS) {
      if ((utilities as Record<string, unknown>)[k] === true) addChip(k);
    }
  }

  // Boolean flags from technical (amenities)
  const technical = d.specs?.technical;
  if (technical && typeof technical === "object" && !Array.isArray(technical)) {
    for (const k of TECHNICAL_FEATURE_KEYS) {
      if ((technical as Record<string, unknown>)[k] === true) addChip(k);
    }
  }

  // Boolean flags from legal (property attributes)
  const legal = d.specs?.legal;
  if (legal && typeof legal === "object" && !Array.isArray(legal)) {
    for (const k of LEGAL_FEATURE_KEYS) {
      if ((legal as Record<string, unknown>)[k] === true) addChip(k);
    }
  }

  return chips;
}

// ── Page ──────────────────────────────────────────────────────────────────

function ExpandableDescription({ text, lang }: { text: string; lang: string }) {
  const textRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [canExpand, setCanExpand] = useState(false);

  useEffect(() => {
    const node = textRef.current;
    if (!node) return;

    setExpanded(false);
    const measure = () => {
      const styles = window.getComputedStyle(node);
      const lineHeight = Number.parseFloat(styles.lineHeight);
      const collapsedHeight = Number.isFinite(lineHeight) ? lineHeight * 5 : 123;
      setCanExpand(node.scrollHeight > collapsedHeight + 1);
    };

    const frame = window.requestAnimationFrame(measure);
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    window.addEventListener("resize", measure);

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [text]);

  return (
    <div className="rounded-[1.25rem] border border-border/65 bg-card/88 px-4 py-4 shadow-control backdrop-blur-xl sm:rounded-2xl sm:px-6 sm:py-5 sm:shadow-card">
      <div
        ref={textRef}
        className={cn(
          // Listing copy, not chrome — agents paste this into portals and mail.
          "select-text overflow-hidden whitespace-pre-line text-[15px] leading-[1.7] text-foreground/88 transition-[max-height] duration-300 sm:leading-[1.75]",
          expanded ? "max-h-[200em]" : "max-h-[8.75em]",
        )}
      >
        <FormattedDescription text={text} />
      </div>
      {canExpand ? (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
          className="-ml-2 mt-3 rounded-full px-2.5 py-1.5 text-[12px] font-semibold text-foreground/55 transition-colors hover:bg-foreground/[0.045] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          {expanded ? t("draft.showLess", lang) : t("draft.showMore", lang)}
        </button>
      ) : null}
    </div>
  );
}

export default function DraftPreviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ sharing?: string | string[] }>;
}) {
  const { id } = use(params);
  const query = use(searchParams);
  const draftId = parseInt(id, 10);
  const { isAuthenticated, isLoading, user, logout } = useAuth();
  const router = useRouter();
  const lang = getUserLanguage(user?.localization);
  const sharingRequested = Array.isArray(query.sharing)
    ? query.sharing.includes("1")
    : query.sharing === "1";

  const [draft, setDraft] = useState<DraftDetailItem | null>(null);
  const [splatData, setSplatData] = useState<SplatsByDraftPayload | null>(null);
  const [tourAssets, setTourAssets] = useState<DraftTourAssetsPayload | null>(null);
  // A cached draft can paint before its tour relationship is known. Keep the
  // action rail neutral until that relationship resolves; otherwise Edit is
  // briefly promoted to the dark primary action and then jumps sideways when
  // the View tour action arrives.
  const [tourDataResolved, setTourDataResolved] = useState(false);
  const [unitCatalog, setUnitCatalog] = useState<UnitLookup[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const [translationPending, setTranslationPending] = useState(false);
  const [activeImageId, setActiveImageId] = useState<number | null>(null);
  const [activeMediaView, setActiveMediaView] = useState<"photos" | "video">("photos");
  const [activeVideoIndex, setActiveVideoIndex] = useState(0);
  const [editorOpen, setEditorOpen] = useState(false);
  const [descriptionEditRequested, setDescriptionEditRequested] = useState(false);
  const [floorplanEditorOpen, setFloorplanEditorOpen] = useState(false);
  const [floorplanFullscreen, setFloorplanFullscreen] = useState(false);
  const [floorplanAgentAction, setFloorplanAgentAction] = useState<ReaiViewerAction | null>(null);
  // Drawing walls, placing doors and dragging vertices needs a pointer and a
  // canvas with room beside its inspector panels; on a phone the plan is pushed
  // off-screen by its own chrome. Viewing the floorplan stays available
  // everywhere — only authoring is desktop-only. Width, not pointer:
  // touchscreen laptops report a coarse pointer and would lose editing they
  // can perform perfectly well.
  const [compactViewport, setCompactViewport] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches,
  );
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [mediaOpen, setMediaOpen] = useState(false);
  const mediaManagerRef = useRef<DraftMediaManagerHandle>(null);
  const [sharingOpen, setSharingOpen] = useState(sharingRequested);
  const [usingCachedDraft, setUsingCachedDraft] = useState(false);
  const [retryAttempt, setRetryAttempt] = useState(0);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [manualRefreshPending, setManualRefreshPending] = useState(false);

  useEffect(() => {
    const handleViewerAction = (event: Event) => {
      const action = readReaiViewerAction(event);
      if (
        action?.surface !== "floorplan"
        || action.resource.draft_id !== draftId
        || (draft?.floorplan_id && action.resource.floorplan_id !== draft.floorplan_id)
      ) return;
      setFloorplanAgentAction({ ...action });
      setFloorplanFullscreen(true);
    };
    window.addEventListener(REAI_VIEWER_ACTION_EVENT, handleViewerAction);
    return () => window.removeEventListener(REAI_VIEWER_ACTION_EVENT, handleViewerAction);
  }, [draft?.floorplan_id, draftId]);

  const refreshListing = () => {
    setManualRefreshPending(true);
    setReloadNonce((value) => value + 1);
  };

  useEffect(() => {
    if (!isLoading && !isAuthenticated) router.replace("/");
  }, [isLoading, isAuthenticated, router]);

  useEffect(() => {
    if (sharingRequested) setSharingOpen(true);
  }, [sharingRequested]);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 767px)");
    const sync = () => setCompactViewport(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  // Shrinking past the breakpoint mid-session must not strand the user inside
  // an editor whose controls they can no longer reach.
  useEffect(() => {
    if (compactViewport) setFloorplanEditorOpen(false);
  }, [compactViewport]);

  const handleSharingOpenChange = (nextOpen: boolean) => {
    setSharingOpen(nextOpen);
    const nextUrl = nextOpen
      ? `/draft/${draftId}?sharing=1`
      : `/draft/${draftId}`;
    window.history.replaceState(window.history.state, "", nextUrl);
  };

  useEffect(() => {
    if (!isAuthenticated || isNaN(draftId)) return;
    let active = true;
    setError(null);
    const cachedDraft = user?.id ? readDraftDetailCache(user.id, draftId) : null;
    if (cachedDraft) {
      // Paint the cached copy immediately, but do NOT raise the stale-listing
      // notice here. The live request is already in flight, so on every visit
      // with a warm cache the banner appeared, then removed itself a moment
      // later when the fetch landed — and since it is an inline block with a
      // bottom margin, the entire listing slid up underneath it every time.
      // The notice only tells the truth in the catch branch below, where the
      // request actually failed and this cached copy is all there is.
      setDraft(cachedDraft);
    }
    Promise.all([
      getDraft(draftId),
      getSplatsByDraft(draftId).catch(() => null),
      getDraftTourAssets(draftId).catch(() => null),
      listUnits().catch(() => []),
    ]).then(([d, s, fetchedTourAssets, fetchedUnits]) => {
      if (!active) return;
      setDraft(d);
      setSplatData(s);
      setTourAssets(fetchedTourAssets);
      setTourDataResolved(true);
      setUnitCatalog(fetchedUnits);
      setUsingCachedDraft(false);
      setRetryAttempt(0);
      setManualRefreshPending(false);
      if (user?.id) writeDraftDetailCache(user.id, draftId, d);
      // Trigger description translation if not yet available and user's lang ≠ en
      if (d.description && lang !== "en" && d.translation_status !== "completed") {
        setTranslationPending(true);
        translateDraftDescription(draftId, lang)
          .then((res) => {
            if (res.status === "ready" && res.translation) {
              setDraft((prev) => prev ? { ...prev, description_translated: res.translation!, translation_status: "completed" } : prev);
              setTranslationPending(false);
            } else if (res.status === "pending") {
              // Poll once after a delay
              setTimeout(() => {
                translateDraftDescription(draftId, lang).then((r2) => {
                  if (r2.status === "ready" && r2.translation) {
                    setDraft((prev) => prev ? { ...prev, description_translated: r2.translation!, translation_status: "completed" } : prev);
                  }
                  setTranslationPending(false);
                }).catch(() => setTranslationPending(false));
              }, 5000);
            }
          })
          .catch(() => setTranslationPending(false));
      }
    }).catch((err) => {
      if (!active) return;
      setTourDataResolved(true);
      setManualRefreshPending(false);
      if (isApiNotFound(err)) {
        setUsingCachedDraft(false);
        setError("notFound");
      } else if (cachedDraft) {
        setDraft(cachedDraft);
        setUsingCachedDraft(true);
        setError(null);
      } else {
        setError("loadFailed");
      }
      setRetryAttempt((attempt) => attempt + 1);
    });
    return () => { active = false; };
  }, [isAuthenticated, draftId, lang, reloadNonce, user?.id]);

  useEffect(() => {
    if (!isAuthenticated || (error !== "loadFailed" && !usingCachedDraft)) return;
    const delay = Math.min(30_000, 3_000 * (2 ** Math.min(retryAttempt, 3)));
    let requested = false;
    const retryWhenAvailable = () => {
      if (requested || document.hidden || !navigator.onLine) return;
      requested = true;
      setReloadNonce((value) => value + 1);
    };
    const retryWhenVisible = () => {
      if (document.visibilityState === "visible") retryWhenAvailable();
    };
    const timer = window.setTimeout(retryWhenAvailable, delay);
    window.addEventListener("online", retryWhenAvailable);
    window.addEventListener("focus", retryWhenAvailable);
    document.addEventListener("visibilitychange", retryWhenVisible);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("online", retryWhenAvailable);
      window.removeEventListener("focus", retryWhenAvailable);
      document.removeEventListener("visibilitychange", retryWhenVisible);
    };
  }, [error, isAuthenticated, retryAttempt, usingCachedDraft]);

  useEffect(() => {
    const refreshMedia = (event: Event) => {
      const detail = (event as CustomEvent<{ draftId?: number; pending?: boolean }>).detail;
      if (detail?.draftId !== draftId) return;
      const refresh = () => getDraft(draftId).then(setDraft).catch(() => {});
      void refresh();
      if (detail.pending) {
        window.setTimeout(refresh, 2500);
        window.setTimeout(refresh, 7000);
        window.setTimeout(refresh, 15000);
        window.setTimeout(refresh, 30000);
        window.setTimeout(refresh, 60000);
      }
    };
    window.addEventListener("reai-media-updated", refreshMedia);
    return () => window.removeEventListener("reai-media-updated", refreshMedia);
  }, [draftId]);

  if (isLoading || !user) {
    return <PageLoading />;
  }

  if (!draft && !error) {
    return (
      <AppShell
        user={user}
        onLogout={logout}
        hideMobileNav
        headerBackHref="/dashboard"
        headerBackLabel={t("nav.dashboard", lang)}
        headerTitleLoading
      >
        <div className="mx-auto flex min-h-[65vh] w-full max-w-[1180px] items-center justify-center pb-28 md:pb-10">
          <CollectionLoading label={t("common.loading", lang)} className="min-h-0 p-0" />
        </div>
      </AppShell>
    );
  }

  if (error) {
    const nf = error === "notFound";
    const errorContent = (
      <div className="flex min-h-[60vh] items-center justify-center px-4">
        <div className="text-center space-y-4 max-w-xs">
          <div className="mx-auto w-12 h-12 rounded-full bg-foreground/[0.04] flex items-center justify-center">
            {nf
              ? <SearchIcon size={20} className="text-foreground/30" />
              : <InfoIcon size={20} className="text-foreground/30" />
            }
          </div>
          <p className="text-[14px] font-medium text-foreground/70">{nf ? t("draft.error.notFoundTitle", lang) : t("draft.error.failedTitle", lang)}</p>
          <p className="text-[13px] text-foreground/40 leading-relaxed">{nf ? t("draft.error.notFound", lang) : t("draft.error.reconnectHint", lang)}</p>
          <div className="flex items-center justify-center gap-2 pt-1">
            {!nf && <Button variant="outline" size="sm" onClick={refreshListing} loading={manualRefreshPending}>{t("draft.refreshListing", lang)}</Button>}
            <Button variant="outline" size="sm" onClick={() => router.push("/dashboard")}>{t("nav.dashboard", lang)}</Button>
          </div>
        </div>
      </div>
    );
    if (!user) return errorContent;
    return (
      <AppShell
        user={user}
        onLogout={logout}
        headerBackHref="/dashboard"
        headerBackLabel={t("nav.dashboard", lang)}
      >
        <div className="mx-auto w-full max-w-3xl pb-28 md:pb-10">{errorContent}</div>
      </AppShell>
    );
  }

  if (!draft || !user) return null;

  // Price: show preferred (converted) price prominently, original smaller if different currency
  const preferredCurrency = resolveUnit(unitCatalog, draft.price_preferred_currency, "CURRENCY");
  const storedCurrency = resolveUnit(unitCatalog, draft.currency, "CURRENCY");
  const prefPrice = fmtMoney(draft.price_preferred, preferredCurrency?.code, lang);
  const origPrice = fmtMoney(draft.price, storedCurrency?.code, lang);
  const price = prefPrice || origPrice;
  const showOrigPrice = prefPrice && origPrice && preferredCurrency?.id !== storedCurrency?.id;

  const address = draft.display_address || [draft.city, draft.state, draft.country].filter(Boolean).join(", ");
  // Django may already return a complete street address in `address`. Do not
  // append the locality a second time (the previous composition produced the
  // duplicated address visible in the owner map card).
  const privateStreetAddress = draft.address?.trim() ?? "";
  const ownerMapAddress = privateStreetAddress || [draft.city, draft.state, draft.postal_code, draft.country]
    .map((part) => typeof part === "string" ? part.trim() : "")
    .filter(Boolean)
    .join(", ");
  const images = getImages(draft.raw_uploads, lang);
  const videos = getVideos(draft.raw_uploads, lang);
  const facts = buildFacts(draft, lang, unitCatalog);
  const rows = buildRows(draft, lang, unitCatalog);
  const features = getFeatureChips(draft, lang);
  const monthlyCosts = buildMonthlyCosts(draft, lang, unitCatalog);
  const hasTranslation = !!(draft.description_translated && draft.translation_status === "completed");
  const rawDesc = hasTranslation ? draft.description_translated! : draft.description;
  const description = rawDesc?.trim() || null;
  const offerType = sec(draft, "taxonomy", "offer_type");

  const legacyPrimarySplat = splatData?.parent_splat_id
    ? splatData.splats.find((s) => (s.splat_id ?? s.id) === splatData.parent_splat_id) ?? splatData.splats[0]
    : splatData?.splats[0];
  const legacyPrimarySplatId = legacyPrimarySplat
    ? (legacyPrimarySplat.splat_id ?? legacyPrimarySplat.id)
    : null;
  const shareableTour = selectShareableTour(tourAssets, legacyPrimarySplatId);
  const primarySplatId = shareableTour?.source_splat_id ?? undefined;
  const hasTour = Boolean(
    shareableTour,
  );
  const hasMedia = images.length > 0 || videos.length > 0;
  const videoIndex = Math.max(0, Math.min(activeVideoIndex, videos.length - 1));
  const activeVideo = videos[videoIndex] ?? null;
  const showingVideo = videos.length > 0 && (images.length === 0 || activeMediaView === "video");
  const hasFloorplan = !!(
    draft.floorplan_id ||
    draft.draft_data?.some((d) => d.data_key === "captured_room_json" || d.data_key === "wall_graph_json")
  );
  const detailsLong = rows.length > 8;
  const visibleRows = detailsExpanded ? rows : rows.slice(0, 8);
  const hasNarrative = Boolean(description || translationPending || hasFloorplan);
  const hasSupportingDetails = rows.length > 0 || features.length > 0 || monthlyCosts.length > 0;
  const nonFloorCardCount = Number(Boolean(description || translationPending))
    + Number(rows.length > 0)
    + Number(features.length > 0)
    + Number(monthlyCosts.length > 0);
  const detailCardCount = nonFloorCardCount + Number(hasFloorplan);
  const sparseNarrativeDetails = Boolean(description || translationPending)
    && rows.length <= 1
    && features.length === 0
    && monthlyCosts.length === 0
    && !hasFloorplan;


  return (
    <AppShell
      user={user}
      onLogout={logout}
      hideMobileNav
      reaiDraftId={draftId}
      reaiDraftTitle={draft?.title}
      reaiUploadId={activeImageId ?? undefined}
      reaiWorkspaceContext={floorplanFullscreen || floorplanEditorOpen ? "floorplan" : "draft"}
      headerBackHref="/dashboard"
      headerBackLabel={t("nav.dashboard", lang)}
      headerTitle={draft.title}
      headerMeta={address || undefined}
      onReaiDraftUpdated={(updatedDraft) => {
        setDraft(updatedDraft);
        writeDraftDetailCache(user.id, draftId, updatedDraft);
      }}
    >
      <div className="draft-detail-page relative mx-auto w-full max-w-[1280px] pb-24 md:pb-12">
        {/*
          Creation toolbar. Back stays the first thing on the page at every
          width — the stale-listing notice below must never displace the way
          out of this screen.
        */}
        <div className="mb-4 flex items-center justify-between gap-3 md:hidden">
          <button
            type="button"
            onClick={() => router.push("/dashboard")}
            aria-label={t("common.back", lang)}
            title={t("common.back", lang)}
            className="floating-capsule pen-touch-target inline-flex h-11 items-center gap-2 border border-border/60 bg-card/85 px-3.5 text-[12px] font-semibold text-foreground/65 shadow-sm backdrop-blur-xl transition-[background-color,color,box-shadow] hover:bg-card hover:text-foreground hover:shadow-control focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <ArrowLeftIcon size={17} />
            <span>{t("nav.dashboard", lang)}</span>
          </button>
        </div>

        {usingCachedDraft && (
          /*
            This notice describes the listing below it, so it sits above that
            listing rather than floating over it — pinned, it covered the very
            title, status and price it was warning about.
          */
          <DraftCacheNotice
            lang={lang}
            refreshing={manualRefreshPending}
            onRefresh={refreshListing}
          />
        )}

        {/* Media and property summary — one continuous workspace at every width. */}
        <div className="draft-mobile-workspace flex flex-col overflow-visible border-0 bg-transparent shadow-none md:overflow-hidden md:rounded-[1.65rem] md:border md:border-border/65 md:bg-card md:shadow-card">
          {/*
            A listing with no photos rendered no hero at all, so the page opened
            on status pills floating in whitespace and never said the obvious
            thing: it needs photographs. This holds the same slot the gallery
            would, so the page has one structure either way, and carries the
            action instead of leaving the gap unexplained. Bounded rather than
            aspect-locked: a 16/10 box at desktop widths grew into a
            viewport-filling droppool that dwarfed its own CTA.
          */}
          {!hasMedia && (
            <button
              type="button"
              onClick={() => mediaManagerRef.current?.requestUpload()}
              className="group w-full bg-transparent p-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring md:border-t md:border-border/60 md:bg-card md:p-4"
            >
              <span className="flex min-h-40 min-w-0 items-center justify-center gap-4 rounded-[1.25rem] border border-dashed border-border/80 bg-surface-subtle/35 p-5 text-center transition-[background-color,border-color] group-hover:border-foreground/25 group-hover:bg-surface-subtle/60 sm:p-7">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-border/70 bg-card text-foreground/55 shadow-control">
                  <ImageIcon size={21} />
                </span>
                <span className="min-w-0 text-left">
                  <span className="block text-[18px] font-semibold tracking-[-0.02em]">{t("draft.media.emptyTitle", lang)}</span>
                  <span className="mt-1.5 block max-w-xl text-[13px] leading-relaxed text-foreground/58">{t("draft.media.emptyBody", lang)}</span>
                  <span className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-full border border-border/70 bg-card px-4 text-[13px] font-semibold text-foreground shadow-control transition-colors group-hover:border-foreground/20">
                    <PlusIcon size={15} /> {t("draft.media.addPhotos", lang)}
                  </span>
                </span>
              </span>
            </button>
          )}
          {hasMedia && (
            <div className="draft-mobile-media min-w-0 space-y-3 border-0 p-0 md:space-y-4 md:border-t md:border-border/60 md:p-5">
              {images.length > 0 && videos.length > 0 ? (
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
                    <ImageIcon size={14} />
                    {t("draft.media.gallery", lang)}
                    <span className={cn("tabular-nums", !showingVideo ? "text-foreground/45" : "text-foreground/35")}>{images.length}</span>
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
                    <VideoIcon size={14} />
                    {t("draft.media.video", lang)}
                    <span className={cn("tabular-nums", showingVideo ? "text-foreground/45" : "text-foreground/35")}>{videos.length}</span>
                  </button>
                </div>
              ) : null}

              {!showingVideo && images.length > 0 ? (
                <div className="detail-hero-frame overflow-hidden rounded-[1.5rem] ring-0 md:rounded-2xl md:ring-1 md:ring-border/70">
                  <DraftImageGallery
                    images={images}
                    alt={draft.title}
                    lang={lang}
                    onActiveImageChange={setActiveImageId}
                    onManage={() => setMediaOpen(true)}
                    manageLabel={t("draft.media.manage", lang)}
                  />
                </div>
              ) : null}

              {showingVideo && activeVideo ? (
                <div className="relative aspect-[4/3] w-full overflow-hidden rounded-[1.5rem] bg-black ring-1 ring-black/[0.08] sm:aspect-video md:rounded-2xl md:ring-border/70">
                  <GlassVideoPlayer key={activeVideo.id} src={activeVideo.url} ariaLabel={activeVideo.name} />
                  {videos.length > 1 ? (
                    <>
                      <button
                        type="button"
                        onClick={() => setActiveVideoIndex(Math.max(0, videoIndex - 1))}
                        disabled={videoIndex === 0}
                        className="floating-icon-button pen-touch-target absolute left-3 top-1/2 hidden -translate-y-1/2 border border-white/20 bg-black/55 text-white shadow-control backdrop-blur-md transition-colors hover:bg-black/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 disabled:invisible sm:inline-flex"
                        aria-label={t("draft.gallery.previous", lang)}
                      >
                        <ArrowLeftIcon size={18} />
                      </button>
                      <button
                        type="button"
                        onClick={() => setActiveVideoIndex(Math.min(videos.length - 1, videoIndex + 1))}
                        disabled={videoIndex === videos.length - 1}
                        className="floating-icon-button pen-touch-target absolute right-3 top-1/2 hidden -translate-y-1/2 border border-white/20 bg-black/55 text-white shadow-control backdrop-blur-md transition-colors hover:bg-black/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 disabled:invisible sm:inline-flex"
                        aria-label={t("draft.gallery.next", lang)}
                      >
                        <ArrowRightIcon size={18} />
                      </button>
                      <span className="pointer-events-none absolute right-3 top-3 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-semibold tabular-nums text-white backdrop-blur-md">
                        {videoIndex + 1} / {videos.length}
                      </span>
                    </>
                  ) : null}
                </div>
              ) : null}
            </div>
          )}

          {/* On a phone these actions belong to the media workspace, not in
              the identity block above it. Keeping them directly below the
              hero produces one readable sequence: listing, media, actions. */}
          <div className="editor-glass-control mx-1 mt-3 grid grid-cols-3 gap-1 rounded-full border border-border/55 bg-card/76 p-1 shadow-control backdrop-blur-2xl md:hidden">
            <button
              type="button"
              data-testid="draft-mobile-editor-open"
              onClick={() => { setDescriptionEditRequested(false); setEditorOpen(true); }}
              className="glossy-capsule flex h-10 min-w-0 items-center justify-center gap-1.5 rounded-full text-[11px] font-semibold text-foreground transition-colors hover:brightness-[1.015] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25"
            >
              <EditIcon size={14} />
              <span className="truncate">{t("shareDialog.edit", lang)}</span>
            </button>
            <button
              type="button"
              data-testid="draft-mobile-sharing-open"
              onClick={() => handleSharingOpenChange(true)}
              className="flex h-10 min-w-0 items-center justify-center gap-1.5 rounded-full text-[11px] font-semibold text-foreground/62 transition-colors hover:bg-card hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25"
            >
              <ShareIcon size={14} />
              <span className="truncate">{t("draft.share", lang)}</span>
            </button>
            <button
              type="button"
              data-testid="draft-mobile-versions-open"
              onClick={() => setVersionsOpen(true)}
              className="flex h-10 min-w-0 items-center justify-center gap-1.5 rounded-full text-[11px] font-semibold text-foreground/62 transition-colors hover:bg-card hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25"
            >
              <VersionsIcon size={14} />
              <span className="truncate">{t("draft.versions.short", lang)}</span>
            </button>
          </div>

          {/* One column width whether or not photos exist. The old max-w-3xl
              cap for photo-less drafts left the action rail ending mid-page
              while the tour panel below ran the full column — two ragged
              right edges stacked on top of each other. */}
          <section
            className={cn(
              "order-first relative z-10 min-w-0 bg-transparent px-1 pb-5 pt-1 md:bg-card md:p-6",
            )}
          >
            <div className="flex min-w-0 flex-wrap items-center gap-2">
                {offerType ? (
                  <StatusPill tone="strong" className="uppercase tracking-[0.09em]">
                    {enumT("offer", offerType, lang)}
                  </StatusPill>
                ) : null}
                <StatusPill tone={draft.is_complete ? "success" : "neutral"} dot>
                  {t(draft.is_complete ? "dashboard.listingComplete" : "dashboard.listingDraft", lang)}
                </StatusPill>
                {hasTour ? <StatusPill tone="success" dot>{t("dashboard.tourReady", lang)}</StatusPill> : null}
            </div>

            <div className="mt-3">
              <h1 className="min-w-0 select-text text-[30px] font-semibold leading-[1.06] tracking-[-0.035em] sm:text-[34px] lg:text-[40px]">
                {draft.title || t("dashboard.untitled", lang)}
              </h1>
            </div>
            {address && (
              <p className="mt-2 flex select-text items-start gap-2 text-[14px] leading-relaxed text-foreground/65 sm:text-[15px]">
                <MapPinIcon size={15} className="mt-0.5 shrink-0 text-foreground/50" />
                <span>{address}</span>
              </p>
            )}
            {price && (
                <p className="mt-3 select-text text-[24px] font-semibold tracking-[-0.025em] tabular-nums sm:mt-4 sm:text-[28px]">
                {price}
                {showOrigPrice && (
                  <span className="ml-2 text-[12px] font-normal tracking-normal text-muted-foreground tabular-nums">{origPrice}</span>
                )}
              </p>
            )}

            {facts.length > 0 && (
              <div className="draft-facts-grid mt-4 flex gap-2.5 overflow-x-auto pb-1 scrollbar-hide sm:grid sm:grid-cols-3 sm:overflow-visible sm:pb-0 md:mt-5 md:border-t md:border-border/70 md:pt-5">
                {facts.map((fact) => (
                  <div
                    key={fact.label}
                    // Parameters with a canonical field behind them can be
                    // dragged into the Agent window to be asked about or edited.
                    draggable={Boolean(fact.path)}
                    onDragStart={(event) => {
                      if (!fact.path) return;
                      writeDragItem(event.dataTransfer, {
                        kind: "field",
                        path: fact.path,
                        label: fact.label,
                        value: fact.value,
                      });
                    }}
                    className={cn(
                      "flex w-[9.75rem] flex-none items-center gap-2.5 rounded-[1.125rem] border border-border/45 bg-card/72 px-3 py-2.5 shadow-control backdrop-blur-xl sm:w-auto sm:min-w-0 md:rounded-xl md:border-0 md:bg-surface-subtle md:shadow-none md:ring-1 md:ring-inset md:ring-border/35",
                      fact.path && "cursor-grab active:cursor-grabbing",
                    )}
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-card text-foreground/60 shadow-control">
                      {fact.icon}
                    </span>
                    <span className="min-w-0 leading-tight">
                      <span className="block select-text truncate text-[14px] font-semibold tabular-nums">{fact.value}</span>
                      <span className="mt-1 block truncate text-[11px] font-medium text-foreground/55">{fact.label}{fact.sub ? ` · ${fact.sub}` : ""}</span>
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* One rail gives every listing action the same baseline and one
                visual centre. The tour remains the dark primary segment; the
                authoring tools divide the remaining width evenly instead of
                forming a second, unrelated capsule on the opposite edge. */}
            <div className="mt-5 hidden border-t border-border/70 pt-5 md:block">
              {/* No fixed height: h-12 gave the 40px buttons a 38px inner box
                  (p-1 wins over the class padding), so the active pill clipped
                  against the capsule instead of floating centred in it. */}
              {!tourDataResolved ? (
                <div
                  aria-label={t("common.loading", lang)}
                  aria-busy="true"
                  className="draft-action-toolbar floating-toolbar glossy-capsule min-h-12 w-full p-1"
                >
                  <span className="h-10 w-full animate-pulse rounded-full bg-foreground/[0.045] motion-reduce:animate-none" />
                </div>
              ) : (
                <div className="draft-action-toolbar floating-toolbar glossy-capsule w-full overflow-x-auto scrollbar-hide">
                  {hasTour && (
                    <Button asChild size="sm" className="draft-action-tour h-10 min-w-[12rem] shrink-0 px-4 shadow-none">
                      <Link href={`/tour/${primarySplatId}?tourId=${shareableTour?.id}`}>
                        <TourIcon size={15} />
                        {t("draft.viewTour", lang)}
                      </Link>
                    </Button>
                  )}
                  {hasTour ? <span aria-hidden="true" className="draft-action-divider mx-1 h-6 w-px shrink-0 bg-border/70" /> : null}
                  <div className="draft-action-items flex min-w-[25rem] flex-1 items-center gap-0.5">
                    <Button type="button" data-testid="draft-media-open" variant="ghost" size="sm" className="h-10 min-w-0 flex-1 shrink-0 rounded-full" aria-label={t("draft.media.manage", lang)} onClick={() => setMediaOpen(true)}>
                      <ImageIcon size={15} /> {t("draft.media.gallery", lang)}
                    </Button>
                    <Button type="button" data-testid="draft-editor-open" variant={hasTour ? "ghost" : "default"} size="sm" className="h-10 min-w-0 flex-1 shrink-0 rounded-full" onClick={() => { setDescriptionEditRequested(false); setEditorOpen(true); }}>
                      <EditIcon size={14} /> {t("shareDialog.edit", lang)}
                    </Button>
                    <Button type="button" data-testid="draft-sharing-open" variant="ghost" size="sm" className="h-10 min-w-0 flex-1 shrink-0 rounded-full" onClick={() => handleSharingOpenChange(true)}>
                      <ShareIcon size={14} /> {t("draft.share", lang)}
                    </Button>
                    <Button type="button" data-testid="draft-versions-open" variant="ghost" size="sm" className="h-10 min-w-0 flex-1 shrink-0 rounded-full" onClick={() => setVersionsOpen(true)}>
                      <VersionsIcon size={15} /> {t("draft.versions.short", lang)}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>

        <DraftSharingDock
          open={sharingOpen}
          onOpenChange={handleSharingOpenChange}
          draftId={draftId}
          draft={draft}
          splatData={splatData}
          tourAssets={tourAssets}
          lang={lang}
          dateFormat={user.localization?.date_format}
        />

        {(hasNarrative || hasSupportingDetails) && (
          <div className={cn(
            "draft-support-grid",
            "mt-6 grid gap-6 md:mt-8 md:gap-7 lg:mt-10",
            detailCardCount > 1 && !sparseNarrativeDetails && "lg:grid-cols-2 lg:items-start",
          )}>
            {hasNarrative && (
              <div className="draft-support-contents min-w-0 space-y-7 lg:contents">
                {(description || translationPending) && (
                  <section className={cn(nonFloorCardCount === 1 && "lg:col-span-2")}>
                    <h2 className="mb-3 flex flex-wrap items-center gap-2 text-[16px] font-semibold tracking-[-0.015em]">
                      <DocumentIcon size={17} className="text-foreground/65" />
                      {t("draft.description", lang)}
                      <span className="ml-auto flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => { setDescriptionEditRequested(true); setEditorOpen(true); }}
                          className="glossy-capsule inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-[11px] font-semibold text-foreground/72 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25"
                        >
                          <EditIcon size={13} /> {t("shareDialog.edit", lang)}
                        </button>
                        <button
                          type="button"
                          onClick={() => setVersionsOpen(true)}
                          className="hidden h-9 items-center gap-1.5 rounded-full px-3 text-[11px] font-semibold text-foreground/52 transition-colors hover:bg-foreground/[0.045] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25 md:inline-flex"
                        >
                          <VersionsIcon size={13} /> {t("draft.versions.short", lang)}
                        </button>
                      </span>
                    </h2>
                    {translationPending && !hasTranslation && (
                      <p className="mb-2 text-[12px] text-foreground/50">{t("draft.descriptionPending", lang)}</p>
                    )}
                    {description && (
                      <ExpandableDescription text={description} lang={lang} />
                    )}
                  </section>
                )}

                {hasFloorplan && (
                  <section className="lg:col-span-2">
                    <h2 className="mb-3 flex items-center gap-2 text-[16px] font-semibold tracking-[-0.015em]">
                      <FloorplanIcon size={17} className="text-foreground/65" />
                      {t("draft.floorplan", lang)}
                      {!compactViewport && (
                        <button
                          type="button"
                          onClick={() => setFloorplanEditorOpen(true)}
                          className="ml-auto rounded-full px-2.5 py-1 text-[12.5px] font-semibold text-foreground/55 transition-colors hover:bg-foreground/[0.05] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        >
                          {t("floorplan.edit", lang)}
                        </button>
                      )}
                    </h2>
                    {/*
                      Tapping the plan opens it fullscreen, the same way tapping
                      a photo does. The inline drawing is sized by its column,
                      which on a phone is too small to read room by room. The
                      viewer itself is not interactive, so an overlay button
                      keeps one unambiguous target over the whole plan.
                    */}
                    {/*
                      The plan's aspect ratio comes from the captured geometry,
                      so a squarish plan left to fill this column rendered
                      nearly as tall as it is wide. That used to be solved by
                      capping the card's *width*, which left the floorplan
                      visibly narrower than every other card on the page.

                      The cap belongs on the drawing's height instead: the plan
                      box carries its own `aspectRatio`, so bounding the height
                      makes it give back width and centre itself, while the card
                      keeps the full column and stays flush with its siblings.
                      Fullscreen is still where the plan gets to be large.
                    */}
                    <div className="relative w-full overflow-hidden rounded-[1.5rem] sm:rounded-2xl">
                      <FloorplanViewer
                        draftData={draft.draft_data ?? []}
                        floorplanId={draft.floorplan_id}
                        lang={lang}
                        units={unitCatalog}
                        targetAreaUnit={draft.area_preferred_unit ?? draft.area_unit}
                        planClassName="max-h-[min(56vh,32rem)]"
                      />
                      <button
                        type="button"
                        onClick={() => setFloorplanFullscreen(true)}
                        aria-label={t("draft.gallery.fullscreen", lang)}
                        className="absolute inset-0 z-10 cursor-zoom-in rounded-[1.5rem] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset sm:rounded-2xl"
                      />
                    </div>

                    {/*
                      Volumes sit with the plan because they describe the same
                      thing: which captured scene each room belongs to. Editing
                      is deliberately available after creation, not only during
                      the capture flow.
                    */}
                    <VolumesEditor
                      draftId={draft.id}
                      floorplanId={draft.floorplan_id}
                      lang={lang}
                      className="mt-6 border-t border-border/70 pt-6"
                    />
                  </section>
                )}
              </div>
            )}

            {hasSupportingDetails && (
              <div className="draft-support-contents min-w-0 space-y-7 lg:contents">
                {rows.length > 0 && (
                  <section className={cn("draft-details-section", nonFloorCardCount === 1 && "lg:col-span-2")}>
                    <h2 className="mb-3 flex items-center gap-2 text-[16px] font-semibold tracking-[-0.015em]">
                      <InfoIcon size={17} className="text-foreground/65" />
                      {t("draft.details", lang)}
                    </h2>
                    <div className="draft-detail-grid grid grid-cols-1 gap-2.5">
                      {visibleRows.map((row, index) => (
                        <div
                          key={`${row.label}-${index}`}
                          draggable={Boolean(row.path)}
                          onDragStart={(event) => {
                            if (!row.path) return;
                            writeDragItem(event.dataTransfer, {
                              kind: "field",
                              path: row.path,
                              label: row.label,
                              value: row.value,
                            });
                          }}
                          className={cn(
                            "group flex min-w-0 items-center gap-3 rounded-[1.25rem] border border-border/65 bg-card/88 px-3.5 py-3.5 shadow-control backdrop-blur-xl transition-[border-color,box-shadow,transform]",
                            row.path && "cursor-grab hover:-translate-y-px hover:border-foreground/20 hover:shadow-card active:cursor-grabbing",
                          )}
                        >
                          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border/55 bg-surface-subtle/75 text-foreground/62 shadow-[inset_0_1px_0_rgba(255,255,255,0.82)]">
                            {row.icon}
                          </span>
                          <span className="min-w-0 flex-1 leading-tight">
                            <span className="block break-words text-[11px] font-medium text-foreground/52">{row.label}</span>
                            <span className="mt-1.5 block select-text break-words text-[14px] font-semibold leading-snug text-foreground tabular-nums">{row.value}</span>
                          </span>
                        </div>
                      ))}
                      {detailsLong && (
                        <div className="flex justify-center pt-1 sm:col-span-2">
                          <button type="button" aria-expanded={detailsExpanded} onClick={() => setDetailsExpanded(!detailsExpanded)} className="floating-capsule min-h-10 rounded-full px-4 text-[12px] font-semibold text-foreground/62 shadow-control transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
                            {detailsExpanded ? t("draft.showLess", lang) : t("draft.showMore", lang)}
                          </button>
                        </div>
                      )}
                    </div>
                  </section>
                )}

                {features.length > 0 && (
                  <section className={cn(nonFloorCardCount === 1 && "lg:col-span-2")}>
                    <h2 className="mb-3 flex items-center gap-2 text-[16px] font-semibold tracking-[-0.015em]">
                      <StarIcon size={17} className="text-foreground/65" />
                      {t("draft.features", lang)}
                    </h2>
                    <div className="flex flex-wrap gap-2 rounded-[1.5rem] border border-border/70 bg-card p-4 shadow-card sm:rounded-2xl">
                      {features.map((feature) => (
                        <span key={feature} className="inline-flex min-h-9 items-center rounded-full border border-border/65 bg-surface-subtle px-3.5 py-1 text-[12px] font-medium text-foreground/80">
                          {feature}
                        </span>
                      ))}
                    </div>
                  </section>
                )}

                {monthlyCosts.length > 0 && (
                  <section className={cn(nonFloorCardCount === 1 && "lg:col-span-2")}>
                    <h2 className="mb-3 flex items-center gap-2 text-[16px] font-semibold tracking-[-0.015em]">
                      <PriceIcon size={17} className="text-foreground/65" />
                      {t("draft.monthlyCosts", lang)}
                    </h2>
                    <div className="draft-cost-grid grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                      {monthlyCosts.map((row, index) => (
                        <div key={`${row.label}-${index}`} className="flex min-w-0 items-center gap-3 rounded-[1.25rem] border border-border/65 bg-card/88 px-3.5 py-3.5 shadow-control backdrop-blur-xl">
                          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border/55 bg-surface-subtle/75 text-foreground/62 shadow-[inset_0_1px_0_rgba(255,255,255,0.82)]">{row.icon}</span>
                          <span className="min-w-0 flex-1 leading-tight">
                            <span className="block break-words text-[11px] font-medium text-foreground/52">{row.label}</span>
                            <span className="mt-1.5 block select-text break-words text-[14px] font-semibold text-foreground tabular-nums">{row.value}</span>
                          </span>
                        </div>
                      ))}
                    </div>
                  </section>
                )}
              </div>
            )}
          </div>
        )}

        {(ownerMapAddress || (draft.latitude != null && draft.longitude != null)) ? (
          <PropertyMapCard
            address={ownerMapAddress || address}
            latitude={draft.latitude}
            longitude={draft.longitude}
            lang={lang}
            className="mt-6 md:mt-8"
          />
        ) : null}

        <DraftTourAssetsPanel
          draftId={draftId}
          lang={lang}
          splats={splatData?.splats}
          initialPayload={tourAssets}
          onPayloadChanged={setTourAssets}
          onPrimaryChanged={(activeSplatId) => setSplatData((current) => (
            current ? { ...current, parent_splat_id: activeSplatId } : current
          ))}
          onOpenSharing={() => handleSharingOpenChange(true)}
        />

      </div>

      <DraftEditor
        open={editorOpen}
        onOpenChange={(next) => {
          setEditorOpen(next);
          if (!next) setDescriptionEditRequested(false);
        }}
        draft={draft}
        units={unitCatalog}
        lang={lang}
        onSaved={setDraft}
        startWithDescription={descriptionEditRequested}
      />
      <FloorplanLightbox
        open={floorplanFullscreen}
        onClose={() => setFloorplanFullscreen(false)}
        draftData={draft.draft_data ?? []}
        floorplanId={draft.floorplan_id}
        lang={lang}
        units={unitCatalog}
        targetAreaUnit={draft.area_preferred_unit ?? draft.area_unit}
        agentAction={floorplanAgentAction}
      />

      {/* Structural gate, so the editor cannot mount on a phone regardless of state. */}
      {floorplanEditorOpen && !compactViewport && (
        <FloorplanEditor
          draftId={draftId}
          draftData={draft.draft_data ?? []}
          lang={lang}
          onClose={() => setFloorplanEditorOpen(false)}
          onSaved={(entries) =>
            setDraft((current) => {
              if (!current) return current;
              const byId = new Map((current.draft_data ?? []).map((e) => [e.id, e]));
              for (const entry of entries) byId.set(entry.id, entry);
              return { ...current, draft_data: [...byId.values()] };
            })
          }
        />
      )}
      <DraftMediaManager
        ref={mediaManagerRef}
        open={mediaOpen}
        onOpenChange={setMediaOpen}
        draft={draft}
        lang={lang}
        onChanged={() => refreshDraft(draftId).then(setDraft)}
      />
      <DraftVersionManager
        open={versionsOpen}
        onOpenChange={setVersionsOpen}
        draft={draft}
        splats={splatData}
        units={unitCatalog}
        lang={lang}
        onActiveTourChanged={(activeSplatId) => setSplatData((current) => current ? { ...current, parent_splat_id: activeSplatId } : current)}
        onDraftRestored={setDraft}
      />

    </AppShell>
  );
}

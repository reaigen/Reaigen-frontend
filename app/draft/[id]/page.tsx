"use client";

import { useEffect, useRef, useState, use, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "../../components/hooks/use-auth";
import { AppShell } from "../../components/app-shell";
import { Button } from "../../lib/ui/button";
import { getDraft, getDraftTourAssets, getSplatsByDraft, listUnits, refreshDraft, translateDraftDescription } from "../../lib/api/client";
import { isApiNotFound } from "../../lib/api/error-message";
import { getUserLanguage, t } from "../../lib/i18n";
import { currentGalleryUploads } from "../../lib/media";
import { readDraftDetailCache, writeDraftDetailCache } from "../../lib/resilient-draft-cache";
import { DraftImageGallery } from "../../components/draft-image-gallery";
import { DraftCacheNotice } from "../../components/draft-cache-notice";
import FloorplanViewer from "../../components/floorplan-viewer";
import type { DraftDetailItem, DraftTourAssetsPayload, DraftUpload, SplatsByDraftPayload } from "../../lib/tour-types";
import { baseUnitForCategory, resolveUnit, unitLabel, type UnitLookup } from "../../lib/unit-catalog";
import { PageLoading } from "../../components/page-loading";
import { CollectionLoading } from "../../components/collection-loading";
import { cn } from "../../lib/utils";
import { DraftEditor } from "../../components/draft-editor";
import { DraftVersionManager } from "../../components/draft-version-manager";
import { DraftMediaManager } from "../../components/draft-media-manager";
import { DraftTourAssetsPanel } from "../../components/draft-tour-assets-panel";
import {
  ArrowLeftIcon,
  DocumentIcon,
  EditIcon,
  FloorplanIcon,
  InfoIcon,
  ImageIcon,
  MapPinIcon,
  PriceIcon,
  SearchIcon,
  ShareIcon,
  StarIcon,
  TourIcon,
  VersionsIcon,
} from "../../components/icons";
import { StatusPill } from "../../components/status-pill";
import { selectShareableTour } from "../../lib/tour-sharing";

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

/** Strip markdown formatting characters from description text */
function stripFormatting(text: string): string {
  return text
    .replace(/#{1,6}\s*/g, "")         // headings
    .replace(/\*\*(.+?)\*\*/g, "$1")   // bold
    .replace(/__(.+?)__/g, "$1")       // bold alt
    .replace(/\*(.+?)\*/g, "$1")       // italic
    .replace(/_(.+?)_/g, "$1")         // italic alt
    .replace(/~~(.+?)~~/g, "$1")       // strikethrough
    .replace(/`(.+?)`/g, "$1")         // inline code
    .replace(/^\s*[-*+]\s+/gm, "• ")   // list items → bullet
    .replace(/^\s*\d+\.\s+/gm, "• ")    // numbered list → bullet
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // links
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "")  // images
    .replace(/^>\s*/gm, "")            // blockquotes
    .replace(/---+/g, "")              // horizontal rules
    .replace(/\n{3,}/g, "\n\n")        // excess newlines
    .trim();
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
  money: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-foreground/55 flex-shrink-0"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>,
  dot: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-foreground/55 flex-shrink-0"><circle cx="12" cy="12" r="4"/></svg>,
  check: <svg width="10" height="10" viewBox="0 0 16 16" fill="none" className="text-foreground/30 flex-shrink-0"><path d="M2 8l4 4 8-8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>,
};

// ── Facts grid (hero stats like iOS) ──────────────────────────────────────

interface Fact { icon: ReactNode; value: string; label: string; sub?: string }

function buildFacts(d: DraftDetailItem, lang: string, units: readonly UnitLookup[]): Fact[] {
  const facts: Fact[] = [];
  const addFact = (icon: ReactNode, value: unknown, label: string, sub?: string | null) => {
    if (value != null && value !== "" && value !== 0) facts.push({ icon, value: String(value), label, sub: sub || undefined });
  };
  addFact(I.bed, sec(d, "layout", "bedrooms"), t("draft.bedrooms", lang));
  addFact(I.bath, sec(d, "layout", "bathrooms"), t("draft.bathrooms", lang));

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
  if (area) addFact(I.area, fmtWithUnit(area, areaUnit, lang), t("draft.area", lang), origAreaStr);

  addFact(I.floor, sec(d, "layout", "floors") ?? sec(d, "technical", "total_floors"), t("draft.totalFloors", lang));
  addFact(I.parking, sec(d, "layout", "parking_spaces"), t("draft.parkingSpaces", lang));
  addFact(I.year, d.year_built ?? sec(d, "technical", "year_built"), t("draft.yearBuilt", lang));
  return facts;
}

// ── Row builder (detail params — excludes facts shown in grid) ────────────

interface Row { icon: ReactNode; label: string; value: string }

function buildRows(d: DraftDetailItem, lang: string, units: readonly UnitLookup[]): Row[] {
  const rows: Row[] = [];
  const push = (icon: ReactNode, label: string, value: unknown) => {
    if (value == null || value === "" || value === false) return;
    rows.push({ icon, label, value: value === true ? t("common.yes", lang) : String(value) });
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
  const fmtArea = (v: unknown) => v && Number(v) > 0 ? fmtWithUnit(v, areaUnit, lang) : null;
  const fmtLotArea = (v: unknown) => v && Number(v) > 0 ? fmtWithUnit(v, lotUnit, lang) : null;
  const fmtStoredMoney = (v: unknown) => fmtMoney(v as string | number | null | undefined, currencyUnit?.code, lang);

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
    if (formatted) push(I.area, t(tKey, lang), formatted);
  }
  // Plot dimensions (not area-formatted)
  const plotW = sec(d, "areas", "plot_width");
  if (plotW && Number(plotW) > 0) push(I.lot, t("draft.plotWidth", lang), fmtWithUnit(plotW, distanceUnit, lang));
  const plotL = sec(d, "areas", "plot_length");
  if (plotL && Number(plotL) > 0) push(I.lot, t("draft.plotLength", lang), fmtWithUnit(plotL, distanceUnit, lang));

  // ── Taxonomy ──
  const propTypeVal = enumT("property", sec(d, "taxonomy", "property_type"), lang);
  push(I.building, t("draft.propertyType", lang), propTypeVal);
  const subtype = sec(d, "taxonomy", "property_subtype");
  const subtypeVal = subtype ? enumT("subtype", subtype, lang) : null;
  if (subtypeVal && subtypeVal !== propTypeVal) push(I.building, t("draft.propertySubtype", lang), subtypeVal);

  // ── Technical / Additional details ──
  push(I.condition, t("draft.condition", lang), enumT("condition", sec(d, "technical", "condition"), lang));
  const constrType = sec(d, "technical", "construction_type");
  if (constrType) push(I.building, t("draft.constructionType", lang), enumT("construction", constrType, lang));
  const renovYear = sec(d, "technical", "renovation_year");
  if (renovYear) push(I.year, t("draft.renovationYear", lang), renovYear);
  push(I.floor, t("draft.floor", lang), sec(d, "technical", "floor"));
  push(I.elevator, t("draft.elevator", lang), sec(d, "technical", "elevator"));
  push(I.energy, t("draft.energyRating", lang), enumT("energy", sec(d, "technical", "energy_certificate"), lang));
  const energyClass = sec(d, "technical", "energy_class");
  if (energyClass) push(I.energy, t("draft.energyClass", lang), enumT("energy", energyClass, lang));
  push(I.compass, t("draft.orientation", lang), enumT("orientation", sec(d, "technical", "orientation"), lang));
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
  if (deposit && Number(deposit) > 0) push(I.money, t("draft.deposit", lang), fmtStoredMoney(deposit));
  const agencyFee = sec(d, "pricing_extra", "agency_fee");
  if (agencyFee && Number(agencyFee) > 0) push(I.money, t("draft.agencyFee", lang), fmtStoredMoney(agencyFee));
  const utilitiesAdv = sec(d, "pricing_extra", "utilities_advance");
  if (utilitiesAdv && Number(utilitiesAdv) > 0) push(I.money, t("draft.utilitiesAdvance", lang), fmtStoredMoney(utilitiesAdv));
  const furnSepPrice = sec(d, "pricing_extra", "furnishing_separate_price");
  if (furnSepPrice && Number(furnSepPrice) > 0) push(I.money, t("draft.furnishingSeparatePrice", lang), fmtStoredMoney(furnSepPrice));
  const parkPrice = sec(d, "pricing_extra", "parking_standalone_price");
  if (parkPrice && Number(parkPrice) > 0) push(I.money, t("draft.parkingStandalonePrice", lang), fmtStoredMoney(parkPrice));
  const storPrice = sec(d, "pricing_extra", "storage_price");
  if (storPrice && Number(storPrice) > 0) push(I.money, t("draft.storagePrice", lang), fmtStoredMoney(storPrice));
  const vatMode = sec(d, "pricing_extra", "vat_mode");
  if (vatMode) push(I.money, t("draft.vatMode", lang), enumT("vat", vatMode, lang));
  const vatRate = sec(d, "pricing_extra", "vat_rate");
  if (vatRate && Number(vatRate) > 0) push(I.money, t("draft.vatRate", lang), fmt(vatRate as number, lang));

  return rows;
}

// ── Monthly costs builder ────────────────────────────────────────────────

function buildMonthlyCosts(d: DraftDetailItem, lang: string, units: readonly UnitLookup[]): Row[] {
  const rows: Row[] = [];
  const currencyUnit = resolveUnit(units, d.currency, "CURRENCY");
  const push = (label: string, value: unknown) => {
    if (value == null || value === "") return;
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return;
    rows.push({ icon: I.money, label, value: fmtMoney(n, currencyUnit?.code, lang)! });
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
    <div className="rounded-[1.5rem] border border-border/70 bg-card px-5 py-5 shadow-card sm:rounded-2xl sm:px-6">
      <div
        ref={textRef}
        className={cn(
          "overflow-hidden whitespace-pre-line text-[14px] leading-[1.75] text-foreground/78 transition-[max-height] duration-300",
          expanded ? "max-h-[200em]" : "max-h-[8.75em]",
        )}
      >
        {text}
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

export default function DraftPreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const draftId = parseInt(id, 10);
  const { isAuthenticated, isLoading, user, logout } = useAuth();
  const router = useRouter();
  const lang = getUserLanguage(user?.localization);

  const [draft, setDraft] = useState<DraftDetailItem | null>(null);
  const [splatData, setSplatData] = useState<SplatsByDraftPayload | null>(null);
  const [tourAssets, setTourAssets] = useState<DraftTourAssetsPayload | null>(null);
  const [unitCatalog, setUnitCatalog] = useState<UnitLookup[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const [translationPending, setTranslationPending] = useState(false);
  const [activeImageId, setActiveImageId] = useState<number | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [mediaOpen, setMediaOpen] = useState(false);
  const [usingCachedDraft, setUsingCachedDraft] = useState(false);
  const [retryAttempt, setRetryAttempt] = useState(0);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [manualRefreshPending, setManualRefreshPending] = useState(false);

  const refreshListing = () => {
    setManualRefreshPending(true);
    setReloadNonce((value) => value + 1);
  };

  useEffect(() => {
    if (!isLoading && !isAuthenticated) router.replace("/");
  }, [isLoading, isAuthenticated, router]);

  useEffect(() => {
    if (!isAuthenticated || isNaN(draftId)) return;
    let active = true;
    setError(null);
    const cachedDraft = user?.id ? readDraftDetailCache(user.id, draftId) : null;
    if (cachedDraft) {
      setDraft(cachedDraft);
      setUsingCachedDraft(true);
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
      <AppShell user={user} onLogout={logout} hideMobileNav>
        <div className="mx-auto w-full max-w-[1180px] pb-28 md:pb-10">
          <div className="h-9 w-36 rounded-full bg-foreground/[0.055]" aria-hidden="true" />
          <div className="mt-6 min-h-[55vh] overflow-hidden rounded-[1.75rem] border border-border/60 bg-card">
            <CollectionLoading label={t("common.loading", lang)} className="min-h-[55vh] items-center p-0" />
          </div>
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
      <AppShell user={user} onLogout={logout}>
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
  const images = getImages(draft.raw_uploads, lang);
  const videos = getVideos(draft.raw_uploads, lang);
  const facts = buildFacts(draft, lang, unitCatalog);
  const rows = buildRows(draft, lang, unitCatalog);
  const features = getFeatureChips(draft, lang);
  const monthlyCosts = buildMonthlyCosts(draft, lang, unitCatalog);
  const hasTranslation = !!(draft.description_translated && draft.translation_status === "completed");
  const rawDesc = hasTranslation ? draft.description_translated! : draft.description;
  const description = rawDesc ? stripFormatting(rawDesc) : null;
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
  const hasFloorplan = !!(
    draft.floorplan_id ||
    draft.draft_data?.some((d) => d.data_key === "captured_room_json" || d.data_key === "wall_graph_json")
  );
  const detailsLong = rows.length > 8;
  const visibleRows = detailsExpanded ? rows : rows.slice(0, 8);
  const hasNarrative = Boolean(description || translationPending || hasFloorplan);
  const hasSupportingDetails = rows.length > 0 || features.length > 0 || monthlyCosts.length > 0;


  return (
    <AppShell
      user={user}
      onLogout={logout}
      hideMobileNav
      reaiDraftId={draftId}
      reaiDraftTitle={draft?.title}
      reaiUploadId={activeImageId ?? undefined}
      onReaiDraftUpdated={(updatedDraft) => {
        setDraft(updatedDraft);
        writeDraftDetailCache(user.id, draftId, updatedDraft);
      }}
    >
      <div className="relative mx-auto w-full max-w-[980px] pb-24 md:pb-12">
        {usingCachedDraft && (
          <DraftCacheNotice
            lang={lang}
            refreshing={manualRefreshPending}
            onRefresh={refreshListing}
            className="fixed right-4 top-20 z-50 mb-0 w-[min(28rem,calc(100vw-2rem))] bg-card/95 backdrop-blur-xl md:right-6 md:top-6"
          />
        )}
        {/* Creation toolbar */}
        <div className="mb-4 flex items-center justify-between gap-3 md:mb-6">
          <button type="button" onClick={() => router.push("/dashboard")} className="floating-control -ml-2 inline-flex items-center gap-1.5 px-3 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-foreground/[0.04] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
            <ArrowLeftIcon size={15} />
            {t("common.back", lang)}
          </button>
        </div>

        {/* Media and property summary — one continuous workspace at every width. */}
        <div className="space-y-6 lg:space-y-8">
          {hasMedia && (
            <div className="min-w-0 space-y-4">
              {images.length > 0 && (
                <div className="detail-hero-frame overflow-hidden rounded-[1.5rem] shadow-card ring-1 ring-border/75 sm:rounded-2xl">
                  <DraftImageGallery
                    images={images}
                    alt={draft.title}
                    lang={lang}
                    onActiveImageChange={setActiveImageId}
                    onManage={() => setMediaOpen(true)}
                    manageLabel={t("draft.media.manage", lang)}
                  />
                </div>
              )}
              {videos.length > 0 && (
                <div className="space-y-4">
                  {videos.map((video) => (
                    <video
                      key={video.id}
                      controls
                      playsInline
                      preload="metadata"
                      className="aspect-[16/10] w-full rounded-[1.5rem] bg-black object-cover shadow-card ring-1 ring-border/75 sm:rounded-2xl"
                      aria-label={video.name}
                    >
                      <source src={video.url} />
                    </video>
                  ))}
                </div>
              )}
            </div>
          )}

          <section className={cn("min-w-0", !hasMedia && "max-w-3xl")}>
            <div className="flex flex-wrap items-center gap-2">
              {offerType ? (
                <span className="inline-flex h-6 items-center rounded-full bg-secondary px-2.5 text-[10px] font-semibold uppercase tracking-[0.09em] text-foreground/60">
                  {enumT("offer", offerType, lang)}
                </span>
              ) : null}
              <StatusPill tone={draft.is_complete ? "success" : "neutral"} dot>
                {t(draft.is_complete ? "dashboard.listingComplete" : "dashboard.listingDraft", lang)}
              </StatusPill>
              {hasTour ? <StatusPill tone="strong">{t("dashboard.tourReady", lang)}</StatusPill> : null}
            </div>

            <h1 className="mt-3 text-[28px] font-semibold leading-[1.08] tracking-[-0.03em] sm:text-[30px] lg:text-[34px]">
              {draft.title || t("dashboard.untitled", lang)}
            </h1>
            {address && (
              <p className="mt-2 flex items-start gap-1.5 text-[13px] leading-relaxed text-muted-foreground">
                <MapPinIcon size={14} className="mt-0.5 shrink-0 text-foreground/40" />
                <span>{address}</span>
              </p>
            )}
            {price && (
              <p className="mt-3 text-[22px] font-semibold tracking-[-0.025em] tabular-nums sm:mt-4">
                {price}
                {showOrigPrice && (
                  <span className="ml-2 text-[12px] font-normal tracking-normal text-muted-foreground tabular-nums">{origPrice}</span>
                )}
              </p>
            )}

            <div className="mt-5 grid grid-cols-2 overflow-hidden rounded-2xl border border-border/70 bg-card p-1 shadow-control md:hidden">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-10 min-w-0 rounded-xl px-2"
                onClick={() => setMediaOpen(true)}
              >
                <ImageIcon size={15} />
                <span className="truncate">{t("draft.media.gallery", lang)}</span>
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-10 min-w-0 rounded-xl border-l border-border/70 px-2"
                onClick={() => setVersionsOpen(true)}
              >
                <VersionsIcon size={15} />
                <span className="truncate">{t("draft.versions.short", lang)}</span>
              </Button>
            </div>

            {facts.length > 0 && (
              <div className="mt-5 grid grid-cols-2 gap-2.5 border-t border-border/70 pt-5 sm:grid-cols-3">
                {facts.map((fact) => (
                  <div key={fact.label} className="flex min-w-0 items-center gap-2.5 rounded-xl bg-surface-subtle px-3 py-2.5 ring-1 ring-inset ring-border/35">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-card text-foreground/60 shadow-control">
                      {fact.icon}
                    </span>
                    <span className="min-w-0 leading-tight">
                      <span className="block truncate text-[13px] font-semibold tabular-nums">{fact.value}</span>
                      <span className="mt-1 block truncate text-[10px] font-medium text-muted-foreground">{fact.label}{fact.sub ? ` · ${fact.sub}` : ""}</span>
                    </span>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-6 hidden border-t border-border/70 pt-5 md:flex">
              <div className="inline-flex max-w-full items-center overflow-x-auto rounded-full border border-border/70 bg-card p-1 shadow-control">
                {hasTour && (
                  <Button asChild size="sm" className="shrink-0">
                    <Link href={`/tour/${primarySplatId}?tourId=${shareableTour?.id}`}>
                      <TourIcon size={15} />
                      {t("draft.viewTour", lang)}
                    </Link>
                  </Button>
                )}
                <Button type="button" variant="ghost" size="sm" onClick={() => setMediaOpen(true)}>
                  <ImageIcon size={15} /> {t("draft.media.manage", lang)}
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setEditorOpen(true)}>
                  <EditIcon size={14} /> {t("shareDialog.edit", lang)}
                </Button>
                <Button asChild variant="ghost" size="sm">
                  <Link href={`/draft/${draftId}/sharing`} prefetch>
                    <ShareIcon size={14} /> {t("draft.share", lang)}
                  </Link>
                </Button>
                <span aria-hidden="true" className="mx-1 h-5 w-px bg-border/80" />
                <Button type="button" variant="ghost" size="sm" onClick={() => setVersionsOpen(true)}>
                  <VersionsIcon size={15} /> {t("draft.versions.title", lang)}
                </Button>
              </div>
            </div>
          </section>
        </div>

        <DraftTourAssetsPanel
          draftId={draftId}
          lang={lang}
          splats={splatData?.splats}
          initialPayload={tourAssets}
          onPayloadChanged={setTourAssets}
          onPrimaryChanged={(activeSplatId) => setSplatData((current) => (
            current ? { ...current, parent_splat_id: activeSplatId } : current
          ))}
        />

        {(hasNarrative || hasSupportingDetails) && (
          <div className="mt-8 space-y-7 lg:mt-10">
            {hasNarrative && (
              <div className="min-w-0 space-y-7">
                {(description || translationPending) && (
                  <section>
                    <h2 className="mb-3 flex items-center gap-2 text-[14px] font-semibold">
                      <DocumentIcon size={16} className="text-foreground/55" />
                      {t("draft.description", lang)}
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
                  <section>
                    <h2 className="mb-3 flex items-center gap-2 text-[14px] font-semibold">
                      <FloorplanIcon size={16} className="text-foreground/55" />
                      {t("draft.floorplan", lang)}
                    </h2>
                    <div className="overflow-hidden rounded-[1.5rem] sm:rounded-2xl">
                      <FloorplanViewer
                        draftData={draft.draft_data ?? []}
                        floorplanId={draft.floorplan_id}
                        lang={lang}
                        units={unitCatalog}
                        targetAreaUnit={draft.area_preferred_unit ?? draft.area_unit}
                      />
                    </div>
                  </section>
                )}
              </div>
            )}

            {hasSupportingDetails && (
              <div className="min-w-0 space-y-7">
                {rows.length > 0 && (
                  <section>
                    <h2 className="mb-3 flex items-center gap-2 text-[14px] font-semibold">
                      <InfoIcon size={16} className="text-foreground/55" />
                      {t("draft.details", lang)}
                    </h2>
                    <div className="overflow-hidden rounded-[1.5rem] border border-border/70 bg-card shadow-card sm:rounded-2xl">
                      {visibleRows.map((row, index) => (
                        <div key={`${row.label}-${index}`} className={cn("flex items-start justify-between gap-4 px-4 py-3", (index < visibleRows.length - 1 || detailsLong) && "border-b border-border/45")}>
                          <span className="min-w-0 break-words text-[12px] leading-relaxed text-muted-foreground">{row.label}</span>
                          <span className="min-w-0 max-w-[58%] break-words text-right text-[12px] font-semibold leading-relaxed text-foreground tabular-nums">{row.value}</span>
                        </div>
                      ))}
                      {detailsLong && (
                        <div className="flex justify-center px-3 py-2.5">
                          <button type="button" aria-expanded={detailsExpanded} onClick={() => setDetailsExpanded(!detailsExpanded)} className="rounded-full px-3 py-1.5 text-[12px] font-semibold text-foreground/55 transition-colors hover:bg-foreground/[0.045] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
                            {detailsExpanded ? t("draft.showLess", lang) : t("draft.showMore", lang)}
                          </button>
                        </div>
                      )}
                    </div>
                  </section>
                )}

                {features.length > 0 && (
                  <section>
                    <h2 className="mb-3 flex items-center gap-2 text-[14px] font-semibold">
                      <StarIcon size={16} className="text-foreground/55" />
                      {t("draft.features", lang)}
                    </h2>
                    <div className="flex flex-wrap gap-2 rounded-[1.5rem] border border-border/70 bg-card p-4 shadow-card sm:rounded-2xl">
                      {features.map((feature) => (
                        <span key={feature} className="inline-flex min-h-8 items-center rounded-full border border-border/65 bg-surface-subtle px-3 py-1 text-[11px] font-medium text-foreground/75">
                          {feature}
                        </span>
                      ))}
                    </div>
                  </section>
                )}

                {monthlyCosts.length > 0 && (
                  <section>
                    <h2 className="mb-3 flex items-center gap-2 text-[14px] font-semibold">
                      <PriceIcon size={16} className="text-foreground/55" />
                      {t("draft.monthlyCosts", lang)}
                    </h2>
                    <div className="overflow-hidden rounded-[1.5rem] border border-border/70 bg-card shadow-card sm:rounded-2xl">
                      {monthlyCosts.map((row, index) => (
                        <div key={`${row.label}-${index}`} className={cn("flex items-center justify-between gap-4 px-4 py-3", index < monthlyCosts.length - 1 && "border-b border-border/45")}>
                          <span className="min-w-0 break-words text-[12px] text-muted-foreground">{row.label}</span>
                          <span className="min-w-0 max-w-[58%] break-words text-right text-[12px] font-semibold text-foreground tabular-nums">{row.value}</span>
                        </div>
                      ))}
                    </div>
                  </section>
                )}
              </div>
            )}
          </div>
        )}

      </div>

      <DraftEditor open={editorOpen} onOpenChange={setEditorOpen} draft={draft} units={unitCatalog} lang={lang} onSaved={setDraft} />
      <DraftMediaManager
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

      {/* Sticky mobile action bar */}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 px-3 pb-[max(0.625rem,env(safe-area-inset-bottom))] md:hidden">
        <div className={cn(
          "pointer-events-auto mx-auto grid max-w-md gap-1 rounded-[1.35rem] border border-border/80 bg-card/95 p-1.5 shadow-floating backdrop-blur-xl",
          hasTour ? "grid-cols-[0.9fr_0.9fr_1.2fr]" : "grid-cols-2",
        )}>
        <Button type="button" variant="ghost" size="sm" className="h-11 min-w-0 rounded-2xl px-2" onClick={() => setEditorOpen(true)}>
          <EditIcon size={15} /> {t("shareDialog.edit", lang)}
        </Button>
        <Button asChild variant="ghost" size="sm" className="h-11 min-w-0 rounded-2xl px-2">
          <Link href={`/draft/${draftId}/sharing`} prefetch aria-label={t("draft.share", lang)}>
            <ShareIcon size={15} />
            <span className="truncate">{t("draft.share", lang)}</span>
          </Link>
        </Button>
        {hasTour && (
          <Button asChild variant="default" size="sm" className="h-11 min-w-0 rounded-2xl px-2">
            <Link href={`/tour/${primarySplatId}?tourId=${shareableTour?.id}`}>
              <TourIcon size={15} />
              <span className="truncate">{t("draft.viewTourShort", lang)}</span>
            </Link>
          </Button>
        )}
        </div>
      </div>
    </AppShell>
  );
}

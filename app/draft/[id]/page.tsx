"use client";

import { useEffect, useState, use, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "../../components/hooks/use-auth";
import { AppShell } from "../../components/app-shell";
import { Button } from "../../lib/ui/button";
import { getDraft, getSplatsByDraft, getFloorplan, translateDraftDescription } from "../../lib/api/client";
import type { FloorplanDetail } from "../../lib/api/client";
import { isApiNotFound } from "../../lib/api/error-message";
import { getUserLanguage, t } from "../../lib/i18n";
import { ShareDialog } from "../../components/share-dialog";
import { DraftImageGallery } from "../../components/draft-image-gallery";
import type { DraftDetailItem, DraftUpload, SplatsByDraftPayload } from "../../lib/tour-types";

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
  try {
    return new Intl.NumberFormat(lang, { style: "currency", currency: currency || "EUR", maximumFractionDigits: 0 }).format(n);
  } catch {
    return `${fmt(n, lang)}${currency ? ` ${currency}` : ""}`;
  }
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

function getImages(uploads: DraftUpload[]) {
  return (uploads ?? [])
    .filter((u) => u.mime_type?.startsWith("image") || u.asset_type === "photo")
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((u) => ({ url: u.file_url }));
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
  bed: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-foreground/40 flex-shrink-0"><path d="M2 4v16"/><path d="M2 8h18a2 2 0 0 1 2 2v10"/><path d="M2 17h20"/><path d="M6 8v9"/></svg>,
  bath: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-foreground/40 flex-shrink-0"><path d="M4 12h16a1 1 0 0 1 1 1v3a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4v-3a1 1 0 0 1 1-1Z"/><path d="M6 12V5a2 2 0 0 1 2-2h3v2.25"/><path d="M4 21l1-1.5"/><path d="M20 21l-1-1.5"/></svg>,
  rooms: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-foreground/40 flex-shrink-0"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 12h18"/><path d="M12 3v18"/></svg>,
  area: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-foreground/40 flex-shrink-0"><rect x="3" y="3" width="18" height="18" rx="1"/><path d="M3 9h18"/><path d="M9 3v18"/></svg>,
  lot: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-foreground/40 flex-shrink-0"><path d="M2 22l5-5"/><path d="M7 22H2v-5"/><path d="M22 2l-5 5"/><path d="M17 2h5v5"/><rect x="6" y="6" width="12" height="12" rx="1"/></svg>,
  year: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-foreground/40 flex-shrink-0"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/></svg>,
  building: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-foreground/40 flex-shrink-0"><rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01M16 6h.01M12 6h.01M12 10h.01M12 14h.01M16 10h.01M16 14h.01M8 10h.01M8 14h.01"/></svg>,
  floor: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-foreground/40 flex-shrink-0"><path d="M22 20H2"/><path d="M6 20v-4"/><path d="M10 20V10"/><path d="M14 20V6"/><path d="M18 20V4"/></svg>,
  condition: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-foreground/40 flex-shrink-0"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>,
  energy: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-foreground/40 flex-shrink-0"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8Z"/></svg>,
  heating: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-foreground/40 flex-shrink-0"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14 0-5.5 2.5-7 .75 1.5 1 2.5 1 4 0 2.5-1.5 3-2.5 5s-.5 3 1 5"/><path d="M12.5 18a2.5 2.5 0 0 0 0-5 2.5 2.5 0 0 0 0 5Z"/></svg>,
  elevator: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-foreground/40 flex-shrink-0"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 7l4-4 4 4"/><path d="M8 17l4 4 4-4"/></svg>,
  parking: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-foreground/40 flex-shrink-0"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 17V7h4a3 3 0 0 1 0 6H9"/></svg>,
  compass: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-foreground/40 flex-shrink-0"><circle cx="12" cy="12" r="10"/><path d="M16.24 7.76l-2.12 6.36-6.36 2.12 2.12-6.36 6.36-2.12Z"/></svg>,
  water: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-foreground/40 flex-shrink-0"><path d="M12 2s-6 7-6 11a6 6 0 0 0 12 0c0-4-6-11-6-11Z"/></svg>,
  legal: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-foreground/40 flex-shrink-0"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/></svg>,
  money: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-foreground/40 flex-shrink-0"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>,
  dot: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-foreground/40 flex-shrink-0"><circle cx="12" cy="12" r="4"/></svg>,
  check: <svg width="10" height="10" viewBox="0 0 16 16" fill="none" className="text-foreground/30 flex-shrink-0"><path d="M2 8l4 4 8-8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>,
};

// ── Facts grid (hero stats like iOS) ──────────────────────────────────────

interface Fact { icon: ReactNode; value: string; label: string; sub?: string }

function buildFacts(d: DraftDetailItem, lang: string): Fact[] {
  const facts: Fact[] = [];
  const addFact = (icon: ReactNode, value: unknown, label: string, sub?: string | null) => {
    if (value != null && value !== "" && value !== 0) facts.push({ icon, value: String(value), label, sub: sub || undefined });
  };
  addFact(I.bed, sec(d, "layout", "bedrooms"), t("draft.bedrooms", lang));
  addFact(I.bath, sec(d, "layout", "bathrooms"), t("draft.bathrooms", lang));

  // Area: show preferred, with original as sub if different unit
  const area = d.area_preferred ?? d.area;
  const areaUnit = d.area_preferred_unit ?? d.area_unit_display ?? "";
  const origAreaStr = d.area && d.area_unit_display && d.area_preferred_unit !== d.area_unit_display
    ? `${fmt(d.area, lang)} ${d.area_unit_display}`
    : null;
  if (area) addFact(I.area, `${fmt(area, lang)} ${areaUnit}`.trim(), t("draft.area", lang), origAreaStr);

  addFact(I.floor, sec(d, "layout", "floors") ?? sec(d, "technical", "total_floors"), t("draft.totalFloors", lang));
  addFact(I.parking, sec(d, "layout", "parking_spaces"), t("draft.parkingSpaces", lang));
  addFact(I.year, d.year_built ?? sec(d, "technical", "year_built"), t("draft.yearBuilt", lang));
  return facts;
}

// ── Row builder (detail params — excludes facts shown in grid) ────────────

interface Row { icon: ReactNode; label: string; value: string }

function buildRows(d: DraftDetailItem, lang: string): Row[] {
  const rows: Row[] = [];
  const push = (icon: ReactNode, label: string, value: unknown) => {
    if (value == null || value === "" || value === false) return;
    rows.push({ icon, label, value: value === true ? t("common.yes", lang) : String(value) });
  };
  type LK = import("../../lib/locales/en").LocaleKey;
  const areaUnit = d.area_preferred_unit ?? d.area_unit_display ?? "";
  const fmtArea = (v: unknown) => v && Number(v) > 0 ? `${fmt(v as number, lang)} ${areaUnit}`.trim() : null;

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
  const lotUnit = d.lot_size_unit ?? areaUnit;
  if (lot && Number(lot) > 0) push(I.lot, t("draft.lotSize", lang), `${fmt(lot, lang)} ${lotUnit}`.trim());

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
    if (fmtArea(v)) push(I.area, t(tKey, lang), fmtArea(v));
  }
  // Plot dimensions (not area-formatted)
  const plotW = sec(d, "areas", "plot_width");
  if (plotW && Number(plotW) > 0) push(I.lot, t("draft.plotWidth", lang), `${fmt(plotW as number, lang)} m`);
  const plotL = sec(d, "areas", "plot_length");
  if (plotL && Number(plotL) > 0) push(I.lot, t("draft.plotLength", lang), `${fmt(plotL as number, lang)} m`);

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
  if (ceilingH && Number(ceilingH) > 0) push(I.floor, t("draft.ceilingHeight", lang), `${fmt(ceilingH as number, lang)} m`);

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
  if (deposit && Number(deposit) > 0) push(I.money, t("draft.deposit", lang), fmt(deposit as number, lang));
  const agencyFee = sec(d, "pricing_extra", "agency_fee");
  if (agencyFee && Number(agencyFee) > 0) push(I.money, t("draft.agencyFee", lang), fmt(agencyFee as number, lang));
  const utilitiesAdv = sec(d, "pricing_extra", "utilities_advance");
  if (utilitiesAdv && Number(utilitiesAdv) > 0) push(I.money, t("draft.utilitiesAdvance", lang), fmt(utilitiesAdv as number, lang));
  const furnSepPrice = sec(d, "pricing_extra", "furnishing_separate_price");
  if (furnSepPrice && Number(furnSepPrice) > 0) push(I.money, t("draft.furnishingSeparatePrice", lang), fmt(furnSepPrice as number, lang));
  const parkPrice = sec(d, "pricing_extra", "parking_standalone_price");
  if (parkPrice && Number(parkPrice) > 0) push(I.money, t("draft.parkingStandalonePrice", lang), fmt(parkPrice as number, lang));
  const storPrice = sec(d, "pricing_extra", "storage_price");
  if (storPrice && Number(storPrice) > 0) push(I.money, t("draft.storagePrice", lang), fmt(storPrice as number, lang));
  const vatMode = sec(d, "pricing_extra", "vat_mode");
  if (vatMode) push(I.money, t("draft.vatMode", lang), enumT("vat", vatMode, lang));
  const vatRate = sec(d, "pricing_extra", "vat_rate");
  if (vatRate && Number(vatRate) > 0) push(I.money, t("draft.vatRate", lang), `${vatRate}%`);

  return rows;
}

// ── Monthly costs builder ────────────────────────────────────────────────

function buildMonthlyCosts(d: DraftDetailItem, lang: string): Row[] {
  const rows: Row[] = [];
  const push = (label: string, value: unknown) => {
    if (value == null || value === "") return;
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return;
    rows.push({ icon: I.money, label, value: fmt(n, lang)! });
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

export default function DraftPreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const draftId = parseInt(id, 10);
  const { isAuthenticated, isLoading, user, logout } = useAuth();
  const router = useRouter();
  const lang = getUserLanguage(user?.localization);

  const [draft, setDraft] = useState<DraftDetailItem | null>(null);
  const [splatData, setSplatData] = useState<SplatsByDraftPayload | null>(null);
  const [floorplan, setFloorplan] = useState<FloorplanDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [descExpanded, setDescExpanded] = useState(false);
  const [floorplanOpen, setFloorplanOpen] = useState(false);
  const [shareTarget, setShareTarget] = useState<{ splatId: number; title: string } | null>(null);
  const [translationPending, setTranslationPending] = useState(false);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) router.replace("/");
  }, [isLoading, isAuthenticated, router]);

  useEffect(() => {
    if (!isAuthenticated || isNaN(draftId)) return;
    Promise.all([
      getDraft(draftId),
      getSplatsByDraft(draftId).catch(() => null),
    ]).then(([d, s]) => {
      setDraft(d);
      setSplatData(s);
      if (d.floorplan_id) getFloorplan(d.floorplan_id).then(setFloorplan).catch(() => {});
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
      setError(isApiNotFound(err) ? "notFound" : "loadFailed");
    });
  }, [isAuthenticated, draftId, lang]);

  if (isLoading || (!draft && !error)) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-3">
          <div className="animate-spin h-7 w-7 border-2 border-foreground/15 border-t-foreground/60 rounded-full mx-auto" />
          <p className="text-xs text-muted-foreground">{t("draft.loading", lang)}</p>
        </div>
      </div>
    );
  }

  if (error) {
    const nf = error === "notFound";
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="text-center space-y-4 max-w-xs">
          <div className="mx-auto w-12 h-12 rounded-full bg-foreground/[0.04] flex items-center justify-center">
            {nf
              ? <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="text-foreground/30"><circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="1.5"/><path d="M21 21l-4.35-4.35" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><path d="M8 11h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
              : <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="text-foreground/30"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5"/><path d="M12 8v4M12 16h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
            }
          </div>
          <p className="text-[14px] font-medium text-foreground/70">{nf ? t("draft.error.notFoundTitle", lang) : t("draft.error.failedTitle", lang)}</p>
          <p className="text-[13px] text-foreground/40 leading-relaxed">{nf ? t("draft.error.notFound", lang) : t("draft.error.loadFailed", lang)}</p>
          <div className="flex items-center justify-center gap-2 pt-1">
            {!nf && <Button variant="outline" size="sm" onClick={() => setError(null)}>{t("common.tryAgain", lang)}</Button>}
            <Button variant="outline" size="sm" onClick={() => router.push("/dashboard")}>{t("nav.dashboard", lang)}</Button>
          </div>
        </div>
      </div>
    );
  }

  if (!draft || !user) return null;

  // Price: show preferred (converted) price prominently, original smaller if different currency
  const prefPrice = fmtMoney(draft.price_preferred, draft.price_preferred_currency, lang);
  const origPrice = fmtMoney(draft.price, draft.currency, lang);
  const price = prefPrice || origPrice;
  const showOrigPrice = prefPrice && origPrice && draft.price_preferred_currency !== draft.currency;

  // Area: preferred vs original
  const prefArea = draft.area_preferred;
  const prefAreaUnit = draft.area_preferred_unit;
  const origArea = draft.area;
  const origAreaUnit = draft.area_unit_display;
  const showOrigArea = prefArea && origArea && prefAreaUnit !== origAreaUnit;

  const address = draft.display_address || [draft.city, draft.state, draft.country].filter(Boolean).join(", ");
  const images = getImages(draft.raw_uploads);
  const facts = buildFacts(draft, lang);
  const rows = buildRows(draft, lang);
  const features = getFeatureChips(draft, lang);
  const monthlyCosts = buildMonthlyCosts(draft, lang);
  const hasTranslation = !!(draft.description_translated && draft.translation_status === "completed");
  const rawDesc = hasTranslation ? draft.description_translated! : draft.description;
  const description = rawDesc ? stripFormatting(rawDesc) : null;
  const descLong = description && description.length > 200;
  const offerType = sec(draft, "taxonomy", "offer_type");

  const primarySplat = splatData?.parent_splat_id
    ? splatData.splats.find((s) => (s.splat_id ?? s.id) === splatData.parent_splat_id) ?? splatData.splats[0]
    : splatData?.splats[0];
  const hasTour = !!primarySplat;
  const primarySplatId = primarySplat ? (primarySplat.splat_id ?? primarySplat.id) : undefined;
  const thumbUrl = primarySplat?.signed_outputs?.thumbnail ?? null;
  const fpUrl = floorplan?.composite_url ?? null;

  return (
    <AppShell user={user} onLogout={logout}>
      <div className="mx-auto w-full max-w-2xl animate-fade-in pb-10">
        {/* Back */}
        <button onClick={() => router.back()} className="mb-3 flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground transition-colors">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M10 12L6 8L10 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          {t("common.back", lang)}
        </button>

        {/* Gallery */}
        <DraftImageGallery images={images} alt={draft.title} fallbackUrl={thumbUrl} lang={lang} />

        {/* Header */}
        <div className="mt-4 space-y-1">
          {offerType ? (
            <span className="inline-block text-[11px] font-medium uppercase tracking-wider text-foreground/40 mb-0.5">
              {enumT("offer", offerType, lang)}
            </span>
          ) : null}
          <h1 className="text-[20px] font-semibold tracking-tight leading-tight">{draft.title || t("dashboard.untitled", lang)}</h1>
          {address && (
            <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" className="flex-shrink-0"><path d="M8 1.5a4.5 4.5 0 0 1 4.5 4.5c0 3.5-4.5 8.5-4.5 8.5S3.5 9.5 3.5 6A4.5 4.5 0 0 1 8 1.5Z" stroke="currentColor" strokeWidth="1.2"/><circle cx="8" cy="6" r="1.5" stroke="currentColor" strokeWidth="1.2"/></svg>
              {address}
            </p>
          )}
          {price && (
            <div className="pt-0.5">
              <p className="text-[18px] font-semibold text-foreground">{price}</p>
              {showOrigPrice && (
                <p className="text-[12px] text-muted-foreground">{origPrice}</p>
              )}
            </div>
          )}
        </div>

        {/* Facts */}
        {facts.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-3">
            {facts.map((f, i) => (
              <div key={i} className="flex items-center gap-2 rounded-lg border border-border/60 px-3 py-2">
                <span className="text-foreground/35">{f.icon}</span>
                <div>
                  <span className="text-[14px] font-semibold tabular-nums leading-tight">{f.value}</span>
                  <span className="ml-1 text-[11px] text-muted-foreground">{f.label}</span>
                  {f.sub && <p className="text-[10px] text-muted-foreground/70">{f.sub}</p>}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Detail attributes */}
        {rows.length > 0 && (
          <div className="mt-5 rounded-lg border border-border/70 divide-y divide-border/50">
            {rows.map((r, i) => (
              <div key={i} className="flex items-center gap-3 px-3.5 py-2.5">
                {r.icon}
                <span className="text-[13px] text-muted-foreground flex-1">{r.label}</span>
                <span className="text-[13px] font-medium text-foreground/85">{r.value}</span>
              </div>
            ))}
          </div>
        )}

        {/* Description */}
        {(description || translationPending) && (
          <div className="mt-5">
            <h2 className="text-[14px] font-semibold mb-2">{t("draft.description", lang)}</h2>
            {translationPending && !hasTranslation && (
              <p className="text-[12px] text-foreground/40 italic mb-2">{t("draft.descriptionPending", lang)}</p>
            )}
            {description && (
              <div className="rounded-lg border border-border/70 px-3.5 py-3">
                <p className={`text-[13px] leading-[1.7] text-foreground/70 whitespace-pre-line ${!descExpanded && descLong ? "line-clamp-5" : ""}`}>
                  {description}
                </p>
                {descLong && (
                  <button onClick={() => setDescExpanded(!descExpanded)} className="mt-2 text-[12px] font-medium text-foreground/50 hover:text-foreground transition-colors">
                    {descExpanded ? t("draft.showLess", lang) : t("draft.showMore", lang)}
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Features */}
        {features.length > 0 && (
          <div className="mt-5">
            <h2 className="text-[14px] font-semibold mb-2">{t("draft.features", lang)}</h2>
            <div className="flex flex-wrap gap-1.5">
              {features.map((f) => (
                <span key={f} className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-muted/30 px-2.5 py-1 text-[12px] text-foreground/70">
                  {I.check} {f}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Monthly costs */}
        {monthlyCosts.length > 0 && (
          <div className="mt-5">
            <h2 className="text-[14px] font-semibold mb-2">{t("draft.monthlyCosts", lang)}</h2>
            <div className="rounded-lg border border-border/70 divide-y divide-border/50">
              {monthlyCosts.map((r, i) => (
                <div key={i} className="flex items-center gap-3 px-3.5 py-2.5">
                  {r.icon}
                  <span className="text-[13px] text-muted-foreground flex-1">{r.label}</span>
                  <span className="text-[13px] font-medium text-foreground/85">{r.value}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Location map — placeholder, awaiting Google Maps API key */}

        {/* Floorplan */}
        {fpUrl && (
          <div className="mt-5">
            <button onClick={() => setFloorplanOpen(!floorplanOpen)} className="flex w-full items-center justify-between rounded-lg border border-border/70 px-3.5 py-2.5 hover:bg-muted/20 transition-colors">
              <span className="flex items-center gap-2 text-[14px] font-semibold">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-foreground/40"><rect x="2" y="2" width="20" height="20" rx="2"/><path d="M2 8h20M8 2v20M14 8v14"/></svg>
                {t("draft.floorplan", lang)}
              </span>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className={`text-foreground/40 transition-transform duration-200 ${floorplanOpen ? "rotate-180" : ""}`}><path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
            {floorplanOpen && (
              <div className="mt-2 overflow-hidden rounded-lg border border-border/70 bg-white">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={fpUrl} alt={t("tour.floorplan.alt", lang)} className="w-full" loading="lazy" />
              </div>
            )}
          </div>
        )}

        {/* Actions */}
        {hasTour && (
          <div className="mt-6 flex gap-2">
            <Button variant="outline" size="sm" className="flex-1" onClick={() => setShareTarget({ splatId: primarySplatId!, title: draft.title })}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mr-1.5"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.59 13.51l6.83 3.98M15.41 6.51l-6.82 3.98"/></svg>
              {t("draft.share", lang)}
            </Button>
            <Link href={`/tour/${primarySplatId}`} className="flex-1">
              <Button variant="default" size="sm" className="w-full">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mr-1.5"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12"/></svg>
                {t("draft.viewTour", lang)}
              </Button>
            </Link>
          </div>
        )}
      </div>

      {shareTarget && <ShareDialog splatId={shareTarget.splatId} title={shareTarget.title} open={!!shareTarget} onClose={() => setShareTarget(null)} lang={lang} />}
    </AppShell>
  );
}

import type { LocaleKey } from "./locales/en";

/**
 * Web mirror of the iOS PropertyFieldRegistry.
 *
 * Keep keys and enum values aligned with `PropertyFieldRegistry.swift`. Values
 * are persisted through the canonical Django `specs` payload. A field marked
 * `core` is edited in the Basic form and intentionally omitted from Advanced
 * so the same fact never appears twice.
 */
export type PropertyType = "apartment" | "house" | "land" | "commercial" | "other";
export type OfferType = "sale" | "rent";
export type PropertySpecSection = "taxonomy" | "layout" | "areas" | "technical" | "utilities" | "features" | "legal" | "pricing_extra";
export type PropertyFieldKind = "text" | "number" | "decimal" | "boolean" | "select" | "multiselect" | "subtype";

export interface PropertyFieldOption {
  value: string;
  labelKey: LocaleKey;
}

export interface PropertyFieldDefinition {
  key: string;
  labelKey: LocaleKey;
  kind: PropertyFieldKind;
  options?: PropertyFieldOption[];
  visibleFor?: PropertyType[];
  offerType?: OfferType;
  core?: boolean;
  min?: number;
  max?: number;
}

export interface PropertyFieldSectionDefinition {
  key: PropertySpecSection;
  labelKey: LocaleKey;
  fields: PropertyFieldDefinition[];
}

const buildings: PropertyType[] = ["apartment", "house", "commercial", "other"];
const residential: PropertyType[] = ["apartment", "house", "other"];

const option = (value: string, labelKey: LocaleKey): PropertyFieldOption => ({ value, labelKey });

const propertyOptions: PropertyFieldOption[] = [
  option("apartment", "enum.property.apartment"),
  option("house", "enum.property.house"),
  option("land", "enum.property.land"),
  option("commercial", "enum.property.commercial"),
  option("other", "enum.property.other"),
];

const PROPERTY_SUBTYPES: Record<PropertyType, PropertyFieldOption[]> = {
  apartment: [
    option("flat", "enum.subtype.flat"), option("apartment", "enum.subtype.apartment"),
    option("studio", "enum.subtype.studio"), option("loft", "enum.subtype.loft"),
    option("penthouse", "enum.subtype.penthouse"), option("duplex", "enum.subtype.duplex"),
  ],
  house: [
    option("house", "enum.subtype.house"), option("villa", "enum.subtype.villa"),
    option("townhouse", "enum.subtype.townhouse"), option("bungalow", "enum.subtype.bungalow"),
    option("cottage", "enum.subtype.cottage"), option("condo", "enum.subtype.condo"),
  ],
  land: [
    option("building_land", "enum.subtype.building_land"), option("agricultural", "enum.subtype.agricultural"),
    option("forest", "enum.subtype.forest"), option("commercial_land", "enum.subtype.commercial_land"),
    option("mixed_use", "enum.subtype.mixed_use"),
  ],
  commercial: [
    option("office", "enum.subtype.office"), option("retail", "enum.subtype.retail"),
    option("warehouse", "enum.subtype.warehouse"), option("restaurant", "enum.subtype.restaurant"),
    option("hotel", "enum.subtype.hotel"), option("production", "enum.subtype.production"),
  ],
  other: [
    option("garage", "enum.subtype.garage"), option("storage", "enum.subtype.storage"),
    option("houseboat", "enum.subtype.houseboat"), option("other", "enum.subtype.other"),
  ],
};

export const PROPERTY_FIELD_SECTIONS: PropertyFieldSectionDefinition[] = [
  {
    key: "taxonomy",
    labelKey: "draft.editor.classification",
    fields: [
      { key: "offer_type", labelKey: "draft.editor.offerType", kind: "select", options: [option("sale", "enum.offer.sale"), option("rent", "enum.offer.rent")] },
      { key: "property_type", labelKey: "draft.propertyType", kind: "select", options: propertyOptions },
      { key: "property_subtype", labelKey: "draft.propertySubtype", kind: "subtype" },
    ],
  },
  {
    key: "layout",
    labelKey: "draft.editor.layout",
    fields: [
      { key: "bedrooms", labelKey: "draft.bedrooms", kind: "number", min: 0, max: 20, visibleFor: residential, core: true },
      { key: "bathrooms", labelKey: "draft.bathrooms", kind: "decimal", min: 0, max: 10, visibleFor: residential, core: true },
      { key: "rooms", labelKey: "draft.rooms", kind: "number", min: 0, max: 30, visibleFor: residential },
      { key: "living_rooms", labelKey: "draft.livingRooms", kind: "number", min: 0, max: 10, visibleFor: residential },
      { key: "kitchens", labelKey: "draft.kitchens", kind: "number", min: 0, max: 5 },
      { key: "kitchenettes", labelKey: "draft.kitchenettes", kind: "number", min: 0, max: 5, visibleFor: residential },
      { key: "toilets", labelKey: "draft.toilets", kind: "number", min: 0, max: 10 },
      { key: "separate_toilets", labelKey: "draft.separateToilets", kind: "number", min: 0, max: 5, visibleFor: residential },
      { key: "wardrobes", labelKey: "draft.wardrobes", kind: "number", min: 0, max: 10, visibleFor: residential },
      { key: "pantries", labelKey: "draft.pantries", kind: "number", min: 0, max: 5, visibleFor: residential },
      { key: "floors", labelKey: "draft.totalFloors", kind: "number", min: 0, max: 99, visibleFor: buildings },
      { key: "floors_above_ground", labelKey: "draft.floorsAboveGround", kind: "number", min: 0, max: 10, visibleFor: ["house"] },
      { key: "open_space_zones", labelKey: "draft.openSpaceZones", kind: "number", min: 0, max: 20, visibleFor: ["commercial"] },
      { key: "meeting_rooms", labelKey: "draft.meetingRooms", kind: "number", min: 0, max: 20, visibleFor: ["commercial"] },
      { key: "storage_rooms", labelKey: "draft.storageRooms", kind: "number", min: 0, max: 10, visibleFor: ["commercial"] },
      { key: "buildability", labelKey: "draft.buildability", kind: "select", visibleFor: ["land"], options: [option("buildable", "enum.buildability.buildable"), option("not_buildable", "enum.buildability.not_buildable"), option("partially", "enum.buildability.partially")] },
      { key: "access_road", labelKey: "draft.accessRoad", kind: "select", visibleFor: ["land"], options: [option("paved", "enum.access_road.paved"), option("gravel", "enum.access_road.gravel"), option("dirt", "enum.access_road.dirt"), option("none", "enum.access_road.none")] },
    ],
  },
  {
    key: "areas",
    labelKey: "draft.editor.areas",
    fields: [
      { key: "floor_area", labelKey: "draft.floorArea", kind: "decimal", visibleFor: buildings, core: true },
      { key: "land_area", labelKey: "draft.landArea", kind: "decimal" },
      { key: "basement_area", labelKey: "draft.basementArea", kind: "decimal", visibleFor: buildings },
      { key: "balcony_area", labelKey: "draft.balconyArea", kind: "decimal", visibleFor: buildings },
      { key: "loggia_area", labelKey: "draft.loggiaArea", kind: "decimal", visibleFor: buildings },
      { key: "terrace_area", labelKey: "draft.terraceArea", kind: "decimal", visibleFor: buildings },
      { key: "garden_area", labelKey: "draft.gardenArea", kind: "decimal", visibleFor: ["house", "other"] },
      { key: "front_garden_area", labelKey: "draft.frontGardenArea", kind: "decimal", visibleFor: buildings },
      { key: "plot_width", labelKey: "draft.plotWidth", kind: "decimal", visibleFor: ["land", "house"] },
      { key: "plot_length", labelKey: "draft.plotLength", kind: "decimal", visibleFor: ["land", "house"] },
      { key: "built_up_area", labelKey: "draft.builtUpArea", kind: "decimal", visibleFor: ["land", "house"] },
      { key: "office_area", labelKey: "draft.officeArea", kind: "decimal", visibleFor: ["commercial"] },
      { key: "warehouse_area", labelKey: "draft.warehouseArea", kind: "decimal", visibleFor: ["commercial"] },
    ],
  },
  {
    key: "technical",
    labelKey: "draft.editor.technical",
    fields: [
      { key: "condition", labelKey: "draft.condition", kind: "select", visibleFor: buildings, options: [option("new", "enum.condition.new"), option("very_good", "enum.condition.very_good"), option("good", "enum.condition.good"), option("fair", "enum.condition.fair"), option("to_renovate", "enum.condition.to_renovate"), option("under_construction", "enum.condition.under_construction"), option("shell", "enum.condition.shell")] },
      { key: "year_built", labelKey: "draft.yearBuilt", kind: "number", min: 1850, visibleFor: buildings, core: true },
      { key: "renovation_year", labelKey: "draft.renovationYear", kind: "number", min: 1950, visibleFor: buildings },
      { key: "construction_type", labelKey: "draft.constructionType", kind: "select", visibleFor: buildings, options: [option("brick", "enum.construction.brick"), option("panel", "enum.construction.panel"), option("wood", "enum.construction.wood"), option("concrete", "enum.construction.concrete"), option("steel", "enum.construction.steel"), option("mixed", "enum.construction.mixed"), option("other", "enum.construction.other")] },
      { key: "floor", labelKey: "draft.floor", kind: "number", min: -5, max: 200, visibleFor: ["apartment", "commercial", "other"] },
      { key: "total_floors", labelKey: "draft.totalFloors", kind: "number", min: 1, max: 200, visibleFor: buildings },
      { key: "elevator", labelKey: "draft.elevator", kind: "boolean", visibleFor: buildings },
      { key: "energy_certificate", labelKey: "draft.energyRating", kind: "select", visibleFor: buildings, options: ["A0", "A1", "B", "C", "D", "E", "F", "G"].map((value) => option(value, `enum.energy.${value}` as LocaleKey)) },
      { key: "orientation", labelKey: "draft.orientation", kind: "select", visibleFor: buildings, options: ["north", "south", "east", "west", "northeast", "northwest", "southeast", "southwest"].map((value) => option(value, `enum.orientation.${value}` as LocaleKey)) },
      { key: "roof_type", labelKey: "draft.roofType", kind: "select", visibleFor: ["house", "other"], options: ["flat", "pitched", "hip", "mansard", "gable"].map((value) => option(value, `enum.roof.${value}` as LocaleKey)) },
      { key: "photovoltaics", labelKey: "draft.feat.photovoltaics", kind: "boolean", visibleFor: ["house", "other"] },
      { key: "smart_features", labelKey: "draft.feat.smart_features", kind: "boolean", visibleFor: buildings },
      { key: "recuperation", labelKey: "draft.feat.recuperation", kind: "boolean", visibleFor: buildings },
      { key: "ventilation", labelKey: "draft.feat.ventilation", kind: "boolean", visibleFor: ["commercial"] },
      { key: "loading_ramp", labelKey: "draft.feat.loading_ramp", kind: "boolean", visibleFor: ["commercial"] },
      { key: "ceiling_height", labelKey: "draft.ceilingHeight", kind: "decimal", visibleFor: ["commercial"] },
      { key: "reception", labelKey: "draft.feat.reception", kind: "boolean", visibleFor: ["commercial"] },
      { key: "attic", labelKey: "draft.feat.attic", kind: "boolean", visibleFor: ["house"] },
      { key: "pool", labelKey: "draft.feat.pool", kind: "boolean", visibleFor: ["house"] },
    ],
  },
  {
    key: "utilities",
    labelKey: "draft.editor.utilities",
    fields: [
      { key: "heating_source", labelKey: "draft.heating", kind: "select", visibleFor: buildings, options: [option("central", "enum.heating.central"), option("gas_boiler", "enum.heating.gas_boiler"), option("electric_boiler", "enum.heating.electric_boiler"), option("heat_pump", "enum.heating.heat_pump")] },
      { key: "heat_distribution", labelKey: "draft.heatDistribution", kind: "multiselect", visibleFor: buildings, options: [option("radiators", "enum.heat_dist.radiator"), option("underfloor", "enum.heat_dist.underfloor")] },
      { key: "cooling_types", labelKey: "draft.cooling", kind: "multiselect", visibleFor: buildings, options: [option("air_conditioning", "enum.cooling.air_conditioning"), option("ceiling_cooling", "enum.cooling.ceiling_cooling")] },
      { key: "electricity", labelKey: "draft.feat.electricity", kind: "boolean" },
      { key: "water", labelKey: "draft.feat.water", kind: "boolean" },
      { key: "sewer", labelKey: "draft.feat.sewer", kind: "boolean" },
      { key: "gas", labelKey: "draft.feat.gas", kind: "boolean" },
      { key: "optic_internet", labelKey: "draft.feat.optic_internet", kind: "boolean" },
      { key: "furnishing_level", labelKey: "draft.furnishing", kind: "select", visibleFor: buildings, options: [option("unfurnished", "enum.furnishing.unfurnished"), option("partially", "enum.furnishing.partially"), option("fully", "enum.furnishing.fully")] },
      { key: "kitchen_with_appliances", labelKey: "draft.feat.kitchen_with_appliances", kind: "boolean", visibleFor: buildings },
    ],
  },
  {
    key: "features",
    labelKey: "draft.editor.featuresSection",
    fields: [
      { key: "balcony", labelKey: "draft.feat.balcony", kind: "boolean", visibleFor: buildings },
      { key: "terrace", labelKey: "draft.feat.terrace", kind: "boolean", visibleFor: buildings },
      { key: "garden", labelKey: "draft.feat.garden", kind: "boolean", visibleFor: buildings },
      { key: "garage", labelKey: "draft.feat.garage", kind: "boolean", visibleFor: buildings },
      { key: "storage", labelKey: "draft.feat.storage", kind: "boolean", visibleFor: buildings },
      { key: "basement", labelKey: "draft.feat.basement", kind: "boolean", visibleFor: buildings },
      { key: "alarm", labelKey: "draft.feat.alarm", kind: "boolean", visibleFor: buildings },
      { key: "fireplace", labelKey: "draft.feat.fireplace", kind: "boolean", visibleFor: residential },
      { key: "laundry", labelKey: "draft.feat.laundry", kind: "boolean", visibleFor: buildings },
      { key: "pets_allowed", labelKey: "draft.feat.pets_allowed", kind: "boolean", visibleFor: residential },
      { key: "furnished", labelKey: "draft.feat.furnished", kind: "boolean", visibleFor: buildings },
    ],
  },
  {
    key: "legal",
    labelKey: "draft.editor.legal",
    fields: [
      { key: "ownership", labelKey: "draft.ownership", kind: "select", options: [option("personal", "enum.ownership.personal"), option("cooperative", "enum.ownership.cooperative"), option("shared", "enum.ownership.shared"), option("company", "enum.ownership.company"), option("municipal", "enum.ownership.municipal"), option("other", "enum.ownership.other")] },
      { key: "permanent_residence_allowed", labelKey: "draft.feat.permanent_residence_allowed", kind: "boolean", visibleFor: buildings },
      { key: "mortgage_eligible", labelKey: "draft.feat.mortgage_eligible", kind: "boolean" },
      { key: "approval_status", labelKey: "draft.approvalStatus", kind: "text", visibleFor: ["apartment"] },
      { key: "encumbrances", labelKey: "draft.encumbrances", kind: "text" },
      { key: "zoning_info", labelKey: "draft.zoningInfo", kind: "text" },
      { key: "land_use_plan", labelKey: "draft.landUsePlan", kind: "text" },
    ],
  },
  {
    key: "pricing_extra",
    labelKey: "draft.editor.pricingExtras",
    fields: [
      { key: "utilities_advance", labelKey: "draft.utilitiesAdvance", kind: "decimal", offerType: "rent" },
      { key: "deposit", labelKey: "draft.deposit", kind: "decimal", offerType: "rent" },
      { key: "agency_fee", labelKey: "draft.agencyFee", kind: "decimal" },
      { key: "furnishing_separate_price", labelKey: "draft.furnishingSeparatePrice", kind: "decimal" },
      { key: "parking_standalone_price", labelKey: "draft.parkingStandalonePrice", kind: "decimal" },
      { key: "storage_price", labelKey: "draft.storagePrice", kind: "decimal" },
      { key: "monthly_repair_fund", labelKey: "draft.monthlyRepairFund", kind: "decimal" },
      { key: "monthly_management_fee", labelKey: "draft.monthlyManagementFee", kind: "decimal" },
      { key: "monthly_heating", labelKey: "draft.monthlyHeating", kind: "decimal" },
      { key: "monthly_water", labelKey: "draft.monthlyWater", kind: "decimal" },
      { key: "monthly_electricity", labelKey: "draft.monthlyElectricity", kind: "decimal" },
      { key: "monthly_waste", labelKey: "draft.monthlyWaste", kind: "decimal" },
      { key: "monthly_internet_tv", labelKey: "draft.monthlyInternetTv", kind: "decimal" },
      { key: "monthly_other", labelKey: "draft.monthlyOther", kind: "decimal" },
      { key: "vat_mode", labelKey: "draft.vatMode", kind: "select", options: [option("excluding_vat", "enum.vat.excluding_vat"), option("including_vat", "enum.vat.including_vat")] },
      { key: "vat_rate", labelKey: "draft.vatRate", kind: "number", min: 0, max: 100 },
    ],
  },
];

const SECTION_ORDER: Record<PropertyType, PropertySpecSection[]> = {
  apartment: ["taxonomy", "layout", "areas", "technical", "utilities", "pricing_extra", "legal", "features"],
  house: ["taxonomy", "layout", "areas", "features", "technical", "utilities", "pricing_extra", "legal"],
  land: ["taxonomy", "areas", "legal", "pricing_extra", "utilities", "layout", "technical", "features"],
  commercial: ["taxonomy", "layout", "technical", "areas", "utilities", "pricing_extra", "legal", "features"],
  other: ["taxonomy", "layout", "areas", "technical", "utilities", "pricing_extra", "legal", "features"],
};

export function subtypeOptions(propertyType: PropertyType) {
  return PROPERTY_SUBTYPES[propertyType];
}

export function advancedPropertySections(propertyType: PropertyType, offerType: OfferType) {
  const order = SECTION_ORDER[propertyType];
  return PROPERTY_FIELD_SECTIONS
    .map((section) => ({
      ...section,
      fields: section.fields.filter((field) => (
        !field.core
        && (!field.visibleFor || field.visibleFor.includes(propertyType))
        && (!field.offerType || field.offerType === offerType)
      )),
    }))
    .filter((section) => section.fields.length > 0)
    .sort((left, right) => order.indexOf(left.key) - order.indexOf(right.key));
}

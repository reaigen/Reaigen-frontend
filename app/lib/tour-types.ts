export type Vec3 = [number, number, number];

export interface FeaturedRoom {
  id: number;
  label: string;
  center: Vec3;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  spaceType: string;
  featuredShotIdx: number;
}

export interface TourShot {
  storyBeat: string;
  label: string;
  startIdx: number;
  fov: number;
  holdAfter: number;
  moveDuration: number;
  compositionScore: number;
  transitionToNext?: string;
}

export interface TourData {
  version: number;
  positions: Vec3[];
  forwards: Vec3[];
  arcLens: number[];
  totalArc: number;
  startIdx: number | null;
  shots: TourShot[];
  sceneType: string;
  metadata?: {
    heroShots?: number[];
    featurePoints?: string[];
    sceneDescription?: string;
    gravityRotation?: number[] | null;
    worldAligned?: boolean;
  };
  rooms?: FeaturedRoom[];
}

export interface CameraData {
  cameras: { position: Vec3; forward: Vec3; up?: Vec3; fov?: number }[];
  fovY?: number;
  sceneFov?: number;
  source?: string;
  cached?: boolean;
}

export interface SharedDraftData {
  title?: string;
  description?: string;
  display_address?: string;
  price?: string | number | null;
  currency?: string;
  bedrooms?: number | null;
  bathrooms?: number | null;
  area?: string | number | null;
  area_unit?: string;
  lot_size?: string | number | null;
  lot_size_unit?: string;
  year_built?: number | null;
  city?: string;
  state?: string;
  country?: string;
  uploads?: { url: string; name?: string; mime_type?: string }[];
  data?: { key: string; value: string }[];
}

export interface TourViewerData {
  id: number;
  splat_id?: number;
  draft_id: number;
  status: string;
  url: string;
  format: string;
  available_formats: string[];
  tour_url: string | null;
  signed_outputs: Record<string, string>;
  metadata: Record<string, unknown>;
  outputs_updated_at: string | null;
  draft_title: string;
  floorplan_url: string | null;
  rooms: RoomData[];
  room_splats: RoomSplatData[];
  cameras: { cameras: { position: number[]; forward: number[]; up?: number[] }[]; fovY?: number; sceneFov?: number } | null;
  draft_data?: SharedDraftData | null;
}

export interface ShareFieldData {
  id: number;
  field_type: string;
  field_name: string;
  is_visible: boolean;
  custom_label: string | null;
  sort_order: number;
}

export interface ShareData {
  id: number;
  draft: number;
  token: string;
  share_url: string;
  share_type: string;
  share_context: string;
  status: string;
  title: string;
  description: string;
  expires_at: string | null;
  max_access_count: number | null;
  max_accesses: number | null;
  access_count: number;
  requires_pin: boolean;
  is_accessible: boolean;
  fields: ShareFieldData[];
  data_features: string[] | null;
  created_at: string;
  updated_at: string;
}

// ─── Share Field Bundles & Groups ──────────────────────────────────────

/** Mirrors backend DraftShareField bundles */
export const SHARE_BUNDLES = {
  minimal: ["title"],
  less: ["title", "description", "display_address", "price", "currency", "bedrooms", "bathrooms", "area", "area_unit", "uploads"],
  all: [
    "title", "description", "display_address", "price", "currency",
    "bedrooms", "bathrooms", "area", "area_unit", "lot_size", "lot_size_unit",
    "year_built", "city", "state", "country", "uploads", "data", "pipeline",
  ],
} as const;

export type ShareBundleName = keyof typeof SHARE_BUNDLES;

/** All known share field names */
export const ALL_SHARE_FIELDS = SHARE_BUNDLES.all;

/** Logical UI groupings for field permission toggles */
export const SHARE_FIELD_GROUPS = [
  { key: "basics", fields: ["title", "description", "display_address"] },
  { key: "pricing", fields: ["price", "currency"] },
  { key: "specs", fields: ["bedrooms", "bathrooms", "area", "area_unit", "lot_size", "lot_size_unit", "year_built"] },
  { key: "location", fields: ["city", "state", "country"] },
  { key: "media", fields: ["uploads"] },
  { key: "features", fields: ["data"] },
  { key: "processing", fields: ["pipeline"] },
] as const;

export interface RoomData {
  id: number;
  label: string;
  boundary_points: number[][] | null;
  center_x: number | null;
  center_z: number | null;
  room_type_code: string | null;
}

export interface RoomSplatData {
  id: number;
  room_label: string;
  splat_url: string;
}

export interface SplatListItem {
  id: number;
  source_draft: number;
  title: string;
  status: string;
  scan_type: string;
  has_ply: boolean;
  has_splat: boolean;
  has_sog: boolean;
  point_count: number | null;
  thumbnail_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface DraftListingItem {
  id: number;
  title: string;
  description: string;
  display_address: string | null;
  city: string;
  state: string;
  country: string;
  postal_code: string;
  price: string | number | null;
  currency: string | null;
  area: string | number | null;
  area_unit_display: string | null;
  area_display: string | null;
  area_preferred: string | number | null;
  area_preferred_unit: string | null;
  price_preferred: string | number | null;
  price_preferred_currency: string | null;
  is_complete: boolean;
  is_portfolio_visible: boolean;
  specs?: {
    layout?: {
      bedrooms?: number | string | null;
      bathrooms?: number | string | null;
      rooms?: number | string | null;
    };
    [key: string]: unknown;
  };
  raw_uploads?: DraftUpload[];
  created_at: string;
  updated_at: string;
}

export interface SplatViewerPayload {
  splat_id: number;
  draft_id: number;
  status: string;
  url: string;
  format: string;
  tour_url: string | null;
  signed_outputs: Record<string, string>;
  metadata: Record<string, unknown>;
  outputs_updated_at: string | null;
  cameras?: CameraData | null;
}

export interface DraftUpload {
  id: number;
  file_url: string;
  file_name: string;
  file_size: number;
  mime_type: string;
  asset_type: string;
  asset_type_detail: string;
  sort_order: number;
  role: string;
  status: string;
  is_master: boolean;
  uploaded_at: string;
}

export interface DraftDataEntry {
  id: number;
  data_key: string;
  data_value: string;
  data_type: string;
  sort_order: number;
}

export interface DraftDetailItem extends DraftListingItem {
  raw_uploads: DraftUpload[];
  draft_data: DraftDataEntry[];
  year_built: number | null;
  floorplan_id: number | null;
  splat_id: number | null;
  description_translated?: string | null;
  translation_status?: string | null;
  lot_size: string | number | null;
  lot_size_unit: string | null;
  lot_size_preferred: string | number | null;
  latitude: string | number | null;
  longitude: string | number | null;
}

export interface SplatsByDraftPayload {
  splats: TourViewerData[];
  parent_splat_id: number | null;
  room_splat_ids: number[];
}

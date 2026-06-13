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

export interface TourViewerData {
  splat_id: number;
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
  expires_at: string | null;
  max_access_count: number | null;
  max_accesses: number | null;
  access_count: number;
  requires_pin: boolean;
  is_accessible: boolean;
  created_at: string;
}

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

export interface SplatsByDraftPayload {
  splats: TourViewerData[];
  parent_splat_id: number | null;
  room_splat_ids: number[];
}

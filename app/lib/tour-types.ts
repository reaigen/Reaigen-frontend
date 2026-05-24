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
  cameras: { position: Vec3; forward: Vec3; up: Vec3 }[];
  fovY?: number;
  cached?: boolean;
}

export interface TourViewerData {
  splat_url: string;
  tour_url: string | null;
  floorplan_url: string | null;
  rooms: RoomData[];
  metadata: Record<string, unknown>;
  room_splats: RoomSplatData[];
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
  point_count: number | null;
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
}

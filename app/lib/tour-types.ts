export type Vec3 = [number, number, number];
export type SpatialViewMode = "surface" | "centers";
export type SpatialCameraMode = "orbit" | "fly";
export type SpatialTransformTool = "select" | "move" | "rotate" | "scale";

/**
 * Explicit, persisted transform from canonical scan space into tour space.
 *
 * Scan assets remain identity/Y-up on disk. This reversible transform is
 * applied at runtime to the splat, RoomKit cage, trajectories and cameras.
 */
export interface GlobalSceneTransform {
  version: 1;
  coordinateSpace: "reaigen_y_up";
  rotationDeg: Vec3;
  translation: Vec3;
  scale: number;
}

export interface UsdStageEditTarget {
  layer: "authoring.usda";
  primPath: "/Reaigen";
}

export interface UsdTransformOperation {
  id: string;
  type: "transform";
  opName: string;
  primPath: "/Reaigen";
  layer: "authoring.usda";
  space: "world";
  revision: number;
  enabled: boolean;
  delta: {
    translation: Vec3;
    rotationDeg: Vec3;
    scale: number;
  };
  matrix: number[][];
}

export interface UsdStageTransformEditResponse {
  sceneDescription: UniversalSceneDescription;
  sceneRevision: number;
  usdStageSha256: string;
  editTarget: UsdStageEditTarget;
  authoredOperation: UsdTransformOperation;
  sceneDeliveries: SceneDeliverySummary[];
  archivedSceneDeliveryIds: number[];
}

/** Versioned scene contract shared by web, iOS and backend renderers. */
export interface UniversalSceneDescription {
  schema: "com.reaigen.scene";
  version: 1 | 2;
  coordinateSystem: {
    handedness: "right";
    upAxis: "+Y";
    forwardAxis: "+Z";
    linearUnit: "meter";
  };
  rootTransform: {
    translation: Vec3;
    /** Quaternion component order is [x, y, z, w]. */
    rotationQuaternion: [number, number, number, number];
    scale: Vec3;
    operationOrder: "scale-rotate-translate";
  };
  spatialPolicy?: {
    canonicalSpace: "right-handed-y-up-meters";
    presentationSpace: "world";
    rootPrimPath: "/Reaigen";
    pointTransform: "T*R*S";
    directionTransform: "normalize(R*S)";
    collisionQuerySpace: "canonical";
    rootTransformAffects: string[];
  };
  contentSpace: {
    splats: "canonical";
    cameras: "canonical";
    roomKit: "canonical";
    trajectories: "canonical";
  };
  cameraPolicy: {
    worldUp: Vec3;
    horizon: "world-up";
    storedBasis?: "position-forward-up";
    rootTransformApplication?: "full-camera-basis";
  };
  editor?: {
    rotationEulerDegrees: Vec3;
    rotationOrder: "YXZ";
    authoringModel?: "lop-transform-stack";
    editTarget?: {
      layer: "authoring.usda";
      primPath: "/Reaigen";
    };
    transformBase?: GlobalSceneTransform;
    transformStack?: UsdTransformOperation[];
    pendingOperation?: null;
  };
  /** USD-aligned resolved-stage metadata, present from scene schema v2. */
  stage?: {
    identifier: string;
    revision: number;
    defaultPrim: "Reaigen";
    upAxis: "Y";
    metersPerUnit: number;
    timeCodesPerSecond: number;
  };
  composition?: {
    strengthOrder: "weak-to-strong";
    layers: Array<{
      id: string;
      role: string;
      immutable: boolean;
      revision?: number | null;
      version?: number | null;
      primPaths?: string[];
      assetUri?: string;
    }>;
  };
  prims?: Array<{
    path: string;
    typeName: string;
    assetUri?: string | null;
    xformOpOrder?: string[];
    attributes?: Record<string, unknown>;
  }>;
  cameraSets?: {
    captured: SceneCameraSet;
    authored: SceneCameraSet & { cameras?: SceneCamera[] };
    immersive: SceneCameraSet;
  };
  geometry?: {
    roomKit: {
      primPath: string;
      available: boolean;
      scanBundleId?: number | null;
      coordinateSpace?: "canonical";
      rootTransformPrimPath?: "/Reaigen";
      collision?: {
        enabled: boolean;
        role: "environment";
        purpose: "guide";
        querySpace: "canonical";
      };
    };
    authoredOverrides: {
      primPath: string;
      sourceUri: string;
      hasWallEdits: boolean;
      hasOpeningEdits: boolean;
      wallGraph?: SceneWallGraph | null;
      openingEdits?: Record<string, unknown> | null;
      sourceRecords?: Record<string, {
        recordId: number;
        updatedAt: string;
      }>;
    };
    floorplan?: {
      floorplanId?: number | null;
      usdLayerCount: number;
    };
  };
  trajectories?: Record<string, unknown>;
  navigation?: {
    firstPerson?: {
      cameraPrimPath: string;
      eyeHeightMeters: number;
      collision: {
        geometryPrimPaths: string[];
        policy: string;
        available: boolean;
        fallback: string;
        sourceGeometrySpace?: "canonical";
        querySpace?: "canonical";
        presentationCameraSpace?: "presentation-world";
        rootTransformPrimPath?: "/Reaigen";
      };
    };
  };
  versioning?: {
    reconstructionDelivery?: SceneVersionIdentity;
    sceneRevision?: SceneVersionIdentity;
    tourDelivery?: SceneVersionIdentity;
  };
  runtimeCapabilities?: Record<string, boolean>;
  /** Immutable OpenUSD source graph backing this runtime projection. */
  usdStage?: OpenUsdStageIdentity | null;
}

export interface OpenUsdStageIdentity {
  schema: "com.reaigen.usd.scene";
  schemaVersion: number;
  format: "usda";
  splatId: number;
  sceneRevision: number;
  rootLayer: "scene.usda";
  stageSha256: string;
  layerEndpoint: string;
  bundleEndpoint: string;
  layers: Array<{
    identifier: string;
    role: string;
    strengthOrder: number;
    sha256: string;
  }>;
  validation: {
    valid: boolean;
    validator: string;
    openUsdAvailable: boolean;
    openUsdVersion?: string;
    errors: string[];
  };
}

export interface SceneVersionIdentity {
  id?: number | null;
  version?: number | null;
  revision?: number | null;
  immutable: boolean;
}

export interface SceneCameraSet {
  primPath: string;
  kind: string;
  storage: string;
  count?: number;
  persisted?: boolean;
  sourceUri?: string;
  description?: string;
  cameras?: SceneCamera[];
}

export interface SceneCamera {
  id: string;
  primPath: string;
  kind: string;
  role: string;
  label: string;
  position: Vec3;
  forward: Vec3;
  up: Vec3;
  projection: {
    type: "perspective";
    verticalFovDegrees?: number | null;
  };
  coordinateSpace: "canonical";
}

export interface SceneWallGraph {
  vertices: Array<[number, number]>;
  edges: Array<{ a: number; b: number }>;
}

export interface SceneRevisionSummary {
  revision: number;
  baseDeliveryVersion?: number | null;
  changeSet: {
    fields?: string[];
    cameraCount?: number | null;
    [key: string]: unknown;
  };
  createdBy?: number | null;
  createdAt: string;
  usdStageSha256?: string | null;
  projectionSha256?: string | null;
  usdValidated?: boolean;
  isCurrent: boolean;
}

export interface SplatSceneResponse {
  scene: UniversalSceneDescription;
  usd?: OpenUsdStageIdentity | null;
  currentRevision: number;
  resolvedRevision: number;
  revisions: SceneRevisionSummary[];
}

export type SceneDeliveryTargetProfile =
  | "web"
  | "ios"
  | "visionos"
  | "interchange";

export interface SceneDeliverySummary {
  id: number;
  splatId: number;
  targetProfile: SceneDeliveryTargetProfile;
  version: number;
  status: "candidate" | "ready" | "published" | "archived" | "failed";
  sceneRevisionId: number;
  sceneRevision: number;
  sceneStageSha256: string;
  reconstructionVersionId: number;
  reconstructionVersion: number;
  sourceJobId?: string | null;
  manifest: {
    schema: "com.reaigen.scene-delivery";
    version: 1;
    preservedAuthoredState: string[];
    target: {
      id: SceneDeliveryTargetProfile;
      runtime: string;
      packageKind: string;
      resolverMode: string;
    };
    gaussian: {
      schema: "ParticleField3DGaussianSplat";
      selectedRepresentation: string;
      assetUri: string;
      representations: Array<{
        format: string;
        name: string;
        assetUri: string;
        storageReference: string;
      }>;
    };
    portableCompanion?: {
      format: "usdz";
      purpose: string;
      gaussianPayload: "external-reaigen-runtime";
      reason: string;
    };
    [key: string]: unknown;
  };
  usd: {
    rootLayer: "delivery.usda";
    stageSha256: string;
    validation: OpenUsdStageIdentity["validation"];
    layerEndpoint: string;
    bundleEndpoint: string;
  };
  assetEndpoint?: string;
  publishEndpoint?: string;
  publishedAt?: string | null;
  createdAt: string;
}

export interface SceneDeliveryResolution {
  delivery: SceneDeliverySummary;
  sceneDescription: UniversalSceneDescription;
  asset: {
    /** Durable resolver identity authored into the USD stage. */
    uri: string;
    format: string;
    /** Expiring authenticated transport URL; never persist as authorship. */
    url: string;
    fingerprint: string;
  };
}

export interface SceneRefinementSummary {
  id: number;
  jobId: string;
  status: string;
  phase: string;
  message: string;
  progressPct: number;
  iterations: number | null;
  preset: string;
  downsample: number;
  outputFormats: string[];
  sceneRevision: number;
  sceneStageSha256: string;
  baseReconstructionVersion?: number | null;
  targetProfiles: SceneDeliveryTargetProfile[];
  promotionPolicy: "manual";
  createdAt: string;
  completedAt?: string | null;
}

export interface DeliveryVersionSummary {
  id: number;
  version: number;
  publication_status: "not_published" | "published" | "archived" | "failed";
  is_master: boolean;
  is_published: boolean;
  scene_count: number;
  assets_available: boolean;
  source_job_id?: string | null;
  source_results_s3_prefix?: string | null;
  scene_revision?: number | null;
  usd_stage_sha256?: string | null;
  created_at: string;
  published_at?: string | null;
}

export interface VirtualTourViewerPayload {
  tour_id: number;
  tour_asset_id?: string;
  tour_name?: string;
  capture_reason?: string;
  captured_at?: string;
  renovation_of_asset_id?: string | null;
  draft_id: number;
  status: string;
  product_publication_status: string;
  config: Record<string, unknown>;
  assets: Record<string, unknown>;
  scene_count: number;
  is_published: boolean;
  latest_delivery_version?: DeliveryVersionSummary | null;
  resolved_delivery_version?: DeliveryVersionSummary | null;
  delivery_versions: DeliveryVersionSummary[];
  scene_description?: UniversalSceneDescription | null;
  assets_updated_at?: string | null;
}

/** Authoritative RoomKit wall geometry in the scan's identity, Y-up space. */
export interface RoomKitCageWall {
  id: string;
  center: Vec3;
  width: number;
  height: number;
  thickness: number;
  yaw: number;
}

/** One camera sample from either the scan trajectory or the published tour. */
export interface SpatialCameraSample {
  position: Vec3;
  forward: Vec3;
  up: Vec3;
  fov: number;
}

/** Keep independently captured room paths separate so they are never joined. */
export interface SpatialTrajectory {
  id: string;
  label: string;
  source: "scan" | "tour" | "saved";
  samples: SpatialCameraSample[];
}

export interface SplatInspectionStats {
  gaussianCount: number;
  sampledCount: number;
  /** Median of the sampled Gaussian's largest local-axis scale, in scene units. */
  medianScale?: number;
  /** 90th percentile of the sampled Gaussian's largest local-axis scale. */
  p90Scale?: number;
  /** Estimated share of large or locally sparse Gaussians in the diagnostic sample. */
  largeOrSparsePercent?: number;
}

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
  /** Optional camera-up samples in the same canonical space as positions. */
  ups?: Vec3[];
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

export interface SavedCamera {
  id?: string;
  position: Vec3;
  forward: Vec3;
  up?: Vec3;
  fov?: number;
  label?: string;
  name?: string;
  kind?: "capture" | "authored";
  role?: "tour" | "hero" | "transition" | string;
  /** Coordinate marker added after the web viewer moved to identity scene space. */
  coordinate_space?: string;
}

export interface CameraData {
  cameras: SavedCamera[];
  fovY?: number;
  sceneFov?: number;
  sceneDescription?: UniversalSceneDescription;
  sceneRevision?: number;
  source?: string;
  cached?: boolean;
}

export interface SharedFloorplanRoom {
  id: number;
  label: string;
  room_number: number | null;
  center: number[] | null;
  floor_area: number | null;
  boundary_points: number[][] | null;
  room_type_code: string | null;
  label_offset_x: number;
  label_offset_z: number;
}

/** Floorplan block of a public share: whitelisted scan draft_data (same keys
 * the app renders from), signed composite image, and room metadata. */
export interface SharedFloorplanPayload {
  draft_data: DraftDataEntry[];
  composite_url: string | null;
  rooms: SharedFloorplanRoom[];
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
  floorplan?: SharedFloorplanPayload | null;
  tours?: SharedTourSummary[];
}

export interface SharedTourSummary {
  tour_id: number;
  tour_asset_id: string;
  name: string;
  name_is_custom?: boolean;
  capture_reason: string;
  captured_at: string;
  is_primary: boolean;
  sort_order: number;
  targets: Array<"web" | "ios">;
}

export interface DraftTourAssetDeliveryVersion {
  id: number;
  version: number;
  publication_status: string;
  is_published: boolean;
  usd_stage_sha256?: string | null;
}

export interface DraftTourAssetPublicationState {
  visible: boolean;
  is_primary: boolean;
  sort_order: number | null;
  targets: Array<"web" | "ios">;
}

export type DraftTourAssetLifecycleState =
  | "reserved"
  | "uploading"
  | "queued"
  | "processing"
  | "preview"
  | "ready"
  | "published"
  | "failed";

export interface DraftTourAssetLifecycle {
  state: DraftTourAssetLifecycleState;
  origin: "ios" | "web" | "owner";
  landed: boolean;
  progress_pct: number | null;
  can_start_capture: boolean;
  can_preview: boolean;
  preview_targets: Array<"web" | "ios">;
  can_publish: boolean;
  can_remove: boolean;
  removal_kind: "cancel" | "archive" | null;
  protected_reason: string | null;
}

export interface DraftTourAsset {
  id: number;
  asset_id: string;
  draft_id: number;
  name: string;
  name_is_custom?: boolean;
  capture_reason: "initial" | "renovation" | "rescan" | "imported" | "other";
  captured_at: string;
  renovation_of_id: number | null;
  renovation_of_asset_id: string | null;
  source_splat_id: number | null;
  source_scan_bundle_id: number | null;
  status: string;
  is_product_published: boolean;
  latest_delivery_version: DraftTourAssetDeliveryVersion | null;
  publication: DraftTourAssetPublicationState;
  lifecycle?: DraftTourAssetLifecycle;
  created_at: string;
  updated_at: string;
}

export interface DraftTourPublicationEntry {
  tour_id: number;
  tour_asset_id: string;
  display_name: string;
  tour_delivery_version_id: number;
  tour_delivery_version: number;
  source_splat_id: number;
  is_primary: boolean;
  sort_order: number;
  targets: Array<"web" | "ios">;
  target_deliveries: Partial<Record<"web" | "ios", {
    id: number;
    version: number;
    status: string;
    usd_stage_sha256: string;
  }>>;
}

export interface DraftTourPublication {
  id: number;
  revision: number;
  manifest_sha256: string;
  usd: {
    root_layer: string;
    stage_sha256: string;
    validation: { valid: boolean; errors?: string[] };
    layer_endpoint: string;
  };
  entries: DraftTourPublicationEntry[];
  created_at: string;
}

export interface DraftTourAssetsPayload {
  schema: "com.reaigen.draft-tour-assets";
  version: 1;
  draft_id: number;
  assets: DraftTourAsset[];
  publication: DraftTourPublication | null;
}

export interface DraftTourPublicationSelection {
  tour_id: number;
  targets: Array<"web" | "ios">;
  is_primary: boolean;
  sort_order: number;
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
  scene_description?: UniversalSceneDescription | null;
  collision_geometry?: {
    format: "roomplan-json";
    coordinate_space: "canonical";
    prim_path: "/Reaigen/Architecture/RoomKit";
    url: string;
  } | null;
  draft_title: string;
  floorplan_url: string | null;
  rooms: RoomData[];
  room_splats: RoomSplatData[];
  cameras: CameraData | null;
  draft_data?: SharedDraftData | null;
  tour_id?: number;
  tour_asset_id?: string;
  tour_name?: string;
  tour_publication?: {
    id: number;
    revision: number;
    manifest_sha256: string;
    usd_stage_sha256: string;
  };
  available_tours?: SharedTourSummary[];
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
    "year_built", "city", "state", "country", "uploads", "data", "pipeline", "floorplan", "tour",
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
  product_publication_status?: string;
  scan_type: string;
  has_ply: boolean;
  has_splat: boolean;
  has_sog: boolean;
  outputs?: Record<string, string>;
  latest_delivery_version?: Record<string, unknown> | null;
  delivery_versions_count?: number;
  artifacts?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  point_count: number | null;
  thumbnail_url: string | null;
  processing_started_at?: string | null;
  processing_completed_at?: string | null;
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
  area_unit?: number | null;
  area_unit_code?: string | null;
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
  scene_description?: UniversalSceneDescription | null;
  /** Exact published OpenUSD graph version used to resolve this runtime. */
  scene_delivery: SceneDeliverySummary;
  asset: SceneDeliveryResolution["asset"];
  representations: SceneDeliveryResolution["asset"][];
  collision_geometry?: TourViewerData["collision_geometry"];
  cameras: CameraData;
}

export interface SplatPackageFileRef {
  key: string;
  url: string;
}

export interface SplatPackageRoomKitGeometry {
  source: "scan_bundle";
  scope: "estate" | "room";
  scan_bundle_id: number;
  room_directory: string | null;
  files: Partial<Record<
    "roomplan_json" | "scan_data_json" | "room_usdz" | "room_frame_indices_json",
    SplatPackageFileRef
  >>;
}

export interface SplatPackageRoomBundle {
  source: "scan_bundle_room";
  scope: "room";
  scan_bundle_id: number;
  scan_bundle_room_id: number | null;
  room_label: string | null;
  room_number: number | null;
  capture_folder_slug: string;
  files: Partial<Record<
    "frames_jsonl" | "room_frame_indices_json" | "roomplan_json" | "scan_data_json" | "room_usdz",
    SplatPackageFileRef
  >>;
}

export interface SplatPackageRoomSummary {
  id: number;
  room_label?: string;
}

export interface SplatPackagePayload {
  package_version: number;
  scene_description?: UniversalSceneDescription | null;
  scene_deliveries?: SceneDeliverySummary[];
  scene_delivery_profiles?: Array<{
    id: SceneDeliveryTargetProfile;
    runtime: string;
    packageKind: string;
    portableUsdz: boolean;
  }>;
  original_roomkit_geometry: SplatPackageRoomKitGeometry | null;
  room_bundle: SplatPackageRoomBundle | null;
  room_splats: SplatPackageRoomSummary[];
}

export interface DraftUpload {
  id: number;
  file_url: string;
  file_name: string;
  /** Stable client filename of the first upload in this logical media asset. */
  original_file_name?: string | null;
  file_size: number;
  mime_type: string;
  asset_type: number | string;
  asset_type_detail: {
    id?: number;
    code?: string;
    name?: string;
    category_code?: string;
    is_raw?: boolean;
  } | string | null;
  sort_order: number;
  role: string;
  status: string;
  is_master: boolean;
  /** Logical gallery presentation state shared by every physical version. */
  is_gallery_visible?: boolean;
  is_deleted?: boolean;
  logical_asset_id?: string | null;
  version?: number;
  supersedes?: number | null;
  source_upload_id?: number | null;
  versions_count?: number;
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
  /** Owner-only street address. Public views must use display_address. */
  address?: string;
  raw_uploads: DraftUpload[];
  draft_data: DraftDataEntry[];
  year_built: number | null;
  floorplan_id: number | null;
  splat_id: number | null;
  description_translated?: string | null;
  translation_status?: string | null;
  lot_size: string | number | null;
  /** Backend Unit lookup primary key. Resolve display/code through lookups/units. */
  lot_size_unit: number | null;
  lot_size_preferred: string | number | null;
  lot_size_preferred_unit?: string | null;
  latitude: string | number | null;
  longitude: string | number | null;
}

/** Compact splat payload returned by `splats/by-draft/:id/?all=true`. */
export interface DraftSplatVersion {
  id: number;
  splat_id?: number;
  source_draft?: number;
  title?: string;
  status: string;
  product_publication_status?: string;
  scan_type?: string;
  parent_splat_id?: number | null;
  room_id?: number | null;
  scan_bundle_id?: number | null;
  has_ply?: boolean;
  has_splat?: boolean;
  has_sog?: boolean;
  format?: string;
  available_formats?: string[];
  url?: string;
  signed_outputs?: Record<string, string>;
  thumbnail_url?: string | null;
  latest_delivery_version?: Record<string, unknown> | null;
  delivery_versions_count?: number;
  point_count?: number | null;
  outputs_updated_at?: string | null;
  processing_completed_at?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface SplatsByDraftPayload {
  splats: DraftSplatVersion[];
  parent_splat_id: number | null;
  room_splat_ids: number[];
}

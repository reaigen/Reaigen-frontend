/**
 * Furniture placement priors — mined from data, not hand-tuned.
 *
 * Sources:
 *  - ProcTHOR-10k val split, 300 houses / 1,254 rooms (AllenAI): per-category
 *    wall-backing rates + back-wall distances, chair↔table and TV↔sofa
 *    pairwise statistics, room-type occupancy.
 *  - ARKitScenes 3DOD annotations, 161 real scans / 1,730 boxes (Apple):
 *    yaw-vs-dominant-orientation distribution (88.6% within 5°, 91.5% within
 *    10°), same-label overlap rate 0.38%, real cross-label containment
 *    ~2.6/scene, physical size ranges per category.
 *  - Interior-design guideline terms (Merrell et al. SIGGRAPH 2011;
 *    Kán & Kaufmann IEEE VR 2018; Panero & Repetto anthropometrics) for the
 *    relations the datasets don't encode (nightstand↔bed, clearances).
 *
 * Regeneration: scratchpad scripts procthor/analyze.py (point at
 * train.jsonl.gz for the full 10k) and arkitscenes/analyze.py; data URLs in
 * each script header.
 */

import type { FurnitureKind } from "./floorplan-geometry";

export interface KindPrior {
  /** Fraction of instances standing back-to-wall (ProcTHOR; 1.0 = always). */
  wallAffinity: number;
  /** Preferred clear gap between back edge and wall face, metres. */
  backGap: number;
}

/** Per-kind wall priors. ProcTHOR back-wall distances are centre-to-wall;
 * converted to edge gaps using median depths (ARKitScenes sizes). Kinds
 * ProcTHOR lacks (bathtub, fireplace, stove/oven/dishwasher as standalone)
 * take ARKitScenes-informed defaults with guideline affinities. */
export const KIND_PRIORS: Record<FurnitureKind, KindPrior> = {
  storage: { wallAffinity: 1.0, backGap: 0.01 },
  refrigerator: { wallAffinity: 1.0, backGap: 0.01 },
  washerDryer: { wallAffinity: 1.0, backGap: 0.01 },
  sink: { wallAffinity: 1.0, backGap: 0.01 },
  toilet: { wallAffinity: 1.0, backGap: 0.01 },
  television: { wallAffinity: 0.98, backGap: 0.02 },
  bed: { wallAffinity: 1.0, backGap: 0.01 },
  bathtub: { wallAffinity: 1.0, backGap: 0.01 },
  stove: { wallAffinity: 1.0, backGap: 0.01 },
  oven: { wallAffinity: 1.0, backGap: 0.01 },
  dishwasher: { wallAffinity: 1.0, backGap: 0.01 },
  fireplace: { wallAffinity: 1.0, backGap: 0.0 },
  sofa: { wallAffinity: 0.51, backGap: 0.05 },
  table: { wallAffinity: 0.0, backGap: 0.0 },
  chair: { wallAffinity: 0.0, backGap: 0.0 },
  stairs: { wallAffinity: 1.0, backGap: 0.0 },
  generic: { wallAffinity: 0.0, backGap: 0.0 },
};

export const LAYOUT_PRIORS = {
  /** Idealized-plan mode: EVERYTHING aligns to the wall frame (45° = always
   * snap to nearest cardinal). ARKitScenes: 93% of reality is near-cardinal;
   * the crooked tail is what makes plans read broken. Marketing floorplans
   * are idealized, not forensic. */
  yawSnapDeg: 45,
  /** How close an edge must already be to a wall to count as wall-placed.
   * ProcTHOR wall-backed categories cluster at edge gaps < 0.15 m; 0.35
   * covers RoomPlan position noise without capturing mid-room pieces. */
  hugDistance: 0.6,
  /** ARKitScenes same-label true-overlap rate is 0.38%, so aggressive
   * same-kind dedupe is safe; cross-kind only at near-total containment
   * (real containment pairs are exempted separately). */
  dedupeSameKind: 0.45,
  dedupeCrossKind: 0.85,
  /** Trust region (Wu et al. Eq 13): soft cap on displacement from the
   * detected pose; hard overlap resolution may use twice this. */
  maxDrift: 0.8,
  /** Chair↔table: ProcTHOR median centre distance 0.68 m (p10 0.59); slot
   * snapping engages when the chair is within this reach of a table edge. */
  chairTableSnap: 0.5,
  chairTuck: 0.06,
  /** TV↔sofa: ProcTHOR median 2.89 m, 58.5% mutually facing within ±45°;
   * we oppose exactly when already within 30° at up to 5 m. */
  tvSofaMaxDist: 5,
  tvSofaFaceDeg: 30,
  /** Wall choice bias: misalignment of the piece's back with the wall normal
   * is worth this many metres of edge gap (bed hugs the wall behind its
   * headboard, not the nearest one). */
  wallMisalignWeight: 0.5,
  /** Fragment twins (parallel same-kind, front-back stacked) collapse within
   * this extra gap — pre-hug and post-hug values. */
  stackSlackPre: 0.15,
  stackSlackPost: 0.4,
  /** Objects whose centre is further outside the wall bounds than this were
   * scanned through openings and are dropped. */
  outOfBoundsMargin: 0.4,
  /** Satellite tables (side/coffee) compose against their sofa/bed anchor:
   * small tables within reach snap flush beside the anchor or centred in
   * front of it (Merrell/Panero: coffee table 16–18" ≈ 0.45 m off the seat). */
  satelliteMaxLong: 1.0,
  satelliteReach: 1.2,
  coffeeTableGap: 0.45,
} as const;

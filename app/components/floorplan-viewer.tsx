"use client";

/**
 * FloorplanViewer — same architectural rendering as the iOS app.
 *
 * Primary path mirrors iOS LocalFloorplanCanvasView: parse the draft's
 * `captured_structure_json` (or legacy `captured_room_json`), Manhattan-snap it, render
 * walls (18 cm ink quads with door/window cuts), scan + custom doors
 * (jambs, and swing arc + panel + hinge when configured via door_N_camera),
 * windows (three parallel lines), numbered room labels, total-area chip,
 * compass, and a room legend below the plan.
 *
 * Fallback mirrors iOS FloorplanCanvas: backend mesh geometry from
 * /floorplans/<id>/rendering/, then the composite image as a last resort.
 */

import { useEffect, useId, useMemo, useState } from "react";
import type { DraftDataEntry, SharedFloorplanPayload } from "../lib/tour-types";
import {
  getFloorplanRendering,
  listUnits,
  type FloorplanRenderingData,
  type FloorplanRoom,
  type GeometryLayer,
} from "../lib/api/client";
import { t } from "../lib/i18n";
import { localizedRoomName } from "../lib/room-names";
import {
  baseUnitForCategory,
  convertUnitValue,
  resolveUnit,
  unitLabel,
  type UnitLookup,
} from "../lib/unit-catalog";
import {
  buildTextDataMap,
  parseCapturedRoom,
  manhattanAdjust,
  parseWallGraph,
  parseOpeningEdits,
  parseDoorConfigs,
  objectCorners,
  parseLabelOffsets,
  parseRoomMarkers,
  parseRoomCenters,
  parseRoomAreaOverrides,
  roomNumbersInTextData,
  rawRoomLabel,
  totalFloorArea,
  floorplanRotationDegrees,
  rotateToSnappedFrame,
  resolveLabelWorldPositions,
  openingHasHostWall,
  wallQuad,
  openingCut,
  computeBounds,
  furnitureKind,
  prepareObjects,
  prepareFloorplanPresentationObjects,
  removeRedundantCountertopFixtures,
  conditionWallSegmentsForPresentation,
  doorObservationUsable,
  solveFurnitureLayout,
  WALL_THICKNESS,
  STROKE_COLOR,
  LABEL_FILL,
  type V2,
  type DoorConfig,
  type ObjectXZ,
} from "../lib/floorplan-geometry";
import { solveReaigenFloorplan, USE_CONSTRAINT_SOLVER } from "../lib/floorplan-solver-adapter";
import { applyFurnitureEdits, parseFurnitureEdits } from "../lib/floorplan-collision-solver";
import {
  applyFurnitureWallAttachment,
  closestFurnitureWallBaseline,
} from "../lib/floorplan-wall-attachment";
import { iconForKind, type IconShape } from "../lib/floorplan-icon-shapes";
import { assignLabelsToRoomPolygons } from "../lib/floorplan-label-placement";
import { inferDoorPresentationConfig } from "../lib/floorplan-door-presentation";
import { cn } from "../lib/utils";

interface Props {
  draftData: DraftDataEntry[];
  floorplanId?: number | null;
  lang: string;
  /** Canonical lookup data. Public views fetch it when the owner page cannot pass it. */
  units?: readonly UnitLookup[];
  /** Backend unit id/code/symbol selected for area display. */
  targetAreaUnit?: number | string | null;
  /** Public share mode: pre-fetched floorplan block from the share payload —
   * used instead of the authenticated rendering endpoint. */
  publicFloorplan?: SharedFloorplanPayload | null;
  /**
   * Applied to the drawing box. A local plan's aspect ratio comes from the
   * captured geometry and the box fills its container, so it grows as tall as
   * the column is wide. Callers bound it; the SVG letterboxes inside.
   */
  planClassName?: string;
  /** Ephemeral measuring mode selected by Agent; it never changes the plan. */
  measurementMode?: "distance" | "area" | null;
  /** Incremented for a fresh measurement, including repeated same-mode requests. */
  measurementSession?: number;
  /**
   * Fullscreen presentation lives inside the lightbox's single glass surface,
   * so it must not introduce a second bordered card around the drawing.
   */
  presentation?: "card" | "lightbox";
}

const SVG_W = 400;
// Compass/area chip are HTML overlays at the card corners, so the viewBox
// only needs breathing room for the plan itself.
const PADDING = 32;
// Keep detail-page plans in a stable visual envelope. Geometry still uses its
// measured aspect ratio, but small single-room captures cannot zoom until they
// fill the entire card while larger apartments are fitted down as needed.
const MIN_SVG_H = 300;
const MAX_SVG_H = 480;
const MAX_PLAN_SCALE = 46;

const MESH_INK = "#141417"; // iOS FloorplanCanvas canvasInkColor
const AREA_FILL = "#6b7280";

const midOf = (p1: V2, p2: V2): V2 => [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];

/** Project a measured opening onto its best parallel host wall. RoomPlan can
 * report an opening a few centimetres off-axis or past a wall junction; using
 * those raw endpoints as a mask cuts white channels through adjacent walls. */
function fitOpeningToHostWall<T extends { p1: V2; p2: V2 }>(
  opening: T,
  walls: [V2, V2][]
): T {
  const odx = opening.p2[0] - opening.p1[0];
  const odz = opening.p2[1] - opening.p1[1];
  const measuredLength = Math.hypot(odx, odz);
  if (measuredLength < 0.2) return opening;

  const ou: V2 = [odx / measuredLength, odz / measuredLength];
  const midpoint = midOf(opening.p1, opening.p2);
  let best: { a: V2; u: V2; length: number; centerT: number; score: number } | null = null;

  for (const [a, b] of walls) {
    const wdx = b[0] - a[0];
    const wdz = b[1] - a[1];
    const wallLength = Math.hypot(wdx, wdz);
    if (wallLength < Math.min(0.8, measuredLength * 0.7)) continue;
    const u: V2 = [wdx / wallLength, wdz / wallLength];
    const parallel = Math.abs(ou[0] * u[0] + ou[1] * u[1]);
    if (parallel < 0.9) continue;

    const rawT = (midpoint[0] - a[0]) * u[0] + (midpoint[1] - a[1]) * u[1];
    const centerT = Math.max(0, Math.min(wallLength, rawT));
    const closest: V2 = [a[0] + u[0] * centerT, a[1] + u[1] * centerT];
    const distance = Math.hypot(midpoint[0] - closest[0], midpoint[1] - closest[1]);
    if (distance > 0.35) continue;

    const projectedStart = rawT - measuredLength / 2;
    const projectedEnd = rawT + measuredLength / 2;
    const overlap = Math.max(0, Math.min(wallLength, projectedEnd) - Math.max(0, projectedStart));
    if (overlap < Math.min(0.4, measuredLength * 0.5)) continue;

    const score = distance + (1 - parallel) * 0.6;
    if (!best || score < best.score) best = { a, u, length: wallLength, centerT, score };
  }

  if (!best) return opening;
  const jambInset = Math.min(WALL_THICKNESS * 0.6, best.length * 0.1);
  const available = best.length - 2 * jambInset;
  if (available < 0.2) return opening;
  const fittedLength = Math.min(measuredLength, available);
  const half = fittedLength / 2;
  const centerT = Math.max(jambInset + half, Math.min(best.length - jambInset - half, best.centerT));
  const center: V2 = [best.a[0] + best.u[0] * centerT, best.a[1] + best.u[1] * centerT];
  const direction = ou[0] * best.u[0] + ou[1] * best.u[1] >= 0 ? 1 : -1;
  const axis: V2 = [best.u[0] * direction, best.u[1] * direction];

  return {
    ...opening,
    p1: [center[0] - axis[0] * half, center[1] - axis[1] * half],
    p2: [center[0] + axis[0] * half, center[1] + axis[1] * half],
  };
}

/** Quarter-circle SVG arc centred on `c` from `p0` to `p1` (minor arc whose
 * centre is the hinge — matches the iOS door swing). */
function arcPathAround(c: [number, number], p0: [number, number], p1: [number, number]): string {
  const r = Math.hypot(p0[0] - c[0], p0[1] - c[1]);
  const a0 = Math.atan2(p0[1] - c[1], p0[0] - c[0]);
  const a1 = Math.atan2(p1[1] - c[1], p1[0] - c[0]);
  let delta = a1 - a0;
  while (delta > Math.PI) delta -= 2 * Math.PI;
  while (delta <= -Math.PI) delta += 2 * Math.PI;
  const sweep = delta > 0 ? 1 : 0;
  return `M ${p0[0]} ${p0[1]} A ${r} ${r} 0 0 ${sweep} ${p1[0]} ${p1[1]}`;
}

function doorSwingWorld(
  door: { p1: V2; p2: V2 },
  cfg: DoorConfig,
  interior: V2
): { hinge: V2; closedEnd: V2; panelEnd: V2 } {
  const [p1, p2] = cfg.hingeSide === "Right" ? [door.p2, door.p1] : [door.p1, door.p2];
  const dx = p2[0] - p1[0];
  const dz = p2[1] - p1[1];
  const len = Math.max(Math.hypot(dx, dz), 1e-4);
  const nxA = -dz / len;
  const nzA = dx / len;
  const midX = (p1[0] + p2[0]) / 2;
  const midZ = (p1[1] + p2[1]) / 2;
  const dSq = (px: number, pz: number) =>
    (px - interior[0]) * (px - interior[0]) +
    (pz - interior[1]) * (pz - interior[1]);
  const dA = dSq(midX + nxA * 0.1, midZ + nzA * 0.1);
  const dB = dSq(midX - nxA * 0.1, midZ - nzA * 0.1);
  const toward: V2 = dA < dB ? [nxA, nzA] : [-nxA, -nzA];
  const away: V2 = dA < dB ? [-nxA, -nzA] : [nxA, nzA];
  const [nx, nz] = cfg.swingDirection === "Out" ? away : toward;
  const faceOffset = WALL_THICKNESS / 2;
  const hinge: V2 = [p1[0] + nx * faceOffset, p1[1] + nz * faceOffset];
  return {
    hinge,
    closedEnd: [p2[0] + nx * faceOffset, p2[1] + nz * faceOffset],
    panelEnd: [hinge[0] + nx * len, hinge[1] + nz * len],
  };
}

interface LegendEntry {
  n: number;
  label: string;
  area: number;
}

// ─────────────────────────────────────────────────────────────────────────────

export default function FloorplanViewer({
  draftData,
  floorplanId,
  lang,
  publicFloorplan,
  units,
  targetAreaUnit,
  planClassName,
  measurementMode,
  measurementSession,
  presentation = "card",
}: Props) {
  const [rendering, setRendering] = useState<FloorplanRenderingData | null>(null);
  const [renderingLoading, setRenderingLoading] = useState(Boolean(floorplanId && !publicFloorplan));
  const [publicUnits, setPublicUnits] = useState<UnitLookup[]>([]);

  useEffect(() => {
    if (!floorplanId || publicFloorplan) {
      setRenderingLoading(false);
      return;
    }
    const ctrl = new AbortController();
    setRenderingLoading(true);
    getFloorplanRendering(floorplanId, ctrl.signal)
      .then((result) => {
        if (!ctrl.signal.aborted) setRendering(result);
      })
      .catch(() => {})
      .finally(() => {
        if (!ctrl.signal.aborted) setRenderingLoading(false);
      });
    return () => ctrl.abort();
  }, [floorplanId, publicFloorplan]);

  useEffect(() => {
    if (units !== undefined) return;
    let active = true;
    listUnits("AREA")
      .then((result) => { if (active) setPublicUnits(result); })
      .catch(() => { if (active) setPublicUnits([]); });
    return () => { active = false; };
  }, [units]);

  const unitCatalog = units ?? publicUnits;
  const sourceAreaUnit = baseUnitForCategory(unitCatalog, "AREA");
  const displayAreaUnit = sourceAreaUnit
    ? resolveUnit(unitCatalog, targetAreaUnit, "AREA") ?? sourceAreaUnit
    : null;
  const formatArea = (value: number) => {
    const converted = sourceAreaUnit && displayAreaUnit
      ? convertUnitValue(value, sourceAreaUnit, displayAreaUnit) ?? value
      : value;
    const label = unitLabel(displayAreaUnit);
    return `${converted.toFixed(1)}${label ? ` ${label}` : ""}`;
  };

  const model = useMemo(() => buildLocalModel(draftData), [draftData]);

  // Legend: union of draft-data room numbers and backend rooms; draft labels win.
  const legendEntries = useMemo<LegendEntry[]>(() => {
    const map = model.textData;
    const overrides = parseRoomAreaOverrides(map);
    const byNumber = new Map<number, LegendEntry>();
    for (const room of publicFloorplan?.rooms ?? rendering?.rooms ?? []) {
      const n = room.room_number ?? byNumber.size + 1;
      const name = localizedRoomName(room.label, room.room_type_code, lang) ?? room.label;
      byNumber.set(n, { n, label: name, area: room.floor_area ?? 0 });
    }
    for (const n of roomNumbersInTextData(map)) {
      const { label, typeCode } = rawRoomLabel(n, map);
      const resolved =
        localizedRoomName(label, typeCode, lang) ??
        byNumber.get(n)?.label ??
        `${t("floorplan.room", lang)} ${n}`;
      byNumber.set(n, { n, label: resolved, area: overrides[n] ?? byNumber.get(n)?.area ?? 0 });
    }
    return [...byNumber.values()].sort((a, b) => a.n - b.n);
  }, [model.textData, rendering, publicFloorplan, lang]);

  const meshLayers = rendering?.geometry?.layers;
  const hasMesh = !!meshLayers && [meshLayers.walls, meshLayers.doors, meshLayers.windows].some(
    (l) => l?.available && l.meshes?.length > 0
  );

  const totalArea = model.local?.totalArea ?? 0;

  if (!model.local && renderingLoading) {
    return (
      <div
        className={cn(
          "overflow-hidden",
          presentation === "card" && "rounded-xl border border-border/40 bg-surface shadow-card",
        )}
        role="status"
        aria-label={t("draft.media.loading", lang)}
        aria-busy="true"
      >
        {/* Carries the caller's height cap too, so the skeleton occupies the
            same box as the plan that replaces it and nothing shifts on swap. */}
        <div className={cn("mx-auto aspect-[4/3] w-full animate-pulse bg-muted/55 motion-reduce:animate-none", planClassName)} />
        <div className={cn(
          "min-h-16 space-y-2 px-4 py-3",
          presentation === "card" ? "border-t border-border/40" : "bg-black/[0.025]",
        )}>
          <div className="h-3 w-2/5 rounded-full bg-muted/65" />
          <div className="h-3 w-3/5 rounded-full bg-muted/45" />
        </div>
      </div>
    );
  }

  let plan: React.ReactNode = null;
  if (model.local) {
    plan = (
      <LocalPlan
        model={model.local}
        legendEntries={legendEntries}
        className={planClassName}
        measurementMode={measurementMode}
        measurementSession={measurementSession}
      />
    );
  } else if (hasMesh) {
    plan = (
      <div className={cn("mx-auto aspect-[4/3] w-full overflow-hidden bg-white", planClassName)}>
        <MeshPlan data={rendering!} legendEntries={legendEntries} lang={lang} formatArea={formatArea} />
      </div>
    );
  } else if (publicFloorplan?.composite_url || rendering?.composite?.url) {
    const url = publicFloorplan?.composite_url ?? rendering!.composite.url;
    plan = (
      <div className={cn("relative mx-auto aspect-[4/3] w-full overflow-hidden bg-white", planClassName)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt="" className="absolute inset-0 h-full w-full object-contain" />
      </div>
    );
  } else {
    return null;
  }

  return (
    <div className={cn(
      "overflow-hidden",
      presentation === "card" && "rounded-xl border border-border/40 bg-surface shadow-card",
    )}>
      {plan}
      {legendEntries.length > 0 && (
        <div className={cn(
          "px-4 py-2.5",
          presentation === "card"
            ? "border-t border-border/40"
            : "bg-black/[0.025] shadow-[0_-14px_32px_-32px_rgba(0,0,0,0.45)] backdrop-blur-xl sm:px-6",
        )}>
          <div className={`grid gap-x-6 gap-y-1.5 ${legendEntries.length > 4 ? "grid-cols-2 max-sm:grid-cols-1" : "grid-cols-1"}`}>
            {legendEntries.map((e) => (
              <div key={e.n} className="flex items-center gap-2 min-w-0">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-black/[0.06] text-[12px] font-semibold text-foreground">
                  {e.n}
                </span>
                <span className="truncate text-[13px] font-medium text-foreground/75">{e.label}</span>
                {e.area > 0 && (
                  <span className="ml-auto shrink-0 text-[12px] text-muted-foreground tabular-nums">
                    {formatArea(e.area)}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      {totalArea > 0 && (
        <div className={cn(
          "flex items-center justify-between px-4 py-3",
          presentation === "card"
            ? "border-t border-border/40"
            : "bg-black/[0.035] shadow-[inset_0_1px_0_rgba(0,0,0,0.045)] sm:px-6",
        )}>
          <span className="text-[13px] font-semibold text-foreground">{t("floorplan.total", lang)}</span>
          <span className="text-[13px] font-semibold text-foreground tabular-nums">{formatArea(totalArea)}</span>
        </div>
      )}
    </div>
  );
}

// ── Local vector plan (iOS LocalFloorplanCanvasView port) ────────────────────

interface LocalModel {
  wallQuads: V2[][];
  wallSegments: [V2, V2][];
  cutQuads: V2[][];
  windows: { p1: V2; p2: V2 }[];
  doors: { id: string; p1: V2; p2: V2 }[];
  objects: ObjectXZ[];
  doorConfigs: Record<string, DoorConfig>;
  interior: V2;
  svgH: number;
  proj: (x: number, z: number) => [number, number];
  unproj: (x: number, y: number) => V2;
  pivot: V2;
  rotW: (p: V2) => V2;
  centresByIndex: Record<number, V2>;
  floorCentres: V2[];
  roomPolygons: V2[][];
  markers: Record<number, V2>;
  offsets: Record<number, V2>;
  totalArea: number;
  /** Compass dial rotation: plan rotation + (sceneRotation − device heading). */
  compassRotationDeg: number;
}

function buildLocalModel(
  draftData: DraftDataEntry[]
): { textData: Record<string, string>; local: LocalModel | null } {
  const textData = buildTextDataMap(draftData);

  let geom: ReturnType<typeof manhattanAdjust> | null = null;
  const rawRoom = textData["captured_structure_json"] ?? textData["captured_room_json"];
  if (rawRoom) {
    try {
      const parsed = parseCapturedRoom(JSON.parse(rawRoom));
      if (parsed) geom = manhattanAdjust(parsed);
    } catch {
      /* fall through to graph / mesh */
    }
  }

  const graphSegs = parseWallGraph(textData);
  const wallSegs: [V2, V2][] | null =
    graphSegs ?? (geom ? geom.walls.map((w) => [w.p1, w.p2] as [V2, V2]) : null);
  if (!wallSegs?.length) return { textData, local: null };

  // Openings: scan-detected (minus user-deleted) + user-drawn, both kept only
  // while a wall still hosts them (iOS openingHasHostWall).
  const edits = parseOpeningEdits(textData);
  const doorConfigs = parseDoorConfigs(textData);
  const hosted = (p1: V2, p2: V2) => openingHasHostWall(midOf(p1, p2), wallSegs);
  const srcDoors = (geom?.doors ?? []).filter(
    (d) =>
      !edits.deletedSourceOpeningIDs.has(d.id)
      && hosted(d.p1, d.p2)
      && doorObservationUsable(d.p1, d.p2, doorConfigs[d.id])
  );
  const srcWindows = (geom?.windows ?? []).filter(
    (w) => !edits.deletedSourceOpeningIDs.has(w.id) && hosted(w.p1, w.p2)
  );
  const srcOpenings = (geom?.openings ?? []).filter(
    (o) => !edits.deletedSourceOpeningIDs.has(o.id) && hosted(o.p1, o.p2)
  );
  const customDoors = edits.customOpenings.filter((o) => o.kind === "door" && hosted(o.p1, o.p2));
  const customWindows = edits.customOpenings.filter((o) => o.kind === "window" && hosted(o.p1, o.p2));
  const doors = [...srcDoors, ...customDoors].map((d) => ({ id: d.id, p1: d.p1, p2: d.p2 }));
  const windows = [...srcWindows, ...customWindows].map((w) => ({ p1: w.p1, p2: w.p2 }));
  const openings = srcOpenings.map((o) => ({ id: o.id, p1: o.p1, p2: o.p2 }));

  // User rotation (0/90/180/270), applied to world points around the stable
  // bounds centre — equivalent to iOS rotating the rendered canvas.
  const stableSegs: [V2, V2][] = geom
    ? conditionWallSegmentsForPresentation(
        wallSegs,
        geom.interiorCentroid,
        geom.floorPolys ?? []
      )
    : conditionWallSegmentsForPresentation(wallSegs, [0, 0]);
  const preBounds = computeBounds(stableSegs.flatMap(([a, b]) => wallQuad(a, b)))!;
  const pivot: V2 = [(preBounds.minX + preBounds.maxX) / 2, (preBounds.minZ + preBounds.maxZ) / 2];
  const rotDeg = floorplanRotationDegrees(textData);
  const rad = (rotDeg * Math.PI) / 180;
  const cosR = Math.cos(rad);
  const sinR = Math.sin(rad);
  const rotW = (p: V2): V2 =>
    rotDeg === 0
      ? p
      : [
          pivot[0] + (p[0] - pivot[0]) * cosR - (p[1] - pivot[1]) * sinR,
          pivot[1] + (p[0] - pivot[0]) * sinR + (p[1] - pivot[1]) * cosR,
        ];

  const rSeg = ([a, b]: [V2, V2]): [V2, V2] => [rotW(a), rotW(b)];
  const wallSegsR = stableSegs.map(rSeg);
  const fittedDoors = doors.map((door) => fitOpeningToHostWall(door, stableSegs));
  const fittedWindows = windows.map((window) => fitOpeningToHostWall(window, stableSegs));
  const fittedOpenings = openings.map((opening) => fitOpeningToHostWall(opening, stableSegs));
  const doorsR = fittedDoors.map((d) => ({ id: d.id, p1: rotW(d.p1), p2: rotW(d.p2) }));
  const windowsR = fittedWindows.map((w) => ({ p1: rotW(w.p1), p2: rotW(w.p2) }));
  const openingsR = fittedOpenings.map((o) => ({ id: o.id, p1: rotW(o.p1), p2: rotW(o.p2) }));
  const rotAxis = (a: V2): V2 =>
    rotDeg === 0 ? a : [a[0] * cosR - a[1] * sinR, a[0] * sinR + a[1] * cosR];
  const rotObj = (o: ObjectXZ): ObjectXZ => ({
    ...o,
    center: rotW(o.center),
    axisW: rotAxis(o.axisW),
    axisD: rotAxis(o.axisD),
  });
  const rawObjects = geom?.objects ?? [];
  const rawFurnitureWalls = (geom?.walls ?? []).map((wall) => [wall.p1, wall.p2] as [V2, V2]);
  const baselineFurnitureWalls = closestFurnitureWallBaseline(
    rawFurnitureWalls,
    rawFurnitureWalls,
    stableSegs,
  );
  const solveInput = {
    // Match iOS: solve against immutable scan evidence, then rigidly attach
    // supported furniture to translated live walls. Re-solving against every
    // wall edit makes objects merge, disappear, and return between frames.
    walls: baselineFurnitureWalls,
    doors: geom?.doors ?? [],
    windows: geom?.windows ?? [],
    openings: geom?.openings ?? [],
    objects: rawObjects, // constraint solver conditions/dedupes internally
    doorConfigs: parseDoorConfigs(textData),
    rooms: geom?.solverRooms ?? [],
  };
  const solveResult = USE_CONSTRAINT_SOLVER ? solveReaigenFloorplan(solveInput) : null;
  const solvedObjects = solveResult
      ? solveResult.objects
      : solveFurnitureLayout(
        prepareObjects(rawObjects, preBounds),
        baselineFurnitureWalls,
        geom?.interiorCentroid ?? pivot,
        geom?.doors ?? [],
        geom?.rooms ?? []
      );
  // Match iOS: authored furniture centres and deletion tombstones are applied
  // after the deterministic solve so deleting one source object cannot make a
  // previously merged/hidden duplicate unexpectedly appear.
  const composedObjects = removeRedundantCountertopFixtures(solvedObjects);
  // Architectural draw order: broad horizontal surfaces establish the base,
  // then seating and compact fixtures remain legible above them. RoomPlan's
  // source order is capture order and must not determine SVG occlusion.
  const furnitureLayer = (object: ObjectXZ): number => {
    const kind = furnitureKind(object.category);
    if (kind === "table") return 0;
    if (kind === "bed" || kind === "sofa") return 1;
    if (kind === "chair") return 3;
    return 2;
  };
  const attachedObjects = applyFurnitureWallAttachment(
    composedObjects,
    baselineFurnitureWalls,
    stableSegs,
  );
  const authoredObjects = applyFurnitureEdits(attachedObjects, parseFurnitureEdits(textData));
  const presentedObjects = prepareFloorplanPresentationObjects(authoredObjects)
    .sort((a, b) =>
      furnitureLayer(a) - furnitureLayer(b)
      || 4 * b.halfW * b.halfD - 4 * a.halfW * a.halfD
      || a.id.localeCompare(b.id)
    );
  const objectsR = presentedObjects.map(rotObj);

  const wallQuads = wallSegsR.map(([a, b]) => wallQuad(a, b));
  const cutQuads = [...doorsR, ...windowsR, ...openingsR].map((o) => openingCut(o.p1, o.p2));

  const interiorR = geom ? rotW(geom.interiorCentroid) : pivot;
  const doorExtentPoints = doorsR.flatMap((door) => {
    const sourceCfg = doorConfigs[door.id];
    const cfg = inferDoorPresentationConfig(door, sourceCfg, wallSegsR);
    if (cfg.doorType === "Moving") return [door.p1, door.p2];
    const swing = doorSwingWorld(door, cfg, interiorR);
    return [swing.hinge, swing.closedEnd, swing.panelEnd];
  });
  const bounds = computeBounds([
    ...wallSegsR.flatMap(([a, b]) => wallQuad(a, b)),
    ...doorExtentPoints,
  ])!;
  const spanX = Math.max(bounds.maxX - bounds.minX, 0.001);
  const spanZ = Math.max(bounds.maxZ - bounds.minZ, 0.001);
  const svgH = Math.max(
    MIN_SVG_H,
    Math.min(MAX_SVG_H, Math.round(SVG_W * (spanZ / spanX)))
  );
  const aw = SVG_W - 2 * PADDING;
  const ah = svgH - 2 * PADDING;
  const s = Math.min(aw / spanX, ah / spanZ, MAX_PLAN_SCALE);
  const ox = PADDING + (aw - spanX * s) / 2;
  const oy = PADDING + (ah - spanZ * s) / 2;
  const proj = (x: number, z: number): [number, number] => [
    ox + (x - bounds.minX) * s,
    oy + (z - bounds.minZ) * s,
  ];
  const unproj = (x: number, y: number): V2 => [
    (x - ox) / s + bounds.minX,
    (y - oy) / s + bounds.minZ,
  ];

  // Label plumbing (kept unrotated; positions get rotW at render time).
  const markersRaw = parseRoomMarkers(textData);
  const markers: Record<number, V2> = {};
  for (const [n, m] of Object.entries(markersRaw)) {
    markers[Number(n)] = geom ? rotateToSnappedFrame(m, geom) : m;
  }
  const centresByIndex: Record<number, V2> = { ...(geom?.floorCentresByIndex ?? {}) };
  const draftCenters = parseRoomCenters(textData);
  for (const [n, c] of Object.entries(draftCenters)) {
    if (!centresByIndex[Number(n)]) centresByIndex[Number(n)] = c;
  }

  // Compass: true-heading at scan start (CW from north) from the compass log,
  // combined with the Manhattan-snap rotation and the user's plan rotation —
  // same math as iOS drawCompass (N-up when no heading was recorded).
  let compassRotationDeg = rotDeg;
  if (geom && textData["compass_data_json"]) {
    try {
      const log = JSON.parse(textData["compass_data_json"]) as { samples?: { headingCWRad?: number }[] };
      const heading = log?.samples?.[0]?.headingCWRad;
      if (typeof heading === "number" && Number.isFinite(heading)) {
        compassRotationDeg += ((geom.sceneRotation - heading) * 180) / Math.PI;
      }
    } catch {
      /* N-up fallback */
    }
  }

  return {
    textData,
    local: {
      wallQuads,
      wallSegments: wallSegsR,
      cutQuads,
      windows: windowsR,
      doors: doorsR,
      objects: objectsR,
      doorConfigs,
      interior: interiorR,
      svgH,
      proj,
      unproj,
      pivot,
      rotW,
      centresByIndex,
      floorCentres: Object.values(geom?.floorCentresByID ?? {}),
      roomPolygons: (solveResult?.result.rooms ?? []).map((room) =>
        room.polygon.map((point) => rotW(point as V2))
      ),
      markers,
      offsets: parseLabelOffsets(textData),
      totalArea: totalFloorArea(textData),
      compassRotationDeg,
    },
  };
}

function LocalPlan({
  model,
  legendEntries,
  className,
  measurementMode,
  measurementSession,
}: {
  model: LocalModel;
  legendEntries: LegendEntry[];
  className?: string;
  measurementMode?: "distance" | "area" | null;
  measurementSession?: number;
}) {
  const maskId = useId();
  const { proj, svgH } = model;
  const [measurementPoints, setMeasurementPoints] = useState<V2[]>([]);
  useEffect(() => setMeasurementPoints([]), [measurementMode, measurementSession]);

  const addMeasurementPoint = (event: React.MouseEvent<SVGSVGElement>) => {
    if (!measurementMode) return;
    const matrix = event.currentTarget.getScreenCTM();
    if (!matrix) return;
    const svgPoint = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    const worldPoint = model.unproj(svgPoint.x, svgPoint.y);
    setMeasurementPoints((current) => (
      measurementMode === "distance"
        ? (current.length >= 2 ? [worldPoint] : [...current, worldPoint])
        : [...current.slice(0, 63), worldPoint]
    ));
    event.stopPropagation();
  };

  const measurementScreenPoints = measurementPoints.map(([x, z]) => proj(x, z));
  const measurementValue = measurementMode === "distance" && measurementPoints.length === 2
    ? Math.hypot(
        measurementPoints[1][0] - measurementPoints[0][0],
        measurementPoints[1][1] - measurementPoints[0][1],
      )
    : measurementMode === "area" && measurementPoints.length >= 3
      ? Math.abs(measurementPoints.reduce((sum, point, index) => {
          const next = measurementPoints[(index + 1) % measurementPoints.length];
          return sum + point[0] * next[1] - next[0] * point[1];
        }, 0)) / 2
      : null;
  const toPts = (poly: V2[]) => poly.map((p) => proj(p[0], p[1]).join(",")).join(" ");

  // Numbered label positions — iOS resolveLabelWorldPositions + rotation.
  const requestedNumbers = legendEntries.map((e) => e.n);
  const rawPositions = resolveLabelWorldPositions(
    requestedNumbers,
    model.pivot,
    model.centresByIndex,
    model.floorCentres,
    model.markers,
    model.offsets
  );
  const rotatedRawPositions = Object.fromEntries(
    Object.entries(rawPositions).map(([number, point]) => [number, model.rotW(point)])
  ) as Record<number, V2>;
  const labelAssignment = assignLabelsToRoomPolygons(
    requestedNumbers,
    rotatedRawPositions,
    model.roomPolygons
  );
  // An authored marker is the room's one placement — exactly where the
  // editor shows it. Polygon re-assignment and badge collision-nudging only
  // apply to rooms that were never explicitly placed.
  const hasAuthoredMarker = (n: number) => model.markers[n] !== undefined;
  const numbers = [...labelAssignment.numbers];
  const positions: Record<number, V2> = { ...labelAssignment.positions };
  for (const n of requestedNumbers) {
    if (!hasAuthoredMarker(n) || !rotatedRawPositions[n]) continue;
    positions[n] = rotatedRawPositions[n];
    if (!numbers.includes(n)) numbers.push(n);
  }
  // Collision layout remains in viewBox units; the rendered badge itself is
  // an HTML overlay with a fixed CSS size so it cannot jump between drafts.
  const circleR = 12;
  const furnitureScreenBounds = model.objects.map((object) => {
    const corners = objectCorners(object).map(([x, z]) => proj(x, z));
    return {
      minX: Math.min(...corners.map(([x]) => x)),
      maxX: Math.max(...corners.map(([x]) => x)),
      minY: Math.min(...corners.map(([, y]) => y)),
      maxY: Math.max(...corners.map(([, y]) => y)),
    };
  });
  const doorScreenBounds = model.doors.map((door) => {
    const sourceCfg = model.doorConfigs[door.id];
    const cfg = inferDoorPresentationConfig(door, sourceCfg, model.wallSegments);
    const worldPoints =
      cfg.doorType === "Moving"
        ? [door.p1, door.p2]
        : (() => {
            const swing = doorSwingWorld(door, cfg, model.interior);
            return [swing.hinge, swing.closedEnd, swing.panelEnd];
          })();
    const screenPoints = worldPoints.map(([x, z]) => proj(x, z));
    return {
      minX: Math.min(...screenPoints.map(([x]) => x)) - 8,
      maxX: Math.max(...screenPoints.map(([x]) => x)) + 8,
      minY: Math.min(...screenPoints.map(([, y]) => y)) - 8,
      maxY: Math.max(...screenPoints.map(([, y]) => y)) + 8,
    };
  });
  const wallScreenBounds = model.wallQuads.map((polygon) => {
    const points = polygon.map(([x, z]) => proj(x, z));
    return {
      minX: Math.min(...points.map(([x]) => x)) - 4,
      maxX: Math.max(...points.map(([x]) => x)) + 4,
      minY: Math.min(...points.map(([, y]) => y)) - 4,
      maxY: Math.max(...points.map(([, y]) => y)) + 4,
    };
  });
  const labelObstructions = [...wallScreenBounds, ...furnitureScreenBounds, ...doorScreenBounds];
  const labelScreenPositions = new Map<number, [number, number]>();
  const occupiedLabelBounds: Array<{
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
  }> = [];
  const labelStep = circleR * 2 + 12;
  const labelOffsets: Array<[number, number]> = [
    [0, 0],
    [0, -labelStep],
    [labelStep, 0],
    [-labelStep, 0],
    [0, labelStep],
    [labelStep, -labelStep],
    [-labelStep, -labelStep],
    [labelStep, labelStep],
    [-labelStep, labelStep],
    [0, -2 * labelStep],
  ];

  for (const number of numbers) {
    const world = positions[number];
    if (!world) continue;
    const [baseX, baseY] = proj(world[0], world[1]);
    let selected: [number, number] = [baseX, baseY];

    for (const [dx, dy] of hasAuthoredMarker(number) ? ([] as Array<[number, number]>) : labelOffsets) {
      const candidate: [number, number] = [baseX + dx, baseY + dy];
      const bounds = {
        minX: candidate[0] - circleR - 12,
        maxX: candidate[0] + circleR + 12,
        minY: candidate[1] - circleR - 12,
        maxY: candidate[1] + circleR + 12,
      };
      const withinPlan =
        bounds.minX >= PADDING &&
        bounds.maxX <= SVG_W - PADDING &&
        bounds.minY >= PADDING &&
        bounds.maxY <= svgH - PADDING;
      const overlaps = (other: typeof bounds) =>
        bounds.minX < other.maxX &&
        bounds.maxX > other.minX &&
        bounds.minY < other.maxY &&
        bounds.maxY > other.minY;

      if (
        withinPlan &&
        !labelObstructions.some(overlaps) &&
        !occupiedLabelBounds.some(overlaps)
      ) {
        selected = candidate;
        break;
      }
    }

    labelScreenPositions.set(number, selected);
    occupiedLabelBounds.push({
      minX: selected[0] - circleR - 12,
      maxX: selected[0] + circleR + 12,
      minY: selected[1] - circleR - 12,
      maxY: selected[1] + circleR + 12,
    });
  }

  const halfT = WALL_THICKNESS / 2;

  return (
    <div
      className={cn("relative mx-auto w-full [container-type:inline-size]", className)}
      style={{
        aspectRatio: `${SVG_W} / ${svgH}`,
      }}
    >
    <svg
      viewBox={`0 0 ${SVG_W} ${svgH}`}
      className={cn("block h-full w-full", measurementMode && "cursor-crosshair")}
      xmlns="http://www.w3.org/2000/svg"
      onClick={addMeasurementPoint}
    >
      <rect width={SVG_W} height={svgH} fill="white" />

      {/* Walls with door/window holes (destination-out via mask) */}
      <defs>
        <mask id={maskId}>
          <rect width={SVG_W} height={svgH} fill="white" />
          {model.cutQuads.map((poly, i) => (
            <polygon key={i} points={toPts(poly)} fill="black" />
          ))}
        </mask>
      </defs>
      <g mask={`url(#${maskId})`}>
        {model.wallQuads.map((poly, i) => (
          <polygon key={i} points={toPts(poly)} fill={STROKE_COLOR} />
        ))}
      </g>

      {/* Furniture: category symbols under openings + labels */}
      {[...model.objects]
        .sort(
          (a, b) =>
            Number(furnitureKind(a.category) === "table") -
            Number(furnitureKind(b.category) === "table")
        )
        .map((o, i) => (
          <FurnitureSymbol key={`f${i}`} object={o} proj={proj} />
        ))}

      {/* Windows: two frame lines on the wall faces + light glazing centre */}
      {model.windows.map((w, i) => {
        const dx = w.p2[0] - w.p1[0];
        const dz = w.p2[1] - w.p1[1];
        const len = Math.max(Math.hypot(dx, dz), 1e-4);
        const nx = -dz / len;
        const nz = dx / len;
        const line = (off: number, width: number, key: string) => {
          const [x1, y1] = proj(w.p1[0] + nx * off, w.p1[1] + nz * off);
          const [x2, y2] = proj(w.p2[0] + nx * off, w.p2[1] + nz * off);
          return (
            <line key={key} x1={x1} y1={y1} x2={x2} y2={y2} stroke={STROKE_COLOR} strokeWidth={width} strokeLinecap="square" />
          );
        };
        const jamb = (p: V2, key: string) => {
          const [x1, y1] = proj(p[0] + nx * halfT, p[1] + nz * halfT);
          const [x2, y2] = proj(p[0] - nx * halfT, p[1] - nz * halfT);
          return (
            <line key={key} x1={x1} y1={y1} x2={x2} y2={y2} stroke={STROKE_COLOR} strokeWidth={FURNITURE_STROKE} strokeLinecap="square" />
          );
        };
        return (
          <g key={`w${i}`}>
            {line(-halfT, FURNITURE_STROKE, "a")}
            {line(halfT, FURNITURE_STROKE, "b")}
            {line(0, FURNITURE_STROKE, "g")}
            {jamb(w.p1, "j1")}
            {jamb(w.p2, "j2")}
          </g>
        );
      })}

      {/* Doors: explicit configuration wins; ambiguous leaves are inferred from
          the nearest supported wall return rather than a global Left/In default. */}
      {model.doors.map((d, i) => {
        const dx = d.p2[0] - d.p1[0];
        const dz = d.p2[1] - d.p1[1];
        const len = Math.max(Math.hypot(dx, dz), 1e-4);
        const nx = -dz / len;
        const nz = dx / len;
        const jamb = (p: V2, key: string) => {
          const [x1, y1] = proj(p[0] + nx * halfT, p[1] + nz * halfT);
          const [x2, y2] = proj(p[0] - nx * halfT, p[1] - nz * halfT);
          return (
            <line key={key} x1={x1} y1={y1} x2={x2} y2={y2} stroke={STROKE_COLOR} strokeWidth={FURNITURE_STROKE} strokeLinecap="butt" />
          );
        };
        const sourceCfg = model.doorConfigs[d.id];
        const cfg = inferDoorPresentationConfig(d, sourceCfg, model.wallSegments);
        return (
          <g key={`d${i}`}>
            {jamb(d.p1, "j1")}
            {jamb(d.p2, "j2")}
            {cfg.doorType === "Moving" ? (
              <SlidingDoor door={d} proj={proj} />
            ) : (
              <DoorSwing door={d} cfg={cfg} interior={model.interior} proj={proj} />
            )}
          </g>
        );
      })}

      {measurementScreenPoints.length > 0 && (
        <g aria-label="Floor-plan measurement" pointerEvents="none">
          {measurementScreenPoints.length > 1 && (
            <polyline
              points={measurementScreenPoints.map((point) => point.join(",")).join(" ")}
              fill={measurementMode === "area" ? "rgba(37,99,235,0.12)" : "none"}
              stroke="#2563eb"
              strokeWidth={2}
              strokeDasharray="5 4"
              strokeLinejoin="round"
            />
          )}
          {measurementScreenPoints.map((point, index) => (
            <circle key={`${point.join(":")}:${index}`} cx={point[0]} cy={point[1]} r={4} fill="#2563eb" stroke="white" strokeWidth={1.5} />
          ))}
          {measurementValue !== null && (() => {
            const labelPoint = measurementScreenPoints[Math.floor(measurementScreenPoints.length / 2)];
            const label = `${measurementValue.toFixed(2)} ${measurementMode === "area" ? "m²" : "m"}`;
            return (
              <g transform={`translate(${labelPoint[0]} ${labelPoint[1] - 14})`}>
                <rect x={-32} y={-11} width={64} height={22} rx={8} fill="#111827" />
                <text textAnchor="middle" dominantBaseline="central" fill="white" fontSize={11} fontWeight={700}>{label}</text>
              </g>
            );
          })()}
        </g>
      )}

    </svg>

    {/*
      Room badges scale with the drawing. Their position was already a
      percentage of the viewBox, but their diameter was a fixed 32px, so the
      smaller a plan rendered the larger each badge became relative to the
      rooms — on a phone, or in the capped desktop column, they swelled over
      walls and into each other. Sized from the container instead, clamped so
      they stay legible on a small plan and never balloon on a large one.
    */}
    {numbers.map((number) => {
      const screen = labelScreenPositions.get(number);
      if (!screen) return null;
      return (
        <div
          key={`rl${number}`}
          data-floorplan-room-number={number}
          className="pointer-events-none absolute flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-black/15 bg-white/95 font-semibold tabular-nums text-slate-700"
          style={{
            left: `${(screen[0] / SVG_W) * 100}%`,
            top: `${(screen[1] / svgH) * 100}%`,
            width: "clamp(1.125rem, 7cqw, 2rem)",
            height: "clamp(1.125rem, 7cqw, 2rem)",
            fontSize: "clamp(0.5625rem, 3.2cqw, 0.875rem)",
          }}
        >
          {number}
        </div>
      );
    })}

    {/* Compass chip (iOS FloorplanCompassChip) — fixed-size HTML overlay in
        the card corner; the dial rotates so N points at true north */}
    <svg viewBox="0 0 36 36" className="pointer-events-none absolute right-3.5 top-3.5 h-9 w-9" xmlns="http://www.w3.org/2000/svg">
      <circle cx="18" cy="18" r="17.4" fill="white" stroke={STROKE_COLOR} strokeOpacity={0.7} strokeWidth={1.2} />
      <g transform={`rotate(${model.compassRotationDeg} 18 18)`}>
        <polygon points="18,7.2 13.5,18 22.5,18" fill={STROKE_COLOR} />
        <polygon points="18,28.8 13.5,18 22.5,18" fill="none" stroke={STROKE_COLOR} strokeOpacity={0.5} strokeWidth={0.8} />
        <text x="18" y="5" textAnchor="middle" dominantBaseline="central" fontSize="7" fontWeight="700" fill={STROKE_COLOR} fontFamily="system-ui, -apple-system, sans-serif">
          N
        </text>
      </g>
    </svg>
    </div>
  );
}

// ── Furniture symbols ────────────────────────────────────────────────────────

const FURNITURE_STROKE = 1.35; // shared screen-pixel detail line
const FURNITURE_OPACITY = 1;

/** Draw one RoomPlan object as its icon from the REAIGEN floorplan icon set.
 *
 * The icon (authored in metres, app/lib/floorplan-icon-shapes.ts) is fitted
 * to the object's oriented box: rotated 90° when their aspects oppose, then
 * stretched to the box extents. The screen mapping is one SVG matrix built
 * from the projected centre + axes; strokes keep their screen width via
 * vector-effect, so the whole set keeps the same line at any plan scale,
 * stretch, or rotation.
 */
function FurnitureSymbol({
  object,
  proj,
}: {
  object: ObjectXZ;
  proj: (x: number, z: number) => [number, number];
}) {
  const { center, axisW, axisD, halfW, halfD } = object;
  const c = proj(center[0], center[1]);
  const pW = proj(center[0] + axisW[0], center[1] + axisW[1]);
  const pD = proj(center[0] + axisD[0], center[1] + axisD[1]);
  const toScreen = `matrix(${pW[0] - c[0]} ${pW[1] - c[1]} ${pD[0] - c[0]} ${pD[1] - c[1]} ${c[0]} ${c[1]})`;

  const kind = furnitureKind(object.category);
  const icon = iconForKind(
    kind,
    halfW,
    halfD,
    (object as ObjectXZ & { presentationVariant?: string }).presentationVariant,
    (object as ObjectXZ & { counterSeams?: number[] }).counterSeams
  );
  const iw = icon.w / 2;
  const id = icon.d / 2;
  const aspectQuarterTurn = halfW >= halfD !== iw >= id ? 1 : 0;
  const quarterTurns = aspectQuarterTurn + (kind === "chair" ? -1 : 0);
  const rotatedHalfW = Math.abs(quarterTurns % 2) === 1 ? id : iw;
  const rotatedHalfD = Math.abs(quarterTurns % 2) === 1 ? iw : id;
  const uniformScale = Math.min(halfW / rotatedHalfW, halfD / rotatedHalfD);
  const fit = `rotate(${quarterTurns * 90}) scale(${uniformScale})`;

  return (
    <g
      transform={`${toScreen} ${fit}`}
      fill="none"
      stroke={STROKE_COLOR}
      strokeOpacity={FURNITURE_OPACITY}
      strokeWidth={FURNITURE_STROKE}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {kind === "table" && (
        <rect
          x={-icon.w / 2}
          y={-icon.d / 2}
          width={icon.w}
          height={icon.d}
          rx={Math.min(icon.w, icon.d) * 0.03}
          fill="white"
          stroke="white"
          strokeWidth={FURNITURE_STROKE + 4}
          vectorEffect="non-scaling-stroke"
        />
      )}
      {icon.shapes.map((s, i) => (
        <IconShapeEl key={i} shape={s} />
      ))}
    </g>
  );
}

function IconShapeEl({ shape }: { shape: IconShape }) {
  const ve = { vectorEffect: "non-scaling-stroke" as const };
  const fill = "fill" in shape && shape.fill ? { fill: "white" } : {};
  switch (shape.t) {
    case "rect":
      return <rect x={shape.x} y={shape.y} width={shape.w} height={shape.h} rx={shape.rx} {...fill} {...ve} />;
    case "circle":
      return <circle cx={shape.cx} cy={shape.cy} r={shape.r} {...fill} {...ve} />;
    case "ellipse":
      return <ellipse cx={shape.cx} cy={shape.cy} rx={shape.rx} ry={shape.ry} {...fill} {...ve} />;
    case "line":
      return <line x1={shape.x1} y1={shape.y1} x2={shape.x2} y2={shape.y2} {...ve} />;
    case "path":
      return <path d={shape.d} {...fill} {...ve} />;
  }
}

/** Sliding door: two half-width panels offset to either wall face, overlapping
 * at the middle — the standard plan symbol for a "Moving" door. */
function SlidingDoor({
  door,
  proj,
}: {
  door: { p1: V2; p2: V2 };
  proj: (x: number, z: number) => [number, number];
}) {
  const dx = door.p2[0] - door.p1[0];
  const dz = door.p2[1] - door.p1[1];
  const len = Math.max(Math.hypot(dx, dz), 1e-4);
  const ux = dx / len;
  const uz = dz / len;
  const nx = -uz;
  const nz = ux;
  const off = WALL_THICKNESS / 4;
  const overlap = len * 0.08;
  const panel = (fromT: number, toT: number, side: number, key: string) => {
    const [x1, y1] = proj(
      door.p1[0] + ux * fromT + nx * off * side,
      door.p1[1] + uz * fromT + nz * off * side
    );
    const [x2, y2] = proj(
      door.p1[0] + ux * toT + nx * off * side,
      door.p1[1] + uz * toT + nz * off * side
    );
    return <line key={key} x1={x1} y1={y1} x2={x2} y2={y2} stroke={STROKE_COLOR} strokeWidth={FURNITURE_STROKE} strokeLinecap="round" />;
  };
  return (
    <g>
      {panel(0, len / 2 + overlap, 1, "a")}
      {panel(len / 2 - overlap, len, -1, "b")}
    </g>
  );
}

/** iOS drawDoor: hinge side picks the pivot endpoint, swing direction picks
 * the perpendicular (toward/away from the room interior). */
function DoorSwing({
  door,
  cfg,
  interior,
  proj,
}: {
  door: { p1: V2; p2: V2 };
  cfg: DoorConfig;
  interior: V2;
  proj: (x: number, z: number) => [number, number];
}) {
  const swing = doorSwingWorld(door, cfg, interior);
  const hingeC = proj(swing.hinge[0], swing.hinge[1]);
  const panelEndC = proj(swing.panelEnd[0], swing.panelEnd[1]);
  const arcEndC = proj(swing.closedEnd[0], swing.closedEnd[1]);

  return (
    <g>
      <path d={arcPathAround(hingeC, arcEndC, panelEndC)} fill="none" stroke={STROKE_COLOR} strokeWidth={FURNITURE_STROKE} strokeLinecap="round" strokeLinejoin="round" />
      <line x1={hingeC[0]} y1={hingeC[1]} x2={panelEndC[0]} y2={panelEndC[1]} stroke={STROKE_COLOR} strokeWidth={FURNITURE_STROKE} strokeLinecap="round" />
      <circle cx={hingeC[0]} cy={hingeC[1]} r={FURNITURE_STROKE * 0.8} fill={STROKE_COLOR} />
    </g>
  );
}

// ── Backend mesh fallback (iOS FloorplanCanvas port) ─────────────────────────

function MeshPlan({
  data,
  legendEntries,
  lang,
  formatArea,
}: {
  data: FloorplanRenderingData;
  legendEntries: LegendEntry[];
  lang: string;
  formatArea: (value: number) => string;
}) {
  const layers = data.geometry.layers;
  const pts: V2[] = [];
  for (const layer of [layers.walls, layers.doors, layers.windows]) {
    for (const mesh of layer?.meshes ?? []) {
      for (const p of mesh.points) if (p.length >= 2) pts.push([p[0], p[1]]);
    }
  }
  const bounds = computeBounds(pts);
  if (!bounds) return null;

  const spanX = Math.max(bounds.maxX - bounds.minX, 0.001);
  const spanZ = Math.max(bounds.maxZ - bounds.minZ, 0.001);
  const svgH = Math.max(240, Math.min(640, Math.round(SVG_W * (spanZ / spanX))));
  const pad = Math.min(SVG_W, svgH) * 0.12;
  const s = Math.min((SVG_W - 2 * pad) / spanX, (svgH - 2 * pad) / spanZ);
  const ox = pad + (SVG_W - 2 * pad - spanX * s) / 2 - bounds.minX * s;
  const oy = pad + (svgH - 2 * pad - spanZ * s) / 2 - bounds.minZ * s;
  const proj = (x: number, z: number): [number, number] => [ox + x * s, oy + z * s];

  const facePolys = (layer: GeometryLayer | undefined): string[] => {
    if (!layer?.available) return [];
    const out: string[] = [];
    for (const mesh of layer.meshes) {
      for (const face of mesh.faces ?? []) {
        if (face.length < 3) continue;
        const poly = face
          .map((idx) => mesh.points[idx])
          .filter((p) => p && p.length >= 2)
          .map((p) => proj(p[0], p[1]).join(","));
        if (poly.length >= 3) out.push(poly.join(" "));
      }
    }
    return out;
  };

  const fontFor = Math.max(11, Math.min(16, s * 0.12));

  return (
    <svg viewBox={`0 0 ${SVG_W} ${svgH}`} className="block h-full w-full" xmlns="http://www.w3.org/2000/svg">
      <rect width={SVG_W} height={svgH} fill="white" />

      {/* Furniture: light outlined faces beneath openings and walls */}
      {facePolys(layers.furniture).map((p, i) => (
        <polygon key={`f${i}`} points={p} fill="none" stroke={MESH_INK} strokeWidth={FURNITURE_STROKE} strokeLinejoin="round" />
      ))}

      {/* Windows: thin outlined faces */}
      {facePolys(layers.windows).map((p, i) => (
        <polygon key={`w${i}`} points={p} fill="none" stroke={MESH_INK} strokeWidth={FURNITURE_STROKE} strokeLinejoin="round" />
      ))}

      {/* Doors: swing arc + panel from mesh bbox and hinge */}
      {(layers.doors?.available ? layers.doors.meshes : []).map((mesh, i) => {
        const meshPts = mesh.points.filter((p) => p.length >= 2);
        if (meshPts.length < 3) return null;
        const xs = meshPts.map((p) => p[0]);
        const zs = meshPts.map((p) => p[1]);
        const mnX = Math.min(...xs);
        const mxX = Math.max(...xs);
        const mnZ = Math.min(...zs);
        const mxZ = Math.max(...zs);
        const hinge = mesh.hinge_xz;
        const hx = hinge?.[0] ?? mnX;
        const hz = hinge && hinge.length >= 2 ? hinge[1] : mnZ;
        const cx1 = Math.abs(hx - mnX) < Math.abs(hx - mxX) ? mxX : mnX;
        const cz2 = Math.abs(hz - mnZ) < Math.abs(hz - mxZ) ? mxZ : mnZ;
        const hingeC = proj(hx, hz);
        const panelEndC = proj(cx1, hz);
        const arcEndC = proj(hx, cz2);
        return (
          <g key={`d${i}`}>
            <path d={arcPathAround(hingeC, arcEndC, panelEndC)} fill="none" stroke={MESH_INK} strokeWidth={FURNITURE_STROKE} strokeLinecap="round" />
            <line x1={hingeC[0]} y1={hingeC[1]} x2={panelEndC[0]} y2={panelEndC[1]} stroke={MESH_INK} strokeWidth={FURNITURE_STROKE} strokeLinecap="round" />
          </g>
        );
      })}

      {/* Walls on top */}
      {facePolys(layers.walls).map((p, i) => (
        <polygon key={`wl${i}`} points={p} fill={MESH_INK} />
      ))}

      {/* Room name + area at each room centre */}
      {(data.rooms ?? []).map((room: FloorplanRoom) => {
        const cx = room.center?.[0];
        const cz = room.center?.[1];
        if (cx == null || cz == null) return null;
        const [sx, sy] = proj(cx + (room.label_offset_x ?? 0), cz + (room.label_offset_z ?? 0));
        const n = room.room_number;
        const showNumber = n != null && legendEntries.some((e) => e.n === n);
        return (
          <g key={room.id} fontFamily="system-ui, -apple-system, sans-serif">
            <text x={sx} y={sy} textAnchor="middle" dominantBaseline="central" fill={LABEL_FILL} fontSize={fontFor} fontWeight={600}>
              {showNumber ? n : localizedRoomName(room.label, room.room_type_code, lang) ?? room.label}
            </text>
            {room.floor_area != null && room.floor_area > 0 && (
              <text x={sx} y={sy + fontFor * 1.2} textAnchor="middle" dominantBaseline="central" fill={AREA_FILL} fontSize={fontFor * 0.7}>
                {formatArea(room.floor_area)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

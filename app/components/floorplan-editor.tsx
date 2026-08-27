"use client";

/**
 * FloorplanEditor — web port of the iOS floorplan editor
 * (FloorPlanView.swift + WallDrawEraseOverlay in LocalFloorplanRenderer.swift).
 *
 * Same model and persistence contract as iOS:
 *  - walls edit a WallGraph (`wall_graph_json`: {vertices, edges}), debounced 300 ms
 *  - door/window edits in `floorplan_opening_edits_json`
 *    (deletedSourceOpeningIDs + customOpenings)
 *  - door configuration in `door_N_camera` (type / hinge / swing)
 *  - labels: `room_N_label`, offsets `room_N_label_offset_x/z`,
 *    new rooms also write `room_N_marker_x/z`
 *  - rotation: `floorplan_rotation_degrees` (0/90/180/270)
 *
 * Same tolerances as iOS: weld 0.10 m, min wall 0.15 m, opening host 0.30 m,
 * vertex pick 26 px, edge pick 24 px, door 0.90 m, window 1.20 m defaults.
 * Undo is whole-graph snapshots (max 20), in-memory only.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DraftDataEntry } from "../lib/tour-types";
import { saveDraftDataFields } from "../lib/api/client";
import { t } from "../lib/i18n";
import { cn } from "../lib/utils";
import {
  buildTextDataMap,
  parseCapturedRoom,
  manhattanAdjust,
  parseOpeningEdits,
  parseDoorConfigs,
  resolveDoorConfig,
  parseLabelOffsets,
  parseRoomMarkers,
  parseRoomCenters,
  roomNumbersInTextData,
  rawRoomLabel,
  floorplanRotationDegrees,
  rotateToSnappedFrame,
  resolveLabelWorldPositions,
  distancePointToSegment,
  openingHasHostWall,
  wallQuad,
  openingCut,
  computeBounds,
  furnitureKind,
  objectCorners,
  prepareObjects,
  prepareFloorplanPresentationObjects,
  removeRedundantCountertopFixtures,
  solveFurnitureLayout,
  STROKE_COLOR,
  WALL_THICKNESS,
  type AdjustedGeometry,
  type CustomOpening,
  type DoorConfig,
  type V2,
} from "../lib/floorplan-geometry";
import {
  ArrowLeftIcon,
  DoorToolIcon,
  DrawWallIcon,
  EraseIcon,
  FrameIcon,
  LayersToolIcon,
  MoveToolIcon,
  ResetToolIcon,
  RoomToolIcon,
  RotateIcon,
  UndoIcon,
  WindowToolIcon,
  type IconProps,
} from "./icons";
import { solveReaigenFloorplan, USE_CONSTRAINT_SOLVER } from "../lib/floorplan-solver-adapter";
import { iconForKind, type IconShape } from "../lib/floorplan-icon-shapes";
import {
  applyFurnitureEdits,
  cloneFurnitureEdits,
  collinearEdgeChain,
  moveFurniture,
  moveWall,
  parseFurnitureEdits,
  pointInsideFurnitureDepth,
  recordFurnitureCenters,
  translateWallChain,
  wallNormalTranslation,
  type FloorplanFurnitureEdits,
} from "../lib/floorplan-collision-solver";
import {
  applyFurnitureWallAttachment,
  closestFurnitureWallBaseline,
} from "../lib/floorplan-wall-attachment";

// iOS WallDrawEraseOverlay tolerances
const WELD_EPS = 0.1; // m
const MIN_WALL_DRAW = 0.15; // m
const MIN_WALL_FOR_OPENING = 0.25; // m
const MIN_OPENING = 0.2; // m
const DEFAULT_DOOR = 0.9; // m
const DEFAULT_WINDOW = 1.2; // m
const VERTEX_PICK_PX = 26;
const EDGE_PICK_PX = 24;
const OPENING_PLACE_PX = 42;
const MAX_UNDO = 20;
const VIEW = 720; // square viewBox so 90° rotations always fit
const DEFAULT_VIEW_ZOOM = 1.12;

interface WallGraphState {
  vertices: V2[];
  edges: { a: number; b: number }[];
}

interface OpeningEditsState {
  deletedSourceOpeningIDs: string[];
  customOpenings: CustomOpening[];
}

interface Snapshot {
  graph: WallGraphState;
  edits: OpeningEditsState;
  furnitureEdits: FloorplanFurnitureEdits;
}

type Tool = "draw" | "erase" | "move" | "door" | "window" | "room";

type MoveSelection =
  | { kind: "edge"; index: number; blocked: boolean }
  | { kind: "furniture"; id: string; blocked: boolean };

interface Props {
  draftId: number;
  draftData: DraftDataEntry[];
  lang: string;
  onClose: () => void;
  /** Saved entries (created or updated) — merge into the page's draft state. */
  onSaved: (entries: DraftDataEntry[]) => void;
}

const cloneGraph = (g: WallGraphState): WallGraphState => ({
  vertices: g.vertices.map((v) => [v[0], v[1]]),
  edges: g.edges.map((e) => ({ ...e })),
});
const cloneEdits = (e: OpeningEditsState): OpeningEditsState => ({
  deletedSourceOpeningIDs: [...e.deletedSourceOpeningIDs],
  customOpenings: e.customOpenings.map((o) => ({ ...o, p1: [...o.p1] as V2, p2: [...o.p2] as V2 })),
});

const dist = (a: V2, b: V2) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const mid = (a: V2, b: V2): V2 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const fmt = (v: number, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : "n/a");
const projectPointToSegment = (point: V2, a: V2, b: V2): V2 => {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const denominator = dx * dx + dz * dz;
  if (denominator < 1e-8) return [...a] as V2;
  const t = Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dz) / denominator));
  return [a[0] + dx * t, a[1] + dz * t];
};

/** Weld raw wall segments into a shared-vertex graph (iOS baseline build). */
function graphFromSegments(segs: [V2, V2][], eps = WELD_EPS): WallGraphState {
  const vertices: V2[] = [];
  const indexOf = (p: V2): number => {
    for (let i = 0; i < vertices.length; i++) if (dist(vertices[i], p) <= eps) return i;
    vertices.push([p[0], p[1]]);
    return vertices.length - 1;
  };
  const edges: { a: number; b: number }[] = [];
  for (const [p1, p2] of segs) {
    const a = indexOf(p1);
    const b = indexOf(p2);
    if (a !== b && !edges.some((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a))) {
      edges.push({ a, b });
    }
  }
  return { vertices, edges };
}

function pruneOrphans(g: WallGraphState): WallGraphState {
  const used = new Set<number>();
  for (const e of g.edges) {
    used.add(e.a);
    used.add(e.b);
  }
  const remap = new Map<number, number>();
  const vertices: V2[] = [];
  for (let i = 0; i < g.vertices.length; i++) {
    if (used.has(i)) {
      remap.set(i, vertices.length);
      vertices.push(g.vertices[i]);
    }
  }
  return { vertices, edges: g.edges.map((e) => ({ a: remap.get(e.a)!, b: remap.get(e.b)! })) };
}

const graphSegs = (g: WallGraphState): [V2, V2][] =>
  g.edges.map((e) => [g.vertices[e.a], g.vertices[e.b]] as [V2, V2]);

/**
 * Parse the scan evidence once for an editor session.
 *
 * Autosave merges the returned draft-data entries into the parent listing. If
 * this baseline is rebuilt from that new prop, the freshly saved wall graph is
 * mistaken for new scan evidence and the viewport projection is recomputed.
 * The result is the delayed whole-plan resize/jump that used to happen just
 * after a drag completed. Live edits belong in component state; this object is
 * deliberately immutable until the editor is closed and opened again.
 */
function buildEditorBaseline(draftData: DraftDataEntry[]) {
  const textData = buildTextDataMap(draftData);
  let geom: AdjustedGeometry | null = null;
  const raw = textData["captured_structure_json"] ?? textData["captured_room_json"];
  if (raw) {
    try {
      const parsed = parseCapturedRoom(JSON.parse(raw));
      if (parsed) geom = manhattanAdjust(parsed);
    } catch {
      /* graph-only editing */
    }
  }

  let initialGraph: WallGraphState | null = null;
  const rawGraph = textData["wall_graph_json"];
  if (rawGraph) {
    try {
      const g = JSON.parse(rawGraph) as WallGraphState;
      if (Array.isArray(g?.vertices) && Array.isArray(g?.edges) && g.edges.length) {
        initialGraph = {
          vertices: g.vertices.map((v) => [v[0], v[1]] as V2),
          edges: g.edges.map((e) => ({ a: e.a, b: e.b })),
        };
      }
    } catch {
      /* rebuild from scan */
    }
  }

  const baselineGraph = graphFromSegments((geom?.walls ?? []).map((w) => [w.p1, w.p2]));
  const parsedEdits = parseOpeningEdits(textData);
  const parsedFurnitureEdits = parseFurnitureEdits(textData);
  return {
    textData,
    geom,
    baselineGraph,
    initialGraph: initialGraph ?? cloneGraph(baselineGraph),
    initialEdits: {
      deletedSourceOpeningIDs: [...parsedEdits.deletedSourceOpeningIDs],
      customOpenings: parsedEdits.customOpenings,
    } as OpeningEditsState,
    initialFurnitureEdits: parsedFurnitureEdits,
  };
}

function initialProjection(base: ReturnType<typeof buildEditorBaseline>) {
  const pts = [
    ...base.initialGraph.vertices,
    ...(base.geom?.walls ?? []).flatMap((wall) => [wall.p1, wall.p2]),
  ];
  const bounds = computeBounds(pts.length ? pts : [[-4, -3], [4, 3]])!;
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cz = (bounds.minZ + bounds.maxZ) / 2;
  const span = Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ, 2) + 3;
  return { cx, cz, s: VIEW / span };
}

// ─────────────────────────────────────────────────────────────────────────────

export default function FloorplanEditor({ draftId, draftData, lang, onClose, onSaved }: Props) {
  // ── immutable scan baseline ────────────────────────────────────────────────
  const [base] = useState(() => buildEditorBaseline(draftData));

  const [graph, setGraph] = useState<WallGraphState>(() => cloneGraph(base.initialGraph));
  const [edits, setEdits] = useState<OpeningEditsState>(() => cloneEdits(base.initialEdits));
  const [furnitureEdits, setFurnitureEdits] = useState<FloorplanFurnitureEdits>(() =>
    cloneFurnitureEdits(base.initialFurnitureEdits)
  );
  const [rotationDeg, setRotationDeg] = useState(() => floorplanRotationDegrees(base.textData));
  const [tool, setTool] = useState<Tool | null>(null);
  const [zoom, setZoom] = useState(DEFAULT_VIEW_ZOOM);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [layersOpen, setLayersOpen] = useState(false);
  const [layers, setLayers] = useState({ doors: true, windows: true, labels: true, furniture: true });
  const [doorConfigs, setDoorConfigs] = useState<Record<string, DoorConfig>>(() => parseDoorConfigs(base.textData));
  const [labels, setLabels] = useState<Record<number, string>>(() => {
    const out: Record<number, string> = {};
    for (const n of roomNumbersInTextData(base.textData)) {
      const { label } = rawRoomLabel(n, base.textData);
      out[n] = label ?? `${t("floorplan.room", lang)} ${n}`;
    }
    return out;
  });
  const [labelOffsets, setLabelOffsets] = useState<Record<number, V2>>(() => parseLabelOffsets(base.textData));
  const [markers, setMarkers] = useState<Record<number, V2>>(() => {
    const raw = parseRoomMarkers(base.textData);
    const out: Record<number, V2> = {};
    for (const [n, m] of Object.entries(raw)) {
      out[Number(n)] = base.geom ? rotateToSnappedFrame(m, base.geom) : m;
    }
    return out;
  });
  const [editingDoor, setEditingDoor] = useState<{ id: string; screen: [number, number] } | null>(null);
  const [editingLabel, setEditingLabel] = useState<{ n: number; value: string; screen: [number, number] } | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "error">("idle");

  const undoStack = useRef<Snapshot[]>([]);
  const entriesRef = useRef<Map<string, DraftDataEntry>>(new Map(draftData.map((e) => [e.data_key, e])));
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const gesture = useRef<{
    kind: "pan" | "draw" | "erase" | "moveEdge" | "moveFurniture" | "label" | null;
    start: V2;
    startScreen: [number, number];
    edgeIndex?: number;
    furnitureId?: string;
    labelN?: number;
    baseGraph?: WallGraphState;
    baseEdits?: OpeningEditsState;
    baseFurniture?: ReturnType<typeof applyFurnitureEdits>;
    baseFurnitureEdits?: FloorplanFurnitureEdits;
    baseDoors?: Array<[V2, V2]>;
    basePan?: { x: number; y: number };
    baseOffset?: V2;
    moved?: boolean;
    undoCaptured?: boolean;
  }>({ kind: null, start: [0, 0], startScreen: [0, 0] });
  const [drawPreview, setDrawPreview] = useState<[V2, V2] | null>(null);
  const [eraseStroke, setEraseStroke] = useState<V2[]>([]);
  const [moveSelection, setMoveSelection] = useState<MoveSelection | null>(null);

  // ── projection (fixed at mount; pan/zoom layered on top) ──────────────────
  const [proj0] = useState(() => initialProjection(base));

  const rad = (rotationDeg * Math.PI) / 180;
  const rotW = useCallback(
    (p: V2): V2 => {
      if (rotationDeg === 0) return p;
      const c = Math.cos(rad);
      const sn = Math.sin(rad);
      const dx = p[0] - proj0.cx;
      const dz = p[1] - proj0.cz;
      return [proj0.cx + dx * c - dz * sn, proj0.cz + dx * sn + dz * c];
    },
    [rotationDeg, rad, proj0]
  );
  const unrotW = useCallback(
    (p: V2): V2 => {
      if (rotationDeg === 0) return p;
      const c = Math.cos(-rad);
      const sn = Math.sin(-rad);
      const dx = p[0] - proj0.cx;
      const dz = p[1] - proj0.cz;
      return [proj0.cx + dx * c - dz * sn, proj0.cz + dx * sn + dz * c];
    },
    [rotationDeg, rad, proj0]
  );

  const proj = useCallback(
    (x: number, z: number): [number, number] => {
      const [rx, rz] = rotW([x, z]);
      return [VIEW / 2 + (rx - proj0.cx) * proj0.s, VIEW / 2 + (rz - proj0.cz) * proj0.s];
    },
    [proj0, rotW]
  );

  /** Screen px per world metre (with zoom). */
  const pxPerMeter = proj0.s * zoom;

  /**
   * A client point in viewBox units.
   *
   * Both helpers below used to scale the offset inside the element's bounding
   * box: `(clientX - rect.left) * VIEW / rect.width`. That assumes the viewBox
   * covers the whole element, which is only true when their aspect ratios
   * agree. This viewBox is square — 720×720, so a 90° rotation always fits —
   * while the canvas is a wide panel, and there is no `preserveAspectRatio`, so
   * SVG applies the default `xMidYMid meet`: the 720 units are scaled to the
   * *shorter* edge and centred, leaving a letterbox margin left and right.
   *
   * So the mapping was wrong twice over — a scale error, plus an offset equal
   * to the margin — and because both grow with distance from the centre, every
   * tool landed further from the cursor the further out you drew.
   *
   * `getScreenCTM()` is the element's own answer to this. Inverted, it maps
   * screen to viewBox for whatever viewBox, aspect ratio and CSS transform are
   * in effect, so this cannot drift again if the canvas changes shape.
   */
  const clientToViewBox = useCallback((clientX: number, clientY: number): [number, number] => {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return [0, 0];
    const point = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
    return [point.x, point.y];
  }, []);

  const screenToWorld = useCallback(
    (clientX: number, clientY: number): V2 => {
      const [sx, sy] = clientToViewBox(clientX, clientY);
      const cx = (sx - pan.x) / zoom;
      const cy = (sy - pan.y) / zoom;
      return unrotW([proj0.cx + (cx - VIEW / 2) / proj0.s, proj0.cz + (cy - VIEW / 2) / proj0.s]);
    },
    [clientToViewBox, pan, zoom, proj0, unrotW]
  );

  const screenPx = useCallback(
    (clientX: number, clientY: number): [number, number] => clientToViewBox(clientX, clientY),
    [clientToViewBox],
  );

  // ── persistence ───────────────────────────────────────────────────────────
  const persist = useCallback(
    async (fields: Record<string, string>) => {
      setSaveState("saving");
      try {
        const saved = await saveDraftDataFields(draftId, fields, [...entriesRef.current.values()]);
        for (const entry of saved) entriesRef.current.set(entry.data_key, entry);
        onSaved(saved);
        setSaveState("idle");
      } catch {
        setSaveState("error");
      }
    },
    [draftId, onSaved]
  );

  const wallFields = useCallback(
    (g: WallGraphState, e: OpeningEditsState, f: FloorplanFurnitureEdits): Record<string, string> => ({
      wall_graph_json: JSON.stringify({
        vertices: g.vertices.map((v) => [v[0], v[1]]),
        edges: g.edges.map((ed) => ({ a: ed.a, b: ed.b })),
      }),
      floorplan_opening_edits_json: JSON.stringify({
        deletedSourceOpeningIDs: e.deletedSourceOpeningIDs,
        customOpenings: e.customOpenings.map((o) => ({ id: o.id, kind: o.kind, p1: o.p1, p2: o.p2 })),
      }),
      floorplan_furniture_edits_json: JSON.stringify({
        deletedSourceObjectIDs: f.deletedSourceObjectIDs,
        objectCenterOverrides: f.objectCenterOverrides,
      }),
    }),
    []
  );

  const schedulePersistWalls = useCallback(
    (g: WallGraphState, e: OpeningEditsState, f: FloorplanFurnitureEdits) => {
      if (persistTimer.current) clearTimeout(persistTimer.current);
      persistTimer.current = setTimeout(() => void persist(wallFields(g, e, f)), 300);
    },
    [persist, wallFields]
  );
  useEffect(() => () => {
    if (persistTimer.current) clearTimeout(persistTimer.current);
  }, []);

  const pushUndo = useCallback(() => {
    undoStack.current.push({
      graph: cloneGraph(graph),
      edits: cloneEdits(edits),
      furnitureEdits: cloneFurnitureEdits(furnitureEdits),
    });
    if (undoStack.current.length > MAX_UNDO) undoStack.current.shift();
  }, [graph, edits, furnitureEdits]);

  const commit = useCallback(
    (g: WallGraphState, e: OpeningEditsState, f: FloorplanFurnitureEdits) => {
      setGraph(g);
      setEdits(e);
      setFurnitureEdits(f);
      schedulePersistWalls(g, e, f);
    },
    [schedulePersistWalls]
  );

  // ── derived render model ──────────────────────────────────────────────────
  const segs = useMemo(() => graphSegs(graph), [graph]);
  const deletedSet = useMemo(() => new Set(edits.deletedSourceOpeningIDs), [edits]);
  const hosted = useCallback((p1: V2, p2: V2) => openingHasHostWall(mid(p1, p2), segs), [segs]);
  const srcDoors = useMemo(
    () => (base.geom?.doors ?? []).filter((d) => !deletedSet.has(d.id) && hosted(d.p1, d.p2)),
    [base.geom, deletedSet, hosted]
  );
  const srcWindows = useMemo(
    () => (base.geom?.windows ?? []).filter((w) => !deletedSet.has(w.id) && hosted(w.p1, w.p2)),
    [base.geom, deletedSet, hosted]
  );
  const srcOpenings = useMemo(
    () => (base.geom?.openings ?? []).filter((o) => !deletedSet.has(o.id) && hosted(o.p1, o.p2)),
    [base.geom, deletedSet, hosted]
  );
  const customDoors = useMemo(
    () => edits.customOpenings.filter((o) => o.kind === "door" && hosted(o.p1, o.p2)),
    [edits, hosted]
  );
  const customWindows = useMemo(
    () => edits.customOpenings.filter((o) => o.kind === "window" && hosted(o.p1, o.p2)),
    [edits, hosted]
  );
  const doors = useMemo(
    () => [...srcDoors, ...customDoors].map((d) => ({ id: d.id, p1: d.p1, p2: d.p2 })),
    [srcDoors, customDoors]
  );
  const windows = useMemo(() => [...srcWindows, ...customWindows], [srcWindows, customWindows]);
  const openings = srcOpenings;
  const interior = useMemo<V2>(() => {
    let sx = 0;
    let sz = 0;
    let c = 0;
    for (const [a, b] of segs) {
      sx += a[0] + b[0];
      sz += a[1] + b[1];
      c += 2;
    }
    return c ? [sx / c, sz / c] : [proj0.cx, proj0.cz];
  }, [segs, proj0]);

  /*
   * Match iOS's two-stage contract. The expensive deterministic solve runs
   * once against immutable scan evidence. Live wall edits only run the rigid
   * wall-attachment/collision pass, so a pointer frame can never cause global
   * merge/rejection decisions or make an object disappear and return.
   */
  const furnitureBaselineWalls = useMemo(() => {
    const rawWalls = (base.geom?.walls ?? []).map((wall) => [wall.p1, wall.p2] as [V2, V2]);
    const weldedWalls = graphSegs(base.baselineGraph);
    return closestFurnitureWallBaseline(rawWalls, weldedWalls, graphSegs(base.initialGraph));
  }, [base.baselineGraph, base.geom?.walls, base.initialGraph]);

  const baselineFurniture = useMemo(
    () => {
      const solved = USE_CONSTRAINT_SOLVER
        ? solveReaigenFloorplan({
            walls: furnitureBaselineWalls,
            doors: base.geom?.doors ?? [],
            windows: base.geom?.windows ?? [],
            openings: base.geom?.openings ?? [],
            objects: base.geom?.objects ?? [], // solver conditions internally
            doorConfigs,
            rooms: base.geom?.solverRooms ?? [],
          }).objects
        : solveFurnitureLayout(
            prepareObjects(base.geom?.objects ?? [], computeBounds(base.baselineGraph.vertices)),
            furnitureBaselineWalls,
            base.geom?.interiorCentroid ?? [proj0.cx, proj0.cz],
            base.geom?.doors ?? [],
            base.geom?.rooms ?? []
          );
      return removeRedundantCountertopFixtures(solved);
    },
    [base.baselineGraph.vertices, base.geom, doorConfigs, furnitureBaselineWalls, proj0.cx, proj0.cz],
  );

  const baselinePresentedFurniture = useMemo(() => {
      const presented = prepareFloorplanPresentationObjects(baselineFurniture);
      const layer = (object: (typeof presented)[number]): number => {
        const kind = furnitureKind(object.category);
        if (kind === "table") return 0;
        if (kind === "bed" || kind === "sofa") return 1;
        if (kind === "chair") return 3;
        return 2;
      };
      const ordered = presented.sort((a, b) =>
        layer(a) - layer(b)
        || 4 * b.halfW * b.halfD - 4 * a.halfW * a.halfD
        || a.id.localeCompare(b.id)
      );
      return ordered;
    }, [baselineFurniture]);

  // Physics and visual presentation deliberately remain separate. Collision
  // uses the immutable solver footprint. The web-only symbol preparation runs
  // once at baseline, then receives only the solved centre; it cannot regroup
  // cabinetry or resize a symbol halfway through a drag.
  const collisionFurniture = useMemo(
    () => applyFurnitureEdits(
      applyFurnitureWallAttachment(baselineFurniture, furnitureBaselineWalls, segs),
      furnitureEdits,
    ),
    [baselineFurniture, furnitureBaselineWalls, furnitureEdits, segs],
  );
  const furniture = useMemo(() => {
    const collisionById = new Map(collisionFurniture.map((object) => [object.id, object]));
    const baselineById = new Map(baselineFurniture.map((object) => [object.id, object]));
    return baselinePresentedFurniture.flatMap((object) => {
      const collisionObject = collisionById.get(object.id);
      const baselineObject = baselineById.get(object.id);
      return collisionObject
        && baselineObject
        ? [{
            ...object,
            center: [
              object.center[0] + collisionObject.center[0] - baselineObject.center[0],
              object.center[1] + collisionObject.center[1] - baselineObject.center[1],
            ] as V2,
          }]
        : [];
    });
  }, [baselineFurniture, baselinePresentedFurniture, collisionFurniture]);
  useEffect(() => {
    if (tool !== "move") {
      setMoveSelection(null);
    }
  }, [tool]);

  const roomNumbers = useMemo(() => {
    const set = new Set(roomNumbersInTextData(base.textData));
    for (const key of Object.keys(labels)) set.add(Number(key));
    return [...set].sort((a, b) => a - b);
  }, [base.textData, labels]);

  const labelPositions = useMemo(() => {
    const centresByIndex: Record<number, V2> = { ...(base.geom?.floorCentresByIndex ?? {}) };
    const draftCenters = parseRoomCenters(base.textData);
    for (const [n, c] of Object.entries(draftCenters)) {
      if (!centresByIndex[Number(n)]) centresByIndex[Number(n)] = c;
    }
    return resolveLabelWorldPositions(
      roomNumbers,
      [proj0.cx, proj0.cz],
      centresByIndex,
      Object.values(base.geom?.floorCentresByID ?? {}),
      markers,
      labelOffsets
    );
  }, [roomNumbers, base, markers, labelOffsets, proj0]);

  // ── tool actions ──────────────────────────────────────────────────────────
  const nearestVertex = useCallback(
    (w: V2): number | null => {
      const tol = VERTEX_PICK_PX / pxPerMeter;
      let best = -1;
      let bestD = tol;
      graph.vertices.forEach((v, i) => {
        const d = dist(v, w);
        if (d <= bestD) {
          bestD = d;
          best = i;
        }
      });
      return best >= 0 ? best : null;
    },
    [graph, pxPerMeter]
  );

  const nearestEdge = useCallback(
    (w: V2, tolPx: number): number | null => {
      const tol = tolPx / pxPerMeter;
      let best = -1;
      let bestD = tol;
      graph.edges.forEach((e, i) => {
        const d = distancePointToSegment(w, graph.vertices[e.a], graph.vertices[e.b]);
        if (d <= bestD) {
          bestD = d;
          best = i;
        }
      });
      return best >= 0 ? best : null;
    },
    [graph, pxPerMeter]
  );

  const snapDrawStart = useCallback((point: V2): V2 => {
    const vertex = nearestVertex(point);
    if (vertex != null) return graph.vertices[vertex];
    const edgeIndex = nearestEdge(point, VERTEX_PICK_PX);
    if (edgeIndex == null) return point;
    const edge = graph.edges[edgeIndex];
    return projectPointToSegment(point, graph.vertices[edge.a], graph.vertices[edge.b]);
  }, [graph, nearestEdge, nearestVertex]);

  /**
   * Keep the new wall orthogonal while snapping its free axis to a nearby
   * corner. A circular vertex hit-test is insufficient here: an otherwise
   * perfect closing wall can be far from a corner on its locked axis.
   */
  const snapDrawEnd = useCallback((start: V2, point: V2): V2 => {
    const horizontal = Math.abs(point[0] - start[0]) >= Math.abs(point[1] - start[1]);
    const aligned: V2 = horizontal ? [point[0], start[1]] : [start[0], point[1]];
    const tolerance = VERTEX_PICK_PX / pxPerMeter;
    let best = tolerance;
    for (const vertex of graph.vertices) {
      const distance = horizontal ? Math.abs(vertex[0] - aligned[0]) : Math.abs(vertex[1] - aligned[1]);
      if (distance < best) {
        best = distance;
        if (horizontal) aligned[0] = vertex[0];
        else aligned[1] = vertex[1];
      }
    }
    return aligned;
  }, [graph.vertices, pxPerMeter]);

  const commitDraw = useCallback(
    (from: V2, to: V2) => {
      if (dist(from, to) < MIN_WALL_DRAW) return;
      pushUndo();
      const g = cloneGraph(graph);
      const indexOf = (p: V2): number => {
        for (let i = 0; i < g.vertices.length; i++) if (dist(g.vertices[i], p) <= WELD_EPS) return i;
        g.vertices.push([p[0], p[1]]);
        return g.vertices.length - 1;
      };
      const a = indexOf(from);
      const b = indexOf(to);
      if (a !== b && !g.edges.some((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a))) {
        g.edges.push({ a, b });
      }
      commit(g, cloneEdits(edits), cloneFurnitureEdits(furnitureEdits));
    },
    [graph, edits, furnitureEdits, pushUndo, commit]
  );

  const eraseAlongStroke = useCallback(
    (stroke: V2[]) => {
      if (stroke.length < 1) return;
      const furnitureHit = furniture
        .map((object) => ({
          object,
          depth: Math.max(...stroke.map((point) => pointInsideFurnitureDepth(point, object))),
        }))
        .filter((hit) => hit.depth >= 0.025)
        .sort((a, b) => b.depth - a.depth || a.object.id.localeCompare(b.object.id))[0];
      if (furnitureHit) {
        pushUndo();
        const nextFurnitureEdits = cloneFurnitureEdits(furnitureEdits);
        const id = furnitureHit.object.id.toLowerCase();
        if (!nextFurnitureEdits.deletedSourceObjectIDs.includes(id)) {
          nextFurnitureEdits.deletedSourceObjectIDs.push(id);
        }
        delete nextFurnitureEdits.objectCenterOverrides[id];
        commit(cloneGraph(graph), cloneEdits(edits), nextFurnitureEdits);
        return;
      }
      const wallTol = WALL_THICKNESS * 0.5 + 6 / pxPerMeter;
      const openTol = wallTol + 8 / pxPerMeter;
      const hitSeg = (p1: V2, p2: V2, tol: number) =>
        stroke.some((p) => distancePointToSegment(p, p1, p2) <= tol);
      const g = cloneGraph(graph);
      const e = cloneEdits(edits);
      const removedEdges = new Set<number>();
      g.edges.forEach((ed, i) => {
        if (hitSeg(g.vertices[ed.a], g.vertices[ed.b], wallTol)) removedEdges.add(i);
      });
      // Openings hit directly by the stroke
      const deleted = new Set(e.deletedSourceOpeningIDs);
      for (const s of [...(base.geom?.doors ?? []), ...(base.geom?.windows ?? []), ...(base.geom?.openings ?? [])]) {
        if (!deleted.has(s.id) && hitSeg(s.p1, s.p2, openTol)) deleted.add(s.id);
      }
      e.customOpenings = e.customOpenings.filter((o) => !hitSeg(o.p1, o.p2, openTol));
      if (removedEdges.size) {
        const hostedByRemovedEdge = (point: V2) => [...removedEdges].some((index) => {
          const edge = g.edges[index];
          return !!edge && distancePointToSegment(point, g.vertices[edge.a], g.vertices[edge.b]) <= 0.3;
        });
        // Deleting a host wall owns its openings too. Persisting that relation
        // avoids a deleted RoomPlan door/window reappearing after reload.
        for (const source of [...(base.geom?.doors ?? []), ...(base.geom?.windows ?? [])]) {
          if (!deleted.has(source.id) && hostedByRemovedEdge(mid(source.p1, source.p2))) {
            deleted.add(source.id);
          }
        }
        e.customOpenings = e.customOpenings.filter((opening) => !hostedByRemovedEdge(mid(opening.p1, opening.p2)));
      }
      if (!removedEdges.size && deleted.size === e.deletedSourceOpeningIDs.length &&
          e.customOpenings.length === edits.customOpenings.length) {
        return;
      }
      pushUndo();
      e.deletedSourceOpeningIDs = [...deleted];
      g.edges = g.edges.filter((_, i) => !removedEdges.has(i));
      commit(pruneOrphans(g), e, cloneFurnitureEdits(furnitureEdits));
    },
    [graph, edits, furniture, furnitureEdits, base.geom, pxPerMeter, pushUndo, commit]
  );

  const placeOpening = useCallback(
    (w: V2, kind: "door" | "window") => {
      const edgeIndex = nearestEdge(w, OPENING_PLACE_PX);
      if (edgeIndex == null) return;
      const e = graph.edges[edgeIndex];
      const a = graph.vertices[e.a];
      const b = graph.vertices[e.b];
      const wallLen = dist(a, b);
      if (wallLen < MIN_WALL_FOR_OPENING) return;
      const len = Math.max(MIN_OPENING, Math.min(kind === "door" ? DEFAULT_DOOR : DEFAULT_WINDOW, wallLen - 0.1));
      const ux = (b[0] - a[0]) / wallLen;
      const uz = (b[1] - a[1]) / wallLen;
      const tRaw = (w[0] - a[0]) * ux + (w[1] - a[1]) * uz;
      const inset = wallLen * 0.02 + len / 2;
      const tC = Math.max(inset, Math.min(wallLen - inset, tRaw));
      const p1: V2 = [a[0] + ux * (tC - len / 2), a[1] + uz * (tC - len / 2)];
      const p2: V2 = [a[0] + ux * (tC + len / 2), a[1] + uz * (tC + len / 2)];
      pushUndo();
      const next = cloneEdits(edits);
      next.customOpenings.push({ id: crypto.randomUUID().toLowerCase(), kind, p1, p2 });
      commit(cloneGraph(graph), next, cloneFurnitureEdits(furnitureEdits));
    },
    [graph, edits, furnitureEdits, nearestEdge, pushUndo, commit]
  );

  const addRoom = useCallback(
    (w: V2) => {
      const n = roomNumbers.length ? Math.max(...roomNumbers) + 1 : 1;
      const name = `${t("floorplan.room", lang)} ${n}`;
      setLabels((prev) => ({ ...prev, [n]: name }));
      setMarkers((prev) => ({ ...prev, [n]: w }));
      void persist({
        [`room_${n}_label`]: name,
        [`room_${n}_marker_x`]: w[0].toFixed(4),
        [`room_${n}_marker_z`]: w[1].toFixed(4),
      });
    },
    [roomNumbers, lang, persist]
  );

  /** Reproject custom openings on edges touched by a move (length + ratio kept). */
  const reprojectOpenings = useCallback(
    (before: WallGraphState, after: WallGraphState, e: OpeningEditsState): OpeningEditsState => {
      const next = cloneEdits(e);
      const affectedEdges = before.edges.flatMap((edge, index) => {
        const nextEdge = after.edges[index];
        if (!nextEdge) return [];
        const oldA = before.vertices[edge.a];
        const oldB = before.vertices[edge.b];
        const newA = after.vertices[nextEdge.a];
        const newB = after.vertices[nextEdge.b];
        return oldA && oldB && newA && newB && (dist(oldA, newA) > 1e-5 || dist(oldB, newB) > 1e-5)
          ? [index]
          : [];
      });
      if (!affectedEdges.length) return next;

      const nearestAffectedEdge = (point: V2): number | null => {
        let best: number | null = null;
        let bestDistance = 0.3;
        for (const index of affectedEdges) {
          const edge = before.edges[index];
          if (!edge) continue;
          const distance = distancePointToSegment(point, before.vertices[edge.a], before.vertices[edge.b]);
          if (distance <= bestDistance) {
            bestDistance = distance;
            best = index;
          }
        }
        return best;
      };

      // RoomPlan openings are immutable scan observations. As on iOS, turn an
      // opening hosted by a moved wall into an authored opening with the same
      // identity before transforming it. Otherwise the source marker remains
      // behind and disappears as soon as the wall leaves its old position.
      const deleted = new Set(next.deletedSourceOpeningIDs);
      for (const source of [
        ...(base.geom?.doors ?? []).map((opening) => ({ ...opening, kind: "door" as const })),
        ...(base.geom?.windows ?? []).map((opening) => ({ ...opening, kind: "window" as const })),
      ]) {
        if (deleted.has(source.id) || nearestAffectedEdge(mid(source.p1, source.p2)) == null) continue;
        deleted.add(source.id);
        if (!next.customOpenings.some((opening) => opening.id === source.id)) {
          next.customOpenings.push({ id: source.id, kind: source.kind, p1: source.p1, p2: source.p2 });
        }
      }
      next.deletedSourceOpeningIDs = [...deleted];

      next.customOpenings = next.customOpenings.map((o) => {
        const m = mid(o.p1, o.p2);
        const bestI = nearestAffectedEdge(m);
        if (bestI == null) return o;
        const oldA = before.vertices[before.edges[bestI].a];
        const oldB = before.vertices[before.edges[bestI].b];
        const newA = after.vertices[after.edges[bestI]?.a ?? before.edges[bestI].a];
        const newB = after.vertices[after.edges[bestI]?.b ?? before.edges[bestI].b];
        if (!newA || !newB) return o;
        const oldLen = Math.max(dist(oldA, oldB), 1e-4);
        const newLen = Math.max(dist(newA, newB), 1e-4);
        if (newLen <= MIN_WALL_FOR_OPENING) return o;
        const len = Math.min(dist(o.p1, o.p2), Math.max(MIN_OPENING, newLen - 0.1));
        const rawTMid = ((m[0] - oldA[0]) * (oldB[0] - oldA[0]) + (m[1] - oldA[1]) * (oldB[1] - oldA[1])) / (oldLen * oldLen);
        const halfT = len / newLen / 2;
        const tMid = Math.max(halfT + 0.02, Math.min(1 - halfT - 0.02, rawTMid));
        const ux = (newB[0] - newA[0]) / newLen;
        const uz = (newB[1] - newA[1]) / newLen;
        const c: V2 = [newA[0] + (newB[0] - newA[0]) * tMid, newA[1] + (newB[1] - newA[1]) * tMid];
        return {
          ...o,
          p1: [c[0] - (ux * len) / 2, c[1] - (uz * len) / 2] as V2,
          p2: [c[0] + (ux * len) / 2, c[1] + (uz * len) / 2] as V2,
        };
      });
      return next;
    },
    [base.geom]
  );

  // ── pointer handlers ──────────────────────────────────────────────────────
  const onPointerDown = useCallback(
    (ev: React.PointerEvent<SVGSVGElement>) => {
      if (editingDoor || editingLabel) {
        setEditingDoor(null);
        setEditingLabel(null);
        return;
      }
      (ev.target as Element).setPointerCapture?.(ev.pointerId);
      const w = screenToWorld(ev.clientX, ev.clientY);
      const sp = screenPx(ev.clientX, ev.clientY);
      const g = gesture.current;
      g.start = w;
      g.startScreen = sp;
      g.moved = false;
      g.undoCaptured = false;
      // Desktop DCC convention: the middle mouse button always pans, even
      // while a drawing or transform tool is active.
      if (ev.button === 1) {
        ev.preventDefault();
        g.kind = "pan";
        g.basePan = { ...pan };
        return;
      }
      if (ev.button !== 0) {
        g.kind = null;
        return;
      }
      if (!tool) {
        // Label hit first, then door config target, else pan.
        const labelTol = 16 / pxPerMeter;
        for (const n of roomNumbers) {
          const pos = labelPositions[n];
          if (pos && dist(pos, w) <= labelTol) {
            g.kind = "label";
            g.labelN = n;
            g.baseOffset = labelOffsets[n] ?? [0, 0];
            return;
          }
        }
        const doorTol = 22 / pxPerMeter;
        for (const d of doors) {
          if (dist(mid(d.p1, d.p2), w) <= doorTol) {
            const [sx, sy] = proj(...mid(d.p1, d.p2));
            setEditingDoor({ id: d.id, screen: [sx * zoom + pan.x, sy * zoom + pan.y] });
            g.kind = null;
            return;
          }
        }
        g.kind = "pan";
        g.basePan = { ...pan };
        return;
      }
      switch (tool) {
        case "draw": {
          g.kind = "draw";
          g.start = snapDrawStart(w);
          setDrawPreview([g.start, g.start]);
          return;
        }
        case "erase":
          g.kind = "erase";
          setEraseStroke([w]);
          return;
        case "move": {
          const furnitureHit = furniture
            .map((object) => ({ object, depth: pointInsideFurnitureDepth(w, object) }))
            .filter((hit) => hit.depth >= 0)
            .sort((a, b) =>
              Number(Boolean(b.object.parentId)) - Number(Boolean(a.object.parentId))
              || b.depth - a.depth
              || a.object.id.localeCompare(b.object.id)
            )[0];
          const edgeAtPointer = nearestEdge(w, EDGE_PICK_PX);
          if (furnitureHit && (furnitureHit.depth >= 0.025 || edgeAtPointer == null)) {
            g.kind = "moveFurniture";
            g.furnitureId = furnitureHit.object.id;
            setMoveSelection({ kind: "furniture", id: furnitureHit.object.id, blocked: false });
            g.baseGraph = cloneGraph(graph);
            g.baseEdits = cloneEdits(edits);
            g.baseFurniture = collisionFurniture.map((object) => ({ ...object, center: [...object.center] as V2 }));
            g.baseFurnitureEdits = cloneFurnitureEdits(furnitureEdits);
            g.baseDoors = doors.map((door) => [[...door.p1] as V2, [...door.p2] as V2]);
            return;
          }
          const ei = edgeAtPointer;
          if (ei != null) {
            g.kind = "moveEdge";
            g.edgeIndex = ei;
            setMoveSelection({ kind: "edge", index: ei, blocked: false });
            g.baseGraph = cloneGraph(graph);
            g.baseEdits = cloneEdits(edits);
            g.baseFurniture = collisionFurniture.map((object) => ({ ...object, center: [...object.center] as V2 }));
            g.baseFurnitureEdits = cloneFurnitureEdits(furnitureEdits);
            g.baseDoors = doors.map((door) => [[...door.p1] as V2, [...door.p2] as V2]);
            return;
          }
          if (furnitureHit) {
            g.kind = "moveFurniture";
            g.furnitureId = furnitureHit.object.id;
            setMoveSelection({ kind: "furniture", id: furnitureHit.object.id, blocked: false });
            g.baseGraph = cloneGraph(graph);
            g.baseEdits = cloneEdits(edits);
            g.baseFurniture = collisionFurniture.map((object) => ({ ...object, center: [...object.center] as V2 }));
            g.baseFurnitureEdits = cloneFurnitureEdits(furnitureEdits);
            g.baseDoors = doors.map((door) => [[...door.p1] as V2, [...door.p2] as V2]);
            return;
          }
          setMoveSelection(null);
          g.kind = "pan";
          g.basePan = { ...pan };
          return;
        }
        case "door":
        case "window":
        case "room":
          g.kind = null; // click actions handled on pointer up
          return;
      }
    },
    [tool, screenToWorld, screenPx, pan, zoom, proj, doors, roomNumbers, labelPositions, labelOffsets,
     nearestEdge, graph, edits, collisionFurniture, furniture, furnitureEdits, pxPerMeter, editingDoor, editingLabel, snapDrawStart]
  );

  const onPointerMove = useCallback(
    (ev: React.PointerEvent<SVGSVGElement>) => {
      const g = gesture.current;
      if (!g.kind) return;
      const w = screenToWorld(ev.clientX, ev.clientY);
      const sp = screenPx(ev.clientX, ev.clientY);
      if (Math.hypot(sp[0] - g.startScreen[0], sp[1] - g.startScreen[1]) > 3) g.moved = true;
      if (
        g.moved
        && !g.undoCaptured
        && (g.kind === "moveEdge" || g.kind === "moveFurniture")
      ) {
        pushUndo();
        g.undoCaptured = true;
      }
      switch (g.kind) {
        case "pan": {
          setPan({
            x: g.basePan!.x + (sp[0] - g.startScreen[0]),
            y: g.basePan!.y + (sp[1] - g.startScreen[1]),
          });
          return;
        }
        case "draw": {
          setDrawPreview([g.start, snapDrawEnd(g.start, w)]);
          return;
        }
        case "erase":
          setEraseStroke((prev) => [...prev, w]);
          return;
        case "moveEdge": {
          const requestedDelta = wallNormalTranslation(
            [w[0] - g.start[0], w[1] - g.start[1]],
            g.edgeIndex!,
            g.baseGraph!,
          );
          const movement = moveWall(
            g.baseFurniture ?? [],
            g.baseGraph!,
            g.edgeIndex!,
            requestedDelta,
            g.baseDoors ?? [],
          );
          const nextGraph = translateWallChain(g.baseGraph!, g.edgeIndex!, movement.wallDelta);
          setGraph(nextGraph);
          setEdits(reprojectOpenings(g.baseGraph!, nextGraph, g.baseEdits!));
          setFurnitureEdits(recordFurnitureCenters(
            g.baseFurnitureEdits!,
            g.baseFurniture ?? [],
            movement.objects,
          ));
          setMoveSelection({ kind: "edge", index: g.edgeIndex!, blocked: movement.blocked });
          return;
        }
        case "moveFurniture": {
          const movement = moveFurniture(
            g.baseFurniture ?? [],
            g.furnitureId!,
            g.baseGraph!,
            [w[0] - g.start[0], w[1] - g.start[1]],
            g.baseDoors ?? [],
          );
          setFurnitureEdits(recordFurnitureCenters(
            g.baseFurnitureEdits!,
            g.baseFurniture ?? [],
            movement.objects,
          ));
          setMoveSelection({ kind: "furniture", id: g.furnitureId!, blocked: movement.blocked });
          return;
        }
        case "label": {
          const n = g.labelN!;
          const dx = w[0] - g.start[0];
          const dz = w[1] - g.start[1];
          setLabelOffsets((prev) => ({
            ...prev,
            [n]: [g.baseOffset![0] + dx, g.baseOffset![1] + dz],
          }));
          return;
        }
      }
    },
    [screenToWorld, screenPx, snapDrawEnd, reprojectOpenings, pushUndo]
  );

  const onPointerUp = useCallback(
    (ev: React.PointerEvent<SVGSVGElement>) => {
      const g = gesture.current;
      const kind = g.kind;
      g.kind = null;
      const w = screenToWorld(ev.clientX, ev.clientY);
      switch (kind) {
        case "draw": {
          commitDraw(g.start, snapDrawEnd(g.start, w));
          setDrawPreview(null);
          return;
        }
        case "erase": {
          eraseAlongStroke([...eraseStroke, w]);
          setEraseStroke([]);
          return;
        }
        case "moveEdge": {
          if (!g.moved) {
            setMoveSelection(null);
            return;
          }
          const requestedDelta = wallNormalTranslation(
            [w[0] - g.start[0], w[1] - g.start[1]],
            g.edgeIndex!,
            g.baseGraph!,
          );
          const movement = moveWall(
            g.baseFurniture ?? [],
            g.baseGraph!,
            g.edgeIndex!,
            requestedDelta,
            g.baseDoors ?? [],
          );
          const nextGraph = translateWallChain(g.baseGraph!, g.edgeIndex!, movement.wallDelta);
          const nextEdits = reprojectOpenings(g.baseGraph!, nextGraph, g.baseEdits!);
          const nextFurnitureEdits = recordFurnitureCenters(
            g.baseFurnitureEdits!,
            g.baseFurniture ?? [],
            movement.objects,
          );
          setMoveSelection(null);
          commit(nextGraph, nextEdits, nextFurnitureEdits);
          return;
        }
        case "moveFurniture": {
          if (!g.moved) {
            setMoveSelection(null);
            return;
          }
          const movement = moveFurniture(
            g.baseFurniture ?? [],
            g.furnitureId!,
            g.baseGraph!,
            [w[0] - g.start[0], w[1] - g.start[1]],
            g.baseDoors ?? [],
          );
          const nextFurnitureEdits = recordFurnitureCenters(
            g.baseFurnitureEdits!,
            g.baseFurniture ?? [],
            movement.objects,
          );
          setMoveSelection(null);
          commit(cloneGraph(g.baseGraph!), cloneEdits(g.baseEdits!), nextFurnitureEdits);
          return;
        }
        case "label": {
          const n = g.labelN!;
          if (!g.moved) {
            // Tap → rename inline (iOS DraggableRoomLabel tap).
            const pos = labelPositions[n];
            if (pos) {
              const [sx, sy] = proj(pos[0], pos[1]);
              setEditingLabel({ n, value: labels[n] ?? "", screen: [sx * zoom + pan.x, sy * zoom + pan.y] });
            }
            return;
          }
          const off = labelOffsets[n] ?? [0, 0];
          void persist({
            [`room_${n}_label_offset_x`]: off[0].toFixed(4),
            [`room_${n}_label_offset_z`]: off[1].toFixed(4),
          });
          return;
        }
        case null: {
          if (tool === "door") placeOpening(w, "door");
          else if (tool === "window") placeOpening(w, "window");
          else if (tool === "room") addRoom(w);
          return;
        }
      }
    },
    [screenToWorld, snapDrawEnd, commitDraw, eraseStroke, eraseAlongStroke, commit,
     reprojectOpenings, labelPositions, labelOffsets, labels, proj, zoom, pan, persist, tool,
     placeOpening, addRoom]
  );

  const onPointerCancel = useCallback(() => {
    const current = gesture.current;
    if (
      (current.kind === "moveEdge" || current.kind === "moveFurniture")
      && current.baseGraph
      && current.baseEdits
    ) {
      setGraph(cloneGraph(current.baseGraph));
      setEdits(cloneEdits(current.baseEdits));
      if (current.baseFurnitureEdits) setFurnitureEdits(cloneFurnitureEdits(current.baseFurnitureEdits));
      if (current.undoCaptured) undoStack.current.pop();
    }
    current.kind = null;
    setMoveSelection(null);
    setDrawPreview(null);
    setEraseStroke([]);
  }, []);

  const onWheel = useCallback(
    (ev: React.WheelEvent<SVGSVGElement>) => {
      const factor = Math.exp(-ev.deltaY * 0.0015);
      setZoom((z) => {
        const next = Math.max(0.5, Math.min(5, z * factor));
        const sp = screenPx(ev.clientX, ev.clientY);
        setPan((p) => ({
          x: sp[0] - ((sp[0] - p.x) / z) * next,
          y: sp[1] - ((sp[1] - p.y) / z) * next,
        }));
        return next;
      });
    },
    [screenPx]
  );

  // ── toolbar actions ───────────────────────────────────────────────────────
  const undo = useCallback(() => {
    const snap = undoStack.current.pop();
    if (!snap) return;
    commit(snap.graph, snap.edits, snap.furnitureEdits);
  }, [commit]);

  const rotate = useCallback(() => {
    const next = (rotationDeg + 90) % 360;
    setRotationDeg(next);
    void persist({ floorplan_rotation_degrees: String(next) });
  }, [rotationDeg, persist]);

  const resetAll = useCallback(() => {
    pushUndo();
    commit(
      cloneGraph(base.baselineGraph),
      { deletedSourceOpeningIDs: [], customOpenings: [] },
      { deletedSourceObjectIDs: [], objectCenterOverrides: {} },
    );
  }, [base.baselineGraph, pushUndo, commit]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTyping = target?.isContentEditable || target?.tagName === "INPUT" || target?.tagName === "TEXTAREA";

      if (event.key === "Escape") {
        setMoveSelection(null);
        setEditingDoor(null);
        setEditingLabel(null);
        setTool(null);
        return;
      }
      if (isTyping) return;

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        undo();
        return;
      }

      const shortcutTools: Partial<Record<string, Tool>> = {
        v: "move",
        w: "draw",
        e: "erase",
        d: "door",
        n: "window",
        r: "room",
      };
      const shortcutTool = shortcutTools[event.key.toLowerCase()];
      if (shortcutTool) {
        event.preventDefault();
        setTool(shortcutTool);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [undo]);

  const saveDoorConfig = useCallback(
    (doorId: string, cfg: DoorConfig) => {
      setDoorConfigs((prev) => ({ ...prev, [doorId]: cfg }));
      // Find the existing door_N_camera key for this door, else allocate N.
      let key: string | null = null;
      let maxN = 0;
      for (const [k, v] of Object.entries(base.textData)) {
        const m = /^door_(\d+)_camera$/.exec(k);
        if (!m) continue;
        maxN = Math.max(maxN, parseInt(m[1], 10));
        try {
          if (String((JSON.parse(v) as { door_id?: string }).door_id ?? "").toLowerCase() === doorId) key = k;
        } catch {
          /* skip */
        }
      }
      for (const k of entriesRef.current.keys()) {
        const m = /^door_(\d+)_camera$/.exec(k);
        if (m) maxN = Math.max(maxN, parseInt(m[1], 10));
      }
      const n = key ? parseInt(key.split("_")[1], 10) : maxN + 1;
      const existingRaw = key ? base.textData[key] : null;
      let merged: Record<string, unknown> = {};
      if (existingRaw) {
        try {
          merged = JSON.parse(existingRaw) as Record<string, unknown>;
        } catch {
          merged = {};
        }
      }
      merged = {
        ...merged,
        door_id: doorId,
        door_number: n,
        door_type: cfg.doorType,
        hinge_side: cfg.hingeSide,
        swing_direction: cfg.swingDirection,
        is_user_configured: true,
      };
      void persist({ [`door_${n}_camera`]: JSON.stringify(merged) });
    },
    [base.textData, persist]
  );

  const renameLabel = useCallback(
    (n: number, value: string) => {
      const name = value.trim();
      setEditingLabel(null);
      if (!name || name === labels[n]) return;
      setLabels((prev) => ({ ...prev, [n]: name }));
      void persist({ [`room_${n}_label`]: name });
    },
    [labels, persist]
  );

  // ── render ────────────────────────────────────────────────────────────────
  const wallQuads = segs.map(([a, b]) => wallQuad(a, b));
  const cutQuads = [...doors, ...windows.map((w) => ({ id: "", p1: w.p1, p2: w.p2 })), ...openings].map((o) =>
    openingCut(o.p1, o.p2)
  );
  const toPts = (poly: V2[]) => poly.map((p) => proj(p[0], p[1]).join(",")).join(" ");
  const halfT = WALL_THICKNESS / 2;
  const fontPx = 13;
  const canUndo = undoStack.current.length > 0;

  const mapBounds = useMemo(() => {
    const pts = [
      ...graph.vertices,
      ...doors.flatMap((door) => [door.p1, door.p2]),
      ...windows.flatMap((window) => [window.p1, window.p2]),
      ...openings.flatMap((opening) => [opening.p1, opening.p2]),
    ];
    return computeBounds(pts);
  }, [doors, graph.vertices, openings, windows]);
  const selectedEdgeIndices = useMemo(
    () => moveSelection?.kind === "edge"
      ? collinearEdgeChain(graph, moveSelection.index)
      : new Set<number>(),
    [graph, moveSelection],
  );
  const mapW = mapBounds ? mapBounds.maxX - mapBounds.minX : 0;
  const mapZ = mapBounds ? mapBounds.maxZ - mapBounds.minZ : 0;
  const ratioText = mapBounds ? `${fmt(mapW)}m × ${fmt(mapZ)}m` : "n/a";

  const toolButton = (tl: Tool, label: string, Icon: (props: IconProps) => React.ReactElement) => (
    <button
      key={tl}
      type="button"
      onClick={() => setTool((prev) => (prev === tl ? null : tl))}
      aria-pressed={tool === tl}
      aria-label={label}
      title={label}
      className={cn(
        "floorplan-tool-button group flex h-12 shrink-0 items-center justify-center gap-2.5 rounded-full px-4 text-[13px] font-semibold transition-[background-color,color,box-shadow,transform]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        tool === tl
          ? "bg-foreground text-background shadow-[inset_0_1px_0_hsl(var(--card)/0.2),0_7px_18px_hsl(var(--foreground)/0.15)]"
          : "text-foreground/62 hover:bg-foreground/[0.055] hover:text-foreground active:scale-[0.98]",
      )}
    >
      <Icon size={21} strokeWidth={1.9} className="shrink-0" />
      <span className="floorplan-tool-label whitespace-nowrap">{label}</span>
    </button>
  );

  const chip = (key: keyof typeof layers, label: string) => (
    <button
      key={key}
      type="button"
      onClick={() => setLayers((prev) => ({ ...prev, [key]: !prev[key] }))}
      className={cn(
        "rounded-full px-2.5 py-1 text-[12px] font-medium transition-colors",
        layers[key] ? "bg-black/[0.07] text-foreground" : "text-foreground/35"
      )}
    >
      {label}
    </button>
  );


  const editingDoorCfg = editingDoor ? resolveDoorConfig(doorConfigs[editingDoor.id]) : null;

  return (
    /*
      Starts where both persistent pieces of app chrome end. Earlier the
      editor began at viewport 0, underneath the sidebar and shared header, so
      its own close control and title were hidden even though the canvas was
      visible. That left users with no discoverable route back to the detail.

      Offset rather than a higher z-index: the Reaigen shell stays stable, the
      editor owns only the remaining workspace, and its labelled back action
      is always visible. It is desktop-only (the mount is gated on
      !compactViewport), so --sidebar-offset is always set.
    */
    <div
      className="fixed bottom-0 z-50 flex flex-col overflow-hidden bg-background transition-[left,right,top] duration-200"
      style={{
        top: "var(--header-total-h, 0px)",
        left: "var(--sidebar-offset, 0px)",
        right: "var(--reai-docked-width, 0px)",
      }}
    >
      {/* top bar */}
      <div className="editor-glass-control relative z-30 flex min-h-[70px] shrink-0 items-center gap-4 border-b border-border/60 px-5 py-2.5">
        <button
          type="button"
          onClick={onClose}
          className="glossy-capsule flex min-h-11 shrink-0 items-center gap-2.5 rounded-full px-4 text-[13px] font-semibold text-foreground/72 transition-[color,transform] hover:text-foreground active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <ArrowLeftIcon size={19} strokeWidth={1.9} />
          {t("floorplan.editor.backToDetail", lang)}
        </button>

        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-semibold tracking-[-0.01em] text-foreground">
            {t("floorplan.editor.title", lang)}
          </div>
          <div className="mt-0.5 flex min-w-0 items-center gap-2 text-[11.5px] font-medium text-muted-foreground">
            <span className="truncate">{ratioText}</span>
            <span aria-hidden="true" className="h-1 w-1 shrink-0 rounded-full bg-foreground/25" />
            <span className="whitespace-nowrap">{t("floorplan.rooms", lang)}: {roomNumbers.length}</span>
          </div>
        </div>

        <span
          className={cn(
            "inline-flex min-h-9 shrink-0 items-center gap-2 rounded-full border border-border/65 bg-card/72 px-3 text-[12px] font-semibold shadow-[inset_0_1px_0_hsl(var(--card)),0_4px_14px_hsl(var(--foreground)/0.055)]",
            saveState === "error" ? "text-destructive" : "text-foreground/58"
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              saveState === "saving" && "animate-pulse bg-foreground/45",
              saveState === "error" && "bg-destructive",
              saveState === "idle" && "bg-foreground/30",
            )}
          />
          {saveState === "saving"
            ? t("floorplan.editor.saving", lang)
            : saveState === "error"
              ? t("floorplan.editor.saveError", lang)
              : t("floorplan.editor.saved", lang)}
        </span>
      </div>

      {/* canvas */}
      <div className="floorplan-editor-canvas relative min-h-0 flex-1 overflow-hidden">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${VIEW} ${VIEW}`}
          className={cn(
            "h-full w-full touch-none select-none",
            tool === "draw" || tool === "door" || tool === "window" || tool === "room"
              ? "cursor-crosshair"
              : tool === "move"
                ? "cursor-default"
                : tool === "erase"
                  ? "cursor-cell"
                  : "cursor-grab active:cursor-grabbing",
          )}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          onWheel={onWheel}
          onContextMenu={(event) => event.preventDefault()}
          xmlns="http://www.w3.org/2000/svg"
        >
          <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
            <defs>
              <mask id="editor-cuts">
                <rect x={-VIEW * 2} y={-VIEW * 2} width={VIEW * 5} height={VIEW * 5} fill="white" />
                {cutQuads.map((poly, i) => (
                  <polygon key={i} points={toPts(poly)} fill="black" />
                ))}
              </mask>
            </defs>

            {/* furniture — desktop DCC selection with rigid-body drag */}
            {layers.furniture &&
              [...furniture]
                .sort(
                  (a, b) =>
                    Number(furnitureKind(a.category) === "table") -
                    Number(furnitureKind(b.category) === "table")
                )
                .map((o, i) => {
                const c = proj(o.center[0], o.center[1]);
                const pW = proj(o.center[0] + o.axisW[0], o.center[1] + o.axisW[1]);
                const pD = proj(o.center[0] + o.axisD[0], o.center[1] + o.axisD[1]);
                const kind = furnitureKind(o.category);
                const icon = iconForKind(
                  kind,
                  o.halfW,
                  o.halfD,
                  (o as typeof o & { presentationVariant?: string }).presentationVariant,
                  (o as typeof o & { counterSeams?: number[] }).counterSeams
                );
                const iw = icon.w / 2;
                const idp = icon.d / 2;
                const aspectQuarterTurn = o.halfW >= o.halfD !== iw >= idp ? 1 : 0;
                const quarterTurns = aspectQuarterTurn + (kind === "chair" ? -1 : 0);
                const rotatedHalfW = Math.abs(quarterTurns % 2) === 1 ? idp : iw;
                const rotatedHalfD = Math.abs(quarterTurns % 2) === 1 ? iw : idp;
                const uniformScale = Math.min(
                  o.halfW / rotatedHalfW,
                  o.halfD / rotatedHalfD
                );
                const fit = `rotate(${quarterTurns * 90}) scale(${uniformScale})`;
                const selected = moveSelection?.kind === "furniture" && moveSelection.id === o.id;
                return (
                  <g key={`f${i}`}>
                    {selected && (
                      <polygon
                        points={toPts(objectCorners(o))}
                        fill="rgba(17,17,17,0.035)"
                        stroke="rgba(17,17,17,0.72)"
                        strokeWidth={moveSelection.blocked ? 2.4 : 1.6}
                        strokeDasharray={moveSelection.blocked ? "4 3" : undefined}
                        vectorEffect="non-scaling-stroke"
                      />
                    )}
                    <g
                    transform={`matrix(${pW[0] - c[0]} ${pW[1] - c[1]} ${pD[0] - c[0]} ${pD[1] - c[1]} ${c[0]} ${c[1]}) ${fit}`}
                    fill="none"
                    stroke={STROKE_COLOR}
                    strokeOpacity={1}
                    strokeWidth={1.35}
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
                        strokeWidth={5.35}
                        vectorEffect="non-scaling-stroke"
                      />
                    )}
                    {icon.shapes.map((s, j) => (
                      <EditorIconShape key={j} shape={s} />
                    ))}
                    </g>
                  </g>
                );
              })}

            {/* walls */}
            <g mask="url(#editor-cuts)">
              {wallQuads.map((poly, i) => (
                <polygon key={i} points={toPts(poly)} fill={STROKE_COLOR} />
              ))}
            </g>

            {/* Selected wall chain. Movement is constrained to its normal. */}
            {tool === "move" && [...selectedEdgeIndices].map((index) => {
              const edge = graph.edges[index];
              if (!edge) return null;
              const [x1, y1] = proj(...graph.vertices[edge.a]);
              const [x2, y2] = proj(...graph.vertices[edge.b]);
              return (
                <line
                  key={`selected-edge-${index}`}
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke="rgba(17,17,17,0.28)"
                  strokeWidth={9}
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}
            {tool === "move" && moveSelection?.kind === "edge" && (() => {
              const edge = graph.edges[moveSelection.index];
              if (!edge) return null;
              const [x, y] = proj(...mid(graph.vertices[edge.a], graph.vertices[edge.b]));
              return (
                <circle
                  cx={x}
                  cy={y}
                  r={7}
                  fill="rgba(255,255,255,0.96)"
                  stroke="rgba(17,17,17,0.72)"
                  strokeWidth={moveSelection.blocked ? 2.4 : 1.4}
                  vectorEffect="non-scaling-stroke"
                />
              );
            })()}

            {/* windows */}
            {layers.windows &&
              windows.map((w, i) => {
                const dx = w.p2[0] - w.p1[0];
                const dz = w.p2[1] - w.p1[1];
                const len = Math.max(Math.hypot(dx, dz), 1e-4);
                const nx = -dz / len;
                const nz = dx / len;
                const line = (off: number, sw: number, key: string) => {
                  const [x1, y1] = proj(w.p1[0] + nx * off, w.p1[1] + nz * off);
                  const [x2, y2] = proj(w.p2[0] + nx * off, w.p2[1] + nz * off);
                  return <line key={key} x1={x1} y1={y1} x2={x2} y2={y2} stroke={STROKE_COLOR} strokeWidth={sw} strokeLinecap="square" />;
                };
                const jamb = (p: V2, key: string) => {
                  const [x1, y1] = proj(p[0] + nx * halfT, p[1] + nz * halfT);
                  const [x2, y2] = proj(p[0] - nx * halfT, p[1] - nz * halfT);
                  return <line key={key} x1={x1} y1={y1} x2={x2} y2={y2} stroke={STROKE_COLOR} strokeWidth={1.35} strokeLinecap="square" />;
                };
                return (
                  <g key={`w${i}`}>
                    {line(-halfT, 1.35, "a")}
                    {line(halfT, 1.35, "b")}
                    {line(0, 1.35, "c")}
                    {jamb(w.p1, "j1")}
                    {jamb(w.p2, "j2")}
                  </g>
                );
              })}

            {/* doors */}
            {layers.doors &&
              doors.map((d, i) => {
                const dx = d.p2[0] - d.p1[0];
                const dz = d.p2[1] - d.p1[1];
                const len = Math.max(Math.hypot(dx, dz), 1e-4);
                const nx = -dz / len;
                const nz = dx / len;
                const cfg = resolveDoorConfig(doorConfigs[d.id]);
                const jamb = (p: V2, key: string) => {
                  const [x1, y1] = proj(p[0] + nx * halfT, p[1] + nz * halfT);
                  const [x2, y2] = proj(p[0] - nx * halfT, p[1] - nz * halfT);
                  return <line key={key} x1={x1} y1={y1} x2={x2} y2={y2} stroke={STROKE_COLOR} strokeWidth={1.35} />;
                };
                return (
                  <g key={`d${i}`}>
                    {jamb(d.p1, "j1")}
                    {jamb(d.p2, "j2")}
                    {cfg.doorType === "Moving" ? (
                      <EditorSlidingDoor door={d} proj={proj} />
                    ) : (
                      <EditorDoorSwing door={d} cfg={cfg} interior={interior} proj={proj} />
                    )}
                  </g>
                );
              })}

            {/* draw preview */}
            {drawPreview && (
              <g>
                <line
                  x1={proj(...drawPreview[0])[0]}
                  y1={proj(...drawPreview[0])[1]}
                  x2={proj(...drawPreview[1])[0]}
                  y2={proj(...drawPreview[1])[1]}
                  stroke="hsl(var(--foreground))"
                  strokeWidth={2.2}
                />
                <circle cx={proj(...drawPreview[0])[0]} cy={proj(...drawPreview[0])[1]} r={4.5} fill="hsl(var(--foreground))" />
                <circle cx={proj(...drawPreview[1])[0]} cy={proj(...drawPreview[1])[1]} r={4.5} fill="hsl(var(--foreground))" />
              </g>
            )}

            {/* erase preview */}
            {eraseStroke.length > 1 && (
              <polyline
                points={eraseStroke.map((p) => proj(p[0], p[1]).join(",")).join(" ")}
                fill="none"
                stroke="hsl(var(--foreground))"
                strokeOpacity={0.46}
                strokeWidth={6}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}

            {/* labels */}
            {layers.labels &&
              roomNumbers.map((n) => {
                const pos = labelPositions[n];
                if (!pos) return null;
                const [sx, sy] = proj(pos[0], pos[1]);
                return (
                  <g key={`rl${n}`} className="cursor-grab">
                    <circle cx={sx} cy={sy} r={(fontPx + 9) / 2} fill="rgba(255,255,255,0.92)" stroke="rgba(0,0,0,0.25)" strokeWidth={0.7} />
                    <text
                      x={sx}
                      y={sy}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fill="#4b5563"
                      fontSize={fontPx}
                      fontWeight={700}
                      fontFamily="system-ui, -apple-system, sans-serif"
                    >
                      {n}
                    </text>
                  </g>
                );
              })}
          </g>
        </svg>

        {/* door config popover */}
        {editingDoor && editingDoorCfg && (
          <DoorConfigPanel
            lang={lang}
            cfg={editingDoorCfg}
            screen={editingDoor.screen}
            onChange={(cfg) => saveDoorConfig(editingDoor.id, cfg)}
            onClose={() => setEditingDoor(null)}
          />
        )}

        {/* label rename */}
        {editingLabel && (
          <div
            className="absolute z-10 -translate-x-1/2 -translate-y-full"
            style={{ left: `${(editingLabel.screen[0] / VIEW) * 100}%`, top: `${(editingLabel.screen[1] / VIEW) * 100}%` }}
          >
            <input
              autoFocus
              value={editingLabel.value}
              onChange={(e) => setEditingLabel({ ...editingLabel, value: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") renameLabel(editingLabel.n, editingLabel.value);
                if (e.key === "Escape") setEditingLabel(null);
              }}
              onBlur={() => renameLabel(editingLabel.n, editingLabel.value)}
              className="w-40 rounded-full border border-border bg-card px-3 py-1.5 text-[13px] font-medium shadow-elevated focus:outline-none"
            />
          </div>
        )}

        {/* A single command dock, grouped like a DCC viewport but deliberately
            labelled and softened for a non-technical property workflow. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex flex-col items-center gap-2 px-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))]">
          {layersOpen && (
            <div className="editor-glass-control pointer-events-auto flex max-w-[calc(100%-1rem)] flex-wrap items-center justify-center gap-1 rounded-full border border-border/65 p-1.5 shadow-[0_10px_30px_hsl(var(--foreground)/0.09)]">
              {chip("doors", t("floorplan.doors", lang))}
              {chip("windows", t("floorplan.windows", lang))}
              {chip("labels", t("floorplan.roomLabels", lang))}
              {chip("furniture", t("floorplan.editor.furniture", lang))}
            </div>
          )}

          <div className="floorplan-command-dock pointer-events-auto flex max-w-full flex-nowrap items-center justify-start gap-1 overflow-x-auto rounded-[26px] border border-border/70 p-1.5">
            <div className="flex shrink-0 flex-nowrap items-center gap-1">
              {toolButton("move", t("floorplan.editor.move", lang), MoveToolIcon)}
              {toolButton("draw", t("floorplan.editor.draw", lang), DrawWallIcon)}
              {toolButton("erase", t("floorplan.editor.erase", lang), EraseIcon)}
            </div>

            <span aria-hidden="true" className="mx-1 h-8 w-px shrink-0 bg-border/70" />

            <div className="flex shrink-0 flex-nowrap items-center gap-1">
              {toolButton("door", t("floorplan.editor.door", lang), DoorToolIcon)}
              {toolButton("window", t("floorplan.editor.window", lang), WindowToolIcon)}
              {toolButton("room", t("floorplan.editor.room", lang), RoomToolIcon)}
            </div>

            <span aria-hidden="true" className="mx-1 h-8 w-px shrink-0 bg-border/70" />

            <div className="flex shrink-0 flex-nowrap items-center gap-1">
              <UtilButton onClick={undo} disabled={!canUndo} label={t("floorplan.editor.undo", lang)} icon={UndoIcon} />
              <UtilButton onClick={rotate} label={t("floorplan.editor.rotate", lang)} icon={RotateIcon} />
              <UtilButton onClick={() => setLayersOpen((v) => !v)} label={t("floorplan.editor.layers", lang)} active={layersOpen} icon={LayersToolIcon} />
              <UtilButton onClick={resetAll} label={t("floorplan.editor.reset", lang)} icon={ResetToolIcon} />
              <UtilButton
                onClick={() => {
                  setZoom(DEFAULT_VIEW_ZOOM);
                  setPan({ x: 0, y: 0 });
                }}
                label={t("floorplan.editor.fitView", lang)}
                icon={FrameIcon}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * A one-shot action in the toolbox: rotate, undo, layers, reset, fit.
 *
 * Labelled at comfortable widths. When the Agent narrows the drawing viewport,
 * the visible label collapses but remains the button's accessible name and
 * native tooltip. This keeps the DCC strip one row high without making the
 * commands cryptic.
 *
 * Kept visually quieter than the tools instead: lighter weight, no fill. These
 * are things that happen once, not modes you are in.
 */
function UtilButton({
  onClick,
  label,
  disabled,
  active,
  icon: Icon,
}: {
  onClick: () => void;
  label: string;
  disabled?: boolean;
  active?: boolean;
  icon: (props: IconProps) => React.ReactElement;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      aria-label={label}
      title={label}
      className={cn(
        "floorplan-util-button flex h-12 shrink-0 items-center justify-center gap-2.5 rounded-full px-3.5 text-[13px] font-medium transition-[background-color,color,transform]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        disabled
          ? "text-foreground/25"
          : active
            ? "bg-foreground/[0.09] text-foreground shadow-inner"
            : "text-foreground/58 hover:bg-foreground/[0.05] hover:text-foreground active:scale-[0.98]",
      )}
    >
      <Icon size={20} strokeWidth={1.9} className="shrink-0" />
      <span className="floorplan-util-label whitespace-nowrap">{label}</span>
    </button>
  );
}

function DoorConfigPanel({
  lang,
  cfg,
  screen,
  onChange,
  onClose,
}: {
  lang: string;
  cfg: DoorConfig;
  screen: [number, number];
  onChange: (cfg: DoorConfig) => void;
  onClose: () => void;
}) {
  const seg = (
    options: { value: string; label: string }[],
    current: string,
    apply: (value: string) => void
  ) => (
    <div className="flex rounded-full bg-black/[0.05] p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => apply(o.value)}
          className={cn(
            "rounded-full px-2.5 py-1 text-[12px] font-semibold transition-colors",
            current === o.value ? "bg-card text-foreground shadow-card" : "text-foreground/50"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
  return (
    <div
      className="absolute z-10 -translate-x-1/2 rounded-2xl border border-border/60 bg-card/95 p-3 shadow-elevated backdrop-blur-xl"
      style={{ left: `${(screen[0] / VIEW) * 100}%`, top: `calc(${(screen[1] / VIEW) * 100}% + 14px)` }}
    >
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-4">
          <span className="text-[12px] font-medium text-muted-foreground">{t("floorplan.editor.doorType", lang)}</span>
          {seg(
            [
              { value: "Swinging", label: t("floorplan.editor.swinging", lang) },
              { value: "Moving", label: t("floorplan.editor.sliding", lang) },
            ],
            cfg.doorType,
            (v) =>
              onChange(
                v === "Moving"
                  ? { doorType: "Moving", hingeSide: "Moving", swingDirection: "Moving" }
                  : { doorType: "Swinging", hingeSide: "Left", swingDirection: "In" }
              )
          )}
        </div>
        {cfg.doorType === "Swinging" && (
          <>
            <div className="flex items-center justify-between gap-4">
              <span className="text-[12px] font-medium text-muted-foreground">{t("floorplan.editor.hinge", lang)}</span>
              {seg(
                [
                  { value: "Left", label: t("floorplan.editor.left", lang) },
                  { value: "Right", label: t("floorplan.editor.right", lang) },
                ],
                cfg.hingeSide,
                (v) => onChange({ ...cfg, hingeSide: v })
              )}
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-[12px] font-medium text-muted-foreground">{t("floorplan.editor.swing", lang)}</span>
              {seg(
                [
                  { value: "In", label: t("floorplan.editor.in", lang) },
                  { value: "Out", label: t("floorplan.editor.out", lang) },
                ],
                cfg.swingDirection,
                (v) => onChange({ ...cfg, swingDirection: v })
              )}
            </div>
          </>
        )}
        <button
          type="button"
          onClick={onClose}
          className="w-full rounded-full bg-black/[0.06] py-1 text-[12px] font-semibold text-foreground/70 hover:text-foreground"
        >
          {t("floorplan.editor.done", lang)}
        </button>
      </div>
    </div>
  );
}

function EditorIconShape({ shape }: { shape: IconShape }) {
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

function arcPath(c: [number, number], p0: [number, number], p1: [number, number]): string {
  const r = Math.hypot(p0[0] - c[0], p0[1] - c[1]);
  const a0 = Math.atan2(p0[1] - c[1], p0[0] - c[0]);
  const a1 = Math.atan2(p1[1] - c[1], p1[0] - c[0]);
  let delta = a1 - a0;
  while (delta > Math.PI) delta -= 2 * Math.PI;
  while (delta <= -Math.PI) delta += 2 * Math.PI;
  return `M ${p0[0]} ${p0[1]} A ${r} ${r} 0 0 ${delta > 0 ? 1 : 0} ${p1[0]} ${p1[1]}`;
}

function EditorDoorSwing({
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
  const [p1, p2] = cfg.hingeSide === "Right" ? [door.p2, door.p1] : [door.p1, door.p2];
  const dx = p2[0] - p1[0];
  const dz = p2[1] - p1[1];
  const len = Math.max(Math.hypot(dx, dz), 1e-4);
  const nxA = -dz / len;
  const nzA = dx / len;
  const midX = (p1[0] + p2[0]) / 2;
  const midZ = (p1[1] + p2[1]) / 2;
  const dSq = (px: number, pz: number) =>
    (px - interior[0]) * (px - interior[0]) + (pz - interior[1]) * (pz - interior[1]);
  const dA = dSq(midX + nxA * 0.1, midZ + nzA * 0.1);
  const dB = dSq(midX - nxA * 0.1, midZ - nzA * 0.1);
  const toward: V2 = dA < dB ? [nxA, nzA] : [-nxA, -nzA];
  const away: V2 = dA < dB ? [-nxA, -nzA] : [nxA, nzA];
  const [nx, nz] = cfg.swingDirection === "Out" ? away : toward;
  const faceOffset = WALL_THICKNESS / 2;
  const hinge: V2 = [p1[0] + nx * faceOffset, p1[1] + nz * faceOffset];
  const closedEnd: V2 = [p2[0] + nx * faceOffset, p2[1] + nz * faceOffset];
  const panelEnd: V2 = [hinge[0] + nx * len, hinge[1] + nz * len];
  const hingeC = proj(hinge[0], hinge[1]);
  const panelEndC = proj(panelEnd[0], panelEnd[1]);
  const arcEndC = proj(closedEnd[0], closedEnd[1]);
  return (
    <g>
      <path d={arcPath(hingeC, arcEndC, panelEndC)} fill="none" stroke={STROKE_COLOR} strokeWidth={1.35} strokeLinecap="round" strokeLinejoin="round" />
      <line x1={hingeC[0]} y1={hingeC[1]} x2={panelEndC[0]} y2={panelEndC[1]} stroke={STROKE_COLOR} strokeWidth={1.35} strokeLinecap="round" />
      <circle cx={hingeC[0]} cy={hingeC[1]} r={1.08} fill={STROKE_COLOR} />
    </g>
  );
}

function EditorSlidingDoor({
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
    const [x1, y1] = proj(door.p1[0] + ux * fromT + nx * off * side, door.p1[1] + uz * fromT + nz * off * side);
    const [x2, y2] = proj(door.p1[0] + ux * toT + nx * off * side, door.p1[1] + uz * toT + nz * off * side);
    return <line key={key} x1={x1} y1={y1} x2={x2} y2={y2} stroke={STROKE_COLOR} strokeWidth={1.35} strokeLinecap="round" />;
  };
  return (
    <g>
      {panel(0, len / 2 + overlap, 1, "a")}
      {panel(len / 2 - overlap, len, -1, "b")}
    </g>
  );
}

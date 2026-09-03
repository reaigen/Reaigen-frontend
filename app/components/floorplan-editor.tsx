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
import { createPortal } from "react-dom";
import type { DraftDataEntry } from "../lib/tour-types";
import { deleteDraftDataEntry, saveDraftDataFields } from "../lib/api/client";
import { randomUUID } from "../lib/uuid";
import { ROOM_TYPE_CODES } from "../lib/room-names";
import {
  baseUnitForCategory,
  convertUnitValue,
  resolveUnit,
  unitLabel,
  unitsForCategory,
  type UnitLookup,
} from "../lib/unit-catalog";
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
  rotateFromSnappedFrame,
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
  CloseIcon,
  DoorToolIcon,
  SelectIcon,
  DrawWallIcon,
  EraseIcon,
  FrameIcon,
  MoveToolIcon,
  ResetToolIcon,
  RoomToolIcon,
  RotateIcon,
  ShowHiddenIcon,
  UndoIcon,
  WindowToolIcon,
  type IconProps,
} from "./icons";
import { solveReaigenFloorplan, USE_CONSTRAINT_SOLVER } from "../lib/floorplan-solver-adapter";
import { iconForKind, type IconShape } from "../lib/floorplan-icon-shapes";
import {
  applyFurnitureEdits,
  cloneFurnitureEdits,
  emptyFurnitureEdits,
  rotateFurniture,
  rotateFurnitureAxes,
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
/**
 * The content group is `translate(pan) scale(zoom)` — SVG scales around the
 * viewBox origin, not its centre, so any zoom ≠ 1 needs this compensating pan
 * or the whole plan drifts toward the bottom-right on open and on fit-view.
 */
const DEFAULT_VIEW_PAN = {
  x: (VIEW / 2) * (1 - DEFAULT_VIEW_ZOOM),
  y: (VIEW / 2) * (1 - DEFAULT_VIEW_ZOOM),
};

const OPENING_GAP = 0.05; // clearance kept between co-hosted openings (m)

/**
 * 1D solve for openings sharing a wall. The driven opening moves or resizes
 * toward its target; neighbours are parametric, not rigid bodies — pressed,
 * they first SHRINK from their near edge (far edge pinned) down to the
 * minimum opening, and only then transmit the push. Wall-end bounds are
 * relative: a scan-placed opening flush in a corner may stay there, it just
 * cannot get worse.
 */
function solveWallSlide(
  items: Array<{ len: number; t: number }>,
  di: number,
  desiredT: number,
  desiredLen: number,
  wallLen: number,
): { positions: number[]; lens: number[] } {
  const inset = wallLen * 0.02;
  const count = items.length;
  const lo0 = items.map((item) => item.t - item.len / 2);
  const hi0 = items.map((item) => item.t + item.len / 2);
  const wallLo = (j: number) => Math.min(inset, lo0[j]);
  const wallHi = (j: number) => Math.max(wallLen - inset, hi0[j]);

  const attempt = (tC: number, drivenLen: number) => {
    const lo = [...lo0];
    const hi = [...hi0];
    lo[di] = tC - drivenLen / 2;
    hi[di] = tC + drivenLen / 2;
    let overRight = Math.max(0, hi[di] - wallHi(di));
    let cursor = hi[di];
    for (let j = di + 1; j < count; j++) {
      const near = Math.max(lo0[j], cursor + OPENING_GAP);
      let far = hi0[j];
      let len = far - near;
      const minLen = Math.min(MIN_OPENING, hi0[j] - lo0[j]);
      if (len < minLen) {
        len = minLen;
        far = near + len;
      }
      lo[j] = near;
      hi[j] = far;
      overRight = Math.max(overRight, far - wallHi(j));
      cursor = far;
    }
    let overLeft = Math.max(0, wallLo(di) - lo[di]);
    cursor = lo[di];
    for (let j = di - 1; j >= 0; j--) {
      const far = Math.min(hi0[j], cursor - OPENING_GAP);
      let near = lo0[j];
      let len = far - near;
      const minLen = Math.min(MIN_OPENING, hi0[j] - lo0[j]);
      if (len < minLen) {
        len = minLen;
        near = far - len;
      }
      lo[j] = near;
      hi[j] = far;
      overLeft = Math.max(overLeft, wallLo(j) - near);
      cursor = near;
    }
    return { lo, hi, overRight, overLeft };
  };

  let len = Math.max(MIN_OPENING, Math.min(desiredLen, wallLen - 2 * inset));
  let tC = desiredT;
  let result = attempt(tC, len);
  for (let iteration = 0; iteration < 3 && (result.overRight > 1e-6 || result.overLeft > 1e-6); iteration++) {
    if (result.overRight > 1e-6 && result.overLeft > 1e-6) {
      len = Math.max(MIN_OPENING, len - result.overRight - result.overLeft);
      tC += (result.overLeft - result.overRight) / 2;
    } else if (result.overRight > 1e-6) {
      tC -= result.overRight;
    } else {
      tC += result.overLeft;
    }
    result = attempt(tC, len);
  }
  return {
    positions: result.lo.map((value, j) => (value + result.hi[j]) / 2),
    lens: result.lo.map((value, j) => result.hi[j] - value),
  };
}

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
  /** Backend unit catalog — lengths display in the user's measurement system. */
  units?: readonly UnitLookup[];
  /** Unit id/code selected for area display; decides metric vs imperial. */
  targetAreaUnit?: number | string | null;
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

export default function FloorplanEditor({ draftId, draftData, lang, onClose, onSaved, units, targetAreaUnit }: Props) {
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
  const [pan, setPan] = useState<{ x: number; y: number }>(() => ({ ...DEFAULT_VIEW_PAN }));
  // Synchronous view mirror. Wheel events burst faster than renders, and
  // computing the anchored-zoom pan inside a state updater is impure — React
  // double-invokes updaters in dev, which applied the pan shift twice and
  // un-anchored the zoom (the drift that sent dragged labels flying). Every
  // view change goes through applyView so this ref is never stale.
  const viewRef = useRef({ zoom: DEFAULT_VIEW_ZOOM, pan: { ...DEFAULT_VIEW_PAN } });
  const applyView = useCallback((nextZoom: number, nextPan: { x: number; y: number }) => {
    viewRef.current = { zoom: nextZoom, pan: { ...nextPan } };
    setZoom(nextZoom);
    setPan({ ...nextPan });
  }, []);
  // Framing animates as a short dolly (world centre lerped, zoom interpolated
  // geometrically) so F never teleports the canvas. Any direct input — wheel,
  // pointer down — cancels the flight and hands control straight back.
  const viewAnimRef = useRef<number | null>(null);
  const cancelViewAnimation = useCallback(() => {
    if (viewAnimRef.current !== null) {
      cancelAnimationFrame(viewAnimRef.current);
      viewAnimRef.current = null;
    }
  }, []);
  const animateViewTo = useCallback(
    (targetZoom: number, targetPan: { x: number; y: number }) => {
      cancelViewAnimation();
      if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
        applyView(targetZoom, targetPan);
        return;
      }
      const from = { zoom: viewRef.current.zoom, pan: { ...viewRef.current.pan } };
      const c0 = { x: (VIEW / 2 - from.pan.x) / from.zoom, y: (VIEW / 2 - from.pan.y) / from.zoom };
      const c1 = { x: (VIEW / 2 - targetPan.x) / targetZoom, y: (VIEW / 2 - targetPan.y) / targetZoom };
      const t0 = performance.now();
      const duration = 240;
      const step = (now: number) => {
        const t = Math.min(1, (now - t0) / duration);
        const e = 1 - Math.pow(1 - t, 3);
        const z = from.zoom * Math.pow(targetZoom / from.zoom, e);
        const cx = c0.x + (c1.x - c0.x) * e;
        const cy = c0.y + (c1.y - c0.y) * e;
        applyView(z, { x: VIEW / 2 - z * cx, y: VIEW / 2 - z * cy });
        viewAnimRef.current = t < 1 ? requestAnimationFrame(step) : null;
      };
      viewAnimRef.current = requestAnimationFrame(step);
    },
    [applyView, cancelViewAnimation]
  );
  useEffect(() => cancelViewAnimation, [cancelViewAnimation]);
  const [layers, setLayers] = useState({ doors: true, windows: true, labels: true, furniture: true });
  // Right-panel state: the inspector binds to whichever element is selected
  // (door via editingDoor, window via selectedWindowId, wall/furniture via
  // moveSelection, which now survives the end of a drag).
  const [inspectorTab, setInspectorTab] = useState<"properties" | "layers">("properties");
  const [selectedWindowId, setSelectedWindowId] = useState<string | null>(null);
  const [selectedRoomN, setSelectedRoomN] = useState<number | null>(null);
  // Plan-level wall presentation, persisted with the plan. Thickness mirrors
  // IFC's material-layer TotalThickness (one number per wall standard case);
  // style switches between poché fill and outline per ISO 7519's graded
  // simplification levels.
  const [wallThicknessMm, setWallThicknessMm] = useState(() => {
    const raw = Number(base.textData["floorplan_wall_thickness_mm"]);
    return Number.isFinite(raw) && raw >= 60 && raw <= 400 ? Math.round(raw) : Math.round(WALL_THICKNESS * 1000);
  });
  const [wallStyle, setWallStyle] = useState<"solid" | "outline">(
    base.textData["floorplan_wall_style"] === "outline" ? "outline" : "solid",
  );
  const wallT = wallThicknessMm / 1000;
  // ── display units: backend lookups decide symbol and system ──────────────
  const unitCatalog = useMemo(() => units ?? [], [units]);
  const displayAreaUnit = useMemo(
    () => resolveUnit(unitCatalog, targetAreaUnit ?? null, "AREA"),
    [unitCatalog, targetAreaUnit],
  );
  const metricLengthUnit = useMemo(() => baseUnitForCategory(unitCatalog, "DISTANCE"), [unitCatalog]);
  const imperialSystem = String(displayAreaUnit?.system ?? "").toUpperCase().includes("IMPERIAL");
  const displayLengthUnit = useMemo(() => {
    if (!imperialSystem) return metricLengthUnit ?? null;
    const candidates = unitsForCategory(unitCatalog, "DISTANCE")
      .filter((unit) => String(unit.system ?? "").toUpperCase().includes("IMPERIAL"));
    return candidates.find((unit) => /^(ft|foot|feet)$/i.test(unit.code)) ?? candidates[0] ?? metricLengthUnit ?? null;
  }, [imperialSystem, unitCatalog, metricLengthUnit]);
  const lengthToDisplay = useCallback((metres: number) => {
    if (!metricLengthUnit || !displayLengthUnit || metricLengthUnit.id === displayLengthUnit.id) return metres;
    return convertUnitValue(metres, metricLengthUnit, displayLengthUnit) ?? metres;
  }, [metricLengthUnit, displayLengthUnit]);
  const displayToMetres = useCallback((value: number) => {
    if (!metricLengthUnit || !displayLengthUnit || metricLengthUnit.id === displayLengthUnit.id) return value;
    return convertUnitValue(value, displayLengthUnit, metricLengthUnit) ?? value;
  }, [metricLengthUnit, displayLengthUnit]);
  const lengthUnitSymbol = unitLabel(displayLengthUnit) || "m";
  const formatLength = useCallback(
    (metres: number, decimals = 2) => `${lengthToDisplay(metres).toFixed(decimals)} ${lengthUnitSymbol}`,
    [lengthToDisplay, lengthUnitSymbol],
  );
  const [roomTypes, setRoomTypes] = useState<Record<number, string>>(() => {
    const out: Record<number, string> = {};
    for (const key of Object.keys(base.textData)) {
      const m = /^room_(\d+)_type$/.exec(key);
      if (m) out[Number(m[1])] = base.textData[key].trim().toLowerCase();
    }
    return out;
  });
  // The palette's "sliding door" tile arms the door tool with a Moving config
  // for placements until the tool changes.
  const [slidingDoorArmed, setSlidingDoorArmed] = useState(false);
  const [doorConfigs, setDoorConfigs] = useState<Record<string, DoorConfig>>(() => parseDoorConfigs(base.textData));
  const [labels, setLabels] = useState<Record<number, string>>(() => {
    const out: Record<number, string> = {};
    for (const n of roomNumbersInTextData(base.textData)) {
      // An explicitly empty label is a deletion tombstone, not a room.
      if (base.textData[`room_${n}_label`] === "") continue;
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
  // Session-only visibility (DCC convention: H hides the selection, Shift+H
  // shows everything). Hidden elements stay in the plan and in every save —
  // they just stop rendering, hit-testing and colliding until shown again.
  const [hiddenIds, setHiddenIds] = useState<ReadonlySet<string>>(() => new Set());
  const [saveState, setSaveState] = useState<"idle" | "saving" | "error">("idle");

  const undoStack = useRef<Snapshot[]>([]);
  const entriesRef = useRef<Map<string, DraftDataEntry>>(new Map(draftData.map((e) => [e.data_key, e])));
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const gesture = useRef<{
    kind: "pan" | "draw" | "erase" | "moveEdge" | "moveFurniture" | "moveOpening" | "label" | null;
    start: V2;
    startScreen: [number, number];
    edgeIndex?: number;
    furnitureId?: string;
    openingId?: string;
    openingKind?: "door" | "window";
    baseOpening?: [V2, V2];
    hostA?: V2;
    hostB?: V2;
    labelN?: number;
    baseGraph?: WallGraphState;
    baseEdits?: OpeningEditsState;
    baseFurniture?: ReturnType<typeof applyFurnitureEdits>;
    baseFurnitureEdits?: FloorplanFurnitureEdits;
    baseDoors?: Array<[V2, V2]>;
    baseMarkers?: Record<number, V2>;
    basePan?: { x: number; y: number };
    baseOffset?: V2;
    button?: number;
    moved?: boolean;
    undoCaptured?: boolean;
  }>({ kind: null, start: [0, 0], startScreen: [0, 0] });
  const [drawPreview, setDrawPreview] = useState<[V2, V2] | null>(null);
  const [eraseStroke, setEraseStroke] = useState<V2[]>([]);
  const [moveSelection, setMoveSelection] = useState<MoveSelection | null>(null);

  // The editor floats over the draft page, whose scrollbar would otherwise
  // keep living at the viewport edge and twitch on every wheel gesture. Lock
  // page scroll for the editor's lifetime; the canvas owns the wheel.
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  // Canvas square side in CSS px — the viewBox maps onto min(width, height),
  // so this converts world metres to on-screen px for the scale ruler.
  const canvasBoxRef = useRef<HTMLDivElement | null>(null);
  const [canvasSide, setCanvasSide] = useState(0);
  useEffect(() => {
    const node = canvasBoxRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) setCanvasSide(Math.min(rect.width, rect.height));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

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
  /**
   * Field-resilient persistence: every key saves independently, failures are
   * retained and merged into the next attempt, and the status chip's retry
   * flushes them explicitly — a failed save is a pending save, not a shrug.
   */
  const failedFieldsRef = useRef<Record<string, string>>({});
  const persist = useCallback(
    async (fields: Record<string, string>) => {
      setSaveState("saving");
      const pending: Record<string, string> = { ...failedFieldsRef.current, ...fields };
      failedFieldsRef.current = {};
      const keys = Object.keys(pending);
      if (!keys.length) {
        setSaveState("idle");
        return;
      }
      const results = await Promise.allSettled(
        keys.map((key) => saveDraftDataFields(draftId, { [key]: pending[key] }, [...entriesRef.current.values()])),
      );
      const savedEntries: DraftDataEntry[] = [];
      let anyFailed = false;
      results.forEach((result, index) => {
        if (result.status === "fulfilled") {
          for (const entry of result.value) {
            entriesRef.current.set(entry.data_key, entry);
            savedEntries.push(entry);
          }
        } else {
          anyFailed = true;
          failedFieldsRef.current[keys[index]] = pending[keys[index]];
        }
      });
      if (savedEntries.length) onSaved(savedEntries);
      setSaveState(anyFailed ? "error" : "idle");
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
        objectRotationOverrides: f.objectRotationOverrides,
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
    () => [...srcDoors, ...customDoors]
      .filter((d) => !hiddenIds.has(d.id))
      .map((d) => ({ id: d.id, p1: d.p1, p2: d.p2 })),
    [srcDoors, customDoors, hiddenIds]
  );
  const windows = useMemo(
    () => [...srcWindows, ...customWindows].filter((w) => !hiddenIds.has(w.id)),
    [srcWindows, customWindows, hiddenIds]
  );

  /**
   * Free span (distances along the wall from `a`) around `aroundT`, bounded by
   * every other opening hosted on the same wall plus 5 cm clearance — the same
   * rigid-collision discipline walls and furniture already obey, applied to
   * openings so a door can never slide over a window.
   */
  const freeWallSpan = useCallback((a: V2, b: V2, aroundT: number, excludeId: string | null): [number, number] => {
    const wallLen = Math.max(dist(a, b), 1e-4);
    const ux = (b[0] - a[0]) / wallLen;
    const uz = (b[1] - a[1]) / wallLen;
    let start = wallLen * 0.02;
    let end = wallLen - wallLen * 0.02;
    const margin = 0.05;
    for (const other of [...doors, ...windows]) {
      if (excludeId && other.id === excludeId) continue;
      const otherMid = mid(other.p1, other.p2);
      if (distancePointToSegment(otherMid, a, b) > 0.3) continue;
      const o1 = (other.p1[0] - a[0]) * ux + (other.p1[1] - a[1]) * uz;
      const o2 = (other.p2[0] - a[0]) * ux + (other.p2[1] - a[1]) * uz;
      const lo = Math.min(o1, o2) - margin;
      const hi = Math.max(o1, o2) + margin;
      if (hi <= aroundT) start = Math.max(start, hi);
      else if (lo >= aroundT) end = Math.min(end, lo);
    }
    return [start, end];
  }, [doors, windows]);
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
    ).filter((object) => !hiddenIds.has(object.id)),
    [baselineFurniture, furnitureBaselineWalls, furnitureEdits, segs, hiddenIds],
  );
  const furniture = useMemo(() => {
    const collisionById = new Map(collisionFurniture.map((object) => [object.id, object]));
    const baselineById = new Map(baselineFurniture.map((object) => [object.id, object]));
    return baselinePresentedFurniture.flatMap((object) => {
      const collisionObject = collisionById.get(object.id);
      const baselineObject = baselineById.get(object.id);
      if (!collisionObject || !baselineObject) return [];
      const moved = {
        ...object,
        center: [
          object.center[0] + collisionObject.center[0] - baselineObject.center[0],
          object.center[1] + collisionObject.center[1] - baselineObject.center[1],
        ] as V2,
      };
      const rotation = furnitureEdits.objectRotationOverrides[object.id.toLowerCase()];
      return [rotation ? rotateFurnitureAxes(moved, rotation) : moved];
    });
  }, [baselineFurniture, baselinePresentedFurniture, collisionFurniture, furnitureEdits]);

  const roomNumbers = useMemo(
    () => Object.keys(labels).map(Number).sort((a, b) => a - b),
    [labels],
  );

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
      const wallTol = wallT * 0.5 + 6 / pxPerMeter;
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
    [graph, edits, furniture, furnitureEdits, base.geom, pxPerMeter, wallT, pushUndo, commit]
  );

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

  const placeOpening = useCallback(
    (w: V2, kind: "door" | "window") => {
      const edgeIndex = nearestEdge(w, OPENING_PLACE_PX);
      if (edgeIndex == null) return;
      const e = graph.edges[edgeIndex];
      const a = graph.vertices[e.a];
      const b = graph.vertices[e.b];
      const wallLen = dist(a, b);
      if (wallLen < MIN_WALL_FOR_OPENING) return;
      const ux = (b[0] - a[0]) / wallLen;
      const uz = (b[1] - a[1]) / wallLen;
      const tRaw = (w[0] - a[0]) * ux + (w[1] - a[1]) * uz;
      const [spanStart, spanEnd] = freeWallSpan(a, b, tRaw, null);
      const len = Math.max(MIN_OPENING, Math.min(
        kind === "door" ? DEFAULT_DOOR : DEFAULT_WINDOW,
        wallLen - 0.1,
        spanEnd - spanStart,
      ));
      const centreLo = spanStart + len / 2;
      const centreHi = spanEnd - len / 2;
      if (centreLo > centreHi || spanEnd - spanStart < MIN_OPENING) return;
      const tC = Math.max(centreLo, Math.min(centreHi, tRaw));
      const p1: V2 = [a[0] + ux * (tC - len / 2), a[1] + uz * (tC - len / 2)];
      const p2: V2 = [a[0] + ux * (tC + len / 2), a[1] + uz * (tC + len / 2)];
      pushUndo();
      const id = randomUUID().toLowerCase();
      const next = cloneEdits(edits);
      next.customOpenings.push({ id, kind, p1, p2 });
      commit(cloneGraph(graph), next, cloneFurnitureEdits(furnitureEdits));
      // The palette's sliding-door tile pre-arms the Moving configuration so
      // the placed door is born sliding instead of needing a second edit.
      if (kind === "door" && slidingDoorArmed) {
        saveDoorConfig(id, { doorType: "Moving", hingeSide: "Moving", swingDirection: "Moving" });
      }
    },
    [graph, edits, furnitureEdits, nearestEdge, freeWallSpan, pushUndo, commit, saveDoorConfig, slidingDoorArmed]
  );

  const addRoom = useCallback(
    (w: V2) => {
      const n = roomNumbers.length ? Math.max(...roomNumbers) + 1 : 1;
      const name = `${t("floorplan.room", lang)} ${n}`;
      setLabels((prev) => ({ ...prev, [n]: name }));
      setMarkers((prev) => ({ ...prev, [n]: w }));
      // Markers persist in the raw scan frame; the editor works in the
      // snapped frame, so store through the inverse or the next load (and
      // the detail preview) applies the snap rotation twice.
      const stored = base.geom ? rotateFromSnappedFrame(w, base.geom) : w;
      void persist({
        [`room_${n}_label`]: name,
        [`room_${n}_marker_x`]: stored[0].toFixed(4),
        [`room_${n}_marker_z`]: stored[1].toFixed(4),
      });
      // One room per activation: hand control back to the select state with
      // the fresh room selected, ready to name and type in the inspector.
      setTool(null);
      setSelectedRoomN(n);
      setEditingDoor(null);
      setSelectedWindowId(null);
      setMoveSelection(null);
    },
    [roomNumbers, lang, persist, base.geom]
  );

  /**
   * Remove a room. Only keys that actually exist are touched (creating new
   * blank entries is what backends reject), blanked as tombstones; if the
   * backend refuses a blank write, the entry is deleted outright instead.
   */
  const deleteRoom = useCallback(async (n: number) => {
    const omit = <T,>(record: Record<number, T>): Record<number, T> => {
      const next = { ...record };
      delete next[n];
      return next;
    };
    setLabels(omit);
    setMarkers(omit);
    setLabelOffsets(omit);
    setRoomTypes(omit);
    setSelectedRoomN(null);
    const keys = [
      `room_${n}_label`,
      `room_${n}_marker_x`,
      `room_${n}_marker_z`,
      `room_${n}_label_offset_x`,
      `room_${n}_label_offset_z`,
      `room_${n}_type`,
    ].filter((key) => entriesRef.current.has(key));
    if (!keys.length) return;
    setSaveState("saving");
    const propagated: DraftDataEntry[] = [];
    let anyFailed = false;
    for (const key of keys) {
      const previous = entriesRef.current.get(key)!;
      try {
        const saved = await saveDraftDataFields(draftId, { [key]: "" }, [...entriesRef.current.values()]);
        for (const entry of saved) {
          entriesRef.current.set(entry.data_key, entry);
          propagated.push(entry);
        }
      } catch {
        try {
          await deleteDraftDataEntry(previous.id);
          entriesRef.current.delete(key);
          propagated.push({ ...previous, data_value: "" });
        } catch {
          anyFailed = true;
        }
      }
    }
    if (propagated.length) onSaved(propagated);
    setSaveState(anyFailed ? "error" : "idle");
  }, [draftId, onSaved]);

  // Switching tools starts a fresh interaction — a stale selection would leave
  // the inspector editing something the canvas no longer highlights.
  useEffect(() => {
    if (tool !== "door") setSlidingDoorArmed(false);
    // Switching to the select state (tool == null) keeps the current
    // selection — the DCC convention; arming a drawing tool clears it.
    if (tool == null) return;
    setMoveSelection(null);
    setSelectedWindowId(null);
    setEditingDoor(null);
    setSelectedRoomN(null);
  }, [tool]);

  const applyWallThickness = useCallback((mm: number) => {
    const next = Math.round(Math.max(60, Math.min(400, mm)));
    setWallThicknessMm(next);
    void persist({ floorplan_wall_thickness_mm: String(next) });
  }, [persist]);

  const applyWallStyle = useCallback((style: "solid" | "outline") => {
    setWallStyle(style);
    void persist({ floorplan_wall_style: style });
  }, [persist]);

  const applyRoomType = useCallback((n: number, code: (typeof ROOM_TYPE_CODES)[number]) => {
    const name = t(`rooms.${code}`, lang);
    setRoomTypes((prev) => ({ ...prev, [n]: code }));
    setLabels((prev) => ({ ...prev, [n]: name }));
    void persist({
      [`room_${n}_type`]: code.toUpperCase(),
      [`room_${n}_label`]: name,
    });
  }, [lang, persist]);

  /** Remove an opening: authored ones vanish, scan ones are tombstoned. */
  const deleteOpening = useCallback(
    (id: string) => {
      pushUndo();
      const e = cloneEdits(edits);
      if (e.customOpenings.some((o) => o.id === id)) {
        e.customOpenings = e.customOpenings.filter((o) => o.id !== id);
      } else if (!e.deletedSourceOpeningIDs.includes(id)) {
        e.deletedSourceOpeningIDs.push(id);
      }
      commit(cloneGraph(graph), e, cloneFurnitureEdits(furnitureEdits));
      setEditingDoor(null);
      setSelectedWindowId(null);
    },
    [graph, edits, furnitureEdits, pushUndo, commit]
  );

  /**
   * Set an opening's width, scaling around its midpoint and clamped to its
   * host wall. A scan opening becomes an authored one with the same identity
   * first — the same conversion moveWall applies before transforming one.
   */
  const resizeOpening = useCallback(
    (id: string, kind: "door" | "window", nextLen: number) => {
      const all = [
        ...doors.map((d) => ({ id: d.id, kind: "door" as const, p1: d.p1, p2: d.p2 })),
        ...windows.map((win) => ({ id: win.id, kind: "window" as const, p1: win.p1, p2: win.p2 })),
      ];
      const current = all.find((o) => o.id === id);
      if (!current) return;
      const centre = mid(current.p1, current.p2);
      const hostIndex = nearestEdge(centre, OPENING_PLACE_PX);
      if (hostIndex == null) return;
      const edge = graph.edges[hostIndex];
      const a = graph.vertices[edge.a];
      const b = graph.vertices[edge.b];
      const wallLen = Math.max(dist(a, b), 1e-4);
      const ux = (b[0] - a[0]) / wallLen;
      const uz = (b[1] - a[1]) / wallLen;
      const tOf = (p1: V2, p2: V2) => ((p1[0] + p2[0]) / 2 - a[0]) * ux + ((p1[1] + p2[1]) / 2 - a[1]) * uz;
      const items = all
        .filter((o) => distancePointToSegment(mid(o.p1, o.p2), a, b) <= 0.3)
        .map((o) => ({ id: o.id, kind: o.kind, len: Math.max(dist(o.p1, o.p2), MIN_OPENING), t: tOf(o.p1, o.p2) }))
        .sort((p, q) => p.t - q.t);
      const di = items.findIndex((item) => item.id === id);
      if (di < 0) return;
      const { positions, lens } = solveWallSlide(items, di, items[di].t, Math.max(MIN_OPENING, nextLen), wallLen);
      const anyMove = items.some((item, index) => (
        Math.abs(positions[index] - item.t) > 1e-4 || Math.abs(lens[index] - item.len) > 1e-4
      ));
      if (Math.abs(lens[di] - items[di].len) < 0.005 && !anyMove) return;
      pushUndo();
      const e = cloneEdits(edits);
      items.forEach((item, index) => {
        const itemLen = lens[index];
        if (index !== di && Math.abs(positions[index] - item.t) < 1e-4 && Math.abs(itemLen - item.len) < 1e-4) return;
        const tC = positions[index];
        const p1: V2 = [a[0] + ux * (tC - itemLen / 2), a[1] + uz * (tC - itemLen / 2)];
        const p2: V2 = [a[0] + ux * (tC + itemLen / 2), a[1] + uz * (tC + itemLen / 2)];
        const existing = e.customOpenings.findIndex((o) => o.id === item.id);
        if (existing >= 0) {
          e.customOpenings[existing] = { ...e.customOpenings[existing], p1, p2 };
        } else {
          if (!e.deletedSourceOpeningIDs.includes(item.id)) e.deletedSourceOpeningIDs.push(item.id);
          e.customOpenings.push({ id: item.id, kind: item.kind, p1, p2 });
        }
      });
      commit(cloneGraph(graph), e, cloneFurnitureEdits(furnitureEdits));
    },
    [doors, windows, graph, edits, furnitureEdits, nearestEdge, pushUndo, commit]
  );

  /**
   * Rotate a furniture object by quarter turns — through the collision solve,
   * so a rotated sofa gets pushed back inside the room instead of clipping
   * through a wall; with no free pose nearby, the rotation is refused.
   */
  const rotateFurnitureObject = useCallback((id: string, deltaDeg: number) => {
    const result = rotateFurniture(
      collisionFurniture,
      id,
      graph,
      deltaDeg,
      doors.map((door) => [door.p1, door.p2] as [V2, V2]),
    );
    if (result.blocked) {
      setMoveSelection({ kind: "furniture", id, blocked: true });
      return;
    }
    pushUndo();
    let next = cloneFurnitureEdits(furnitureEdits);
    const key = id.toLowerCase();
    const rotation = (((next.objectRotationOverrides[key] ?? 0) + deltaDeg) % 360 + 360) % 360;
    if (rotation === 0) delete next.objectRotationOverrides[key];
    else next.objectRotationOverrides[key] = rotation;
    next = recordFurnitureCenters(next, collisionFurniture, result.objects);
    commit(cloneGraph(graph), cloneEdits(edits), next);
  }, [collisionFurniture, doors, graph, edits, furnitureEdits, pushUndo, commit]);

  /** Remove the selected wall chain and every opening it hosts. */
  const deleteEdgeChain = useCallback(
    (seedIndex: number) => {
      const chain = collinearEdgeChain(graph, seedIndex);
      if (!chain.size) return;
      const g = cloneGraph(graph);
      const e = cloneEdits(edits);
      const hostedByChain = (point: V2) => [...chain].some((index) => {
        const edge = g.edges[index];
        return !!edge && distancePointToSegment(point, g.vertices[edge.a], g.vertices[edge.b]) <= 0.3;
      });
      const deleted = new Set(e.deletedSourceOpeningIDs);
      for (const source of [...(base.geom?.doors ?? []), ...(base.geom?.windows ?? [])]) {
        if (!deleted.has(source.id) && hostedByChain(mid(source.p1, source.p2))) deleted.add(source.id);
      }
      e.customOpenings = e.customOpenings.filter((opening) => !hostedByChain(mid(opening.p1, opening.p2)));
      e.deletedSourceOpeningIDs = [...deleted];
      g.edges = g.edges.filter((_, index) => !chain.has(index));
      pushUndo();
      commit(pruneOrphans(g), e, cloneFurnitureEdits(furnitureEdits));
      setMoveSelection(null);
    },
    [graph, edits, furnitureEdits, base.geom, pushUndo, commit]
  );

  /** Remove a furniture object — the erase tool's tombstone, from the panel. */
  const deleteFurnitureObject = useCallback(
    (id: string) => {
      pushUndo();
      const next = cloneFurnitureEdits(furnitureEdits);
      const key = id.toLowerCase();
      if (!next.deletedSourceObjectIDs.includes(key)) next.deletedSourceObjectIDs.push(key);
      delete next.objectCenterOverrides[key];
      commit(cloneGraph(graph), cloneEdits(edits), next);
      setMoveSelection(null);
    },
    [graph, edits, furnitureEdits, pushUndo, commit]
  );

  /**
   * The opening-drag gesture, shared by pointer-move (live preview) and
   * pointer-up (commit): slide the door/window along its host wall to the
   * pointer, clamped the same way placement clamps, converting a scan opening
   * into an authored one with the same identity on first touch.
   */
  const openingDragEdits = useCallback(
    (
      g: { openingId?: string; openingKind?: "door" | "window"; baseOpening?: [V2, V2]; hostA?: V2; hostB?: V2; baseEdits?: OpeningEditsState },
      w: V2,
    ): OpeningEditsState | null => {
      if (!g.openingId || !g.openingKind || !g.baseOpening || !g.hostA || !g.hostB || !g.baseEdits) return null;
      const a = g.hostA;
      const b = g.hostB;
      const wallLen = Math.max(dist(a, b), 1e-4);
      const ux = (b[0] - a[0]) / wallLen;
      const uz = (b[1] - a[1]) / wallLen;
      const tOf = (p1: V2, p2: V2) =>
        ((p1[0] + p2[0]) / 2 - a[0]) * ux + ((p1[1] + p2[1]) / 2 - a[1]) * uz;

      /*
       * Neighbours are rebuilt from the gesture's base state (not the live
       * render lists) so every drag frame is an idempotent solve from the same
       * starting layout. Dragging pushes them along the wall — the same
       * rigid-body rule walls apply to furniture — and the chain clamps as a
       * whole when its last member reaches the wall end.
       */
      type SlideItem = { id: string; kind: "door" | "window"; len: number; t: number };
      const items: SlideItem[] = [];
      const deletedBase = new Set(g.baseEdits.deletedSourceOpeningIDs);
      const shadowed = new Set(g.baseEdits.customOpenings.map((o) => o.id));
      const pushBase = (id: string, kind: "door" | "window", p1: V2, p2: V2) => {
        if (id === g.openingId) return;
        if (distancePointToSegment(mid(p1, p2), a, b) > 0.3) return;
        items.push({ id, kind, len: Math.max(dist(p1, p2), MIN_OPENING), t: tOf(p1, p2) });
      };
      for (const s of base.geom?.doors ?? []) {
        if (!deletedBase.has(s.id) && !shadowed.has(s.id)) pushBase(s.id, "door", s.p1, s.p2);
      }
      for (const s of base.geom?.windows ?? []) {
        if (!deletedBase.has(s.id) && !shadowed.has(s.id)) pushBase(s.id, "window", s.p1, s.p2);
      }
      for (const o of g.baseEdits.customOpenings) pushBase(o.id, o.kind, o.p1, o.p2);

      const dragged: SlideItem = {
        id: g.openingId,
        kind: g.openingKind,
        len: Math.max(dist(g.baseOpening[0], g.baseOpening[1]), MIN_OPENING),
        t: tOf(g.baseOpening[0], g.baseOpening[1]),
      };
      items.push(dragged);
      items.sort((p, q) => p.t - q.t);
      const di = items.indexOf(dragged);
      const tRaw = (w[0] - a[0]) * ux + (w[1] - a[1]) * uz;
      const { positions, lens } = solveWallSlide(items, di, tRaw, dragged.len, wallLen);

      const nextEdits = cloneEdits(g.baseEdits);
      let changed = false;
      items.forEach((item, index) => {
        const tC = positions[index];
        const itemLen = lens[index];
        if (Math.abs(tC - item.t) < 1e-4 && Math.abs(itemLen - item.len) < 1e-4 && item.id !== g.openingId) return;
        const p1: V2 = [a[0] + ux * (tC - itemLen / 2), a[1] + uz * (tC - itemLen / 2)];
        const p2: V2 = [a[0] + ux * (tC + itemLen / 2), a[1] + uz * (tC + itemLen / 2)];
        const existing = nextEdits.customOpenings.findIndex((o) => o.id === item.id);
        if (existing >= 0) {
          nextEdits.customOpenings[existing] = { ...nextEdits.customOpenings[existing], p1, p2 };
        } else {
          if (!nextEdits.deletedSourceOpeningIDs.includes(item.id)) nextEdits.deletedSourceOpeningIDs.push(item.id);
          nextEdits.customOpenings.push({ id: item.id, kind: item.kind, p1, p2 });
        }
        changed = true;
      });
      return changed ? nextEdits : null;
    },
    [base.geom]
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

  /**
   * A moving wall pushes room label markers ahead of it — same rigid rule as
   * furniture — so a shrinking room never leaves its badge inside the wall.
   */
  const pushedMarkers = useCallback((
    baseMarkers: Record<number, V2>,
    baseGraph: WallGraphState,
    edgeIndex: number,
    wallDelta: V2,
  ): Record<number, V2> => {
    const distanceMoved = Math.hypot(wallDelta[0], wallDelta[1]);
    if (distanceMoved <= 1e-6) return baseMarkers;
    const dir: V2 = [wallDelta[0] / distanceMoved, wallDelta[1] / distanceMoved];
    const chain = collinearEdgeChain(baseGraph, edgeIndex);
    const clearance = wallT / 2 + 0.35;
    const next: Record<number, V2> = { ...baseMarkers };
    for (const [key, marker] of Object.entries(baseMarkers)) {
      let along = Number.POSITIVE_INFINITY;
      for (const index of chain) {
        const edge = baseGraph.edges[index];
        if (!edge) continue;
        const nearest = projectPointToSegment(marker, baseGraph.vertices[edge.a], baseGraph.vertices[edge.b]);
        const rel: V2 = [marker[0] - nearest[0], marker[1] - nearest[1]];
        along = Math.min(along, rel[0] * dir[0] + rel[1] * dir[1]);
      }
      if (!Number.isFinite(along)) continue;
      if (along > -clearance && along < distanceMoved + clearance) {
        const push = distanceMoved + clearance - along;
        next[Number(key)] = [marker[0] + dir[0] * push, marker[1] + dir[1] * push];
      }
    }
    return next;
  }, [wallT]);

  // ── pointer handlers ──────────────────────────────────────────────────────
  const onPointerDown = useCallback(
    (ev: React.PointerEvent<SVGSVGElement>) => {
      cancelViewAnimation();
      const g = gesture.current;
      // A second button pressed mid-gesture (click during a middle-mouse pan)
      // must not restart or rebase the gesture in flight — the stale rebase is
      // what made the canvas jump.
      if (g.kind) return;
      (ev.target as Element).setPointerCapture?.(ev.pointerId);
      const w = screenToWorld(ev.clientX, ev.clientY);
      const sp = screenPx(ev.clientX, ev.clientY);
      g.button = ev.button;
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
      /** Capture the state a move gesture transforms against. */
      const beginBases = () => {
        g.baseGraph = cloneGraph(graph);
        g.baseEdits = cloneEdits(edits);
        g.baseFurniture = collisionFurniture.map((object) => ({ ...object, center: [...object.center] as V2 }));
        g.baseFurnitureEdits = cloneFurnitureEdits(furnitureEdits);
        g.baseDoors = doors.map((door) => [[...door.p1] as V2, [...door.p2] as V2]);
        g.baseMarkers = Object.fromEntries(
          Object.entries(markers).map(([key, marker]) => [key, [...marker] as V2]),
        );
      };

      /** Furniture/wall hit. The select state only selects; the move tool
          also arms the drag — an accidental drag can no longer shift a wall. */
      const beginMoveInteraction = (selectOnly: boolean): boolean => {
        const furnitureHit = furniture
          .map((object) => ({ object, depth: pointInsideFurnitureDepth(w, object) }))
          .filter((hit) => hit.depth >= 0)
          .sort((a, b) =>
            Number(Boolean(b.object.parentId)) - Number(Boolean(a.object.parentId))
            || b.depth - a.depth
            || a.object.id.localeCompare(b.object.id)
          )[0];
        const edgeAtPointer = nearestEdge(w, EDGE_PICK_PX);
        const armFurniture = () => {
          g.kind = selectOnly ? null : "moveFurniture";
          g.furnitureId = furnitureHit!.object.id;
          setMoveSelection({ kind: "furniture", id: furnitureHit!.object.id, blocked: false });
          setEditingDoor(null);
          setSelectedWindowId(null);
          setSelectedRoomN(null);
          if (!selectOnly) beginBases();
        };
        if (furnitureHit && (furnitureHit.depth >= 0.025 || edgeAtPointer == null)) {
          armFurniture();
          return true;
        }
        if (edgeAtPointer != null) {
          g.kind = selectOnly ? null : "moveEdge";
          g.edgeIndex = edgeAtPointer;
          setMoveSelection({ kind: "edge", index: edgeAtPointer, blocked: false });
          setEditingDoor(null);
          setSelectedWindowId(null);
          setSelectedRoomN(null);
          if (!selectOnly) beginBases();
          return true;
        }
        if (furnitureHit) {
          armFurniture();
          return true;
        }
        return false;
      };

      /** Door/window hit → select; the move tool also arms the slide. */
      const beginOpeningInteraction = (selectOnly: boolean): boolean => {
        const openingTol = 22 / pxPerMeter;
        const arm = (opening: { id: string; p1: V2; p2: V2 }, kind: "door" | "window"): boolean => {
          const centre = mid(opening.p1, opening.p2);
          if (dist(centre, w) > openingTol) return false;
          if (kind === "door") {
            const [sx, sy] = proj(...centre);
            setEditingDoor({ id: opening.id, screen: [sx * zoom + pan.x, sy * zoom + pan.y] });
            setSelectedWindowId(null);
          } else {
            setSelectedWindowId(opening.id);
            setEditingDoor(null);
          }
          setSelectedRoomN(null);
          setMoveSelection(null);
          const hostIndex = selectOnly ? null : nearestEdge(centre, OPENING_PLACE_PX);
          if (hostIndex == null) {
            g.kind = null;
            return true;
          }
          const hostEdge = graph.edges[hostIndex];
          g.kind = "moveOpening";
          g.openingId = opening.id;
          g.openingKind = kind;
          g.baseOpening = [[...opening.p1] as V2, [...opening.p2] as V2];
          g.hostA = [...graph.vertices[hostEdge.a]] as V2;
          g.hostB = [...graph.vertices[hostEdge.b]] as V2;
          g.baseEdits = cloneEdits(edits);
          return true;
        };
        for (const d of doors) if (arm(d, "door")) return true;
        for (const win of windows) if (arm({ id: win.id, p1: win.p1, p2: win.p2 }, "window")) return true;
        return false;
      };

      if (!tool) {
        // The neutral state is a full select mode: labels, doors, windows,
        // furniture, and walls all answer a plain click — tapping selects for
        // the inspector, dragging repositions. Only empty canvas pans.
        const labelTol = 16 / pxPerMeter;
        for (const n of roomNumbers) {
          const pos = labelPositions[n];
          if (pos && dist(pos, w) <= labelTol) {
            setSelectedRoomN(n);
            setEditingDoor(null);
            setSelectedWindowId(null);
            setMoveSelection(null);
            g.kind = null;
            return;
          }
        }
        if (beginOpeningInteraction(true)) return;
        if (beginMoveInteraction(true)) return;
        setEditingDoor(null);
        setSelectedWindowId(null);
        setMoveSelection(null);
        setSelectedRoomN(null);
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
          const labelTol = 16 / pxPerMeter;
          for (const n of roomNumbers) {
            const pos = labelPositions[n];
            if (pos && dist(pos, w) <= labelTol) {
              g.kind = "label";
              g.labelN = n;
              g.baseOffset = labelOffsets[n] ?? [0, 0];
              setSelectedRoomN(n);
              return;
            }
          }
          if (beginOpeningInteraction(false)) return;
          if (beginMoveInteraction(false)) return;
          setMoveSelection(null);
          setEditingDoor(null);
          setSelectedWindowId(null);
          setSelectedRoomN(null);
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
    [tool, screenToWorld, screenPx, pan, zoom, proj, doors, windows, roomNumbers, labelPositions, labelOffsets,
     nearestEdge, graph, edits, collisionFurniture, furniture, furnitureEdits, markers, pxPerMeter, snapDrawStart,
     cancelViewAnimation]
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
        && (g.kind === "moveEdge" || g.kind === "moveFurniture" || g.kind === "moveOpening")
      ) {
        pushUndo();
        g.undoCaptured = true;
      }
      switch (g.kind) {
        case "pan": {
          applyView(viewRef.current.zoom, {
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
          setMarkers(pushedMarkers(g.baseMarkers ?? {}, g.baseGraph!, g.edgeIndex!, movement.wallDelta));
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
        case "moveOpening": {
          if (!g.moved) return;
          const next = openingDragEdits(g, w);
          if (next) setEdits(next);
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
    [screenToWorld, screenPx, snapDrawEnd, reprojectOpenings, pushUndo, openingDragEdits, pushedMarkers, applyView]
  );

  const onPointerUp = useCallback(
    (ev: React.PointerEvent<SVGSVGElement>) => {
      const g = gesture.current;
      // Only the button that started the gesture may end it; releasing the
      // other one mid-hold must neither cut the gesture short nor fire a
      // one-shot tool action at a phantom position.
      if (g.button !== undefined && ev.button !== g.button) return;
      g.button = undefined;
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
            // A tap is a selection — the inspector edits it in place.
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
          setMoveSelection({ kind: "edge", index: g.edgeIndex!, blocked: false });
          const nextMarkers = pushedMarkers(g.baseMarkers ?? {}, g.baseGraph!, g.edgeIndex!, movement.wallDelta);
          setMarkers(nextMarkers);
          const changedMarkers: Record<string, string> = {};
          for (const [key, marker] of Object.entries(nextMarkers)) {
            const before = g.baseMarkers?.[Number(key)];
            if (!before || Math.hypot(marker[0] - before[0], marker[1] - before[1]) > 0.002) {
              const stored = base.geom ? rotateFromSnappedFrame(marker, base.geom) : marker;
              changedMarkers[`room_${key}_marker_x`] = stored[0].toFixed(4);
              changedMarkers[`room_${key}_marker_z`] = stored[1].toFixed(4);
            }
          }
          if (Object.keys(changedMarkers).length) void persist(changedMarkers);
          commit(nextGraph, nextEdits, nextFurnitureEdits);
          return;
        }
        case "moveFurniture": {
          if (!g.moved) {
            // A tap is a selection — the inspector edits it in place.
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
          setMoveSelection({ kind: "furniture", id: g.furnitureId!, blocked: false });
          commit(cloneGraph(g.baseGraph!), cloneEdits(g.baseEdits!), nextFurnitureEdits);
          return;
        }
        case "moveOpening": {
          // A tap is a selection; a drag commits the slid position.
          if (!g.moved) return;
          const next = openingDragEdits(g, w);
          if (next) commit(cloneGraph(graph), next, cloneFurnitureEdits(furnitureEdits));
          return;
        }
        case "label": {
          const n = g.labelN!;
          if (!g.moved) {
            // Tap → the room's name and type edit in the inspector.
            setSelectedRoomN(n);
            setEditingDoor(null);
            setSelectedWindowId(null);
            setMoveSelection(null);
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
     reprojectOpenings, labelOffsets, persist, tool,
     placeOpening, addRoom, openingDragEdits, graph, furnitureEdits, pushedMarkers, base.geom]
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
    current.button = undefined;
    setMoveSelection(null);
    setDrawPreview(null);
    setEraseStroke([]);
  }, []);

  const onWheel = useCallback(
    (ev: React.WheelEvent<SVGSVGElement>) => {
      cancelViewAnimation();
      const factor = Math.exp(-ev.deltaY * 0.0015);
      const sp = screenPx(ev.clientX, ev.clientY);
      const { zoom: z, pan: p } = viewRef.current;
      const next = Math.max(0.5, Math.min(5, z * factor));
      const nextPan = {
        x: sp[0] - ((sp[0] - p.x) / z) * next,
        y: sp[1] - ((sp[1] - p.y) / z) * next,
      };
      const g = gesture.current;
      if (g.kind === "pan") {
        // Zooming while middle-mouse panning: rebase the live pan gesture on
        // the post-zoom view, otherwise the very next pointermove restores
        // the pre-zoom pan and the canvas jumps back.
        g.basePan = { ...nextPan };
        g.startScreen = sp;
      }
      applyView(next, nextPan);
    },
    [screenPx, applyView, cancelViewAnimation]
  );

  // ── toolbar actions ───────────────────────────────────────────────────────
  /**
   * DCC framing: F frames the selection (falling back to the whole plan),
   * the toolbar's fit button always frames the whole plan.
   */
  const frameView = useCallback(
    (scope: "auto" | "all") => {
      const pts: V2[] = [];
      if (scope === "auto") {
        if (moveSelection?.kind === "furniture") {
          const object = furniture.find((o) => o.id === moveSelection.id);
          if (object) pts.push(...objectCorners(object));
        } else if (moveSelection?.kind === "edge") {
          const edge = graph.edges[moveSelection.index];
          if (edge) pts.push(graph.vertices[edge.a], graph.vertices[edge.b]);
        } else if (selectedWindowId) {
          const win = windows.find((w) => w.id === selectedWindowId);
          if (win) pts.push(win.p1, win.p2);
        } else if (editingDoor) {
          const door = doors.find((d) => d.id === editingDoor.id);
          if (door) pts.push(door.p1, door.p2);
        } else if (selectedRoomN != null && labelPositions[selectedRoomN]) {
          const [lx, lz] = labelPositions[selectedRoomN];
          pts.push([lx - 1.2, lz - 1.2], [lx + 1.2, lz + 1.2]);
        }
      }
      const framingAll = pts.length === 0;
      if (framingAll) {
        pts.push(...graph.vertices);
        for (const object of furniture) pts.push(...objectCorners(object));
      }
      if (!pts.length) {
        animateViewTo(DEFAULT_VIEW_ZOOM, DEFAULT_VIEW_PAN);
        return;
      }
      const screen = pts.map(([x, z]) => proj(x, z));
      const minX = Math.min(...screen.map(([x]) => x));
      const maxX = Math.max(...screen.map(([x]) => x));
      const minY = Math.min(...screen.map(([, y]) => y));
      const maxY = Math.max(...screen.map(([, y]) => y));
      const span = Math.max(maxX - minX, maxY - minY, 24);
      const avail = VIEW * (framingAll ? 0.82 : 0.62);
      const nextZoom = Math.max(0.5, Math.min(5, avail / span));
      animateViewTo(nextZoom, {
        x: VIEW / 2 - nextZoom * ((minX + maxX) / 2),
        y: VIEW / 2 - nextZoom * ((minY + maxY) / 2),
      });
    },
    [moveSelection, selectedWindowId, editingDoor, selectedRoomN, labelPositions,
     graph, furniture, windows, doors, proj, animateViewTo]
  );

  /** H hides the selected door, window or piece of furniture (session-only). */
  const hideSelection = useCallback(() => {
    const id = moveSelection?.kind === "furniture"
      ? moveSelection.id
      : selectedWindowId ?? editingDoor?.id ?? null;
    if (!id) return;
    setHiddenIds((prev) => new Set(prev).add(id));
    setMoveSelection(null);
    setSelectedWindowId(null);
    setEditingDoor(null);
  }, [moveSelection, selectedWindowId, editingDoor]);

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
      emptyFurnitureEdits(),
    );
  }, [base.baselineGraph, pushUndo, commit]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTyping = target?.isContentEditable || target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.tagName === "SELECT";
      // While typing in an inspector field, every key belongs to the field —
      // a global Escape used to tear the section down mid-edit and lose the
      // value before it could commit.
      if (isTyping) return;

      if (event.key === "Escape") {
        setMoveSelection(null);
        setEditingDoor(null);
        setSelectedWindowId(null);
        setSelectedRoomN(null);
        setTool(null);
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        undo();
        return;
      }

      if (event.metaKey || event.ctrlKey || event.altKey) return;

      // Delete/Backspace removes whatever is selected — the same actions the
      // inspector's remove buttons run, so undo and persistence behave alike.
      if (event.key === "Delete" || event.key === "Backspace") {
        if (editingDoor) deleteOpening(editingDoor.id);
        else if (selectedWindowId) deleteOpening(selectedWindowId);
        else if (moveSelection?.kind === "furniture") deleteFurnitureObject(moveSelection.id);
        else if (selectedRoomN != null) void deleteRoom(selectedRoomN);
        else return;
        event.preventDefault();
        return;
      }

      // DCC conventions: F frames selection (or all), H hides the selection,
      // Shift+H shows everything hidden again.
      if (event.key.toLowerCase() === "f") {
        event.preventDefault();
        frameView("auto");
        return;
      }
      if (event.key.toLowerCase() === "h") {
        event.preventDefault();
        if (event.shiftKey) setHiddenIds(new Set());
        else hideSelection();
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
  }, [undo, frameView, hideSelection, editingDoor, selectedWindowId, moveSelection,
      selectedRoomN, deleteOpening, deleteFurnitureObject, deleteRoom]);

  const renameLabel = useCallback(
    (n: number, value: string) => {
      const name = value.trim();
      if (!name || name === labels[n]) return;
      setLabels((prev) => ({ ...prev, [n]: name }));
      void persist({ [`room_${n}_label`]: name });
    },
    [labels, persist]
  );

  // ── render ────────────────────────────────────────────────────────────────
  // Pan/zoom re-renders every frame; wall and cut geometry only changes when
  // the plan itself does, so it must not be rebuilt per navigation frame.
  const wallQuads = useMemo(() => segs.map(([a, b]) => wallQuad(a, b, wallT)), [segs, wallT]);
  const cutQuads = useMemo(
    () => [...doors, ...windows.map((w) => ({ id: "", p1: w.p1, p2: w.p2 })), ...openings].map((o) =>
      openingCut(o.p1, o.p2, wallT)
    ),
    [doors, windows, openings, wallT]
  );
  const toPts = useCallback(
    (poly: V2[]) => poly.map((p) => proj(p[0], p[1]).join(",")).join(" "),
    [proj]
  );
  const halfT = wallT / 2;
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
  const ratioText = mapBounds ? `${formatLength(mapW)} × ${formatLength(mapZ)}` : "n/a";

  // ── inspector bindings ────────────────────────────────────────────────────
  const selectedDoor = editingDoor ? doors.find((d) => d.id === editingDoor.id) ?? null : null;
  const selectedWindow = selectedWindowId ? windows.find((w) => w.id === selectedWindowId) ?? null : null;
  const selectedEdge = moveSelection?.kind === "edge" ? graph.edges[moveSelection.index] ?? null : null;
  const selectedObject = moveSelection?.kind === "furniture"
    ? furniture.find((object) => object.id === moveSelection.id) ?? null
    : null;
  const selectedRoom = selectedRoomN != null && labels[selectedRoomN] !== undefined ? selectedRoomN : selectedRoomN != null && roomNumbers.includes(selectedRoomN) ? selectedRoomN : null;
  const clearSelection = () => {
    setEditingDoor(null);
    setSelectedWindowId(null);
    setMoveSelection(null);
    setSelectedRoomN(null);
  };

  /**
   * Exact-value length field — type a number, Enter/blur commits. Metric users
   * type millimetres; imperial users type the backend's imperial length unit.
   * Internally everything stays metres/mm.
   */
  const mmInput = (currentMm: number, min: number, max: number, commitMm: (mm: number) => void) => {
    const shownValue = imperialSystem
      ? Number(lengthToDisplay(currentMm / 1000).toFixed(2))
      : currentMm;
    return (
      <span className="flex items-center gap-1.5">
        <input
          key={shownValue}
          type="number"
          inputMode={imperialSystem ? "decimal" : "numeric"}
          step={imperialSystem ? 0.01 : 1}
          defaultValue={shownValue}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            }
          }}
          onBlur={(event) => {
            const raw = Number(event.currentTarget.value);
            if (!Number.isFinite(raw)) return;
            const mm = Math.round(imperialSystem ? displayToMetres(raw) * 1000 : raw);
            if (mm >= min && mm <= max && Math.abs(mm - currentMm) > 1) commitMm(mm);
          }}
          className="w-[4.75rem] rounded-lg border border-border bg-white px-2 py-1 text-right text-[12px] font-semibold tabular-nums text-foreground outline-none transition-colors hover:border-foreground/35 focus:border-foreground [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
        <span className="text-[11px] font-medium text-muted-foreground">{imperialSystem ? lengthUnitSymbol : "mm"}</span>
      </span>
    );
  };

  const inspectorHeading = (text: string) => (
    <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-foreground/55">{text}</p>
  );
  /** Names the selected element and offers one obvious way out of it. */
  const selectionHeader = (text: string) => (
    <div className="flex items-center justify-between gap-2">
      {inspectorHeading(text)}
      <button
        type="button"
        onClick={clearSelection}
        aria-label={t("common.close", lang)}
        className="flex h-7 w-7 items-center justify-center rounded-full text-foreground/45 transition-colors hover:bg-foreground/[0.06] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <CloseIcon size={13} />
      </button>
    </div>
  );
  const inspectorRow = (label: string, control: React.ReactNode) => (
    <div className="flex min-h-9 items-center justify-between gap-3">
      <span className="text-[12px] font-medium text-muted-foreground">{label}</span>
      {control}
    </div>
  );
  /*
   * IFC 4.3 (IfcDoorTypeOperationEnum) warns that "left/right door" wording
   * differs between countries and recommends showing the swing pictorially —
   * so hinge and direction toggles pair a miniature swing symbol with the word.
   */
  const swingGlyph = (mirrorX: boolean, flipY: boolean) => (
    <svg viewBox="0 0 20 20" className="h-4 w-4 shrink-0" fill="none" aria-hidden="true">
      <g transform={[mirrorX ? "translate(20 0) scale(-1 1)" : "", flipY ? "translate(0 20) scale(1 -1)" : ""].join(" ").trim() || undefined}>
        <path d="M2 17h16" stroke="currentColor" strokeWidth={2.4} />
        <path d="M5 17V7" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
        <path d="M5 7a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth={1.1} />
      </g>
    </svg>
  );

  const segControl = <Value extends string>(
    options: Array<{ value: Value; label: string; glyph?: React.ReactNode }>,
    current: string,
    apply: (value: Value) => void,
  ) => (
    <div className="flex shrink-0 items-center gap-0.5 rounded-full bg-black/[0.05] p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => apply(option.value)}
          aria-pressed={current === option.value}
          className={cn(
            "flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-semibold transition-colors",
            current === option.value ? "bg-card text-foreground shadow-card" : "text-foreground/50 hover:text-foreground",
          )}
        >
          {option.glyph}
          {option.label}
        </button>
      ))}
    </div>
  );
  const widthControl = (currentMm: number, options: number[], apply: (metres: number) => void) => (
    <div className="space-y-1.5">
      {inspectorRow(t("floorplan.editor.width", lang), mmInput(currentMm, 300, 3000, (mm) => apply(mm / 1000)))}
      <div className="flex flex-wrap gap-1">
        {options.map((mm) => (
          <button
            key={mm}
            type="button"
            onClick={() => apply(mm / 1000)}
            aria-pressed={Math.abs(mm - currentMm) <= 25}
            className={cn(
              "rounded-full border px-2.5 py-1 text-[11px] font-semibold tabular-nums transition-colors",
              Math.abs(mm - currentMm) <= 25
                ? "border-foreground bg-foreground text-background"
                : "border-border/70 bg-card text-foreground/60 hover:border-foreground/30 hover:text-foreground",
            )}
          >
            {imperialSystem ? lengthToDisplay(mm / 1000).toFixed(1) : mm}
          </button>
        ))}
      </div>
    </div>
  );
  const removeButton = (onRemove: () => void) => (
    <button
      type="button"
      onClick={onRemove}
      className="w-full rounded-full border border-destructive/20 bg-destructive/[0.045] py-2 text-[12px] font-semibold text-destructive transition-colors hover:bg-destructive/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/30"
    >
      {t("floorplan.editor.delete", lang)}
    </button>
  );

  /*
   * Palette tiles carry the same 2D symbols the plan itself draws — a swing
   * arc, a triple-lined window, a dashed room — so a non-technical user
   * recognises the element, not an abstract tool glyph.
   */
  const paletteGlyphs: Record<string, React.ReactNode> = {
    wall: <path d="M9 40V11h30" stroke="currentColor" strokeWidth={6} fill="none" />,
    door: (
      <>
        <path d="M4 39h9M35 39h9" stroke="currentColor" strokeWidth={4.5} />
        <path d="M13 39V17" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" />
        <path d="M13 17a22 22 0 0 1 22 22" stroke="currentColor" strokeWidth={1.5} fill="none" />
      </>
    ),
    sliding: (
      <>
        <path d="M4 24h7M37 24h7" stroke="currentColor" strokeWidth={4.5} />
        <path d="M11 20.5h17M20 27.5h17" stroke="currentColor" strokeWidth={3} strokeLinecap="square" />
      </>
    ),
    window: (
      <>
        <path d="M4 24h7M37 24h7" stroke="currentColor" strokeWidth={4.5} />
        <path d="M11 17.5v13M37 17.5v13" stroke="currentColor" strokeWidth={2} />
        <path d="M11 19h26M11 29h26" stroke="currentColor" strokeWidth={2} />
        <path d="M11 24h26" stroke="currentColor" strokeWidth={1.3} />
      </>
    ),
    room: (
      <>
        <rect x={8} y={10} width={32} height={27} rx={2} stroke="currentColor" strokeWidth={2} strokeDasharray="5 4" fill="none" />
        <circle cx={24} cy={23.5} r={4.5} stroke="currentColor" strokeWidth={1.6} fill="none" />
        <circle cx={24} cy={23.5} r={1.4} fill="currentColor" />
      </>
    ),
  };

  /* One quiet bordered square per element — glyph directly on the tile, no
     nested boxes, uniform height so partial rows still read as a tidy grid. */
  const paletteTile = (key: keyof typeof paletteGlyphs, label: string, active: boolean, onClick: () => void) => (
    <button
      key={key}
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex min-h-[4.75rem] flex-col items-center justify-start gap-0.5 rounded-xl border px-1 pt-2 text-center transition-[background-color,border-color,color] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "border-foreground bg-surface-subtle text-foreground"
          : "border-border/60 bg-card text-foreground/75 hover:border-foreground/35 hover:text-foreground",
      )}
    >
      <svg viewBox="0 0 48 48" className="h-9 w-9 shrink-0" fill="none" aria-hidden="true">
        {paletteGlyphs[key]}
      </svg>
      <span className="text-[10px] font-semibold leading-[1.25]">{label}</span>
    </button>
  );

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

  // Desktop-only (the mount is gated on !compactViewport), so
  // --sidebar-offset is always set.
  // The plan itself is view-independent: pan/zoom only move the outer
  // group's transform. Memoising the subtree turns every navigation frame
  // into a single attribute update instead of a full SVG re-render.
  const planContent = useMemo(() => (
    <>
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

          {/* walls — poché fill or outline, per the plan's persisted style */}
          <g mask="url(#editor-cuts)">
            {wallQuads.map((poly, i) => (
              <polygon
                key={i}
                points={toPts(poly)}
                fill={wallStyle === "outline" ? "#ffffff" : STROKE_COLOR}
                stroke={STROKE_COLOR}
                strokeWidth={wallStyle === "outline" ? 1.5 : 0}
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </g>

          {/* Overall dimension strings — simplified consumer dimensioning:
              one string per axis, extension ticks, value in metres. */}
          {mapBounds && (() => {
            const off = 0.55;
            const tick = 0.12;
            const spanW = mapBounds.maxX - mapBounds.minX;
            const spanH = mapBounds.maxZ - mapBounds.minZ;
            if (spanW < 0.5 || spanH < 0.5) return null;
            const south = mapBounds.maxZ + off;
            const west = mapBounds.minX - off;
            const seg = (p: V2, q: V2, key: string) => {
              const [x1, y1] = proj(...p);
              const [x2, y2] = proj(...q);
              return <line key={key} x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgba(17,17,17,0.45)" strokeWidth={1} vectorEffect="non-scaling-stroke" />;
            };
            const [sx, sy] = proj((mapBounds.minX + mapBounds.maxX) / 2, south + 0.3);
            const [wx, wy] = proj(west - 0.3, (mapBounds.minZ + mapBounds.maxZ) / 2);
            return (
              <g aria-hidden="true">
                {seg([mapBounds.minX, south], [mapBounds.maxX, south], "dim-s")}
                {seg([mapBounds.minX, south - tick], [mapBounds.minX, south + tick], "dim-s1")}
                {seg([mapBounds.maxX, south - tick], [mapBounds.maxX, south + tick], "dim-s2")}
                <text x={sx} y={sy} textAnchor="middle" dominantBaseline="middle" fontSize={fontPx * 0.85} fill="rgba(17,17,17,0.66)" stroke="#fff" strokeWidth={3} paintOrder="stroke" style={{ fontVariantNumeric: "tabular-nums" }}>
                  {formatLength(spanW)}
                </text>
                {seg([west, mapBounds.minZ], [west, mapBounds.maxZ], "dim-w")}
                {seg([west - tick, mapBounds.minZ], [west + tick, mapBounds.minZ], "dim-w1")}
                {seg([west - tick, mapBounds.maxZ], [west + tick, mapBounds.maxZ], "dim-w2")}
                <text x={wx} y={wy} textAnchor="middle" dominantBaseline="middle" fontSize={fontPx * 0.85} fill="rgba(17,17,17,0.66)" stroke="#fff" strokeWidth={3} paintOrder="stroke" transform={`rotate(-90 ${wx} ${wy})`} style={{ fontVariantNumeric: "tabular-nums" }}>
                  {formatLength(spanH)}
                </text>
              </g>
            );
          })()}

          {/* Selected wall chain. Movement is constrained to its normal. */}
          {[...selectedEdgeIndices].map((index) => {
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
          {moveSelection?.kind === "edge" && (() => {
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

          {/* selection marks: ring on the selected opening, dashed outline
              around the selected object — visible in every mode so the
              inspector's subject is never ambiguous. */}
          {(selectedDoor || selectedWindow) && (() => {
            const opening = selectedDoor ?? selectedWindow!;
            const centre = mid(opening.p1, opening.p2);
            const [cx, cy] = proj(...centre);
            const marks: React.ReactNode[] = [
              <circle
                key="ring"
                cx={cx}
                cy={cy}
                r={12}
                fill="none"
                stroke="rgba(17,17,17,0.45)"
                strokeWidth={1.6}
                vectorEffect="non-scaling-stroke"
              />,
            ];
            for (const [handleIndex, point] of [opening.p1, opening.p2].entries()) {
              const [hx, hy] = proj(...point);
              marks.push(
                <rect key={`handle-${handleIndex}`} x={hx - 3} y={hy - 3} width={6} height={6} fill="#fff" stroke="rgba(17,17,17,0.85)" strokeWidth={1.2} vectorEffect="non-scaling-stroke" />,
              );
            }
            // Distance from each end of the opening to its wall's ends —
            // the numbers an agent needs to centre a door — live-updating
            // while the opening slides.
            const hostIndex = nearestEdge(centre, OPENING_PLACE_PX);
            const hostEdge = hostIndex != null ? graph.edges[hostIndex] : null;
            if (hostEdge) {
              const a = graph.vertices[hostEdge.a];
              const b = graph.vertices[hostEdge.b];
              const wallLen = Math.max(dist(a, b), 1e-4);
              const ux = (b[0] - a[0]) / wallLen;
              const uz = (b[1] - a[1]) / wallLen;
              const t1 = (opening.p1[0] - a[0]) * ux + (opening.p1[1] - a[1]) * uz;
              const t2 = (opening.p2[0] - a[0]) * ux + (opening.p2[1] - a[1]) * uz;
              const lo = Math.max(0, Math.min(t1, t2));
              const hi = Math.min(wallLen, Math.max(t1, t2));
              // Measure to the nearest neighbouring opening, not through it
              // to the wall end — the number an agent actually needs.
              let gapStart = 0;
              let gapEnd = wallLen;
              for (const other of [...doors, ...windows]) {
                if (other.id === opening.id) continue;
                if (distancePointToSegment(mid(other.p1, other.p2), a, b) > 0.3) continue;
                const o1 = (other.p1[0] - a[0]) * ux + (other.p1[1] - a[1]) * uz;
                const o2 = (other.p2[0] - a[0]) * ux + (other.p2[1] - a[1]) * uz;
                const otherHi = Math.max(o1, o2);
                const otherLo = Math.min(o1, o2);
                if (otherHi <= lo + 1e-6) gapStart = Math.max(gapStart, otherHi);
                if (otherLo >= hi - 1e-6) gapEnd = Math.min(gapEnd, otherLo);
              }
              const at = (tPos: number): V2 => [a[0] + ux * tPos, a[1] + uz * tPos];
              const gapMark = (from: number, to: number, towardOpening: 1 | -1, key: string) => {
                const span = to - from;
                if (span < 0.05) return null;
                const p = at(from);
                const q = at(to);
                const [x1, y1] = proj(...p);
                const [x2, y2] = proj(...q);
                const nx = -uz;
                const nz = ux;
                // Short corner gaps slide their label along the wall toward
                // the opening so it never sits on the perpendicular wall.
                const alongShift = span < 0.6 ? towardOpening * (0.6 - span / 2) : 0;
                const labelAt: V2 = [
                  (p[0] + q[0]) / 2 + nx * 0.42 + ux * alongShift,
                  (p[1] + q[1]) / 2 + nz * 0.42 + uz * alongShift,
                ];
                const [lx, ly] = proj(...labelAt);
                return (
                  <g key={key}>
                    <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgba(17,17,17,0.4)" strokeWidth={1} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
                    <text x={lx} y={ly} textAnchor="middle" dominantBaseline="middle" fontSize={fontPx * 0.85} fill="rgba(17,17,17,0.62)" stroke="#fff" strokeWidth={3} paintOrder="stroke" style={{ fontVariantNumeric: "tabular-nums" }}>
                      {formatLength(span)}
                    </text>
                  </g>
                );
              };
              marks.push(gapMark(gapStart, lo, 1, "gap-a"), gapMark(hi, gapEnd, -1, "gap-b"));
            }
            return marks;
          })()}
          {selectedObject && (() => {
            const corners = objectCorners(selectedObject);
            return (
              <g>
                <polygon points={toPts(corners)} fill="none" stroke="rgba(17,17,17,0.8)" strokeWidth={1.8} vectorEffect="non-scaling-stroke" />
                {corners.map((corner, index) => {
                  const [hx, hy] = proj(...corner);
                  return (
                    <rect key={index} x={hx - 3.2} y={hy - 3.2} width={6.4} height={6.4} fill="#fff" stroke="rgba(17,17,17,0.85)" strokeWidth={1.2} vectorEffect="non-scaling-stroke" />
                  );
                })}
              </g>
            );
          })()}

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
    </>
  ), [cutQuads, doorConfigs, doors, drawPreview, eraseStroke, formatLength, furniture,
      graph, halfT, interior, labelPositions, layers, mapBounds, moveSelection,
      nearestEdge, proj, roomNumbers, selectedDoor, selectedEdgeIndices, selectedObject,
      selectedWindow, toPts, wallQuads, wallStyle, windows]);

  return createPortal(
    <div
      // Portaled to <body>: the shell wraps every page in a filled fade-in
      // animation, which pins a permanent stacking context — inside it no
      // z-index can ever paint above the fixed app header, and this editor's
      // own bar (with the back-to-detail arrow) ended up hidden beneath it.
      // From <body>, z-[55] sits above the header (z-50) and below the
      // navigation rail (z-[60]), which stays usable on the left. Inline-size
      // containment makes this the container the dock's label-collapsing
      // @container rules measure against.
      className="fixed bottom-0 top-0 z-[55] flex flex-col overflow-hidden bg-background [container-type:inline-size]"
      style={{
        left: "var(--sidebar-offset, 0px)",
        right: "var(--reai-docked-width, 0px)",
      }}
    >
      {/* top bar */}
      <div className="editor-glass-control relative z-30 flex min-h-[70px] shrink-0 items-center gap-4 border-b border-border/60 px-5 py-2.5">
        <button
          type="button"
          onClick={onClose}
          aria-label={t("floorplan.editor.backToDetail", lang)}
          title={t("floorplan.editor.backToDetail", lang)}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border/60 bg-card text-foreground/70 shadow-control transition-[background-color,color,transform] duration-100 hover:bg-surface-subtle hover:text-foreground active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <ArrowLeftIcon size={19} strokeWidth={1.9} />
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

        <button
          type="button"
          disabled={saveState !== "error"}
          onClick={() => void persist({})}
          className={cn(
            "inline-flex min-h-9 shrink-0 items-center gap-2 rounded-full border border-border/65 bg-card/72 px-3 text-[12px] font-semibold shadow-[inset_0_1px_0_hsl(var(--card)),0_4px_14px_hsl(var(--foreground)/0.055)]",
            saveState === "error"
              ? "text-destructive transition-colors hover:bg-destructive/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40"
              : "text-foreground/58",
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
              ? `${t("floorplan.editor.saveError", lang)} · ${t("common.tryAgain", lang)}`
              : t("floorplan.editor.saved", lang)}
        </button>
      </div>

      {/* canvas */}
      <div ref={canvasBoxRef} className="floorplan-editor-canvas relative min-h-0 flex-1 overflow-hidden">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${VIEW} ${VIEW}`}
          className={cn(
            "h-full w-full touch-none select-none",
            tool === "draw" || tool === "door" || tool === "window" || tool === "room"
              ? "cursor-crosshair"
              : tool === "move"
                ? "cursor-move"
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
            {planContent}
          </g>
        </svg>

        {/* ── scale ruler: real metres at the current zoom ───────────── */}
        {canvasSide > 0 && (() => {
          const metrePx = proj0.s * zoom * (canvasSide / VIEW);
          if (!Number.isFinite(metrePx) || metrePx <= 0) return null;
          // One ruler unit in the user's display system (1 m or 1 ft), with
          // the label increment growing until segments are readable.
          const unitPx = metrePx * displayToMetres(1);
          const increment = unitPx >= 24 ? 1 : unitPx * 5 >= 32 ? 5 : 10;
          const segmentPx = unitPx * increment;
          if (segmentPx < 24) return null;
          const segments = segmentPx * 3 > 340 ? 2 : 3;
          return (
            <div className="pointer-events-none absolute bottom-4 left-4 z-10" aria-hidden="true">
              <div className="relative h-4" style={{ width: segments * segmentPx + 32 }}>
                {Array.from({ length: segments + 1 }, (_, i) => (
                  <span
                    key={i}
                    className={cn("absolute text-[10px] font-medium tabular-nums text-foreground/60", i > 0 && "-translate-x-1/2")}
                    style={{ left: i * segmentPx }}
                  >
                    {i === segments ? `${i * increment} ${lengthUnitSymbol}` : i * increment}
                  </span>
                ))}
              </div>
              <div className="relative h-2 border-b border-l border-r border-foreground/40" style={{ width: segments * segmentPx }}>
                {Array.from({ length: Math.max(0, segments - 1) }, (_, i) => (
                  <span key={i} className="absolute bottom-0 h-2 w-px bg-foreground/40" style={{ left: (i + 1) * segmentPx }} />
                ))}
              </div>
            </div>
          );
        })()}

        {/* ── element palette (left) ─────────────────────────────────── */}
        <div className="pointer-events-none absolute bottom-4 left-4 top-4 z-20 hidden w-[13rem] flex-col min-[1180px]:flex">
          <div className="floating-panel pointer-events-auto flex max-h-full flex-col gap-4 overflow-y-auto border-border/70 bg-card p-4 scrollbar-thin">
            <p className="text-[13px] font-bold tracking-[-0.01em] text-foreground">{t("floorplan.editor.addElement", lang)}</p>
            <div className="space-y-2">
              {inspectorHeading(t("floorplan.walls", lang))}
              <div className="grid grid-cols-3 gap-1.5">
                {paletteTile("wall", t("floorplan.editor.wall", lang), tool === "draw",
                  () => setTool((prev) => (prev === "draw" ? null : "draw")))}
              </div>
            </div>
            <div className="space-y-2">
              {inspectorHeading(t("floorplan.editor.doorsWindows", lang))}
              <div className="grid grid-cols-3 gap-1.5">
                {paletteTile("door", t("floorplan.editor.door", lang), tool === "door" && !slidingDoorArmed,
                  () => { setSlidingDoorArmed(false); setTool((prev) => (prev === "door" && !slidingDoorArmed ? null : "door")); })}
                {paletteTile("sliding", t("floorplan.editor.slidingDoor", lang), tool === "door" && slidingDoorArmed,
                  () => {
                    if (tool === "door" && slidingDoorArmed) { setTool(null); return; }
                    setTool("door");
                    // The tool-change effect clears the armed flag, so arm it
                    // after that effect has run.
                    requestAnimationFrame(() => setSlidingDoorArmed(true));
                  })}
                {paletteTile("window", t("floorplan.editor.window", lang), tool === "window",
                  () => setTool((prev) => (prev === "window" ? null : "window")))}
              </div>
            </div>
            <div className="space-y-2">
              {inspectorHeading(t("floorplan.rooms", lang))}
              <div className="grid grid-cols-3 gap-1.5">
                {paletteTile("room", t("floorplan.editor.newRoom", lang), tool === "room",
                  () => setTool((prev) => (prev === "room" ? null : "room")))}
              </div>
            </div>
            {tool === "draw" || tool === "door" || tool === "window" || tool === "room" ? (
              <p className="rounded-xl bg-surface-subtle px-3 py-2.5 text-[11px] leading-relaxed text-foreground/65" aria-live="polite">
                {t(
                  tool === "draw"
                    ? "floorplan.editor.hint.draw"
                    : tool === "room"
                      ? "floorplan.editor.hint.room"
                      : "floorplan.editor.hint.opening",
                  lang,
                )}
              </p>
            ) : null}
          </div>
        </div>

        {/* ── inspector (right): properties + layers ─────────────────── */}
        <div className="pointer-events-none absolute bottom-4 right-4 top-4 z-20 hidden w-[16.5rem] flex-col min-[1180px]:flex">
          <div className="floating-panel pointer-events-auto flex max-h-full flex-col overflow-hidden border-border/70 bg-card">
            <div className="flex shrink-0 gap-1 border-b border-border/55 p-2">
              {(["properties", "layers"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  aria-pressed={inspectorTab === tab}
                  onClick={() => setInspectorTab(tab)}
                  className={cn(
                    "flex-1 rounded-full px-3 py-2 text-[12px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    inspectorTab === tab
                      ? "bg-foreground text-background"
                      : "text-foreground/55 hover:bg-foreground/[0.05] hover:text-foreground",
                  )}
                >
                  {t(tab === "properties" ? "floorplan.editor.properties" : "floorplan.editor.layers", lang)}
                </button>
              ))}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4 scrollbar-thin">
              {inspectorTab === "layers" ? (
                <div className="space-y-1">
                  {([
                    ["doors", t("floorplan.doors", lang)],
                    ["windows", t("floorplan.windows", lang)],
                    ["labels", t("floorplan.roomLabels", lang)],
                    ["furniture", t("floorplan.editor.furniture", lang)],
                  ] as const).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      role="switch"
                      aria-checked={layers[key]}
                      onClick={() => setLayers((prev) => ({ ...prev, [key]: !prev[key] }))}
                      className="flex min-h-11 w-full items-center justify-between gap-3 rounded-xl px-3 py-1.5 text-[13px] font-medium transition-colors hover:bg-foreground/[0.045] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className={layers[key] ? "text-foreground" : "text-foreground/45"}>{label}</span>
                      <span
                        aria-hidden="true"
                        className={cn(
                          "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                          layers[key] ? "border-foreground" : "border-foreground/25",
                        )}
                      >
                        <span
                          className={cn(
                            "h-2.5 w-2.5 rounded-full bg-foreground transition-[transform,opacity] duration-150",
                            layers[key] ? "scale-100 opacity-100" : "scale-50 opacity-0",
                          )}
                        />
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Stena — plan-level wall parameters, always editable */}
                  <div className="space-y-3 border-b border-border/55 pb-4">
                    {inspectorHeading(t("floorplan.editor.wall", lang))}
                    {inspectorRow(t("floorplan.editor.thickness", lang), mmInput(wallThicknessMm, 60, 400, applyWallThickness))}
                    {inspectorRow(t("floorplan.editor.wallStyle", lang), (
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          aria-pressed={wallStyle === "solid"}
                          aria-label={t("floorplan.editor.wallSolid", lang)}
                          title={t("floorplan.editor.wallSolid", lang)}
                          onClick={() => applyWallStyle("solid")}
                          className={cn(
                            "flex h-7 w-7 items-center justify-center rounded-lg border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            wallStyle === "solid" ? "border-foreground" : "border-border/60 hover:border-foreground/40",
                          )}
                        >
                          <span className="h-4 w-4 rounded-[3px] bg-foreground" />
                        </button>
                        <button
                          type="button"
                          aria-pressed={wallStyle === "outline"}
                          aria-label={t("floorplan.editor.wallOutline", lang)}
                          title={t("floorplan.editor.wallOutline", lang)}
                          onClick={() => applyWallStyle("outline")}
                          className={cn(
                            "flex h-7 w-7 items-center justify-center rounded-lg border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            wallStyle === "outline" ? "border-foreground" : "border-border/60 hover:border-foreground/40",
                          )}
                        >
                          <span className="h-4 w-4 rounded-[3px] border-[1.5px] border-foreground bg-white" />
                        </button>
                      </div>
                    ))}
                  </div>
                  {selectedDoor ? (() => {
                const cfg = resolveDoorConfig(doorConfigs[selectedDoor.id]);
                const widthMm = Math.round(dist(selectedDoor.p1, selectedDoor.p2) * 1000);
                return (
                  <div className="space-y-4">
                    {selectionHeader(t("floorplan.editor.door", lang))}
                    {inspectorRow(t("floorplan.editor.doorType", lang), segControl(
                      [
                        { value: "Swinging", label: t("floorplan.editor.swinging", lang) },
                        { value: "Moving", label: t("floorplan.editor.sliding", lang) },
                      ],
                      cfg.doorType,
                      (value) => saveDoorConfig(
                        selectedDoor.id,
                        value === "Moving"
                          ? { doorType: "Moving", hingeSide: "Moving", swingDirection: "Moving" }
                          : { doorType: "Swinging", hingeSide: "Left", swingDirection: "In" },
                      ),
                    ))}
                    {cfg.doorType === "Swinging" && (
                      /* One visual question — "which way does it open?" — four
                         pictogram answers, instead of hinge/swing jargon rows. */
                      <div className="space-y-1.5">
                        <p className="text-[12px] font-medium text-muted-foreground">{t("floorplan.editor.swing", lang)}</p>
                        <div className="grid grid-cols-2 gap-1.5">
                          {([
                            { hinge: "Left", swing: "In" },
                            { hinge: "Right", swing: "In" },
                            { hinge: "Left", swing: "Out" },
                            { hinge: "Right", swing: "Out" },
                          ] as const).map(({ hinge, swing }) => {
                            const active = cfg.hingeSide === hinge && cfg.swingDirection === swing;
                            const label = `${t(swing === "In" ? "floorplan.editor.in" : "floorplan.editor.out", lang)} · ${t(hinge === "Left" ? "floorplan.editor.left" : "floorplan.editor.right", lang).toLowerCase()}`;
                            return (
                              <button
                                key={`${hinge}-${swing}`}
                                type="button"
                                aria-pressed={active}
                                onClick={() => saveDoorConfig(selectedDoor.id, { doorType: "Swinging", hingeSide: hinge, swingDirection: swing })}
                                className={cn(
                                  "flex items-center justify-center gap-1.5 rounded-xl border px-2 py-2 text-[11px] font-semibold transition-[background-color,border-color,color] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                  active
                                    ? "border-foreground bg-surface-subtle text-foreground"
                                    : "border-border/60 bg-card text-foreground/60 hover:border-foreground/30 hover:text-foreground",
                                )}
                              >
                                {swingGlyph(hinge === "Right", swing === "Out")}
                                {label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    {widthControl(widthMm, [700, 800, 900, 1000], (metres) => resizeOpening(selectedDoor.id, "door", metres))}
                    {removeButton(() => deleteOpening(selectedDoor.id))}
                  </div>
                );
              })() : selectedWindow ? (() => {
                const widthMm = Math.round(dist(selectedWindow.p1, selectedWindow.p2) * 1000);
                return (
                  <div className="space-y-4">
                    {selectionHeader(t("floorplan.editor.window", lang))}
                    {widthControl(widthMm, [900, 1200, 1500, 1800], (metres) => resizeOpening(selectedWindow.id, "window", metres))}
                    {removeButton(() => deleteOpening(selectedWindow.id))}
                  </div>
                );
              })() : selectedRoom != null ? (
                <div className="space-y-4">
                  {selectionHeader(labels[selectedRoom] ?? `${t("floorplan.room", lang)} ${selectedRoom}`)}
                  <div className="space-y-1.5">
                    <p className="text-[12px] font-medium text-muted-foreground">{t("floorplan.editor.roomName", lang)}</p>
                    <input
                      key={`${selectedRoom}:${labels[selectedRoom] ?? ""}`}
                      defaultValue={labels[selectedRoom] ?? ""}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          event.currentTarget.blur();
                        }
                      }}
                      onBlur={(event) => renameLabel(selectedRoom, event.currentTarget.value)}
                      className="w-full rounded-lg border border-border bg-white px-2.5 py-1.5 text-[13px] font-medium text-foreground outline-none transition-colors hover:border-foreground/35 focus:border-foreground"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <p className="text-[12px] font-medium text-muted-foreground">{t("floorplan.editor.doorType", lang)}</p>
                    <select
                      value={ROOM_TYPE_CODES.includes(roomTypes[selectedRoom] as (typeof ROOM_TYPE_CODES)[number]) ? roomTypes[selectedRoom] : ""}
                      onChange={(event) => {
                        const code = event.target.value as (typeof ROOM_TYPE_CODES)[number] | "";
                        if (code) applyRoomType(selectedRoom, code);
                      }}
                      className="w-full rounded-lg border border-border bg-white px-2 py-1.5 text-[13px] font-medium text-foreground outline-none transition-colors hover:border-foreground/35 focus:border-foreground"
                    >
                      <option value="">—</option>
                      {ROOM_TYPE_CODES.map((code) => (
                        <option key={code} value={code}>{t(`rooms.${code}`, lang)}</option>
                      ))}
                    </select>
                  </div>
                  {removeButton(() => deleteRoom(selectedRoom))}
                </div>
              ) : selectedEdge ? (() => {
                const lengthM = dist(graph.vertices[selectedEdge.a], graph.vertices[selectedEdge.b]);
                return (
                  <div className="space-y-4">
                    {selectionHeader(t("floorplan.editor.wall", lang))}
                    {inspectorRow(t("floorplan.editor.length", lang), (
                      <span className="text-[12px] font-semibold tabular-nums text-foreground">{formatLength(lengthM)}</span>
                    ))}
                    {moveSelection?.kind === "edge" ? removeButton(() => deleteEdgeChain(moveSelection.index)) : null}
                  </div>
                );
              })() : selectedObject ? (
                <div className="space-y-4">
                  {selectionHeader(t("floorplan.editor.object", lang))}
                  {inspectorRow(t("floorplan.editor.object", lang), (
                    <span className="max-w-[9rem] truncate text-[12px] font-semibold text-foreground">
                      {furnitureKind(selectedObject.category).replace(/([a-z])([A-Z])/g, "$1 $2")}
                    </span>
                  ))}
                  {inspectorRow(t("floorplan.editor.rotate", lang), (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => rotateFurnitureObject(selectedObject.id, -90)}
                        aria-label={`${t("floorplan.editor.rotate", lang)} -90°`}
                        title="-90°"
                        className="flex h-8 w-9 items-center justify-center rounded-full border border-border/70 text-foreground/70 transition-colors hover:border-foreground/35 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <RotateIcon size={14} className="scale-x-[-1]" />
                      </button>
                      <button
                        type="button"
                        onClick={() => rotateFurnitureObject(selectedObject.id, 90)}
                        aria-label={`${t("floorplan.editor.rotate", lang)} +90°`}
                        title="+90°"
                        className="flex h-8 w-9 items-center justify-center rounded-full border border-border/70 text-foreground/70 transition-colors hover:border-foreground/35 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <RotateIcon size={14} />
                      </button>
                    </div>
                  ))}
                  {removeButton(() => deleteFurnitureObject(selectedObject.id))}
                </div>
              ) : (
                <div className="space-y-4">
                  <p className="text-[12px] leading-relaxed text-muted-foreground">{t("floorplan.editor.selectHint", lang)}</p>
                  {inspectorRow(t("floorplan.editor.dimensions", lang), (
                    <span className="text-[12px] font-semibold tabular-nums text-foreground">{ratioText}</span>
                  ))}
                  {inspectorRow(t("floorplan.rooms", lang), (
                    <span className="text-[12px] font-semibold tabular-nums text-foreground">{roomNumbers.length}</span>
                  ))}
                </div>
              )}
                </div>
              )}
            </div>
          </div>
        </div>

      </div>

      {/* A single command dock, grouped like a DCC viewport but deliberately
          labelled and softened for a non-technical property workflow. In flow
          below the canvas, not floating over it: an overlay covered the bottom
          of the drawing, which is why a freshly opened plan looked mis-centred
          with its lower wall hidden. */}
      <div className="relative z-20 flex shrink-0 flex-col items-center gap-2 px-4 pb-[calc(0.9rem+env(safe-area-inset-bottom,0px))] pt-2">
          {/* Wraps rather than scrolls: a scrolling shelf silently hides its
              last tools, and every command here must stay reachable. */}
          <div className="floorplan-command-dock pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-1 rounded-[26px] border border-border/70 p-1.5">
            <div className="flex shrink-0 flex-nowrap items-center gap-1">
              <button
                type="button"
                onClick={() => setTool(null)}
                aria-pressed={tool == null}
                aria-label={t("floorplan.editor.select", lang)}
                title={t("floorplan.editor.select", lang)}
                className={cn(
                  "floorplan-tool-button group flex h-12 shrink-0 items-center justify-center gap-2.5 rounded-full px-4 text-[13px] font-semibold transition-[background-color,color,box-shadow,transform]",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                  tool == null
                    ? "bg-foreground text-background shadow-[inset_0_1px_0_hsl(var(--card)/0.2),0_7px_18px_hsl(var(--foreground)/0.15)]"
                    : "text-foreground/62 hover:bg-foreground/[0.055] hover:text-foreground active:scale-[0.98]",
                )}
              >
                <SelectIcon size={21} strokeWidth={1.9} className="shrink-0" />
                <span className="floorplan-tool-label whitespace-nowrap">{t("floorplan.editor.select", lang)}</span>
              </button>
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
              <UtilButton onClick={resetAll} label={t("floorplan.editor.reset", lang)} icon={ResetToolIcon} />
              <UtilButton
                onClick={() => frameView("all")}
                label={t("floorplan.editor.fitView", lang)}
                icon={FrameIcon}
              />
              {hiddenIds.size > 0 && (
                <UtilButton
                  onClick={() => setHiddenIds(new Set())}
                  label={`${t("floorplan.editor.showHidden", lang)} (${hiddenIds.size})`}
                  icon={ShowHiddenIcon}
                />
              )}
            </div>
          </div>
      </div>
    </div>,
    document.body,
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

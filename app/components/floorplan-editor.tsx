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
  prepareObjects,
  prepareFloorplanPresentationObjects,
  solveFurnitureLayout,
  STROKE_COLOR,
  STROKE_WIDTH,
  DOOR_PANEL_WIDTH,
  DOOR_ARC_WIDTH,
  DOOR_HINGE_RADIUS,
  WALL_THICKNESS,
  type AdjustedGeometry,
  type CustomOpening,
  type DoorConfig,
  type V2,
} from "../lib/floorplan-geometry";
import { solveReaigenFloorplan, USE_CONSTRAINT_SOLVER } from "../lib/floorplan-solver-adapter";
import { iconForKind, type IconShape } from "../lib/floorplan-icon-shapes";

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
}

type Tool = "draw" | "erase" | "move" | "door" | "window" | "room";

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

// ─────────────────────────────────────────────────────────────────────────────

export default function FloorplanEditor({ draftId, draftData, lang, onClose, onSaved }: Props) {
  // ── immutable scan baseline ────────────────────────────────────────────────
  const base = useMemo(() => {
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
    return {
      textData,
      geom,
      baselineGraph,
      initialGraph: initialGraph ?? cloneGraph(baselineGraph),
      initialEdits: {
        deletedSourceOpeningIDs: [...parsedEdits.deletedSourceOpeningIDs],
        customOpenings: parsedEdits.customOpenings,
      } as OpeningEditsState,
    };
  }, [draftData]);

  const [graph, setGraph] = useState<WallGraphState>(() => cloneGraph(base.initialGraph));
  const [edits, setEdits] = useState<OpeningEditsState>(() => cloneEdits(base.initialEdits));
  const [rotationDeg, setRotationDeg] = useState(() => floorplanRotationDegrees(base.textData));
  const [tool, setTool] = useState<Tool | null>(null);
  const [zoom, setZoom] = useState(1);
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
    kind: "pan" | "draw" | "erase" | "moveVertex" | "moveEdge" | "label" | null;
    start: V2;
    startScreen: [number, number];
    vertexIndex?: number;
    edgeIndex?: number;
    labelN?: number;
    baseGraph?: WallGraphState;
    basePan?: { x: number; y: number };
    baseOffset?: V2;
    moved?: boolean;
  }>({ kind: null, start: [0, 0], startScreen: [0, 0] });
  const [drawPreview, setDrawPreview] = useState<[V2, V2] | null>(null);
  const [eraseStroke, setEraseStroke] = useState<V2[]>([]);

  // ── projection (fixed at mount; pan/zoom layered on top) ──────────────────
  const proj0 = useMemo(() => {
    const pts = [
      ...base.initialGraph.vertices,
      ...(base.geom?.walls ?? []).flatMap((w) => [w.p1, w.p2]),
    ];
    const b = computeBounds(pts.length ? pts : [[-4, -3], [4, 3]])!;
    const cx = (b.minX + b.maxX) / 2;
    const cz = (b.minZ + b.maxZ) / 2;
    const span = Math.max(b.maxX - b.minX, b.maxZ - b.minZ, 2) + 3; // margin to draw outside
    const s = VIEW / span;
    return { cx, cz, s };
  }, [base]);

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

  const screenToWorld = useCallback(
    (clientX: number, clientY: number): V2 => {
      const svg = svgRef.current!;
      const rect = svg.getBoundingClientRect();
      const sx = ((clientX - rect.left) * VIEW) / rect.width;
      const sy = ((clientY - rect.top) * VIEW) / rect.height;
      const cx = (sx - pan.x) / zoom;
      const cy = (sy - pan.y) / zoom;
      return unrotW([proj0.cx + (cx - VIEW / 2) / proj0.s, proj0.cz + (cy - VIEW / 2) / proj0.s]);
    },
    [pan, zoom, proj0, unrotW]
  );

  const screenPx = useCallback((clientX: number, clientY: number): [number, number] => {
    const svg = svgRef.current!;
    const rect = svg.getBoundingClientRect();
    return [((clientX - rect.left) * VIEW) / rect.width, ((clientY - rect.top) * VIEW) / rect.height];
  }, []);

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
    (g: WallGraphState, e: OpeningEditsState): Record<string, string> => ({
      wall_graph_json: JSON.stringify({
        vertices: g.vertices.map((v) => [v[0], v[1]]),
        edges: g.edges.map((ed) => ({ a: ed.a, b: ed.b })),
      }),
      floorplan_opening_edits_json: JSON.stringify({
        deletedSourceOpeningIDs: e.deletedSourceOpeningIDs,
        customOpenings: e.customOpenings.map((o) => ({ id: o.id, kind: o.kind, p1: o.p1, p2: o.p2 })),
      }),
    }),
    []
  );

  const schedulePersistWalls = useCallback(
    (g: WallGraphState, e: OpeningEditsState) => {
      if (persistTimer.current) clearTimeout(persistTimer.current);
      persistTimer.current = setTimeout(() => void persist(wallFields(g, e)), 300);
    },
    [persist, wallFields]
  );
  useEffect(() => () => {
    if (persistTimer.current) clearTimeout(persistTimer.current);
  }, []);

  const pushUndo = useCallback(() => {
    undoStack.current.push({ graph: cloneGraph(graph), edits: cloneEdits(edits) });
    if (undoStack.current.length > MAX_UNDO) undoStack.current.shift();
  }, [graph, edits]);

  const commit = useCallback(
    (g: WallGraphState, e: OpeningEditsState) => {
      setGraph(g);
      setEdits(e);
      schedulePersistWalls(g, e);
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

  // Solve against the CURRENT edited walls and openings, not the load-time
  // snapshot — wall/door edits immediately re-place furniture.
  const furniture = useMemo(
    () => {
      const solved = USE_CONSTRAINT_SOLVER
        ? solveReaigenFloorplan({
            walls: segs,
            doors,
            windows,
            openings,
            objects: base.geom?.objects ?? [], // solver conditions internally
            doorConfigs,
            rooms: base.geom?.solverRooms ?? [],
          }).objects
        : solveFurnitureLayout(
            prepareObjects(base.geom?.objects ?? [], computeBounds(graph.vertices)),
            graphSegs(graph),
            base.geom?.interiorCentroid ?? [0, 0],
            doors,
            base.geom?.rooms ?? []
          );
      const layer = (object: (typeof solved)[number]): number => {
        const kind = furnitureKind(object.category);
        if (kind === "table") return 0;
        if (kind === "bed" || kind === "sofa") return 1;
        if (kind === "chair") return 3;
        return 2;
      };
      return prepareFloorplanPresentationObjects(solved).sort((a, b) =>
        layer(a) - layer(b)
        || 4 * b.halfW * b.halfD - 4 * a.halfW * a.halfD
        || a.id.localeCompare(b.id)
      );
    },
    [base, graph, segs, doors, windows, openings, doorConfigs]
  );

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
      commit(g, cloneEdits(edits));
    },
    [graph, edits, pushUndo, commit]
  );

  const eraseAlongStroke = useCallback(
    (stroke: V2[]) => {
      if (stroke.length < 1) return;
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
      if (!removedEdges.size && deleted.size === e.deletedSourceOpeningIDs.length &&
          e.customOpenings.length === edits.customOpenings.length) {
        return;
      }
      pushUndo();
      e.deletedSourceOpeningIDs = [...deleted];
      g.edges = g.edges.filter((_, i) => !removedEdges.has(i));
      commit(pruneOrphans(g), e);
    },
    [graph, edits, base.geom, pxPerMeter, pushUndo, commit]
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
      commit(cloneGraph(graph), next);
    },
    [graph, edits, nearestEdge, pushUndo, commit]
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
      next.customOpenings = next.customOpenings.map((o) => {
        const m = mid(o.p1, o.p2);
        let bestI = -1;
        let bestD = Infinity;
        before.edges.forEach((ed, i) => {
          const d = distancePointToSegment(m, before.vertices[ed.a], before.vertices[ed.b]);
          if (d < bestD) {
            bestD = d;
            bestI = i;
          }
        });
        if (bestI < 0 || bestD > 0.3) return o;
        const oldA = before.vertices[before.edges[bestI].a];
        const oldB = before.vertices[before.edges[bestI].b];
        const newA = after.vertices[after.edges[bestI]?.a ?? before.edges[bestI].a];
        const newB = after.vertices[after.edges[bestI]?.b ?? before.edges[bestI].b];
        if (!newA || !newB) return o;
        const oldLen = Math.max(dist(oldA, oldB), 1e-4);
        const newLen = Math.max(dist(newA, newB), 1e-4);
        const len = dist(o.p1, o.p2);
        if (newLen < Math.max(MIN_WALL_FOR_OPENING, len + 0.02)) return o;
        const tMid = ((m[0] - oldA[0]) * (oldB[0] - oldA[0]) + (m[1] - oldA[1]) * (oldB[1] - oldA[1])) / (oldLen * oldLen);
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
    []
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
          const vi = nearestVertex(w);
          g.kind = "draw";
          g.start = vi != null ? graph.vertices[vi] : w;
          setDrawPreview([g.start, g.start]);
          return;
        }
        case "erase":
          g.kind = "erase";
          setEraseStroke([w]);
          return;
        case "move": {
          const vi = nearestVertex(w);
          if (vi != null) {
            g.kind = "moveVertex";
            g.vertexIndex = vi;
            g.baseGraph = cloneGraph(graph);
            pushUndo();
            return;
          }
          const ei = nearestEdge(w, EDGE_PICK_PX);
          if (ei != null) {
            g.kind = "moveEdge";
            g.edgeIndex = ei;
            g.baseGraph = cloneGraph(graph);
            pushUndo();
            return;
          }
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
     nearestVertex, nearestEdge, graph, pxPerMeter, pushUndo, editingDoor, editingLabel]
  );

  const onPointerMove = useCallback(
    (ev: React.PointerEvent<SVGSVGElement>) => {
      const g = gesture.current;
      if (!g.kind) return;
      const w = screenToWorld(ev.clientX, ev.clientY);
      const sp = screenPx(ev.clientX, ev.clientY);
      if (Math.hypot(sp[0] - g.startScreen[0], sp[1] - g.startScreen[1]) > 3) g.moved = true;
      switch (g.kind) {
        case "pan": {
          setPan({
            x: g.basePan!.x + (sp[0] - g.startScreen[0]),
            y: g.basePan!.y + (sp[1] - g.startScreen[1]),
          });
          return;
        }
        case "draw": {
          // Manhattan snap + vertex snap (iOS drawSnapRadius).
          let end: V2 =
            Math.abs(w[0] - g.start[0]) >= Math.abs(w[1] - g.start[1])
              ? [w[0], g.start[1]]
              : [g.start[0], w[1]];
          const vi = nearestVertex(end);
          if (vi != null) end = graph.vertices[vi];
          setDrawPreview([g.start, end]);
          return;
        }
        case "erase":
          setEraseStroke((prev) => [...prev, w]);
          return;
        case "moveVertex": {
          const next = cloneGraph(g.baseGraph!);
          next.vertices[g.vertexIndex!] = w;
          setGraph(next);
          return;
        }
        case "moveEdge": {
          const dx = w[0] - g.start[0];
          const dz = w[1] - g.start[1];
          const next = cloneGraph(g.baseGraph!);
          const e = next.edges[g.edgeIndex!];
          next.vertices[e.a] = [g.baseGraph!.vertices[e.a][0] + dx, g.baseGraph!.vertices[e.a][1] + dz];
          next.vertices[e.b] = [g.baseGraph!.vertices[e.b][0] + dx, g.baseGraph!.vertices[e.b][1] + dz];
          setGraph(next);
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
    [screenToWorld, screenPx, nearestVertex, graph]
  );

  const onPointerUp = useCallback(
    (ev: React.PointerEvent<SVGSVGElement>) => {
      const g = gesture.current;
      const kind = g.kind;
      g.kind = null;
      const w = screenToWorld(ev.clientX, ev.clientY);
      switch (kind) {
        case "draw": {
          if (drawPreview) commitDraw(drawPreview[0], drawPreview[1]);
          setDrawPreview(null);
          return;
        }
        case "erase": {
          eraseAlongStroke([...eraseStroke, w]);
          setEraseStroke([]);
          return;
        }
        case "moveVertex":
        case "moveEdge": {
          const nextEdits = reprojectOpenings(g.baseGraph!, graph, edits);
          commit(cloneGraph(graph), nextEdits);
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
    [screenToWorld, drawPreview, commitDraw, eraseStroke, eraseAlongStroke, graph, edits, commit,
     reprojectOpenings, labelPositions, labelOffsets, labels, proj, zoom, pan, persist, tool,
     placeOpening, addRoom]
  );

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
    commit(snap.graph, snap.edits);
  }, [commit]);

  const rotate = useCallback(() => {
    const next = (rotationDeg + 90) % 360;
    setRotationDeg(next);
    void persist({ floorplan_rotation_degrees: String(next) });
  }, [rotationDeg, persist]);

  const resetAll = useCallback(() => {
    pushUndo();
    commit(cloneGraph(base.baselineGraph), { deletedSourceOpeningIDs: [], customOpenings: [] });
  }, [base.baselineGraph, pushUndo, commit]);

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
      ...base.initialGraph.vertices,
      ...(base.geom?.walls ?? []).flatMap((w) => [w.p1, w.p2]),
      ...(base.geom?.doors ?? []).flatMap((d) => [d.p1, d.p2]),
      ...(base.geom?.windows ?? []).flatMap((d) => [d.p1, d.p2]),
      ...(base.geom?.openings ?? []).flatMap((d) => [d.p1, d.p2]),
      ...furniture.map((o) => o.center),
    ];
    return computeBounds(pts);
  }, [base.initialGraph.vertices, base.geom?.walls, base.geom?.doors, base.geom?.windows, base.geom?.openings, furniture]);
  const mapW = mapBounds ? mapBounds.maxX - mapBounds.minX : 0;
  const mapZ = mapBounds ? mapBounds.maxZ - mapBounds.minZ : 0;
  const mapArea = mapW * mapZ;
  const ratioText = mapBounds ? `${fmt(mapW)}m × ${fmt(mapZ)}m` : "n/a";
  const aspectRatioText = mapBounds && mapZ > 0 ? fmt(mapW / mapZ, 2) : "n/a";
  const wallCount = segs.length;
  const windowCount = windows.length;
  const doorCount = doors.length;
  const objectCount = furniture.length;
  const doorWindowRatio = windowCount > 0 ? `${fmt(doorCount / windowCount, 2)}:1` : "n/a";
  const elementDensity = mapArea > 0 ? fmt(objectCount / mapArea, 2) : "n/a";
  const compassDeg = ((360 - ((rotationDeg % 360) + 360)) % 360);

  const toolButton = (tl: Tool, label: string) => (
    <button
      key={tl}
      type="button"
      onClick={() => setTool((prev) => (prev === tl ? null : tl))}
      className={cn(
        "rounded-full px-3 py-1.5 text-[12.5px] font-semibold transition-colors",
        tool === tl ? "bg-foreground text-background" : "text-foreground/60 hover:text-foreground"
      )}
    >
      {label}
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

  const legendItems = [
    {
      label: t("floorplan.walls", lang),
      mark: <path d="M2 12 H20" stroke={STROKE_COLOR} strokeWidth={2.4} />,
    },
    {
      label: t("floorplan.doors", lang),
      mark: <path d="M2 12 H14 L20 12" stroke={STROKE_COLOR} strokeWidth={2.4} />,
    },
    {
      label: t("floorplan.windows", lang),
      mark: <path d="M2 12 H10 M12 8 H20" stroke={STROKE_COLOR} strokeDasharray="3 3" strokeWidth={2} />,
    },
    {
      label: t("floorplan.roomLabels", lang),
      mark: <circle cx={11} cy={12} r={4} fill="rgba(255,255,255,0.9)" stroke={STROKE_COLOR} strokeWidth={1.4} />,
    },
    {
      label: t("floorplan.editor.furniture", lang),
      mark: <rect x={5} y={6} width={12} height={10} rx={2} fill="none" stroke={STROKE_COLOR} strokeWidth={1.4} />,
    },
  ];
  const northLabel = "N";

  const editingDoorCfg = editingDoor ? resolveDoorConfig(doorConfigs[editingDoor.id]) : null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      {/* top bar */}
      <div className="flex items-center justify-between border-b border-border/50 px-4 py-3">
        <button
          type="button"
          onClick={onClose}
          className="rounded-full px-3 py-1.5 text-[13px] font-semibold text-foreground/60 hover:text-foreground"
        >
          {t("common.close", lang)}
        </button>
        <span className="text-[14px] font-semibold">{t("floorplan.editor.title", lang)}</span>
        <span
          className={cn(
            "min-w-16 text-right text-[12px] font-medium",
            saveState === "error" ? "text-red-600" : "text-muted-foreground"
          )}
        >
          {saveState === "saving"
            ? t("floorplan.editor.saving", lang)
            : saveState === "error"
              ? t("floorplan.editor.saveError", lang)
              : t("floorplan.editor.saved", lang)}
        </span>
      </div>

      {/* canvas */}
      <div className="relative min-h-0 flex-1 overflow-hidden bg-white">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${VIEW} ${VIEW}`}
          className="h-full w-full touch-none select-none"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onWheel={onWheel}
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

            {/* furniture (read-only) */}
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
                return (
                  <g
                    key={`f${i}`}
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
                );
              })}

            {/* walls */}
            <g mask="url(#editor-cuts)">
              {wallQuads.map((poly, i) => (
                <polygon key={i} points={toPts(poly)} fill={STROKE_COLOR} />
              ))}
            </g>

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

            {/* move handles */}
            {tool === "move" &&
              graph.vertices.map((v, i) => {
                const [x, y] = proj(v[0], v[1]);
                return <circle key={i} cx={x} cy={y} r={5} fill="#2563eb" fillOpacity={0.55} />;
              })}

            {/* draw preview */}
            {drawPreview && (
              <g>
                <line
                  x1={proj(...drawPreview[0])[0]}
                  y1={proj(...drawPreview[0])[1]}
                  x2={proj(...drawPreview[1])[0]}
                  y2={proj(...drawPreview[1])[1]}
                  stroke="#2563eb"
                  strokeWidth={2.2}
                />
                <circle cx={proj(...drawPreview[0])[0]} cy={proj(...drawPreview[0])[1]} r={4.5} fill="#2563eb" />
                <circle cx={proj(...drawPreview[1])[0]} cy={proj(...drawPreview[1])[1]} r={4.5} fill="#2563eb" />
              </g>
            )}

            {/* erase preview */}
            {eraseStroke.length > 1 && (
              <polyline
                points={eraseStroke.map((p) => proj(p[0], p[1]).join(",")).join(" ")}
                fill="none"
                stroke="#dc2626"
                strokeOpacity={0.6}
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

        <div className="pointer-events-none absolute left-3 top-3 z-20 flex flex-col gap-2">
          <div className="rounded-xl border border-border/40 bg-card/90 p-2 shadow-card backdrop-blur-md">
            <div className="mx-auto h-16 w-16 rounded-full border border-border/40 bg-white/85 text-xs text-foreground">
              <svg viewBox="0 0 64 64" className="h-full w-full">
                <circle cx={32} cy={32} r={28} fill="white" fillOpacity={0.9} />
                <g transform={`rotate(${compassDeg} 32 32)`}>
                  <path d="M32 6 L35.5 15.5 H28.5 Z" fill={STROKE_COLOR} />
                  <line x1={32} y1={15} x2={32} y2={30} stroke={STROKE_COLOR} strokeWidth={2.2} />
                  <text x={32} y={16} textAnchor="middle" fontSize={10} fontWeight={700} fill={STROKE_COLOR}>
                    {northLabel}
                  </text>
                  <text x={32} y={58} textAnchor="middle" fontSize={9} fill={STROKE_COLOR}>
                    S
                  </text>
                  <text x={58} y={36} textAnchor="middle" fontSize={9} fill={STROKE_COLOR}>
                    E
                  </text>
                  <text x={6} y={36} textAnchor="middle" fontSize={9} fill={STROKE_COLOR}>
                    W
                  </text>
                  <circle cx={32} cy={32} r={3} fill={STROKE_COLOR} />
                </g>
              </svg>
            </div>
          </div>

          <div className="rounded-xl border border-border/40 bg-card/92 px-3 py-2 text-[11px] leading-5 text-foreground/80 shadow-card backdrop-blur-md">
            <div className="font-semibold text-foreground/95">
              {t("floorplan.area", lang)}: {ratioText}
            </div>
            <div>
              {t("floorplan.editor.furnitureDensity", lang)}: {elementDensity}
            </div>
            <div>
              {t("floorplan.walls", lang)}:{wallCount} · {t("floorplan.doors", lang)}:{doorCount} · {t("floorplan.windows", lang)}:{windowCount}
            </div>
            <div>
              {t("floorplan.editor.aspectRatio", lang)}: {aspectRatioText}:1
            </div>
            <div>
              {t("floorplan.editor.doorWindowRatio", lang)}: {doorWindowRatio}
            </div>
            <div>{t("floorplan.rooms", lang)}: {roomNumbers.length}</div>
          </div>

          <div className="rounded-xl border border-border/40 bg-card/92 px-3 py-2 text-[11px] shadow-card backdrop-blur-md">
            <div className="mb-1 font-semibold text-foreground/95">{t("floorplan.editor.layers", lang)}</div>
            <ul className="space-y-1">
              {legendItems.map((item, idx) => (
                <li key={`${item.label}-${idx}`} className="flex items-center gap-2">
                  <svg width={24} height={16} viewBox="0 0 24 24" className="shrink-0">
                    {item.mark}
                  </svg>
                  <span className="text-foreground/75">{item.label}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

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
      </div>

      {/* bottom bars */}
      <div className="border-t border-border/50 px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] pt-2">
        {layersOpen && (
          <div className="mb-2 flex flex-wrap items-center justify-center gap-1.5 border-b border-border/40 pb-2">
            {chip("doors", t("floorplan.doors", lang))}
            {chip("windows", t("floorplan.windows", lang))}
            {chip("labels", t("floorplan.roomLabels", lang))}
            {chip("furniture", t("floorplan.editor.furniture", lang))}
          </div>
        )}
        <div className="flex flex-wrap items-center justify-center gap-1">
          {toolButton("draw", t("floorplan.editor.draw", lang))}
          {toolButton("erase", t("floorplan.editor.erase", lang))}
          {toolButton("move", t("floorplan.editor.move", lang))}
          {toolButton("door", t("floorplan.editor.door", lang))}
          {toolButton("window", t("floorplan.editor.window", lang))}
          {toolButton("room", t("floorplan.editor.room", lang))}
        </div>
        <div className="mt-1 flex items-center justify-center gap-1">
          <UtilButton onClick={rotate} label={t("floorplan.editor.rotate", lang)} />
          <UtilButton onClick={undo} disabled={!canUndo} label={t("floorplan.editor.undo", lang)} />
          <UtilButton onClick={() => setLayersOpen((v) => !v)} label={t("floorplan.editor.layers", lang)} active={layersOpen} />
          <UtilButton onClick={resetAll} label={t("floorplan.editor.reset", lang)} />
          <UtilButton
            onClick={() => {
              setZoom(1);
              setPan({ x: 0, y: 0 });
            }}
            label={t("floorplan.editor.fitView", lang)}
          />
        </div>
      </div>
    </div>
  );
}

function UtilButton({
  onClick,
  label,
  disabled,
  active,
}: {
  onClick: () => void;
  label: string;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "rounded-full px-2.5 py-1 text-[12px] font-medium transition-colors",
        disabled ? "text-foreground/25" : active ? "bg-black/[0.07] text-foreground" : "text-foreground/60 hover:text-foreground"
      )}
    >
      {label}
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

"use client";

/**
 * FloorplanViewer — same architectural rendering as the iOS app.
 *
 * Primary path mirrors iOS LocalFloorplanCanvasView: parse the draft's
 * `captured_room_json` (RoomPlan CapturedRoom), Manhattan-snap it, render
 * walls (18 cm ink quads with door/window cuts), scan + custom doors
 * (jambs, and swing arc + panel + hinge when configured via door_N_camera),
 * windows (three parallel lines), numbered room labels, total-area chip,
 * compass, and a room legend below the plan.
 *
 * Fallback mirrors iOS FloorplanCanvas: backend mesh geometry from
 * /floorplans/<id>/rendering/, then the composite image as a last resort.
 */

import { useEffect, useId, useMemo, useState } from "react";
import type { DraftDataEntry } from "../lib/tour-types";
import {
  getFloorplanRendering,
  type FloorplanRenderingData,
  type FloorplanRoom,
  type GeometryLayer,
} from "../lib/api/client";
import { t } from "../lib/i18n";
import { localizedRoomName } from "../lib/room-names";
import {
  buildTextDataMap,
  parseCapturedRoom,
  manhattanAdjust,
  parseWallGraph,
  parseOpeningEdits,
  parseDoorConfigs,
  doorSwingRenderable,
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
  WALL_THICKNESS,
  STROKE_COLOR,
  LABEL_FILL,
  STROKE_WIDTH,
  DOOR_PANEL_WIDTH,
  DOOR_ARC_WIDTH,
  DOOR_HINGE_RADIUS,
  type V2,
  type DoorConfig,
} from "../lib/floorplan-geometry";

interface Props {
  draftData: DraftDataEntry[];
  floorplanId?: number | null;
  lang: string;
}

const SVG_W = 400;
// Compass/area chip are HTML overlays at the card corners, so the viewBox
// only needs breathing room for the plan itself.
const PADDING = 32;
const MESH_INK = "#141417"; // iOS FloorplanCanvas canvasInkColor
const AREA_FILL = "#6b7280";

const midOf = (p1: V2, p2: V2): V2 => [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];

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

interface LegendEntry {
  n: number;
  label: string;
  area: number;
}

// ─────────────────────────────────────────────────────────────────────────────

export default function FloorplanViewer({ draftData, floorplanId, lang }: Props) {
  const [rendering, setRendering] = useState<FloorplanRenderingData | null>(null);

  useEffect(() => {
    if (!floorplanId) return;
    const ctrl = new AbortController();
    getFloorplanRendering(floorplanId, ctrl.signal)
      .then(setRendering)
      .catch(() => {});
    return () => ctrl.abort();
  }, [floorplanId]);

  const model = useMemo(() => buildLocalModel(draftData), [draftData]);

  // Legend: union of draft-data room numbers and backend rooms; draft labels win.
  const legendEntries = useMemo<LegendEntry[]>(() => {
    const map = model.textData;
    const overrides = parseRoomAreaOverrides(map);
    const byNumber = new Map<number, LegendEntry>();
    for (const room of rendering?.rooms ?? []) {
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
  }, [model.textData, rendering, lang]);

  const meshLayers = rendering?.geometry?.layers;
  const hasMesh = !!meshLayers && [meshLayers.walls, meshLayers.doors, meshLayers.windows].some(
    (l) => l?.available && l.meshes?.length > 0
  );

  let plan: React.ReactNode = null;
  if (model.local) {
    plan = <LocalPlan model={model.local} legendEntries={legendEntries} lang={lang} />;
  } else if (hasMesh) {
    plan = <MeshPlan data={rendering!} legendEntries={legendEntries} lang={lang} />;
  } else if (rendering?.composite?.url) {
    plan = (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={rendering.composite.url} alt="" className="w-full block bg-white" />
    );
  } else {
    return null;
  }

  return (
    <div className="rounded-2xl border border-black/[0.06] bg-white overflow-hidden">
      {plan}
      {legendEntries.length > 0 && (
        <div className="px-4 py-2.5 border-t border-black/[0.05]">
          <div className={`grid gap-x-6 gap-y-1.5 ${legendEntries.length > 4 ? "grid-cols-2 max-sm:grid-cols-1" : "grid-cols-1"}`}>
            {legendEntries.map((e) => (
              <div key={e.n} className="flex items-center gap-2 min-w-0">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-black/[0.06] text-[12px] font-bold text-foreground">
                  {e.n}
                </span>
                <span className="truncate text-[13px] font-medium text-foreground/75">{e.label}</span>
                {e.area > 0 && (
                  <span className="ml-auto shrink-0 text-[12px] text-muted-foreground tabular-nums">
                    {e.area.toFixed(1)} m²
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Local vector plan (iOS LocalFloorplanCanvasView port) ────────────────────

interface LocalModel {
  wallQuads: V2[][];
  cutQuads: V2[][];
  windows: { p1: V2; p2: V2 }[];
  doors: { id: string; p1: V2; p2: V2 }[];
  doorConfigs: Record<string, DoorConfig>;
  interior: V2;
  svgH: number;
  proj: (x: number, z: number) => [number, number];
  pivot: V2;
  rotW: (p: V2) => V2;
  centresByIndex: Record<number, V2>;
  floorCentres: V2[];
  markers: Record<number, V2>;
  offsets: Record<number, V2>;
  totalArea: number;
  /** Compass dial rotation: plan rotation + (sceneRotation − device heading). */
  compassRotationDeg: number;
}

function buildLocalModel(draftData: DraftDataEntry[]): { textData: Record<string, string>; local: LocalModel | null } {
  const textData = buildTextDataMap(draftData);

  let geom: ReturnType<typeof manhattanAdjust> | null = null;
  const rawRoom = textData["captured_room_json"];
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
  const hosted = (p1: V2, p2: V2) => openingHasHostWall(midOf(p1, p2), wallSegs);
  const srcDoors = (geom?.doors ?? []).filter(
    (d) => !edits.deletedSourceOpeningIDs.has(d.id) && hosted(d.p1, d.p2)
  );
  const srcWindows = (geom?.windows ?? []).filter(
    (w) => !edits.deletedSourceOpeningIDs.has(w.id) && hosted(w.p1, w.p2)
  );
  const customDoors = edits.customOpenings.filter((o) => o.kind === "door" && hosted(o.p1, o.p2));
  const customWindows = edits.customOpenings.filter((o) => o.kind === "window" && hosted(o.p1, o.p2));
  const doors = [...srcDoors, ...customDoors].map((d) => ({ id: d.id, p1: d.p1, p2: d.p2 }));
  const windows = [...srcWindows, ...customWindows].map((w) => ({ p1: w.p1, p2: w.p2 }));

  // User rotation (0/90/180/270), applied to world points around the stable
  // bounds centre — equivalent to iOS rotating the rendered canvas.
  const stableSegs: [V2, V2][] = geom
    ? [...wallSegs, ...geom.walls.map((w) => [w.p1, w.p2] as [V2, V2])]
    : wallSegs;
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
  const wallSegsR = wallSegs.map(rSeg);
  const doorsR = doors.map((d) => ({ id: d.id, p1: rotW(d.p1), p2: rotW(d.p2) }));
  const windowsR = windows.map((w) => ({ p1: rotW(w.p1), p2: rotW(w.p2) }));

  const wallQuads = wallSegsR.map(([a, b]) => wallQuad(a, b));
  const cutQuads = [...doorsR, ...windowsR].map((o) => openingCut(o.p1, o.p2));

  const bounds = computeBounds(stableSegs.map(rSeg).flatMap(([a, b]) => wallQuad(a, b)))!;
  const spanX = Math.max(bounds.maxX - bounds.minX, 0.001);
  const spanZ = Math.max(bounds.maxZ - bounds.minZ, 0.001);
  const svgH = Math.max(240, Math.min(640, Math.round(SVG_W * (spanZ / spanX))));
  const aw = SVG_W - 2 * PADDING;
  const ah = svgH - 2 * PADDING;
  const s = Math.min(aw / spanX, ah / spanZ);
  const ox = PADDING + (aw - spanX * s) / 2;
  const oy = PADDING + (ah - spanZ * s) / 2;
  const proj = (x: number, z: number): [number, number] => [
    ox + (x - bounds.minX) * s,
    oy + (z - bounds.minZ) * s,
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
      cutQuads,
      windows: windowsR,
      doors: doorsR,
      doorConfigs: parseDoorConfigs(textData),
      interior: geom ? rotW(geom.interiorCentroid) : pivot,
      svgH,
      proj,
      pivot,
      rotW,
      centresByIndex,
      floorCentres: Object.values(geom?.floorCentresByID ?? {}),
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
  lang,
}: {
  model: LocalModel;
  legendEntries: LegendEntry[];
  lang: string;
}) {
  const maskId = useId();
  const { proj, svgH } = model;
  const toPts = (poly: V2[]) => poly.map((p) => proj(p[0], p[1]).join(",")).join(" ");

  // Numbered label positions — iOS resolveLabelWorldPositions + rotation.
  const numbers = legendEntries.map((e) => e.n);
  const positions = resolveLabelWorldPositions(
    numbers,
    model.pivot,
    model.centresByIndex,
    model.floorCentres,
    model.markers,
    model.offsets
  );
  const fontPx = Math.max(11, Math.min(28, Math.round(Math.min(SVG_W, svgH) / 28)));
  const circleR = (fontPx + 8) / 2;

  const halfT = WALL_THICKNESS / 2;

  return (
    <div className="relative">
    <svg viewBox={`0 0 ${SVG_W} ${svgH}`} className="block w-full h-auto max-h-[440px]" xmlns="http://www.w3.org/2000/svg">
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
            <line key={key} x1={x1} y1={y1} x2={x2} y2={y2} stroke={STROKE_COLOR} strokeWidth={width} strokeLinecap="butt" />
          );
        };
        return (
          <g key={`w${i}`}>
            {line(-halfT, DOOR_PANEL_WIDTH, "a")}
            {line(halfT, DOOR_PANEL_WIDTH, "b")}
            {line(0, DOOR_ARC_WIDTH, "g")}
          </g>
        );
      })}

      {/* Doors: jambs always; swing arc + panel + hinge when configured */}
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
            <line key={key} x1={x1} y1={y1} x2={x2} y2={y2} stroke={STROKE_COLOR} strokeWidth={STROKE_WIDTH} strokeLinecap="butt" />
          );
        };
        const cfg = model.doorConfigs[d.id];
        return (
          <g key={`d${i}`}>
            {jamb(d.p1, "j1")}
            {jamb(d.p2, "j2")}
            {doorSwingRenderable(cfg) && <DoorSwing door={d} cfg={cfg!} interior={model.interior} proj={proj} />}
          </g>
        );
      })}

      {/* Room labels: numbered circles (names live in the legend) */}
      {numbers.map((n) => {
        const pos = positions[n];
        if (!pos) return null;
        const rp = model.rotW(pos);
        const [sx, sy] = proj(rp[0], rp[1]);
        return (
          <g key={`rl${n}`}>
            <circle cx={sx} cy={sy} r={circleR} fill="rgba(255,255,255,0.9)" stroke="rgba(0,0,0,0.2)" strokeWidth={0.5} />
            <text
              x={sx}
              y={sy}
              textAnchor="middle"
              dominantBaseline="central"
              fill={LABEL_FILL}
              fontSize={fontPx}
              fontWeight={700}
              fontFamily="system-ui, -apple-system, sans-serif"
            >
              {n}
            </text>
          </g>
        );
      })}

    </svg>

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

    {/* Total floor area — anchored to the card's bottom-left */}
    {model.totalArea > 0 && (
      <p className="pointer-events-none absolute bottom-3 left-4 text-[14px] font-semibold" style={{ color: STROKE_COLOR }}>
        {t("floorplan.total", lang)} {model.totalArea.toFixed(1)} m²
      </p>
    )}
    </div>
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

  const hingeC = proj(p1[0], p1[1]);
  const panelEndC = proj(p1[0] + nx * len, p1[1] + nz * len);
  const arcEndC = proj(p2[0], p2[1]);

  return (
    <g>
      <path d={arcPathAround(hingeC, arcEndC, panelEndC)} fill="none" stroke={STROKE_COLOR} strokeWidth={DOOR_ARC_WIDTH} strokeLinecap="round" />
      <line x1={hingeC[0]} y1={hingeC[1]} x2={panelEndC[0]} y2={panelEndC[1]} stroke={STROKE_COLOR} strokeWidth={DOOR_PANEL_WIDTH} strokeLinecap="round" />
      <circle cx={hingeC[0]} cy={hingeC[1]} r={DOOR_HINGE_RADIUS} fill={STROKE_COLOR} />
    </g>
  );
}

// ── Backend mesh fallback (iOS FloorplanCanvas port) ─────────────────────────

function MeshPlan({
  data,
  legendEntries,
  lang,
}: {
  data: FloorplanRenderingData;
  legendEntries: LegendEntry[];
  lang: string;
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
    <svg viewBox={`0 0 ${SVG_W} ${svgH}`} className="block w-full h-auto max-h-[440px]" xmlns="http://www.w3.org/2000/svg">
      <rect width={SVG_W} height={svgH} fill="white" />

      {/* Windows: thin outlined faces */}
      {facePolys(layers.windows).map((p, i) => (
        <polygon key={`w${i}`} points={p} fill="none" stroke={MESH_INK} strokeWidth={1.2} />
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
            <path d={arcPathAround(hingeC, arcEndC, panelEndC)} fill="none" stroke={MESH_INK} strokeWidth={1.0} />
            <line x1={hingeC[0]} y1={hingeC[1]} x2={panelEndC[0]} y2={panelEndC[1]} stroke={MESH_INK} strokeWidth={1.8} strokeLinecap="round" />
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
                {room.floor_area.toFixed(1)} m²
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

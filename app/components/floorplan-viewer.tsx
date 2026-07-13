"use client";

/**
 * FloorplanViewer — renders floorplan from draft_data fields,
 * same data source as iOS FloorPlanView.swift.
 *
 * Data: wall_graph_json, floorplan_opening_edits_json, room_N_label
 * from DraftDataEntry[].
 */

import { useMemo, useEffect, useReducer } from "react";
import type { DraftDataEntry } from "../lib/tour-types";

interface Props {
  draftData: DraftDataEntry[];
  floorplanId?: number | null;
  lang: string;
}

// iOS constants
const WALL_THICKNESS = 0.18;
const STROKE_COLOR = "#111111";
const LABEL_FILL = "#4b5563";
const PADDING = 40;

// Wall quad (iOS wallQuad: 18cm thick filled rectangle)
function wallQuad(p1: number[], p2: number[]): number[][] {
  const dx = p2[0] - p1[0], dz = p2[1] - p1[1];
  const len = Math.max(Math.hypot(dx, dz), 1e-4);
  const nx = -dz / len, nz = dx / len, dirX = dx / len, dirZ = dz / len;
  const t = WALL_THICKNESS / 2;
  const ax = p1[0] - dirX * t, az = p1[1] - dirZ * t;
  const bx = p2[0] + dirX * t, bz = p2[1] + dirZ * t;
  return [[ax + nx * t, az + nz * t], [bx + nx * t, bz + nz * t], [bx - nx * t, bz - nz * t], [ax - nx * t, az - nz * t]];
}

// Opening cut quad (same as wall quad — punches through wall)
function openingCut(p1: number[], p2: number[]): number[][] {
  return wallQuad(p1, p2);
}

// Parse JSON from draft_data safely
function getDataValue(data: DraftDataEntry[], key: string): string | null {
  // Take latest entry for key (highest id)
  let best: DraftDataEntry | null = null;
  for (const d of data) {
    if (d.data_key === key && (!best || d.id > best.id)) best = d;
  }
  return best?.data_value ?? null;
}

function parseJSON(data: DraftDataEntry[], key: string): any {
  const val = getDataValue(data, key);
  if (!val) return null;
  try { return JSON.parse(val); } catch { return null; }
}

export default function FloorplanViewer({ draftData, floorplanId, lang }: Props) {
  // Fetch room data from rendering endpoint (for centers/labels)
  const [renderRooms, setRenderRooms] = useReducer((_: any[], a: any[]) => a, [] as any[]);
  useEffect(() => {
    if (!floorplanId) return;
    fetch(`/api/reaigen/floorplans/${floorplanId}/rendering/`, { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.rooms?.length) setRenderRooms(d.rooms); })
      .catch(() => {});
  }, [floorplanId]);

  const parsed = useMemo(() => {
    const wallGraph = parseJSON(draftData, "wall_graph_json");
    const openingEdits = parseJSON(draftData, "floorplan_opening_edits_json");

    // Room labels from room_N_label fields
    const roomLabels: { number: number; label: string }[] = [];
    for (const d of draftData) {
      const m = d.data_key.match(/^room_(\d+)_label$/);
      if (m && d.data_value) roomLabels.push({ number: parseInt(m[1]), label: d.data_value });
    }
    roomLabels.sort((a, b) => a.number - b.number);

    // Room centers from room_N_center_x/z
    const roomCenters: Record<number, [number, number]> = {};
    for (const d of draftData) {
      const mx = d.data_key.match(/^room_(\d+)_center_x$/);
      if (mx) {
        const n = parseInt(mx[1]);
        if (!roomCenters[n]) roomCenters[n] = [0, 0];
        roomCenters[n][0] = parseFloat(d.data_value) || 0;
      }
      const mz = d.data_key.match(/^room_(\d+)_center_z$/);
      if (mz) {
        const n = parseInt(mz[1]);
        if (!roomCenters[n]) roomCenters[n] = [0, 0];
        roomCenters[n][1] = parseFloat(d.data_value) || 0;
      }
    }

    // Label offsets
    const labelOffsets: Record<number, [number, number]> = {};
    for (const d of draftData) {
      const mx = d.data_key.match(/^room_(\d+)_label_offset_x$/);
      if (mx) {
        const n = parseInt(mx[1]);
        if (!labelOffsets[n]) labelOffsets[n] = [0, 0];
        labelOffsets[n][0] = parseFloat(d.data_value) || 0;
      }
      const mz = d.data_key.match(/^room_(\d+)_label_offset_z$/);
      if (mz) {
        const n = parseInt(mz[1]);
        if (!labelOffsets[n]) labelOffsets[n] = [0, 0];
        labelOffsets[n][1] = parseFloat(d.data_value) || 0;
      }
    }

    // Custom openings
    const customOpenings: { kind: string; p1: number[]; p2: number[] }[] = [];
    if (openingEdits) {
      const list = openingEdits.customOpenings ?? openingEdits.custom_openings ?? [];
      for (const op of list) {
        if (op.p1 && op.p2) customOpenings.push({ kind: op.kind ?? "door", p1: op.p1, p2: op.p2 });
      }
    }

    return { wallGraph, roomLabels, roomCenters, labelOffsets, customOpenings };
  }, [draftData]);

  const { wallGraph, roomLabels, roomCenters, labelOffsets, customOpenings } = parsed;

  if (!wallGraph?.vertices?.length || !wallGraph?.edges?.length) return null;

  // Build wall quads
  const wallPolygons: number[][][] = [];
  for (const edge of wallGraph.edges) {
    const a = wallGraph.vertices[edge.a];
    const b = wallGraph.vertices[edge.b];
    if (a && b) wallPolygons.push(wallQuad(a, b));
  }

  // Build opening cuts + symbols
  const doorCuts: number[][][] = [];
  const windowData: { cut: number[][]; p1: number[]; p2: number[] }[] = [];
  for (const op of customOpenings) {
    if (op.kind === "window") {
      windowData.push({ cut: openingCut(op.p1, op.p2), p1: op.p1, p2: op.p2 });
    } else {
      doorCuts.push(openingCut(op.p1, op.p2));
    }
  }

  // Bounds
  const allPts: number[][] = [];
  for (const poly of wallPolygons) allPts.push(...poly);
  if (allPts.length < 2) return null;

  const xs = allPts.map(p => p[0]), zs = allPts.map(p => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minZ = Math.min(...zs), maxZ = Math.max(...zs);
  const spanX = Math.max(maxX - minX, 0.001), spanZ = Math.max(maxZ - minZ, 0.001);
  const svgW = 400;
  const svgH = Math.round(svgW * (spanZ / spanX));
  const aw = svgW - 2 * PADDING, ah = svgH - 2 * PADDING;
  const s = Math.min(aw / spanX, ah / spanZ);
  const ox = PADDING + (aw - spanX * s) / 2;
  const oy = PADDING + (ah - spanZ * s) / 2;
  const proj = (x: number, z: number) => `${ox + (x - minX) * s},${oy + (z - minZ) * s}`;
  const projXY = (x: number, z: number): [number, number] => [ox + (x - minX) * s, oy + (z - minZ) * s];

  return (
    <div className="rounded-xl border border-border/40 bg-white overflow-hidden">
      <svg viewBox={`0 0 ${svgW} ${svgH}`} className="w-full block" xmlns="http://www.w3.org/2000/svg">
        <rect width={svgW} height={svgH} fill="white" />

        {/* Walls — filled black quads */}
        {wallPolygons.map((poly, i) => (
          <polygon key={`w${i}`} points={poly.map(p => proj(p[0], p[1])).join(" ")} fill={STROKE_COLOR} />
        ))}

        {/* Door cuts — white erase + jamb lines */}
        {doorCuts.map((poly, i) => (
          <polygon key={`dc${i}`} points={poly.map(p => proj(p[0], p[1])).join(" ")} fill="white" />
        ))}
        {customOpenings.filter(o => o.kind !== "window").map((op, i) => {
          const dx = op.p2[0] - op.p1[0], dz = op.p2[1] - op.p1[1];
          const len = Math.max(Math.hypot(dx, dz), 1e-4);
          const nx = -dz / len, nz = dx / len;
          const ht = WALL_THICKNESS / 2;
          const [j1ax, j1ay] = projXY(op.p1[0] + nx * ht, op.p1[1] + nz * ht);
          const [j1bx, j1by] = projXY(op.p1[0] - nx * ht, op.p1[1] - nz * ht);
          const [j2ax, j2ay] = projXY(op.p2[0] + nx * ht, op.p2[1] + nz * ht);
          const [j2bx, j2by] = projXY(op.p2[0] - nx * ht, op.p2[1] - nz * ht);
          return (
            <g key={`dj${i}`}>
              <line x1={j1ax} y1={j1ay} x2={j1bx} y2={j1by} stroke={STROKE_COLOR} strokeWidth={2.2} strokeLinecap="butt" />
              <line x1={j2ax} y1={j2ay} x2={j2bx} y2={j2by} stroke={STROKE_COLOR} strokeWidth={2.2} strokeLinecap="butt" />
            </g>
          );
        })}

        {/* Window cuts — white erase + 3-line symbol */}
        {windowData.map((w, i) => {
          const dx = w.p2[0] - w.p1[0], dz = w.p2[1] - w.p1[1];
          const len = Math.max(Math.hypot(dx, dz), 1e-4);
          const nx = -dz / len, nz = dx / len;
          const ht = WALL_THICKNESS / 2;
          const [x1, y1] = projXY(w.p1[0], w.p1[1]);
          const [x2, y2] = projXY(w.p2[0], w.p2[1]);
          const [a1x, a1y] = projXY(w.p1[0] + nx * ht, w.p1[1] + nz * ht);
          const [a2x, a2y] = projXY(w.p2[0] + nx * ht, w.p2[1] + nz * ht);
          const [b1x, b1y] = projXY(w.p1[0] - nx * ht, w.p1[1] - nz * ht);
          const [b2x, b2y] = projXY(w.p2[0] - nx * ht, w.p2[1] - nz * ht);
          return (
            <g key={`wc${i}`}>
              <polygon points={w.cut.map(p => proj(p[0], p[1])).join(" ")} fill="white" />
              <line x1={a1x} y1={a1y} x2={a2x} y2={a2y} stroke={STROKE_COLOR} strokeWidth={1.6} strokeLinecap="butt" />
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={STROKE_COLOR} strokeWidth={1.0} strokeLinecap="butt" />
              <line x1={b1x} y1={b1y} x2={b2x} y2={b2y} stroke={STROKE_COLOR} strokeWidth={1.6} strokeLinecap="butt" />
            </g>
          );
        })}

        {/* Room labels — numbered white circles */}
        {/* From draft_data room_N_center fields */}
        {roomLabels.map((room) => {
          const center = roomCenters[room.number];
          if (!center) return null;
          const off = labelOffsets[room.number] ?? [0, 0];
          const [sx, sy] = projXY(center[0] + off[0], center[1] + off[1]);
          return (
            <g key={`rl${room.number}`}>
              <circle cx={sx} cy={sy} r={12} fill="rgba(255,255,255,0.92)" stroke="rgba(0,0,0,0.1)" strokeWidth={0.5} />
              <text x={sx} y={sy} textAnchor="middle" dominantBaseline="central" fill={LABEL_FILL} fontSize={10} fontWeight={700} fontFamily="system-ui, -apple-system, sans-serif">{room.number}</text>
            </g>
          );
        })}
        {/* From rendering endpoint rooms (fallback when draft_data has no centers) */}
        {roomLabels.length === 0 && renderRooms.map((room: any, idx: number) => {
          const cx = room.center?.[0], cz = room.center?.[1];
          if (cx == null || cz == null) return null;
          const [sx, sy] = projXY(cx + (room.label_offset_x ?? 0), cz + (room.label_offset_z ?? 0));
          return (
            <g key={`rr${room.id}`}>
              <circle cx={sx} cy={sy} r={12} fill="rgba(255,255,255,0.92)" stroke="rgba(0,0,0,0.1)" strokeWidth={0.5} />
              <text x={sx} y={sy} textAnchor="middle" dominantBaseline="central" fill={LABEL_FILL} fontSize={10} fontWeight={700} fontFamily="system-ui, -apple-system, sans-serif">{idx + 1}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

"use client";

import { useState } from "react";
import type { RoomData } from "@/app/lib/tour-types";

interface Props {
  floorplanUrl: string;
  rooms: RoomData[];
  onRoomClick: (room: RoomData) => void;
  activeRoomId?: number | null;
}

export default function FloorplanNav({ floorplanUrl, rooms, onRoomClick, activeRoomId }: Props) {
  const [expanded, setExpanded] = useState(false);

  // Find bounds for normalizing room coordinates to SVG viewport
  const allPoints = rooms.flatMap((r) => r.boundary_points ?? []);
  if (!allPoints.length) return null;

  const xs = allPoints.map((p) => p[0]);
  const zs = allPoints.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);
  const rangeX = maxX - minX || 1;
  const rangeZ = maxZ - minZ || 1;

  const svgW = 300;
  const svgH = svgW * (rangeZ / rangeX);
  const pad = 10;

  function toSvg(x: number, z: number): [number, number] {
    return [
      pad + ((x - minX) / rangeX) * (svgW - 2 * pad),
      pad + ((z - minZ) / rangeZ) * (svgH - 2 * pad),
    ];
  }

  return (
    <div className="absolute bottom-20 left-4 z-20">
      <button
        onClick={() => setExpanded(!expanded)}
        className="mb-2 bg-background/80 backdrop-blur-md rounded-xl px-3 py-2 text-xs font-medium shadow-lg border border-border/50 hover:bg-accent transition-colors"
      >
        {expanded ? "Hide Floorplan" : "Floorplan"}
      </button>

      {expanded && (
        <div className="bg-background/90 backdrop-blur-md rounded-2xl shadow-xl border border-border/50 p-3 relative">
          {/* Floorplan image as background */}
          <div className="relative" style={{ width: svgW, height: svgH }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={floorplanUrl}
              alt="Floorplan"
              className="absolute inset-0 w-full h-full object-contain rounded-xl opacity-30"
            />
            <svg
              width={svgW}
              height={svgH}
              className="absolute inset-0"
              viewBox={`0 0 ${svgW} ${svgH}`}
            >
              {rooms.map((room) => {
                const pts = room.boundary_points;
                if (!pts?.length) return null;
                const svgPts = pts.map(([x, z]) => toSvg(x, z));
                const pointsStr = svgPts.map(([x, z]) => `${x},${z}`).join(" ");
                const isActive = activeRoomId === room.id;

                // Center for label
                const cx = room.center_x != null ? toSvg(room.center_x, room.center_z!)[0] : svgPts.reduce((s, p) => s + p[0], 0) / svgPts.length;
                const cz = room.center_x != null ? toSvg(room.center_x, room.center_z!)[1] : svgPts.reduce((s, p) => s + p[1], 0) / svgPts.length;

                return (
                  <g key={room.id} onClick={() => onRoomClick(room)} className="cursor-pointer">
                    <polygon
                      points={pointsStr}
                      fill={isActive ? "hsl(var(--primary) / 0.3)" : "hsl(var(--muted) / 0.2)"}
                      stroke={isActive ? "hsl(var(--primary))" : "hsl(var(--border))"}
                      strokeWidth={isActive ? 2 : 1}
                      className="transition-all duration-200 hover:fill-[hsl(var(--primary)/0.2)]"
                    />
                    <text
                      x={cx}
                      y={cz}
                      textAnchor="middle"
                      dominantBaseline="central"
                      className="text-[9px] fill-foreground font-medium pointer-events-none select-none"
                    >
                      {room.label}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
        </div>
      )}
    </div>
  );
}

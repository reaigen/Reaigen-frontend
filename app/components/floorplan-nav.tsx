"use client";

import { useState } from "react";
import type { RoomData } from "@/app/lib/tour-types";
import { t } from "@/app/lib/i18n";

interface Props {
  floorplanUrl: string;
  rooms: RoomData[];
  onRoomClick: (room: RoomData) => void;
  activeRoomId?: number | null;
  lang?: string;
}

export default function FloorplanNav({ floorplanUrl, rooms, onRoomClick, activeRoomId, lang = "en" }: Props) {
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

  const svgW = typeof window !== "undefined" && window.innerWidth < 640 ? Math.min(240, window.innerWidth - 40) : 300;
  const svgH = svgW * (rangeZ / rangeX);
  const pad = 10;

  function toSvg(x: number, z: number): [number, number] {
    return [
      pad + ((x - minX) / rangeX) * (svgW - 2 * pad),
      pad + ((z - minZ) / rangeZ) * (svgH - 2 * pad),
    ];
  }

  return (
    <div className="absolute bottom-20 left-3 z-20 animate-fade-in sm:left-4">
      <button
        onClick={() => setExpanded(!expanded)}
        className={`mb-2 flex items-center gap-1.5 rounded-full border border-white/10 bg-black/75 px-3 py-2 text-xs font-medium text-white/80 shadow-lg transition-all hover:bg-black/85 hover:text-white ${expanded ? "bg-black/85" : ""}`}
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" className={`transition-transform duration-200 ${expanded ? "rotate-45" : ""}`}>
          <rect x="2" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.5" />
          <rect x="9" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.5" />
          <rect x="2" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.5" />
          <rect x="9" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.5" />
        </svg>
        {expanded ? t("tour.floorplan.close", lang) : t("tour.floorplan.open", lang)}
      </button>

      {expanded && (
        <div className="max-w-[calc(100vw-1.5rem)] animate-fade-in-up rounded-2xl border border-white/10 bg-black/80 p-3 shadow-2xl sm:max-w-none">
          {/* Floorplan image as background */}
          <div className="relative" style={{ width: svgW, height: svgH }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={floorplanUrl}
              alt={t("tour.floorplan.alt", lang)}
              loading="lazy"
              decoding="async"
              className="absolute inset-0 w-full h-full object-contain rounded-xl opacity-20 invert"
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
                      fill={isActive ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.08)"}
                      stroke={isActive ? "rgba(255,255,255,0.8)" : "rgba(255,255,255,0.3)"}
                      strokeWidth={isActive ? 2 : 1}
                      className="transition-all duration-200 hover:fill-[rgba(255,255,255,0.15)]"
                    />
                    <text
                      x={cx}
                      y={cz}
                      textAnchor="middle"
                      dominantBaseline="central"
                      className="text-[9px] fill-white/80 font-medium pointer-events-none select-none"
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

"use client";

import { useState } from "react";
import type { RoomData } from "@/app/lib/tour-types";
import { t } from "@/app/lib/i18n";
import { cn } from "@/app/lib/utils";
import { FloorplanIcon } from "@/app/components/icons";

interface Props {
  floorplanUrl: string;
  rooms: RoomData[];
  onRoomClick: (room: RoomData) => void;
  activeRoomId?: number | null;
  lang?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export default function FloorplanNav({ floorplanUrl, rooms, onRoomClick, activeRoomId, lang = "en", open, onOpenChange }: Props) {
  const [internalExpanded, setInternalExpanded] = useState(false);
  const expanded = open ?? internalExpanded;
  const setExpanded = (next: boolean) => {
    if (open == null) setInternalExpanded(next);
    onOpenChange?.(next);
  };

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

  // Render against one stable coordinate system and let CSS scale it on phones.
  // This keeps server and client markup identical while preserving room hit areas.
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
    <div className="absolute bottom-[calc(4.75rem+env(safe-area-inset-bottom,0px))] left-3 z-20 animate-fade-in sm:bottom-20 sm:left-auto sm:right-4">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className={cn(
          "mb-2 flex min-h-11 items-center gap-1.5 rounded-full border border-white/10 px-3 py-2 text-xs font-medium text-white/80 shadow-lg transition-colors hover:bg-black/85 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70",
          expanded ? "bg-black/85" : "bg-black/75",
        )}
      >
        <FloorplanIcon size={12} />
        {expanded ? t("tour.floorplan.close", lang) : t("tour.floorplan.open", lang)}
      </button>

      {expanded && (
        <div className="max-h-[48dvh] max-w-[calc(100vw-1.5rem)] animate-fade-in-up overflow-auto rounded-2xl border border-white/10 bg-black/70 p-3 shadow-2xl backdrop-blur-2xl sm:max-w-none">
          {/* Floorplan image as background */}
          <div className="relative w-[min(300px,calc(100vw-3rem))]" style={{ aspectRatio: `${svgW} / ${svgH}` }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={floorplanUrl}
              alt={t("tour.floorplan.alt", lang)}
              loading="lazy"
              decoding="async"
              className="absolute inset-0 w-full h-full object-contain rounded-xl opacity-20 invert"
            />
            <svg
              width="100%"
              height="100%"
              className="absolute inset-0 h-full w-full"
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

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
  const hasRoomGeometry = allPoints.length > 0;

  const xs = allPoints.map((p) => p[0]);
  const zs = allPoints.map((p) => p[1]);
  const minX = hasRoomGeometry ? Math.min(...xs) : 0;
  const maxX = hasRoomGeometry ? Math.max(...xs) : 1;
  const minZ = hasRoomGeometry ? Math.min(...zs) : 0;
  const maxZ = hasRoomGeometry ? Math.max(...zs) : 0.75;
  const rangeX = maxX - minX || 1;
  const rangeZ = maxZ - minZ || 1;

  // Render against one stable coordinate system and let CSS scale it on phones.
  // This keeps server and client markup identical while preserving room hit areas.
  const svgW = 300;
  const svgH = hasRoomGeometry ? svgW * (rangeZ / rangeX) : 225;
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
          "floating-control mb-2 flex items-center gap-1.5 border border-border/60 bg-card/90 px-3 text-xs font-semibold text-foreground/70 shadow-elevated backdrop-blur-2xl transition-colors hover:bg-card hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
          expanded && "bg-card text-foreground",
        )}
      >
        <FloorplanIcon size={12} />
        {expanded ? t("tour.floorplan.close", lang) : t("tour.floorplan.open", lang)}
      </button>

      {expanded && (
        <div className="floating-panel max-h-[48dvh] max-w-[calc(100vw-1.5rem)] animate-fade-in-up overflow-auto border border-border/60 bg-card/[0.92] p-3 shadow-elevated backdrop-blur-2xl sm:max-w-none">
          {/* Floorplan image as background */}
          <div className="relative w-[min(300px,calc(100vw-3rem))]" style={{ aspectRatio: `${svgW} / ${svgH}` }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={floorplanUrl}
              alt={t("tour.floorplan.alt", lang)}
              loading="lazy"
              decoding="async"
              className={cn(
                "absolute inset-0 h-full w-full rounded-xl object-contain",
                hasRoomGeometry ? "opacity-70" : "opacity-100",
              )}
            />
            {hasRoomGeometry ? (
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
                        fill={isActive ? "rgba(0,0,0,0.14)" : "rgba(0,0,0,0.035)"}
                        stroke={isActive ? "rgba(0,0,0,0.72)" : "rgba(0,0,0,0.25)"}
                        strokeWidth={isActive ? 2 : 1}
                        className="transition-all duration-200 hover:fill-[rgba(0,0,0,0.08)]"
                      />
                      <text
                        x={cx}
                        y={cz}
                        textAnchor="middle"
                        dominantBaseline="central"
                        className="pointer-events-none select-none fill-foreground/75 text-[9px] font-semibold"
                      >
                        {room.label}
                      </text>
                    </g>
                  );
                })}
              </svg>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

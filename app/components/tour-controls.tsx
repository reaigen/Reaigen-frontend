"use client";

import type { TourShot } from "@/app/lib/tour-types";
import { Button } from "@/app/lib/ui/button";

interface Props {
  shots: TourShot[];
  currentIdx: number;
  onGoToShot: (idx: number) => void;
  onPrev: () => void;
  onNext: () => void;
}

export default function TourControls({ shots, currentIdx, onGoToShot, onPrev, onNext }: Props) {
  if (!shots.length) return null;

  return (
    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 bg-background/80 backdrop-blur-md rounded-2xl px-3 py-2 shadow-lg border border-border/50">
      <Button variant="ghost" size="icon-sm" onClick={onPrev} aria-label="Previous shot">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M10 12L6 8L10 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </Button>

      <div className="flex items-center gap-1 overflow-x-auto max-w-[400px] scrollbar-hide">
        {shots.map((shot, i) => (
          <button
            key={i}
            onClick={() => onGoToShot(i)}
            className={`flex-shrink-0 px-2.5 py-1 rounded-lg text-xs font-medium transition-all duration-200 ${
              i === currentIdx
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:text-foreground hover:bg-accent"
            }`}
          >
            {shot.label || `Shot ${i + 1}`}
          </button>
        ))}
      </div>

      <Button variant="ghost" size="icon-sm" onClick={onNext} aria-label="Next shot">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M6 4L10 8L6 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </Button>
    </div>
  );
}

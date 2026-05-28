"use client";

import type { TourShot } from "@/app/lib/tour-types";

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
    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 animate-fade-in-up">
      <div className="flex items-center gap-1.5 bg-black/60 backdrop-blur-xl rounded-full px-2 py-1.5 shadow-2xl border border-white/10">
        <button onClick={onPrev} className="p-1.5 rounded-full text-white/70 hover:text-white hover:bg-white/10 transition-colors" aria-label="Previous shot">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M10 12L6 8L10 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        <div className="flex items-center gap-0.5 px-1">
          {shots.map((_, i) => (
            <button
              key={i}
              onClick={() => onGoToShot(i)}
              className={`rounded-full transition-all duration-300 ${
                i === currentIdx
                  ? "w-5 h-2 bg-white"
                  : "w-2 h-2 bg-white/40 hover:bg-white/70"
              }`}
              aria-label={shots[i].label || `Shot ${i + 1}`}
            />
          ))}
        </div>

        <button onClick={onNext} className="p-1.5 rounded-full text-white/70 hover:text-white hover:bg-white/10 transition-colors" aria-label="Next shot">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M6 4L10 8L6 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        {/* Shot label */}
        <div className="pl-1.5 pr-2.5 border-l border-white/15">
          <span className="text-[11px] text-white/70 font-medium whitespace-nowrap">
            {shots[currentIdx]?.label || `Shot ${currentIdx + 1}`}
          </span>
        </div>
      </div>
    </div>
  );
}

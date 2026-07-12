"use client";

import type { TourShot } from "@/app/lib/tour-types";
import { t } from "@/app/lib/i18n";

interface Props {
  shots: TourShot[];
  currentIdx: number;
  onGoToShot: (idx: number) => void;
  onPrev: () => void;
  onNext: () => void;
  lang?: string;
}

export default function TourControls({ shots, currentIdx, onGoToShot, onPrev, onNext, lang = "en" }: Props) {
  if (!shots.length) return null;

  return (
    <div className="absolute bottom-4 left-1/2 z-20 w-[calc(100%-1rem)] max-w-[calc(100%-1rem)] -translate-x-1/2 animate-fade-in-up sm:bottom-6 sm:w-auto sm:max-w-[calc(100%-2rem)]">
      <div className="flex items-center justify-center gap-1.5 rounded-full border border-white/10 bg-black/75 px-2 py-1.5 shadow-2xl">
        <button onClick={onPrev} className="p-1.5 rounded-full text-white/70 hover:text-white hover:bg-white/10 transition-colors" aria-label={t("tour.controls.previousShot", lang)}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M10 12L6 8L10 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        <div className="flex max-w-[52vw] items-center gap-0.5 overflow-x-auto px-1 scrollbar-hide sm:max-w-none">
          {shots.map((_, i) => (
            <button
              key={i}
              onClick={() => onGoToShot(i)}
              className={`rounded-full transition-all duration-300 ${
                i === currentIdx
                  ? "w-5 h-2 bg-white"
                  : "w-2 h-2 bg-white/40 hover:bg-white/70"
              }`}
              aria-label={shots[i].label || `${t("tour.controls.shot", lang)} ${i + 1}`}
            />
          ))}
        </div>

        <button onClick={onNext} className="p-1.5 rounded-full text-white/70 hover:text-white hover:bg-white/10 transition-colors" aria-label={t("tour.controls.nextShot", lang)}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M6 4L10 8L6 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        {/* Shot label */}
        <div className="pl-1.5 pr-2.5 border-l border-white/15 hidden sm:block">
          <span className="text-[11px] text-white/70 font-medium whitespace-nowrap">
            {shots[currentIdx]?.label || `${t("tour.controls.shot", lang)} ${currentIdx + 1}`}
          </span>
        </div>
      </div>
    </div>
  );
}

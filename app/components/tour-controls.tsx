"use client";

import type { TourShot } from "@/app/lib/tour-types";
import { t } from "@/app/lib/i18n";
import { ArrowLeftIcon, ArrowRightIcon } from "./icons";

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
    <div className="absolute bottom-[calc(1rem+env(safe-area-inset-bottom,0px))] left-1/2 z-20 w-[calc(100%-1rem)] max-w-[calc(100%-1rem)] -translate-x-1/2 animate-fade-in-up sm:bottom-[calc(1.5rem+env(safe-area-inset-bottom,0px))] sm:w-auto sm:max-w-[calc(100%-2rem)]">
      <div className="flex items-center justify-center gap-1 rounded-full border border-white/10 bg-black/75 px-1.5 py-1.5 shadow-2xl sm:gap-1.5 sm:px-2">
        <button type="button" onClick={onPrev} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white/70 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 sm:h-8 sm:w-8" aria-label={t("tour.controls.previousShot", lang)}>
          <ArrowLeftIcon size={14} />
        </button>

        <div className="flex max-w-[calc(100vw-8rem)] items-center overflow-x-auto scrollbar-hide sm:max-w-[42vw] lg:max-w-[50vw]">
          {shots.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onGoToShot(i)}
              className="group flex h-11 min-w-8 items-center justify-center rounded-full px-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 sm:h-8 sm:min-w-6"
              aria-label={shots[i].label || `${t("tour.controls.shot", lang)} ${i + 1}`}
              aria-current={i === currentIdx ? "true" : undefined}
            >
              <span className={`h-2 rounded-full transition-all duration-300 ${i === currentIdx ? "w-5 bg-white" : "w-2 bg-white/40 group-hover:bg-white/70"}`} />
            </button>
          ))}
        </div>

        <button type="button" onClick={onNext} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white/70 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 sm:h-8 sm:w-8" aria-label={t("tour.controls.nextShot", lang)}>
          <ArrowRightIcon size={14} />
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

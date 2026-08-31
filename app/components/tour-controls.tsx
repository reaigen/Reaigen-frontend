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
  // Match the native viewer: a single camera needs no persistent navigation.
  if (shots.length <= 1) return null;

  return (
    <div className="absolute bottom-[calc(0.75rem+env(safe-area-inset-bottom,0px))] left-1/2 z-20 max-w-[calc(100%-1rem)] -translate-x-1/2 animate-fade-in-up sm:bottom-[calc(1.5rem+env(safe-area-inset-bottom,0px))] sm:max-w-[calc(100%-2rem)]">
      <div className="floating-toolbar-shape flex w-fit max-w-full items-center justify-center gap-1 border border-white/[0.16] bg-black/60 p-1 shadow-2xl backdrop-blur-2xl">
        <button type="button" onClick={onPrev} className="floating-icon-button flex shrink-0 items-center justify-center text-white/70 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70" aria-label={t("tour.controls.previousShot", lang)}>
          <ArrowLeftIcon size={14} />
        </button>

        <div className="min-w-0 px-2 text-center sm:hidden">
          <span className="block max-w-[9rem] truncate text-[11px] font-medium text-white/80">
            {shots[currentIdx]?.label || `${t("tour.controls.shot", lang)} ${currentIdx + 1}`}
          </span>
          <span className="block text-[10px] tabular-nums text-white/45">{currentIdx + 1} / {shots.length}</span>
        </div>

        <div className="hidden max-w-[42vw] items-center overflow-x-auto scrollbar-hide sm:flex lg:max-w-[50vw]">
          {shots.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onGoToShot(i)}
              className="group flex h-[var(--floating-control)] min-w-8 items-center justify-center rounded-full px-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
              aria-label={shots[i].label || `${t("tour.controls.shot", lang)} ${i + 1}`}
              aria-current={i === currentIdx ? "true" : undefined}
            >
              <span className={`h-2 rounded-full transition-all duration-300 ${i === currentIdx ? "w-5 bg-white" : "w-2 bg-white/40 group-hover:bg-white/70"}`} />
            </button>
          ))}
        </div>

        <button type="button" onClick={onNext} className="floating-icon-button flex shrink-0 items-center justify-center text-white/70 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70" aria-label={t("tour.controls.nextShot", lang)}>
          <ArrowRightIcon size={14} />
        </button>

        {/* Shot label */}
        <div className="hidden border-l border-white/15 pl-1.5 pr-2.5 sm:block">
          <span className="text-[11px] text-white/70 font-medium whitespace-nowrap">
            {shots[currentIdx]?.label || `${t("tour.controls.shot", lang)} ${currentIdx + 1}`}
          </span>
        </div>
      </div>
    </div>
  );
}

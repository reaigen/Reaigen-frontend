"use client";

import * as React from "react";

import { cn } from "../lib/utils";

function formatTime(value: number) {
  if (!Number.isFinite(value) || value < 0) return "0:00";
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60);
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function PlayerGlyph({ kind }: { kind: "play" | "pause" | "sound" | "muted" | "expand" }) {
  if (kind === "play") return <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="m6 4 8 5-8 5V4Z" fill="currentColor" /></svg>;
  if (kind === "pause") return <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="M5.5 4.5v9M12.5 4.5v9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>;
  if (kind === "expand") return <svg width="17" height="17" viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="M7 3.5H3.5V7M11 3.5h3.5V7M14.5 11v3.5H11M7 14.5H3.5V11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
  return <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="M3.5 7h2L9 4v10l-3.5-3h-2V7Z" fill="currentColor" /><path d={kind === "muted" ? "m12 7 3 4m0-4-3 4" : "M12 6.3c1.5 1.5 1.5 3.9 0 5.4"} stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>;
}

export function GlassVideoPlayer({ src, ariaLabel, className }: { src: string; ariaLabel: string; className?: string }) {
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = React.useState(false);
  const [muted, setMuted] = React.useState(false);
  const [currentTime, setCurrentTime] = React.useState(0);
  const [duration, setDuration] = React.useState(0);

  React.useEffect(() => {
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);
  }, [src]);

  const togglePlayback = async () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) await video.play();
    else video.pause();
  };

  const toggleFullscreen = async () => {
    const root = rootRef.current;
    if (!root) return;
    if (document.fullscreenElement) await document.exitFullscreen();
    else if (root.requestFullscreen) await root.requestFullscreen();
    else {
      const mobileVideo = videoRef.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
      mobileVideo?.webkitEnterFullscreen?.();
    }
  };

  return (
    <div
      ref={rootRef}
      className={cn("group/video relative h-full min-h-0 w-full overflow-hidden bg-[#111]", className)}
      onKeyDown={(event) => {
        if (event.key === " " || event.key === "Enter") {
          event.preventDefault();
          void togglePlayback();
        }
      }}
    >
      <video
        ref={videoRef}
        key={src}
        src={src}
        playsInline
        preload="metadata"
        aria-label={ariaLabel}
        className="h-full w-full object-cover"
        onClick={() => { void togglePlayback(); }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(event) => {
          const nextTime = event.currentTarget.currentTime;
          setCurrentTime(nextTime);
        }}
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
        onDurationChange={(event) => setDuration(event.currentTarget.duration)}
      />

      {!playing ? (
        <button
          type="button"
          onClick={() => { void togglePlayback(); }}
          className="floating-icon-button pen-touch-target absolute left-1/2 top-1/2 z-10 h-14 w-14 -translate-x-1/2 -translate-y-1/2 border border-white/55 bg-white/88 text-black shadow-[inset_0_1px_0_rgba(255,255,255,.7),0_14px_38px_rgba(0,0,0,.24)] backdrop-blur-xl transition-[transform,background-color] hover:scale-[1.04] hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 sm:h-16 sm:w-16"
          aria-label="Play"
        >
          <PlayerGlyph kind="play" />
        </button>
      ) : null}

      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-black/58 via-black/18 to-transparent" />
      <div className={cn(
        "absolute inset-x-3 bottom-3 z-10 flex h-12 items-center gap-1.5 rounded-full border border-white/20 bg-black/42 px-1.5 text-white shadow-[inset_0_1px_0_rgba(255,255,255,.14),0_10px_30px_rgba(0,0,0,.2)] backdrop-blur-xl transition-opacity duration-200 sm:gap-2 sm:px-2",
        playing ? "opacity-0 group-hover/video:opacity-100 group-focus-within/video:opacity-100" : "opacity-100",
      )}>
        <button type="button" onClick={() => { void togglePlayback(); }} className="floating-icon-button h-9 w-9 shrink-0 text-white/94 hover:bg-white/14 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70" aria-label={playing ? "Pause" : "Play"}>
          <PlayerGlyph kind={playing ? "pause" : "play"} />
        </button>
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.01}
          value={Math.min(currentTime, duration || 0)}
          onChange={(event) => {
            const next = Number(event.target.value);
            if (videoRef.current) videoRef.current.currentTime = next;
            setCurrentTime(next);
          }}
          aria-label="Video progress"
          className="reai-video-progress min-w-0 flex-1"
          style={{ "--video-progress": `${duration > 0 ? (currentTime / duration) * 100 : 0}%` } as React.CSSProperties}
        />
        <span className="shrink-0 text-[10px] font-medium tabular-nums text-white/78 sm:text-[11px]">
          {formatTime(currentTime)}<span className="hidden min-[390px]:inline"> / {formatTime(duration)}</span>
        </span>
        <button type="button" onClick={() => {
          const next = !muted;
          setMuted(next);
          if (videoRef.current) videoRef.current.muted = next;
        }} className="floating-icon-button h-9 w-9 shrink-0 text-white/88 hover:bg-white/12 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70" aria-label={muted ? "Unmute" : "Mute"}>
          <PlayerGlyph kind={muted ? "muted" : "sound"} />
        </button>
        <button type="button" onClick={() => { void toggleFullscreen(); }} className="floating-icon-button h-9 w-9 shrink-0 text-white/88 hover:bg-white/12 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70" aria-label="Fullscreen">
          <PlayerGlyph kind="expand" />
        </button>
      </div>
    </div>
  );
}

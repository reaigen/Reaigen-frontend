export default function Loading() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-3">
        <span
          className="text-[28px] text-foreground/80"
          style={{ fontFamily: "var(--font-brand), ui-serif, Georgia, serif", fontWeight: 400, letterSpacing: "0.01em" }}
        >
          Reaigen
        </span>
        <div className="h-0.5 w-12 rounded-full bg-foreground/10 overflow-hidden">
          <div className="h-full w-1/2 rounded-full bg-foreground/40 animate-[shimmer-bar_1.2s_ease-in-out_infinite]" />
        </div>
      </div>
    </div>
  );
}

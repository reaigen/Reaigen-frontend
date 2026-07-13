export default function Loading() {
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-4">
        <span
          className="text-[30px] text-foreground/80"
          style={{ fontFamily: "var(--font-brand), ui-serif, Georgia, serif", fontWeight: 400, letterSpacing: "0.01em" }}
        >
          Reaigen
        </span>
        <div className="h-[3px] w-16 rounded-full bg-foreground/10 overflow-hidden">
          <div className="h-full w-1/2 rounded-full bg-foreground/40 animate-[shimmer-bar_1.2s_ease-in-out_infinite]" />
        </div>
      </div>
    </div>
  );
}

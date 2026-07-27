export function PageLoading({ className }: { className?: string }) {
  return (
    <div className={className ?? "fixed inset-0 flex items-center justify-center bg-background"}>
      <div className="flex flex-col items-center gap-5 animate-fade-in">
        <span
          className="text-[29px] text-foreground/85"
          style={{ fontFamily: "var(--font-brand), ui-serif, Georgia, serif", fontWeight: 400, letterSpacing: "0.01em" }}
        >
          Reaigen
        </span>
        <div
          className="loading-progress-track w-28"
          role="progressbar"
          aria-label="Loading"
        >
          <span className="loading-progress-indeterminate" />
        </div>
      </div>
    </div>
  );
}

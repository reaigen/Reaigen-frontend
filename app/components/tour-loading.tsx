"use client";

interface Props {
  status: string;
  downloadPct?: number;
}

export default function TourLoading({ status, downloadPct }: Props) {
  return (
    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-white">
      <div className="w-10 h-10 border-2 border-foreground/20 border-t-foreground rounded-full animate-spin mb-4" />
      <span className="text-sm text-muted-foreground">{status}</span>
      {downloadPct != null && downloadPct > 0 && downloadPct < 100 && (
        <div className="mt-3 w-56 h-1.5 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full bg-foreground/60 rounded-full transition-all duration-200"
            style={{ width: `${downloadPct}%` }}
          />
        </div>
      )}
    </div>
  );
}

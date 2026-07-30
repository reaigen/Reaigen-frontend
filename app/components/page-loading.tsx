import { ReaigenLoadingMark } from "./reaigen-loading-mark";

export function PageLoading({ className }: { className?: string }) {
  return (
    <div className={className ?? "fixed inset-0 flex items-center justify-center bg-background"}>
      <ReaigenLoadingMark className="animate-fade-in" />
    </div>
  );
}

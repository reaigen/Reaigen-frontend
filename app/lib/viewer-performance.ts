export type ViewerPerformanceProfile = "quality" | "balanced";

/**
 * Choose one stable canvas density for the viewer session.
 *
 * The balanced delivery profile keeps HTML controls at native resolution but
 * bounds the expensive WebGL backbuffer. It is intended for public tours,
 * where a million-Gaussian scene must remain responsive on Retina/HiDPI
 * displays. Authoring retains its existing precision-oriented budget.
 */
export function viewerRenderDpr(
  deviceDpr: number,
  viewportWidth: number,
  viewportHeight: number,
  compactTouch: boolean,
  authoring: boolean,
  profile: ViewerPerformanceProfile = "quality",
): number {
  const safeDeviceDpr = Number.isFinite(deviceDpr)
    ? Math.max(1, deviceDpr)
    : 1;
  const cssPixels = Math.max(
    1,
    Math.max(1, viewportWidth) * Math.max(1, viewportHeight),
  );

  let maxDpr: number;
  let pixelBudget: number;
  if (authoring) {
    maxDpr = compactTouch ? 1.75 : 2.5;
    pixelBudget = compactTouch ? 3_000_000 : 8_000_000;
  } else if (profile === "balanced") {
    maxDpr = compactTouch ? 1.75 : 2;
    pixelBudget = compactTouch ? 2_250_000 : 4_500_000;
  } else {
    maxDpr = compactTouch ? 2.25 : 2.5;
    pixelBudget = compactTouch ? 3_500_000 : 9_000_000;
  }

  const budgetDpr = Math.sqrt(pixelBudget / cssPixels);
  return Math.max(1, Math.min(safeDeviceDpr, maxDpr, budgetDpr));
}

/**
 * Return the updated motion-frame clock when a frame is due, otherwise null.
 *
 * Babylon schedules its loop from requestAnimationFrame, so a 120 Hz display
 * otherwise asks the Gaussian renderer to sort and draw twice as often as a
 * normal display. The accumulator avoids drift and still produces an even
 * 60-fps cadence on 90/120 Hz panels.
 */
export function nextViewerMotionFrameTimestamp(
  previousTimestamp: number | null,
  now: number,
  profile: ViewerPerformanceProfile = "quality",
): number | null {
  if (!Number.isFinite(now)) return null;
  if (profile === "quality") return now;
  if (previousTimestamp == null || !Number.isFinite(previousTimestamp)) {
    return now;
  }

  const interval = 1000 / 60;
  const elapsed = now - previousTimestamp;
  // Allow a small rAF scheduling tolerance without opening the cap to 120 Hz.
  if (elapsed < interval - 0.5) return null;
  if (elapsed > interval * 4 || elapsed < 0) return now;

  const completedIntervals = Math.max(1, Math.floor(elapsed / interval));
  return previousTimestamp + completedIntervals * interval;
}

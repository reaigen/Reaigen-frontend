/**
 * Hold a viewer's reveal until its Gaussian engine has put splats on screen.
 *
 * "Loaded" is not "visible": the first draws after a scene upload can be
 * refused while a WebGL2 backend links its programs, and on WebGPU the first
 * presented frames run before the projection counters report anything.
 * Revealing on "loaded" faded the loading surface over an empty canvas — the
 * dark backdrop showed for a few frames and then the room appeared, the black
 * blink at the start of every tour. This draws a frame at a time until the
 * engine reports Gaussians on screen for a few consecutive frames, and gives
 * up after a bounded wait so a backend without counters still reveals.
 */
export interface ContentFrameProbe {
  /** Draw one frame. May throw while the backend is not ready; the next frame retries. */
  draw(): void;
  /**
   * The engine's frame counter and how many Gaussians its last frame
   * projected. `overflow` is a frame that hit the projected capacity and
   * dropped splats — whole regions can be missing from it; `selection` is the
   * share of the scene the engine is drawing, which its settle loop adjusts
   * from 1 down to what the capacity allows over the first readbacks, each
   * change resetting the accumulated image. Neither frame is the picture the
   * viewer should meet.
   */
  stats(): { frame: number; projectedSplats: number; overflow?: boolean; selection?: number };
  requestFrame(callback: () => void): void;
  now(): number;
  aborted?: () => boolean;
}

export interface ContentFrameOptions {
  /** Upper bound on the wait, in milliseconds. */
  timeoutMs?: number;
  /** Consecutive frames that must show content before the reveal. */
  contentFrames?: number;
}

export type ContentFrameOutcome = "painted" | "timeout" | "aborted";

export function waitForFirstContentFrame(
  probe: ContentFrameProbe,
  options: ContentFrameOptions = {},
): Promise<ContentFrameOutcome> {
  const timeoutMs = options.timeoutMs ?? 2500;
  const needed = Math.max(1, Math.floor(options.contentFrames ?? 6));
  return new Promise((resolve) => {
    const startedAt = probe.now();
    const startFrame = probe.stats().frame;
    let painted = 0;
    let selection: number | undefined;
    const step = () => {
      if (probe.aborted?.()) {
        resolve("aborted");
        return;
      }
      try {
        probe.draw();
      } catch {
        // The backend refused this draw; the next frame retries.
      }
      const stats = probe.stats();
      const resampled = stats.selection !== undefined && selection !== undefined && stats.selection !== selection;
      selection = stats.selection;
      const settled = stats.frame > startFrame && stats.projectedSplats > 0 && !stats.overflow && !resampled;
      painted = settled ? painted + 1 : 0;
      if (painted >= needed) {
        resolve("painted");
        return;
      }
      if (probe.now() - startedAt >= timeoutMs) {
        resolve("timeout");
        return;
      }
      probe.requestFrame(step);
    };
    step();
  });
}

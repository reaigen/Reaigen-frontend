/**
 * Babylon sorts Gaussian splats on a worker. The worker accepts only one
 * request at a time, so a dense scene can finish and apply an ordering for a
 * camera pose that is already several frames old. The geometry then appears
 * to jump around an otherwise smooth camera.
 *
 * Keep the last coherent ordering while the camera is moving and request one
 * exact sort after the pose has remained still for a short settle window.
 */

export interface AsyncGaussianSortMesh {
  viewUpdateThreshold: number;
  _canPostToWorker?: boolean;
  _sortIsDirty?: boolean;
  _postToWorker?: (forced?: boolean) => void;
}

export class GaussianSortMotionController {
  private readonly originalThresholds = new Map<AsyncGaussianSortMesh, number>();
  private readonly settleMilliseconds: number;
  private settleAt = Number.POSITIVE_INFINITY;

  constructor(settleMilliseconds = 120) {
    this.settleMilliseconds = settleMilliseconds;
  }

  get active() {
    return this.originalThresholds.size > 0;
  }

  markMoving(meshes: Iterable<AsyncGaussianSortMesh>, now: number) {
    if (!Number.isFinite(now)) return;
    for (const mesh of meshes) {
      if (!mesh || !Number.isFinite(mesh.viewUpdateThreshold)) continue;
      if (!this.originalThresholds.has(mesh)) {
        this.originalThresholds.set(mesh, mesh.viewUpdateThreshold);
      }
      mesh.viewUpdateThreshold = Number.POSITIVE_INFINITY;
    }
    if (this.active) {
      this.settleAt = now + Math.max(0, this.settleMilliseconds);
    }
  }

  /** Restore normal sorting once and force the final camera pose to sort. */
  settle(now: number) {
    if (!this.active || !Number.isFinite(now) || now < this.settleAt) return false;
    const locked = [...this.originalThresholds.entries()];
    this.originalThresholds.clear();
    this.settleAt = Number.POSITIVE_INFINITY;

    for (const [mesh, threshold] of locked) {
      mesh.viewUpdateThreshold = threshold;
      // If a pre-motion worker request is still in flight, Babylon cannot
      // accept the forced request yet. Marking the sort dirty makes its
      // completion handler immediately request this final pose instead.
      mesh._sortIsDirty = mesh._canPostToWorker === false;
      mesh._postToWorker?.(true);
    }
    return true;
  }

  /** Restore thresholds during viewer teardown without starting new work. */
  dispose() {
    for (const [mesh, threshold] of this.originalThresholds) {
      mesh.viewUpdateThreshold = threshold;
    }
    this.originalThresholds.clear();
    this.settleAt = Number.POSITIVE_INFINITY;
  }
}

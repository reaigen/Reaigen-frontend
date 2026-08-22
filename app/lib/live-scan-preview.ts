import type { LiveSplatPreview } from "./api/client";

/**
 * Keep preview publication monotonic without treating a stable gauge as a
 * frozen point cloud. Forming previews can grow many times inside one gauge,
 * and rollout workers may advance the source sequence within one epoch.
 */
export function newestLiveSplatPreview(
  current: LiveSplatPreview | null,
  incoming: LiveSplatPreview,
): LiveSplatPreview {
  if (!current) return incoming;

  const currentGauge = current.gauge_revision ?? 0;
  const incomingGauge = incoming.gauge_revision ?? 0;
  if (incomingGauge !== currentGauge) {
    return incomingGauge > currentGauge ? incoming : current;
  }
  if (incoming.epoch !== current.epoch) {
    return incoming.epoch > current.epoch ? incoming : current;
  }
  const currentSource = current.source_sequence ?? 0;
  const incomingSource = incoming.source_sequence ?? 0;
  if (incomingSource !== currentSource) {
    return incomingSource > currentSource ? incoming : current;
  }

  const incomingIsNewerStage = incoming.refined && !current.refined;
  const geometryChanged = (
    incoming.point_count !== current.point_count
    || incoming.camera_count !== current.camera_count
  );
  const inlineTransportChanged = (
    incoming.inline_ply_sha256 !== current.inline_ply_sha256
    || incoming.durable_ply_ready !== current.durable_ply_ready
  );
  return incomingIsNewerStage || geometryChanged || inlineTransportChanged
    ? incoming
    : current;
}

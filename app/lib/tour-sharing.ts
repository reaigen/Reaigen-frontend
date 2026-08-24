import type {
  DraftTourAsset,
  DraftTourAssetsPayload,
} from "./tour-types";

/**
 * Sharing follows the tour product lifecycle, not the reconstruction upload
 * row. Web-authored tours can be fully deliverable while their source splat
 * no longer matches the legacy upload-status heuristic.
 */
export function isTourReadyToShare(asset: DraftTourAsset): boolean {
  if (asset.source_splat_id == null) return false;
  if (asset.lifecycle) {
    return asset.lifecycle.can_publish || (
      asset.lifecycle.can_preview
      && asset.lifecycle.preview_targets.includes("web")
    );
  }
  return Boolean(
    asset.latest_delivery_version
      && asset.latest_delivery_version.publication_status !== "failed",
  );
}

export function selectShareableTour(
  data: DraftTourAssetsPayload | null,
  preferredSplatId?: number | null,
): DraftTourAsset | null {
  const ready = (data?.assets ?? []).filter(isTourReadyToShare);
  if (ready.length === 0) return null;

  if (preferredSplatId != null) {
    const preferred = ready.find(
      (asset) => asset.source_splat_id === preferredSplatId,
    );
    if (preferred) return preferred;
  }

  const publishedPrimaryId = data?.publication?.entries.find(
    (entry) => entry.is_primary && entry.targets.includes("web"),
  )?.tour_id;

  return (
    ready.find((asset) => asset.id === publishedPrimaryId)
    ?? ready.find((asset) => asset.publication.is_primary)
    ?? ready[0]
  );
}

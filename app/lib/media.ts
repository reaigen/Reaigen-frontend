import type { DraftUpload } from "./tour-types";

export type GalleryMediaKind = "image" | "video";

function matchesKind(upload: DraftUpload, kind: GalleryMediaKind) {
  const mime = (upload.mime_type || "").toLowerCase();
  if (kind === "video") return mime.startsWith("video/");
  return mime.startsWith("image/") || upload.asset_type === "photo" || upload.asset_type === "processed_image";
}

function uploadedAt(upload: DraftUpload) {
  const timestamp = Date.parse(upload.uploaded_at || "");
  return Number.isFinite(timestamp) ? timestamp : Number.POSITIVE_INFINITY;
}

/**
 * Resolve the client filename from the first physical version of a logical
 * asset. Processed versions often have generated storage names, which should
 * never replace the name people recognize in the gallery.
 */
export function originalMediaFileName(
  versions: readonly DraftUpload[],
  fallback = "",
) {
  const authoritative = versions.find((upload) => upload.original_file_name?.trim())
    ?.original_file_name
    ?.trim();
  if (authoritative) return authoritative;

  const ordered = [...versions].sort((left, right) => {
    const leftIsRoot = left.supersedes == null && left.source_upload_id == null ? 0 : 1;
    const rightIsRoot = right.supersedes == null && right.source_upload_id == null ? 0 : 1;
    if (leftIsRoot !== rightIsRoot) return leftIsRoot - rightIsRoot;

    const leftVersion = Number.isFinite(left.version) ? Number(left.version) : Number.POSITIVE_INFINITY;
    const rightVersion = Number.isFinite(right.version) ? Number(right.version) : Number.POSITIVE_INFINITY;
    if (leftVersion !== rightVersion) return leftVersion - rightVersion;

    return uploadedAt(left) - uploadedAt(right)
      || left.id - right.id;
  });
  return ordered.find((upload) => upload.file_name?.trim())?.file_name.trim()
    || fallback.trim();
}

export function mediaDisplayName(upload: DraftUpload) {
  return upload.original_file_name?.trim() || upload.file_name?.trim() || "";
}

/**
 * Collapse physical upload versions into the current logical gallery assets.
 * Owner, inventory, and sharing previews must all tell the same media story.
 */
export function currentGalleryUploads(uploads: DraftUpload[] | null | undefined, kind: GalleryMediaKind) {
  const grouped = new Map<string, DraftUpload[]>();
  for (const upload of uploads ?? []) {
    if (!matchesKind(upload, kind)) continue;
    const key = upload.logical_asset_id || `upload-${upload.id}`;
    grouped.set(key, [...(grouped.get(key) ?? []), upload]);
  }
  return [...grouped.values()]
    .map((versions): DraftUpload | null => {
      const current = versions.find((upload) => upload.is_master !== false && !upload.is_deleted);
      if (!current || current.is_gallery_visible === false) return null;
      return {
        ...current,
        original_file_name: originalMediaFileName(versions, current.file_name),
      };
    })
    .filter((upload): upload is DraftUpload => Boolean(upload?.file_url))
    .sort((left, right) => left.sort_order - right.sort_order || left.id - right.id);
}

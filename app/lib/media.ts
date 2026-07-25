import type { DraftUpload } from "./tour-types";

export type GalleryMediaKind = "image" | "video";

function matchesKind(upload: DraftUpload, kind: GalleryMediaKind) {
  const mime = (upload.mime_type || "").toLowerCase();
  if (kind === "video") return mime.startsWith("video/");
  return mime.startsWith("image/") || upload.asset_type === "photo" || upload.asset_type === "processed_image";
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
    .map((versions) => versions.find((upload) => upload.is_master !== false && !upload.is_deleted))
    .filter((upload): upload is DraftUpload => Boolean(upload?.file_url))
    .sort((left, right) => left.sort_order - right.sort_order || left.id - right.id);
}

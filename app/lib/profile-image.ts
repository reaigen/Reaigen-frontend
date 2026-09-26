import type { LocaleKey } from "./locales";

/**
 * Profile photo and cover uploads.
 *
 * The web used to PUT the file straight to a presigned S3 URL. The workspace
 * bucket carries no CORS rule, so the browser refused the request and the
 * creator saw a bare "Failed to fetch" (Bench 06 B06-F02/EF04). The file now
 * goes through our own API (multipart `file` to /profiles/upload-avatar/ and
 * /upload-cover/), which stores it and answers like confirm-avatar did.
 *
 * The API route runs behind a serverless body limit, so a large photo is
 * scaled down here first: nobody needs more than 2048 px for an avatar or a
 * cover, and a phone photo shrinks from several megabytes to a few hundred
 * kilobytes. HEIC cannot be decoded by most browsers; it is sent as it is and
 * the server converts it.
 */

export const PROFILE_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"] as const;
export const PROFILE_IMAGE_ACCEPT = PROFILE_IMAGE_TYPES.join(",");
/** What the server accepts. */
export const PROFILE_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
/** What the upload route can carry in one request. */
export const PROFILE_IMAGE_UPLOAD_MAX_BYTES = 4 * 1024 * 1024;
export const PROFILE_IMAGE_MAX_EDGE = 2048;

export type ProfileImageProblem = "image_unsupported" | "image_too_large" | "image_missing" | "failed";

export class ProfileImageError extends Error {
  readonly problem: ProfileImageProblem;

  constructor(problem: ProfileImageProblem) {
    super(problem);
    this.problem = problem;
    this.name = "ProfileImageError";
  }
}

const PROBLEM_KEYS: Record<ProfileImageProblem, LocaleKey> = {
  image_unsupported: "settings.profile.imageUnsupported",
  image_too_large: "settings.profile.imageTooLarge",
  image_missing: "settings.profile.imageMissing",
  failed: "settings.profile.imageFailed",
};

export function profileImageProblemKey(problem: ProfileImageProblem): LocaleKey {
  return PROBLEM_KEYS[problem];
}

function extensionType(name: string): string {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  return ({ jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic", heif: "image/heif" } as Record<string, string>)[ext] ?? "";
}

/** The file's image type, trusting the extension when the browser gives none (HEIC on Chrome). */
export function profileImageType(file: { name: string; type: string }): string {
  const type = (file.type || extensionType(file.name)).toLowerCase();
  return type === "image/jpg" ? "image/jpeg" : type;
}

export function isSupportedProfileImage(file: { name: string; type: string }): boolean {
  return (PROFILE_IMAGE_TYPES as readonly string[]).includes(profileImageType(file));
}

/** Size a longest edge down to the limit, keeping the aspect ratio. */
export function scaledProfileImageSize(width: number, height: number, maxEdge = PROFILE_IMAGE_MAX_EDGE) {
  const longest = Math.max(width, height);
  if (longest <= maxEdge || longest <= 0) return { width, height, scaled: false };
  const factor = maxEdge / longest;
  return { width: Math.max(1, Math.round(width * factor)), height: Math.max(1, Math.round(height * factor)), scaled: true };
}

function renamed(name: string, type: string): string {
  const base = name.replace(/\.[^.]+$/, "") || "photo";
  return `${base}.${type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg"}`;
}

/**
 * Validate a chosen file and scale it down when it is larger than the
 * upload needs. Throws ProfileImageError for a type or size the server
 * would refuse, so the creator hears why before anything is sent.
 */
export async function prepareProfileImage(file: File): Promise<File> {
  if (!isSupportedProfileImage(file)) throw new ProfileImageError("image_unsupported");
  if (file.size > PROFILE_IMAGE_MAX_BYTES) throw new ProfileImageError("image_too_large");
  const type = profileImageType(file);
  if (type === "image/heic" || type === "image/heif") {
    if (file.size > PROFILE_IMAGE_UPLOAD_MAX_BYTES) throw new ProfileImageError("image_too_large");
    return file;
  }
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") {
    if (file.size > PROFILE_IMAGE_UPLOAD_MAX_BYTES) throw new ProfileImageError("image_too_large");
    return file;
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new ProfileImageError("image_unsupported");
  }
  try {
    const size = scaledProfileImageSize(bitmap.width, bitmap.height);
    if (!size.scaled && file.size <= PROFILE_IMAGE_UPLOAD_MAX_BYTES) return file;
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d");
    if (!context) throw new ProfileImageError("failed");
    context.drawImage(bitmap, 0, 0, size.width, size.height);
    // PNG keeps its transparency as WebP; everything else becomes JPEG.
    const outType = type === "image/png" || type === "image/webp" ? "image/webp" : "image/jpeg";
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, outType, 0.88));
    if (!blob) throw new ProfileImageError("failed");
    if (blob.size > PROFILE_IMAGE_UPLOAD_MAX_BYTES) throw new ProfileImageError("image_too_large");
    return new File([blob], renamed(file.name, blob.type || outType), { type: blob.type || outType });
  } finally {
    bitmap.close();
  }
}

const SERVER_PROBLEMS = new Set<ProfileImageProblem>(["image_unsupported", "image_too_large", "image_missing"]);

/** The problem a refused upload names, from its error code or a 413. */
export function profileImageProblemFromResponse(status: number, code: string | null): ProfileImageProblem | null {
  if (status === 413) return "image_too_large";
  return code && SERVER_PROBLEMS.has(code as ProfileImageProblem) ? code as ProfileImageProblem : null;
}

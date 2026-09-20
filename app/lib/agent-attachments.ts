export type AgentAttachmentKind = "image" | "document" | "video";
export type AgentDocumentReadFailure = "unsupported" | "too_large" | "encrypted" | "no_text" | "too_many_pages" | "unreadable" | "request_failed";
export type AgentDocumentReadState = { status: "extracted" } | { status: "evidence_only"; reason: AgentDocumentReadFailure };

export type AgentAttachmentDescriptor = {
  name: string;
  content_type: string;
  size: number;
  kind: AgentAttachmentKind;
  analysis?: AgentDocumentReadState;
};

const FILE_TYPES: Record<string, { contentType: string; kind: AgentAttachmentKind }> = {
  jpg: { contentType: "image/jpeg", kind: "image" },
  jpeg: { contentType: "image/jpeg", kind: "image" },
  png: { contentType: "image/png", kind: "image" },
  webp: { contentType: "image/webp", kind: "image" },
  heic: { contentType: "image/heic", kind: "image" },
  heif: { contentType: "image/heif", kind: "image" },
  tif: { contentType: "image/tiff", kind: "image" },
  tiff: { contentType: "image/tiff", kind: "image" },
  bmp: { contentType: "image/bmp", kind: "image" },
  pdf: { contentType: "application/pdf", kind: "document" },
  txt: { contentType: "text/plain", kind: "document" },
  csv: { contentType: "text/csv", kind: "document" },
  docx: { contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", kind: "document" },
  xlsx: { contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", kind: "document" },
  pptx: { contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", kind: "document" },
  mp4: { contentType: "video/mp4", kind: "video" },
  mov: { contentType: "video/quicktime", kind: "video" },
  avi: { contentType: "video/x-msvideo", kind: "video" },
};

export const AGENT_ATTACHMENT_ACCEPT = Object.keys(FILE_TYPES).map((extension) => `.${extension}`).join(",");
export const MAX_AGENT_ATTACHMENTS = 24;
// Leave space for multipart headers below Vercel's 4.5 MB function-body cap.
// Larger originals remain private evidence; do not send a doomed intake POST.
export const MAX_AGENT_INLINE_DOCUMENT_BYTES = 4_000_000;

export function documentIntakeBlock(file: Pick<File, "name" | "size">): AgentDocumentReadFailure | null {
  if (!/\.(pdf|txt)$/i.test(file.name)) return "unsupported";
  return file.size > MAX_AGENT_INLINE_DOCUMENT_BYTES ? "too_large" : null;
}

export function documentReadState(intake: { status: string; reason?: string | null }): AgentDocumentReadState {
  if (intake.status === "extracted") return { status: "extracted" };
  const reasons: AgentDocumentReadFailure[] = ["unsupported", "too_large", "encrypted", "no_text", "too_many_pages", "unreadable", "request_failed"];
  return { status: "evidence_only", reason: reasons.find((reason) => reason === intake.reason) ?? "unreadable" };
}

/** Metadata only; this never claims to have read the file's contents. */
export function describeAgentAttachment(file: Pick<File, "name" | "type" | "size">): AgentAttachmentDescriptor | null {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const type = FILE_TYPES[extension];
  if (!type || !Number.isSafeInteger(file.size) || file.size <= 0 || file.size > 10 * 1024 ** 3) return null;
  if (type.kind === "document" && file.size > 25 * 1024 ** 2) return null;
  const contentType = file.type.toLowerCase().split(";")[0].trim();
  if (contentType && contentType !== "application/octet-stream"
    && contentType !== type.contentType
    && !(extension === "csv" && contentType === "application/vnd.ms-excel")
    && !(["docx", "xlsx", "pptx"].includes(extension) && ["application/zip", "application/x-zip-compressed"].includes(contentType))
    && !(type.kind === "image" && ["image/jpg", "image/x-ms-bmp"].includes(contentType))) return null;
  return { name: file.name.slice(0, 255), content_type: type.contentType, size: file.size, kind: type.kind };
}

export function pendingAttachmentDescriptors(files: readonly File[], analyses?: ReadonlyMap<File, AgentDocumentReadState>): AgentAttachmentDescriptor[] {
  return files.flatMap((file) => {
    const descriptor = describeAgentAttachment(file);
    return descriptor ? [{ ...descriptor, ...(descriptor.kind === "document" && analyses?.has(file) ? { analysis: analyses.get(file) } : {}) }] : [];
  }).slice(0, MAX_AGENT_ATTACHMENTS);
}

export function pendingImageCount(files: readonly File[]): number {
  return pendingAttachmentDescriptors(files).filter((file) => file.kind === "image").length;
}

/** Successful files leave the queue; failures and new drops remain available. */
export function remainingAgentAttachments<T>(current: readonly T[], attempted: readonly T[], failed: readonly T[]): T[] {
  return current.filter((file) => !attempted.includes(file) || failed.includes(file));
}

import { NextRequest, NextResponse } from "next/server";
import { ACCESS_COOKIE_NAME } from "../../lib/server/auth-cookies";
import { fetchBackend } from "../../lib/server/backend-fetch";

/**
 * Same-origin image bytes for the photo editor.
 *
 * Owner media is served from a host that sends no `Access-Control-Allow-Origin`,
 * so drawing it into a canvas taints the canvas and `getImageData` throws. The
 * editor needs those pixels: auto-white-balance is a gray-world average and
 * auto-enhance is a histogram stretch, and neither can be computed from a
 * CSS filter. Serving the bytes from our own origin makes the canvas readable.
 *
 * The caller passes an *upload id*, never a URL. Accepting a URL would turn this
 * into an open SSRF probe against everything the Next server can reach, and the
 * Django origin is not directly reachable from the internet — the proxies are
 * the only thing in front of it (see `lib/server/proxy-path.ts` for the same
 * reasoning applied to path segments). Resolving the URL from the backend with
 * the caller's own bearer token also means the backend enforces authorization:
 * an id the caller cannot see comes back 401/403/404 before any fetch happens.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BACKEND_URL = process.env.REAIGEN_BACKEND_URL ?? "http://localhost:8000";
const MAX_IMAGE_BYTES = 40 * 1024 * 1024;
/** Longest edge `?max=` may ask for. Above this, send the original untouched. */
const MAX_PREVIEW_EDGE = 2048;

/**
 * Shrink to `maxEdge` before the bytes cross the network, or return null and let
 * the caller send the original.
 *
 * The editor decodes to a 1400px working copy no matter what arrives, so on a
 * phone the full-resolution download — several megabytes of detail thrown away
 * on arrival — was pure latency before any control could do anything. Every
 * failure path here is non-fatal on purpose: a missing codec or an image sharp
 * cannot read must degrade to today's behaviour, never to a broken editor.
 */
async function downscale(
  bytes: ArrayBuffer,
  maxEdge: number,
): Promise<{ body: Buffer; contentType: string } | null> {
  try {
    const { default: sharp } = await import("sharp");
    const input = Buffer.from(bytes);
    const metadata = await sharp(input).metadata();
    const longest = Math.max(metadata.width ?? 0, metadata.height ?? 0);
    if (!longest || longest <= maxEdge) return null;
    const body = await sharp(input)
      // Bake in EXIF orientation: the resized output carries no orientation tag,
      // and a browser would otherwise render it rotated against the original.
      .rotate()
      .resize({ width: maxEdge, height: maxEdge, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 90 })
      .toBuffer();
    return { body, contentType: "image/webp" };
  } catch {
    return null;
  }
}

function requestedMaxEdge(raw: string | null): number | null {
  if (!raw || !/^[0-9]{2,4}$/.test(raw)) return null;
  const value = Number(raw);
  return value > 0 && value <= MAX_PREVIEW_EDGE ? value : null;
}

function backendCandidates(): string[] {
  const configured = BACKEND_URL.replace(/\/+$/, "");
  const candidates = [configured];
  try {
    const url = new URL(configured);
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
      const current = url.port || (url.protocol === "https:" ? "443" : "80");
      for (const port of [80, 8000]) {
        if (String(port) !== current) candidates.push(`${url.protocol}//${url.hostname}:${port}`);
      }
    }
  } catch {
    // Keep the configured URL only when it is not parseable.
  }
  return [...new Set(candidates)];
}

function headersFor(contentType: string) {
  return {
    "Content-Type": contentType,
    "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate",
    "Cross-Origin-Resource-Policy": "same-origin",
    "X-Content-Type-Options": "nosniff",
  };
}

function fail(status: number, detail: string) {
  return NextResponse.json({ detail }, { status, headers: headersFor("application/json") });
}

export async function GET(req: NextRequest) {
  const uploadId = req.nextUrl.searchParams.get("upload");
  if (!uploadId || !/^[0-9]{1,18}$/.test(uploadId)) {
    return fail(400, "A numeric upload id is required.");
  }

  const accessToken = req.cookies.get(ACCESS_COOKIE_NAME)?.value;
  if (!accessToken) return fail(401, "Authentication required.");

  const authHeaders = {
    Authorization: `Bearer ${accessToken}`,
    "X-Reaigen-Client": "web",
  };

  let fileUrl: string | null = null;
  for (const baseUrl of backendCandidates()) {
    try {
      const metaResponse = await fetchBackend(
        `${baseUrl}/api/v1/reaigen/uploads/${uploadId}/`,
        { headers: authHeaders, cache: "no-store" },
      );
      if (!metaResponse.ok) {
        // Surface the backend's own authorization verdict rather than masking it.
        if (metaResponse.status === 401 || metaResponse.status === 403 || metaResponse.status === 404) {
          return fail(metaResponse.status, "Upload is not available.");
        }
        continue;
      }
      const meta = await metaResponse.json();
      if (typeof meta?.file_url === "string" && meta.file_url) fileUrl = meta.file_url;
      break;
    } catch {
      // Try the next candidate origin.
    }
  }

  if (!fileUrl) return fail(502, "Could not resolve the upload.");

  // The value came from our own backend, but validate the scheme anyway so a
  // malformed record can never make us fetch a `file:`/`data:` target.
  let target: URL;
  try {
    target = new URL(fileUrl);
  } catch {
    return fail(502, "Upload has an unusable location.");
  }
  if (target.protocol !== "https:" && target.protocol !== "http:") {
    return fail(502, "Upload has an unsupported scheme.");
  }

  let imageResponse: Response;
  try {
    imageResponse = await fetchBackend(target.toString(), { cache: "no-store" });
  } catch {
    return fail(504, "Upstream media did not respond.");
  }
  if (!imageResponse.ok) return fail(502, "Upstream media returned an error.");

  const contentType = imageResponse.headers.get("Content-Type") ?? "";
  if (!contentType.toLowerCase().startsWith("image/")) {
    return fail(415, "Upload is not an image.");
  }

  const declared = Number(imageResponse.headers.get("Content-Length") ?? "");
  if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) {
    return fail(413, "Image is too large to preview.");
  }

  const bytes = await imageResponse.arrayBuffer();
  if (bytes.byteLength > MAX_IMAGE_BYTES) return fail(413, "Image is too large to preview.");

  const maxEdge = requestedMaxEdge(req.nextUrl.searchParams.get("max"));
  const reduced = maxEdge === null ? null : await downscale(bytes, maxEdge);
  if (reduced) {
    return new NextResponse(new Uint8Array(reduced.body), {
      status: 200,
      headers: headersFor(reduced.contentType),
    });
  }

  return new NextResponse(bytes, { status: 200, headers: headersFor(contentType) });
}

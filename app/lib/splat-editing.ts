import type { Vec3 } from "./tour-types";

export type SplatSelectionTool = "none" | "brush" | "lasso" | "box";
export type SplatSelectionOperation = "replace" | "add" | "subtract";

export interface SplatSelectionStats {
  total: number;
  selected: number;
  remaining: number;
  pruned: number;
  dirty: boolean;
}

export interface SplatPruneMask {
  schema: "com.reaigen.splat-prune-mask";
  version: 1;
  encoding: "removed-bitset-base64";
  point_count: number;
  removed_count: number;
  base_asset_fingerprint: string;
  data: string;
  mask_sha256?: string;
}

export interface PackedSplatData {
  buffer: ArrayBuffer;
  sh?: Uint8Array[];
  shDegree?: number;
}

const SPLAT_ROW_BYTES = 32;
const SH_C0 = 0.28209479177387814;

export function countMask(mask: Uint8Array): number {
  let count = 0;
  for (let index = 0; index < mask.length; index += 1) count += mask[index] ? 1 : 0;
  return count;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function encodeSplatPruneMask(
  alive: Uint8Array,
  baseAssetFingerprint: string,
): SplatPruneMask | null {
  const removedCount = alive.length - countMask(alive);
  if (removedCount < 1) return null;
  const removed = new Uint8Array(Math.ceil(alive.length / 8));
  for (let index = 0; index < alive.length; index += 1) {
    if (!alive[index]) removed[index >> 3] |= 1 << (index & 7);
  }
  return {
    schema: "com.reaigen.splat-prune-mask",
    version: 1,
    encoding: "removed-bitset-base64",
    point_count: alive.length,
    removed_count: removedCount,
    base_asset_fingerprint: baseAssetFingerprint,
    data: bytesToBase64(removed),
  };
}

export function decodeSplatPruneMask(
  value: SplatPruneMask | null | undefined,
  pointCount: number,
): Uint8Array | null {
  if (
    !value
    || value.schema !== "com.reaigen.splat-prune-mask"
    || value.version !== 1
    || value.encoding !== "removed-bitset-base64"
    || value.point_count !== pointCount
  ) return null;
  try {
    const removed = base64ToBytes(value.data);
    if (removed.length !== Math.ceil(pointCount / 8)) return null;
    const alive = new Uint8Array(pointCount);
    let removedCount = 0;
    for (let index = 0; index < pointCount; index += 1) {
      const isRemoved = Boolean(removed[index >> 3] & (1 << (index & 7)));
      alive[index] = isRemoved ? 0 : 1;
      if (isRemoved) removedCount += 1;
    }
    return removedCount === value.removed_count ? alive : null;
  } catch {
    return null;
  }
}

export function splatMasksEqual(
  left: Uint8Array | null,
  right: Uint8Array | null,
): boolean {
  if (left === right) return true;
  if (!left || !right || left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

export function filterPackedSplats(
  source: PackedSplatData,
  alive: Uint8Array,
): PackedSplatData {
  const sourceCount = Math.floor(source.buffer.byteLength / SPLAT_ROW_BYTES);
  if (alive.length !== sourceCount) throw new Error("Splat edit mask does not match the source.");
  const keptCount = countMask(alive);
  const output = new Uint8Array(keptCount * SPLAT_ROW_BYTES);
  const input = new Uint8Array(source.buffer);
  let destinationIndex = 0;
  for (let sourceIndex = 0; sourceIndex < sourceCount; sourceIndex += 1) {
    if (!alive[sourceIndex]) continue;
    output.set(
      input.subarray(sourceIndex * SPLAT_ROW_BYTES, (sourceIndex + 1) * SPLAT_ROW_BYTES),
      destinationIndex * SPLAT_ROW_BYTES,
    );
    destinationIndex += 1;
  }

  const sh = source.sh?.map((sourceTexture) => {
    const target = new Uint8Array(keptCount * 16);
    let targetIndex = 0;
    for (let sourceIndex = 0; sourceIndex < sourceCount; sourceIndex += 1) {
      if (!alive[sourceIndex]) continue;
      target.set(
        sourceTexture.subarray(sourceIndex * 16, sourceIndex * 16 + 16),
        targetIndex * 16,
      );
      targetIndex += 1;
    }
    return target;
  });
  return { buffer: output.buffer, sh, shDegree: source.shDegree };
}

function shDimension(degree: number): number {
  if (degree === 1) return 3;
  if (degree === 2) return 8;
  if (degree === 3) return 15;
  if (degree === 4) return 24;
  return 0;
}

function packedShValue(
  sh: Uint8Array[] | undefined,
  splatIndex: number,
  internalIndex: number,
): number {
  if (!sh?.length) return 0;
  const textureIndex = Math.floor(internalIndex / 16);
  const componentIndex = internalIndex % 16;
  const value = sh[textureIndex]?.[splatIndex * 16 + componentIndex] ?? 128;
  return value / 127.5 - 1;
}

/**
 * Encode Babylon's 32-byte packed rows as binary little-endian Gaussian PLY.
 * Higher-order SH coefficients are retained when the source decoder supplied
 * them, so pruning does not silently flatten view-dependent appearance.
 */
export function packedSplatsToPly(source: PackedSplatData): Blob {
  const count = Math.floor(source.buffer.byteLength / SPLAT_ROW_BYTES);
  const degree = source.sh?.length ? Math.max(0, Math.min(4, source.shDegree ?? 0)) : 0;
  const dimension = shDimension(degree);
  const shPropertyCount = dimension * 3;
  const properties = [
    "property float x",
    "property float y",
    "property float z",
    "property float f_dc_0",
    "property float f_dc_1",
    "property float f_dc_2",
    "property float opacity",
    "property float scale_0",
    "property float scale_1",
    "property float scale_2",
    "property float rot_0",
    "property float rot_1",
    "property float rot_2",
    "property float rot_3",
    ...Array.from({ length: shPropertyCount }, (_, index) => `property float f_rest_${index}`),
  ];
  const header = new TextEncoder().encode([
    "ply",
    "format binary_little_endian 1.0",
    `element vertex ${count}`,
    ...properties,
    "end_header",
    "",
  ].join("\n"));
  const floatsPerRow = 14 + shPropertyCount;
  const body = new ArrayBuffer(count * floatsPerRow * 4);
  const bodyView = new DataView(body);
  const sourceFloats = new Float32Array(source.buffer);
  const sourceBytes = new Uint8Array(source.buffer);

  const write = (row: number, column: number, value: number) => {
    bodyView.setFloat32((row * floatsPerRow + column) * 4, value, true);
  };
  for (let index = 0; index < count; index += 1) {
    const floatOffset = index * 8;
    const byteOffset = index * SPLAT_ROW_BYTES;
    write(index, 0, sourceFloats[floatOffset]);
    write(index, 1, sourceFloats[floatOffset + 1]);
    write(index, 2, sourceFloats[floatOffset + 2]);
    write(index, 3, ((sourceBytes[byteOffset + 24] ?? 128) / 255 - 0.5) / SH_C0);
    write(index, 4, ((sourceBytes[byteOffset + 25] ?? 128) / 255 - 0.5) / SH_C0);
    write(index, 5, ((sourceBytes[byteOffset + 26] ?? 128) / 255 - 0.5) / SH_C0);
    const alpha = Math.max(1 / 255, Math.min(254 / 255, (sourceBytes[byteOffset + 27] ?? 255) / 255));
    write(index, 6, Math.log(alpha / (1 - alpha)));
    write(index, 7, Math.log(Math.max(1e-8, Math.abs(sourceFloats[floatOffset + 3]))));
    write(index, 8, Math.log(Math.max(1e-8, Math.abs(sourceFloats[floatOffset + 4]))));
    write(index, 9, Math.log(Math.max(1e-8, Math.abs(sourceFloats[floatOffset + 5]))));
    write(index, 10, (sourceBytes[byteOffset + 28] ?? 255) / 127.5 - 1);
    write(index, 11, (sourceBytes[byteOffset + 29] ?? 128) / 127.5 - 1);
    write(index, 12, (sourceBytes[byteOffset + 30] ?? 128) / 127.5 - 1);
    write(index, 13, (sourceBytes[byteOffset + 31] ?? 128) / 127.5 - 1);

    for (let channel = 0; channel < 3; channel += 1) {
      for (let coefficient = 0; coefficient < dimension; coefficient += 1) {
        const plyIndex = channel * dimension + coefficient;
        const internalIndex = coefficient * 3 + channel;
        write(index, 14 + plyIndex, packedShValue(source.sh, index, internalIndex));
      }
    }
  }
  return new Blob([header, body], { type: "application/octet-stream" });
}

export function pointInsidePolygon(point: Vec3, polygon: Array<{ x: number; y: number }>): boolean {
  let inside = false;
  for (let current = 0, previous = polygon.length - 1; current < polygon.length; previous = current++) {
    const a = polygon[current];
    const b = polygon[previous];
    const intersects = (
      (a.y > point[1]) !== (b.y > point[1])
      && point[0] < (b.x - a.x) * (point[1] - a.y) / ((b.y - a.y) || 1e-9) + a.x
    );
    if (intersects) inside = !inside;
  }
  return inside;
}

export function distanceToPolyline(
  x: number,
  y: number,
  points: Array<{ x: number; y: number }>,
): number {
  let minimum = Number.POSITIVE_INFINITY;
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const denominator = dx * dx + dy * dy;
    const amount = denominator > 1e-9
      ? Math.max(0, Math.min(1, ((x - start.x) * dx + (y - start.y) * dy) / denominator))
      : 0;
    minimum = Math.min(minimum, Math.hypot(x - (start.x + dx * amount), y - (start.y + dy * amount)));
  }
  if (points.length === 1) minimum = Math.hypot(x - points[0].x, y - points[0].y);
  return minimum;
}

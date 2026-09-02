/**
 * UUID v4 that works on insecure origins.
 *
 * `crypto.randomUUID` exists only in secure contexts — over plain HTTP on a
 * LAN IP (how the dev server and on-site demos are reached) it is undefined,
 * and every feature that minted an id crashed. `crypto.getRandomValues` has
 * no such restriction, so the fallback builds a spec-correct v4 from it.
 */
export function randomUUID(): string {
  const direct = globalThis.crypto?.randomUUID?.();
  if (direct) return direct;
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const DEFAULT_BACKEND_TIMEOUT_MS = 12_000;

function configuredTimeoutMs(): number {
  const parsed = Number(process.env.REAIGEN_BACKEND_TIMEOUT_MS);
  if (!Number.isFinite(parsed)) return DEFAULT_BACKEND_TIMEOUT_MS;
  return Math.min(30_000, Math.max(1_000, parsed));
}

/**
 * Server-side backend fetch with a hard deadline. A stalled upstream must
 * become a controlled 502 instead of leaving the browser in a permanent
 * loading state.
 */
export async function fetchBackend(
  input: string,
  init: RequestInit = {},
  timeoutMs = configuredTimeoutMs(),
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

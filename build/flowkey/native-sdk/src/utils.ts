/**
 * Small pure helpers exported by the SDK. They run inside the sidecar, so
 * anything logged must go to stderr (console.error) — stdout is the NDJSON
 * protocol channel.
 */

/** Generates a random UUID-format identifier. */
export function randomId(): string {
  return globalThis.crypto.randomUUID();
}

/**
 * Reports a handled exception for diagnostics. The sidecar already surfaces
 * unhandled errors to the shell; use this inside catch blocks so failures are
 * visible in the sidecar log instead of being swallowed.
 */
export function captureException(error: unknown): void {
  console.error('[flowkey] captured exception', error);
}

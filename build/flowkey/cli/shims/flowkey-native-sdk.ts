/**
 * Runtime shim aliased to `@flowkey-mini/native-sdk`. Contexts and capabilities
 * are injected as props by the sidecar; only the pure helpers come through the
 * host globals so every extension shares one implementation.
 */
const host = (
  globalThis as {
    __FLOWKEY_HOST__?: { nativeSdk?: Record<string, unknown> };
  }
).__FLOWKEY_HOST__;
const nativeSdk = host?.nativeSdk ?? {};

function missing(name: string): never {
  throw new Error(
    `the FlowKey sidecar did not provide @flowkey-mini/native-sdk (missing ${name}); rebuild the extension with @flowkey-mini/cli`,
  );
}

export const defineExtension =
  (nativeSdk.defineExtension as ((module: unknown) => unknown) | undefined) ??
  ((module: unknown) => module);
export const createCapabilities =
  nativeSdk.createCapabilities ?? (() => missing('createCapabilities'));
export const randomId = nativeSdk.randomId ?? (() => missing('randomId'));
export const captureException =
  nativeSdk.captureException ?? ((error: unknown) => missing('captureException'));

/**
 * Runtime shim aliased to `react/jsx-runtime` and `react/jsx-dev-runtime`.
 * Reads the JSX runtime instance from the sidecar's host globals.
 */
type JsxFn = (type: unknown, props: unknown, key?: unknown) => unknown;

const host = (
  globalThis as {
    __FLOWKEY_HOST__?: { reactJsx?: Record<string, unknown> };
  }
).__FLOWKEY_HOST__;
const jsxRuntime = host?.reactJsx ?? {};

function missing(name: string): never {
  throw new Error(
    `the FlowKey sidecar did not provide the JSX runtime (missing ${name}); rebuild the extension with @flowkey-mini/cli`,
  );
}

const fallback: JsxFn = () => missing('jsx');

export const Fragment = jsxRuntime.Fragment;
export const jsx: JsxFn = (jsxRuntime.jsx as JsxFn | undefined) ?? fallback;
export const jsxs: JsxFn = (jsxRuntime.jsxs as JsxFn | undefined) ?? fallback;
export const jsxDEV: JsxFn = (jsxRuntime.jsxDEV as JsxFn | undefined) ?? jsx;

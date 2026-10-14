/**
 * Runtime shim aliased to `@flowkey-mini/react-ui`. Reads the component set from
 * the sidecar's host globals so the serialized element tags are produced by
 * the same module instances the sidecar's serializer understands.
 */
const host = (
  globalThis as {
    __FLOWKEY_HOST__?: { reactUi?: Record<string, unknown> };
  }
).__FLOWKEY_HOST__;
const reactUi = host?.reactUi ?? {};

function missing(name: string): never {
  throw new Error(
    `the FlowKey sidecar did not provide @flowkey-mini/react-ui (missing ${name}); rebuild the extension with @flowkey-mini/cli`,
  );
}

export const List = reactUi.List ?? (() => missing('List'));
export const Detail = reactUi.Detail ?? (() => missing('Detail'));
export const Grid = reactUi.Grid ?? (() => missing('Grid'));
export const ActionPanel = reactUi.ActionPanel ?? (() => missing('ActionPanel'));
export const Action = reactUi.Action ?? (() => missing('Action'));
export const Form = reactUi.Form ?? missingForm;

function missingForm(): never {
  throw new Error(
    'the FlowKey sidecar did not provide @flowkey-mini/react-ui (missing Form); rebuild the extension with @flowkey-mini/cli',
  );
}
export const defineReactExtension = reactUi.defineReactExtension ?? ((module: unknown) => module);
export const usePromise = reactUi.usePromise ?? (() => missing('usePromise'));
export const useFetch = reactUi.useFetch ?? (() => missing('useFetch'));
export const useDebounce = reactUi.useDebounce ?? (() => missing('useDebounce'));
export const useCachedState = reactUi.useCachedState ?? (() => missing('useCachedState'));
export const useLocalStorage = reactUi.useLocalStorage ?? (() => missing('useLocalStorage'));
export const useCachedPromise = reactUi.useCachedPromise ?? (() => missing('useCachedPromise'));
export const withCache = reactUi.withCache ?? (() => missing('withCache'));
export const Color = reactUi.Color ?? {};
export const Icon = reactUi.Icon ?? {};

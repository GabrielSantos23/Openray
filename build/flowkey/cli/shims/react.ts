/**
 * Runtime shim bundled INTO every extension build, aliased to `react`. Reads
 * the React instance the sidecar installs on `globalThis.__FLOWKEY_HOST__`
 * before importing the bundle, so extension hooks share the host's single
 * React copy (a second copy would break hooks and the reconciler).
 *
 * The default export exposes the full React namespace for anything not
 * listed below: `import React from 'react'; React.cloneElement(...)`.
 */
const host = (globalThis as { __FLOWKEY_HOST__?: { react: Record<string, unknown> } })
  .__FLOWKEY_HOST__;
const react = host?.react ?? {};

export default react;

// Hooks
export const useCallback = react.useCallback;
export const useContext = react.useContext;
export const useDebugValue = react.useDebugValue;
export const useDeferredValue = react.useDeferredValue;
export const useEffect = react.useEffect;
export const useId = react.useId;
export const useImperativeHandle = react.useImperativeHandle;
export const useInsertionEffect = react.useInsertionEffect;
export const useLayoutEffect = react.useLayoutEffect;
export const useMemo = react.useMemo;
export const useOptimistic = react.useOptimistic;
export const useReducer = react.useReducer;
export const useRef = react.useRef;
export const useState = react.useState;
export const useSyncExternalStore = react.useSyncExternalStore;
export const useTransition = react.useTransition;

// Elements & components
export const Children = react.Children;
export const Fragment = react.Fragment;
export const Profiler = react.Profiler;
export const StrictMode = react.StrictMode;
export const Suspense = react.Suspense;
export const cloneElement = react.cloneElement;
export const createContext = react.createContext;
export const createElement = react.createElement;
export const forwardRef = react.forwardRef;
export const isValidElement = react.isValidElement;
export const lazy = react.lazy;
export const memo = react.memo;
export const startTransition = react.startTransition;

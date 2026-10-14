import { useCallback, useEffect, useRef, useState } from 'react';
import type { FetchOptions, FlowKeyCapabilities } from '@flowkey-mini/native-sdk';
import { useHostContext } from './hostContext';

/** Async operation state shared by `usePromise` and `useFetch`. */
export interface AsyncState<T> {
  data: T | undefined;
  isLoading: boolean;
  error: unknown;
  /** Re-runs the operation (e.g. after a pull-to-refresh action). */
  revalidate: () => void;
}

export interface AsyncOptions {
  /** Set false to skip the initial run (call `revalidate()` manually). */
  execute?: boolean;
  /** Keep the previous data visible while a new run is in flight. */
  keepPreviousData?: boolean;
  onError?: (error: unknown) => void;
}

/**
 * Runs an async function for the given deps and exposes its state. The
 * function receives an AbortSignal that aborts when the deps change or the
 * root unmounts; stale resolutions are discarded.
 *
 * `deps` must keep a constant length across renders (like React deps arrays).
 */
export function usePromise<T>(
  fn: (helpers: { signal: AbortSignal }) => Promise<T>,
  deps: unknown[] = [],
  options: AsyncOptions = {},
): AsyncState<T> {
  const { execute = true, keepPreviousData = false } = options;
  const [state, setState] = useState<{ data?: T; error?: unknown; loading: boolean }>({
    loading: execute,
  });
  const attemptRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const onErrorRef = useRef(options.onError);
  onErrorRef.current = options.onError;

  const run = useCallback(() => {
    const attempt = ++attemptRef.current;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setState((prev) => ({
      data: keepPreviousData ? prev.data : undefined,
      loading: true,
      error: undefined,
    }));
    fnRef
      .current({ signal: controller.signal })
      .then((data) => {
        if (attemptRef.current !== attempt) return;
        setState({ data, loading: false });
      })
      .catch((error) => {
        if (attemptRef.current !== attempt) return;
        setState((prev) => ({ ...prev, loading: false, error }));
        onErrorRef.current?.(error);
      });
  }, [keepPreviousData]);

  useEffect(() => {
    if (!execute) return;
    run();
    return () => {
      controllerRef.current?.abort();
    };
    // The caller-owned deps list is spread deliberately; its length must stay constant.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [execute, run, ...deps]);

  return { data: state.data, isLoading: state.loading, error: state.error, revalidate: run };
}

/**
 * Fetches a URL through the gated `http` capability and parses the JSON body.
 * Only primitive options participate in re-fetching — pass headers via a
 * stable reference if they change.
 */
export function useFetch<T = unknown>(
  url: string,
  options: FetchOptions & AsyncOptions = {},
): AsyncState<T> {
  const { capabilities } = useHostContext();
  const { execute, keepPreviousData, onError, ...fetchOptions } = options;
  const fetchOptionsRef = useRef(fetchOptions);
  fetchOptionsRef.current = fetchOptions;

  return usePromise<T>(
    async ({ signal }) => {
      const response = await capabilities.http.fetch(url, {
        ...fetchOptionsRef.current,
        signal,
      });
      return (response.body ? JSON.parse(response.body) : undefined) as T;
    },
    [url, fetchOptions.method, fetchOptions.body, fetchOptions.auth],
    { execute, keepPreviousData, onError },
  );
}

/** Returns `value` after it has stopped changing for `delayMs` milliseconds. */
export function useDebounce<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

/**
 * State persisted in the extension's storage KV under `key`, shared across
 * commands. Starts from `initialState`, then hydrates the stored value
 * asynchronously; every update is written back.
 */
export function useCachedState<T>(
  key: string,
  initialState: T,
): [T, (value: T | ((prev: T) => T)) => void] {
  const { capabilities } = useHostContext();
  const [value, setValue] = useState<T>(initialState);
  const valueRef = useRef(value);
  valueRef.current = value;

  useEffect(() => {
    let cancelled = false;
    capabilities.storage
      .get<T>(key)
      .then((stored) => {
        if (!cancelled && stored !== null) setValue(stored);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [capabilities, key]);

  const set = useCallback(
    (update: T | ((prev: T) => T)) => {
      const next =
        typeof update === 'function' ? (update as (prev: T) => T)(valueRef.current) : update;
      valueRef.current = next;
      setValue(next);
      void capabilities.storage.set(key, next).catch(() => {});
    },
    [capabilities, key],
  );

  return [value, set];
}

/**
 * Storage-backed state that starts empty and persists every update. Like
 * `useCachedState`, but the value is `undefined` until loaded and
 * `initialValue` is written when nothing is stored yet.
 */
export function useLocalStorage<T>(
  key: string,
  initialValue?: T,
): [T | undefined, (value: T) => void] {
  const { capabilities } = useHostContext();
  const [value, setValue] = useState<T | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    capabilities.storage
      .get<T>(key)
      .then((stored) => {
        if (cancelled) return;
        if (stored !== null) {
          setValue(stored);
        } else if (initialValue !== undefined) {
          setValue(initialValue);
          void capabilities.storage.set(key, initialValue).catch(() => {});
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // initialValue is intentionally excluded: it is only used on the first hydration.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capabilities, key]);

  const set = useCallback(
    (next: T) => {
      setValue(next);
      void capabilities.storage.set(key, next).catch(() => {});
    },
    [capabilities, key],
  );

  return [value, set];
}

/**
 * Cache-partition key for `useCachedPromise`: the serialized deps of the call.
 */
function cacheKeyFor(deps: unknown[]): string {
  return `useCachedPromise:${JSON.stringify(deps)}`;
}

/**
 * `usePromise` backed by the `cache` capability: while a run is in flight the
 * last cached result for the same deps is shown (no flicker), and every
 * resolved result is written back. Pass `seconds` to cache with a TTL.
 */
export function useCachedPromise<T>(
  fn: (helpers: { signal: AbortSignal }) => Promise<T>,
  deps: unknown[] = [],
  options: AsyncOptions & { seconds?: number } = {},
): AsyncState<T> {
  const { capabilities } = useHostContext();
  const { seconds, ...asyncOptions } = options;
  const key = cacheKeyFor(deps);

  const [hydrated, setHydrated] = useState<T | undefined>(undefined);
  const state = usePromise<T>(fn, deps, asyncOptions);

  useEffect(() => {
    let cancelled = false;
    setHydrated(undefined);
    capabilities.cache
      .get<T>(key)
      .then((stored) => {
        if (!cancelled && stored !== null) setHydrated(stored);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [capabilities, key]);

  useEffect(() => {
    if (state.data === undefined) return;
    void capabilities.cache.set(key, state.data, { ttlSeconds: seconds }).catch(() => {});
  }, [capabilities, key, seconds, state.data]);

  return {
    ...state,
    data: state.data ?? hydrated,
    isLoading: state.isLoading && state.data === undefined && hydrated === undefined,
  };
}

/**
 * Wraps an async function with the `cache` capability: repeated calls with the
 * same arguments return the cached value until its TTL (if any) expires.
 */
export function withCache<TArgs extends unknown[], T>(
  cache: FlowKeyCapabilities['cache'],
  fn: (...args: TArgs) => Promise<T>,
  options?: { key?: (...args: TArgs) => string; seconds?: number },
): (...args: TArgs) => Promise<T> {
  return async (...args: TArgs) => {
    const key = options?.key
      ? `withCache:${options.key(...args)}`
      : `withCache:${JSON.stringify(args)}`;
    const cached = await cache.get<T>(key).catch(() => null);
    if (cached !== null) return cached;
    const result = await fn(...args);
    void cache.set(key, result, { ttlSeconds: options?.seconds }).catch(() => {});
    return result;
  };
}

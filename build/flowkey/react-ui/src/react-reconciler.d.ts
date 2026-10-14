declare module 'react-reconciler' {
  export interface ReconcilerInstance {
    createContainer(
      containerInfo: unknown,
      tag: number,
      hydrationCallbacks: null,
      isStrictMode: boolean,
      concurrentUpdatesByDefaultOverride: boolean,
      identifierPrefix: string,
      onUncaughtError: (error: unknown) => void,
      onCaughtError: (error: unknown) => void,
      onRecoverableError: (error: unknown) => void,
      onDefaultTransitionIndicator: () => void,
    ): unknown;
    updateContainer(
      element: unknown,
      root: unknown,
      parentComponent: null,
      callback: () => void,
    ): void;
    updateContainerSync(
      element: unknown,
      root: unknown,
      parentComponent: null,
      callback: null,
    ): void;
    flushSyncWork(): boolean;
    flushPassiveEffects(): boolean;
    batchedUpdates<T>(fn: () => T, arg?: unknown): T;
  }

  const reconcilerFactory: (config: unknown) => ReconcilerInstance;
  export default reconcilerFactory;
}

declare module 'react-reconciler/constants' {
  export const ConcurrentRoot: number;
  export const LegacyRoot: number;
}

import { createContext, useContext } from 'react';
import type { ExtensionEnvironment, FlowKeyCapabilities } from '@flowkey-mini/native-sdk';
import type { ReactNativeContext } from './defineReactExtension';

/**
 * Runtime services the sidecar provides to every rendered component. ReactRoot
 * wraps the extension component in this provider, so hooks (useFetch,
 * useCachedState, …) can reach the gated capability groups without prop
 * drilling.
 */
export interface HostContextValue {
  native: ReactNativeContext;
  capabilities: FlowKeyCapabilities;
  environment: ExtensionEnvironment;
}

export const HostContext = createContext<HostContextValue | null>(null);

/** Reads the runtime services provided by ReactRoot. Throws outside the sidecar. */
export function useHostContext(): HostContextValue {
  const value = useContext(HostContext);
  if (!value) {
    throw new Error(
      'FlowKey hooks must run inside the sidecar runtime (the component was rendered outside ReactRoot)',
    );
  }
  return value;
}

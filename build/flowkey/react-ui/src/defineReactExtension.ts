import type { ComponentType } from 'react';
import type {
  Arguments,
  ExtensionEnvironment,
  ExtensionManifest,
  ExtensionWindow,
  FlowKeyCapabilities,
  HudOptions,
  Preferences,
} from '@flowkey-mini/native-sdk';

export interface ReactNativeContext {
  call<T = unknown>(
    method: string,
    params?: Record<string, unknown>,
    options?: { signal?: AbortSignal; timeoutMs?: number },
  ): Promise<T>;
  showHud(options: HudOptions): Promise<void>;
}

export interface CommandProps {
  query: string;
  filterValue?: string;
  commandId?: string;
  /** Captured command arguments, when the command declares them. */
  arguments?: Arguments;
  preferences: Preferences;
  /** Read-only facts about the extension and the entry point being rendered. */
  environment: ExtensionEnvironment;
  /** Window/launch controls forwarded to the shell by the sidecar. */
  window: ExtensionWindow;
  native: ReactNativeContext;
  /** Typed capability groups (http, storage, clipboard, …) — same as `native`, but ergonomic. */
  capabilities: FlowKeyCapabilities;
  signal: AbortSignal;
}

export interface ReactExtensionModule {
  manifest: ExtensionManifest;
  component: ComponentType<CommandProps>;
}

export function defineReactExtension(module: ReactExtensionModule): ReactExtensionModule {
  return module;
}

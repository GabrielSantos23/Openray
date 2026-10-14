import type { FlowKeyCapabilities } from '../capabilities';
import type { WebResultMessage } from '../types';

/**
 * Web-side runtime for `ui: 'web'` commands. Runs inside the shell's WebView2:
 * capability calls are posted to the C# host, which relays them through the
 * sidecar's gated NativeBridge — the same manifest/consent policy applies to
 * every call, exactly as it does for tree-mode extensions. The extension id is
 * stamped by the shell (it knows the mounted web command), so calls here only
 * carry the method and params.
 */

export interface WebHostConnection {
  post(message: Record<string, unknown>): void;
  /** Registers a listener for host messages ({type:'init'|'props'|'result'|'dispose'}). */
  onMessage(handler: (message: Record<string, unknown>) => void): void;
}

/** The props a web command component receives on mount and on every update. */
export interface WebCommandProps {
  query: string;
  filterValue?: string;
  arguments?: Record<string, string>;
  preferences: Record<string, unknown>;
  environment: {
    extensionId: string;
    extensionName: string;
    extensionVersion: string;
    commandId?: string;
    commandMode?: 'view' | 'background';
    isDevelopment: boolean;
  };
  capabilities: FlowKeyCapabilities;
  /** Theme token values from the shell (hex colors), keyed by token name. */
  theme: Record<string, string>;
}

export interface WebHostLink {
  post: (message: Record<string, unknown>) => void;
  addResultHandler: (handler: (message: WebResultMessage) => void) => void;
}

interface CallOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

/**
 * Wires the typed capability groups over the webview bridge. Mirrors the
 * argument/result shapes of `createCapabilities` in the tree SDK one-to-one.
 */
export function createWebCapabilities(link: WebHostLink): FlowKeyCapabilities {
  const pending = new Map<string, (message: WebResultMessage) => void>();
  let nextBridgeId = 1;

  link.addResultHandler((message) => {
    const settle = pending.get(message.bridgeId);
    if (settle) {
      pending.delete(message.bridgeId);
      settle(message);
    }
  });

  const call = <T = unknown>(
    method: string,
    params?: Record<string, unknown>,
    options?: CallOptions,
  ): Promise<T> => {
    const bridgeId = `w${nextBridgeId++}`;
    const signal = options?.signal;
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        if (signal) signal.removeEventListener('abort', onAbort);
        pending.delete(bridgeId);
        fn();
      };
      const onAbort = () => {
        settle(() => reject({ code: 'aborted', message: `native method ${method} aborted` }));
        link.post({ type: 'webAbort', bridgeId });
      };
      if (signal) signal.addEventListener('abort', onAbort, { once: true });
      pending.set(bridgeId, (message) => {
        if (message.ok) {
          resolve(message.result as T);
        } else {
          reject(message.error ?? { code: 'webFailed', message: 'web call failed' });
        }
      });
      link.post({
        type: 'webCall',
        bridgeId,
        method,
        params,
        timeoutMs: options?.timeoutMs,
      });
    });
  };

  function unwrapOk(result: { ok?: boolean } | undefined, method: string): void {
    if (result && result.ok === false) {
      throw new Error(`native call ${method} failed`);
    }
  }

  const capabilities: FlowKeyCapabilities = {
    http: {
      async fetch(url, options) {
        const { signal, ...params } = options ?? {};
        const result = await call<Record<string, unknown>>(
          'http.fetch',
          { url, ...params },
          { signal: signal as AbortSignal | undefined },
        );
        return {
          status: result.status as number,
          headers: (result.headers ?? {}) as Record<string, string>,
          body: (result.bodyText as string | null) ?? undefined,
          bytesReceived: result.bytesReceived as number | undefined,
        };
      },
      async fetchJson(url, options) {
        const response = await this.fetch(url, options);
        return JSON.parse((response.body as string | undefined) ?? '{}');
      },
      async upload(url, options) {
        const { signal, ...params } = options ?? {};
        const result = await call<Record<string, unknown>>(
          'http.upload',
          { url, ...params },
          { signal },
        );
        return {
          status: result.status as number,
          bytesSent: result.bytesSent as number,
          elapsedMs: result.elapsedMs as number,
        };
      },
    },
    clipboard: {
      async read() {
        const result = await call<{ text?: string | null }>('clipboard.read');
        return result.text ?? null;
      },
      async write(text) {
        await call('clipboard.write', { text });
      },
      async paste(text) {
        await call('clipboard.paste', { text });
      },
      async history(options) {
        const result = await call<{ items?: [] }>('clipboard.history', {
          query: options?.query,
          limit: options?.limit,
        });
        return result.items ?? [];
      },
      async clearHistory() {
        await call('clipboard.clearHistory', {});
      },
      async deleteEntry(id) {
        await call('clipboard.deleteEntry', { id });
      },
      async copyEntry(id) {
        await call('clipboard.copyEntry', { id });
      },
      async pasteEntry(id) {
        await call('clipboard.pasteEntry', { id });
      },
      async editEntry(id) {
        await call('clipboard.editEntry', { id });
      },
      async writeContent(content) {
        await call('clipboard.write', { ...content });
      },
      async readContent() {
        return await call('clipboard.read');
      },
      async clear() {
        await call('clipboard.clear', {});
      },
    },
    storage: {
      async get(key) {
        const result = await call<{ ok: boolean; value?: unknown }>('storage.get', { key });
        unwrapOk(result, 'storage.get');
        return (result.value ?? null) as never;
      },
      async set(key, value) {
        await call('storage.set', { key, value });
      },
      async delete(key) {
        await call('storage.delete', { key });
      },
      async keys() {
        const result = await call<{ ok: boolean; keys?: string[] }>('storage.keys');
        return result.keys ?? [];
      },
      async allItems<T = unknown>(): Promise<Record<string, T>> {
        const keys = await this.keys();
        const entries = await Promise.all(
          keys.map(async (key) => {
            const result = await call<{ ok: boolean; value?: unknown }>('storage.get', { key });
            unwrapOk(result, 'storage.get');
            return [key, (result.value ?? null) as T | null] as const;
          }),
        );
        return Object.fromEntries(
          entries.filter((entry): entry is readonly [string, T] => entry[1] !== null),
        );
      },
    },
    cache: {
      async get(key) {
        const result = await call<{ ok: boolean; value?: unknown }>('cache.get', { key });
        unwrapOk(result, 'cache.get');
        return (result.value ?? null) as never;
      },
      async set(key, value, options) {
        await call('cache.set', { key, value, ttlSeconds: options?.ttlSeconds });
      },
      async delete(key) {
        await call('cache.delete', { key });
      },
      async clear() {
        await call('cache.clear', {});
      },
    },
    secrets: {
      async get(key) {
        const result = await call<{ ok?: boolean; value?: string }>('secrets.get', { key });
        unwrapOk(result, 'secrets.get');
        return result.value ?? null;
      },
      async set(key, value) {
        await call('secrets.set', { key, value });
      },
      async delete(key) {
        await call('secrets.delete', { key });
      },
    },
    shell: {
      async openUrl(url) {
        await call('shell.openUrl', { url });
      },
      async openPath(path) {
        await call('shell.openPath', { path });
      },
      async revealPath(path) {
        await call('shell.revealPath', { path });
      },
    },
    fs: {
      async readText(path) {
        const result = await call<{ ok?: boolean; content?: string }>('fs.readText', { path });
        unwrapOk(result, 'fs.readText');
        return result.content ?? '';
      },
      async writeText(path, content, options) {
        await call('fs.writeText', { path, content, append: options?.append === true });
      },
      async delete(path) {
        await call('fs.delete', { path });
      },
      async glob(pattern, options) {
        const result = await call<{ ok?: boolean; entries?: [] }>('fs.glob', {
          pattern,
          limit: options?.limit,
        });
        unwrapOk(result, 'fs.glob');
        return result.entries ?? [];
      },
      async stat(path) {
        return await call('fs.stat', { path });
      },
      async mkdir(path) {
        await call('fs.mkdir', { path });
      },
      async exists(path) {
        const result = await call<{ ok: boolean; exists?: boolean }>('fs.exists', { path });
        return result.exists === true;
      },
      async copy(from, to) {
        await call('fs.copy', { from, to });
      },
      async move(from, to) {
        await call('fs.move', { from, to });
      },
      async trash(path) {
        await call('fs.trash', { path });
      },
    },
    apps: {
      async list(query) {
        const result = await call<{ apps?: [] }>('apps.list', { query });
        return result.apps ?? [];
      },
      async launch(id) {
        await call('apps.launch', { id });
      },
      async frontmost() {
        const result = await call<{ app?: unknown | null }>('apps.frontmost');
        return (result.app ?? null) as never;
      },
      async defaultFor(path) {
        const result = await call<{ path?: string | null }>('apps.default', { path });
        return result.path ?? null;
      },
    },
    media: {
      async current() {
        return await call('media.current');
      },
      async control(command) {
        await call('media.control', { command });
      },
    },
    image: {
      async fetch(url) {
        const result = await call<{ ok?: boolean; uri?: string }>('image.fetch', { url });
        unwrapOk(result, 'image.fetch');
        return result.uri ?? '';
      },
    },
    system: {
      async selectedText(options) {
        const result = await call<{ text?: string | null }>('system.selectedText', {
          allowFallback: options?.allowFallback === true,
        });
        return result.text ?? null;
      },
    },
    oauth: {
      async authorize(provider, options) {
        return await call(
          'oauth.authorize',
          { provider, clientId: options?.clientId },
          {
            signal: options?.signal as AbortSignal | undefined,
            timeoutMs: options?.timeoutMs,
          },
        );
      },
      async status(provider, options) {
        return await call('oauth.status', { provider }, options);
      },
      async disconnect(provider) {
        await call('oauth.disconnect', { provider });
      },
    },
    hud: {
      async show(options) {
        await call('hud.show', { ...options });
      },
    },
    toast: {
      async show(options) {
        await call('toast.show', { ...options });
      },
    },
    alert: {
      async confirm(options) {
        const result = await call<{ confirmed?: boolean }>('alert.confirm', { ...options });
        return result.confirmed === true;
      },
    },
  };

  return capabilities;
}

import type { ConfirmOptions, HudOptions, ToastOptions } from './types';

/** Raw native transport available on every extension context. */
export type NativeCaller = <T = unknown>(
  method: string,
  params?: Record<string, unknown>,
  options?: { signal?: AbortSignal; timeoutMs?: number },
) => Promise<T>;

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body?: string;
  /** Present when the request was sent with `discardBody: true`. */
  bytesReceived?: number;
}

export interface ClipboardWriteContent {
  text?: string;
  html?: string;
  paths?: string[];
}

export interface ClipboardReadContent {
  text: string | null;
  html: string | null;
  paths: string[] | null;
}

export interface FrontmostApp {
  id?: string | null;
  name: string;
  path?: string | null;
}

export interface UploadOptions {
  /** Payload size in bytes; generated and streamed shell-side. */
  bytes?: number;
  method?: string;
  headers?: Record<string, string>;
  /** Per-call deadline; also extends the sidecar bridge timeout. */
  timeoutMs?: number;
  /** Aborts the in-flight request (transport-level, never serialized as a param). */
  signal?: AbortSignal;
}

export interface UploadResult {
  status: number;
  bytesSent: number;
  /** Wall-clock duration of the transfer, in milliseconds. */
  elapsedMs: number;
}

export interface FetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  /** Request OAuth token injection for a provider declared in the manifest. */
  auth?: string;
  /** Aborts the in-flight request (transport-level, never serialized as a param). */
  signal?: AbortSignal;
  /**
   * Skips transferring the response body to the extension; the result carries
   * `bytesReceived` instead. Use for throughput measurements.
   */
  discardBody?: boolean;
}

/** Result of the shell's `oauth.*` routes (token state is vaulted host-side). */
export interface OAuthStatus {
  ok: boolean;
  /** RFC 3339 expiry of the vaulted access token, when one exists. */
  expiresAt?: string;
  scope?: string;
}

export interface AppEntry {
  id: string;
  name: string;
  iconUri?: string;
}

export interface MediaSnapshot {
  playing: boolean;
  title?: string | null;
  artist?: string | null;
  album?: string | null;
  positionMs?: number;
  durationMs?: number;
  /** Unix epoch milliseconds of when the snapshot was taken. */
  updatedAtMs?: number;
}

/** Transport commands accepted by the shell's `media.control` route. */
export type MediaCommand = 'playPause' | 'next' | 'previous';

export interface HistoryEntry {
  id: string;
  text: string;
}

export interface FsEntry {
  /** Absolute path of the file. */
  path: string;
  name: string;
  sizeBytes: number;
  /** Unix epoch milliseconds. */
  createdAtMs: number;
  modifiedAtMs: number;
}

/**
 * Typed capability groups over the raw native-call transport. Built once per
 * extension by the sidecar and injected into every context and component's
 * props, so extensions never hand-roll `native.call('namespace.method', ...)`
 * strings. Every method still goes through the shell's manifest and consent
 * gate on the host side.
 */
export interface FlowKeyCapabilities {
  /** Host-allowlisted HTTP (every request is checked against manifest httpHosts). */
  http: {
    fetch(url: string, options?: FetchOptions): Promise<HttpResponse>;
    fetchJson<T = unknown>(url: string, options?: FetchOptions): Promise<T>;
    /**
     * Streams a shell-generated payload to an allowlisted host and reports the
     * transfer time. The body never crosses the extension bridge, so
     * throughput measurement stays off the relay.
     */
    upload(url: string, options?: UploadOptions): Promise<UploadResult>;
  };
  clipboard: {
    read(): Promise<string | null>;
    write(text: string): Promise<void>;
    /** Writes the text and pastes it into the foreground application. */
    paste(text: string): Promise<void>;
    history(options?: { query?: string; limit?: number }): Promise<HistoryEntry[]>;
    /** Removes every entry from the clipboard history. */
    clearHistory(): Promise<void>;
    /** Deletes one history entry by id. */
    deleteEntry(id: string): Promise<void>;
    /** Re-copies a history entry to the clipboard. */
    copyEntry(id: string): Promise<void>;
    /** Copies a history entry and pastes it into the foreground application. */
    pasteEntry(id: string): Promise<void>;
    /** Opens a history entry (image file or temp text file) in the default editor. */
    editEntry(id: string): Promise<void>;
    /** Writes rich content: plain text, HTML and/or a file drop list. */
    writeContent(content: ClipboardWriteContent): Promise<void>;
    /** Reads the full clipboard snapshot (text, HTML, file drop list). */
    readContent(): Promise<ClipboardReadContent>;
    /** Empties the clipboard. */
    clear(): Promise<void>;
  };
  storage: {
    get<T = unknown>(key: string): Promise<T | null>;
    set(key: string, value: unknown): Promise<void>;
    delete(key: string): Promise<void>;
    keys(): Promise<string[]>;
    /** Loads every stored key/value pair (one get call per key). */
    allItems<T = unknown>(): Promise<Record<string, T>>;
  };

  /**
   * Per-extension transient cache with optional per-entry TTL and larger caps
   * than `storage`. Entries are disposable — the shell may behave like a
   * cold cache at any time, so treat misses as "compute again".
   */
  cache: {
    get<T = unknown>(key: string): Promise<T | null>;
    set(key: string, value: unknown, options?: { ttlSeconds?: number }): Promise<void>;
    delete(key: string): Promise<void>;
    clear(): Promise<void>;
  };

  /**
   * Vaulted OAuth for providers declared in the manifest `oauth` list. Tokens
   * never reach the extension — `http.fetch` injects them via `options.auth`,
   * and these routes only report/refresh authorization state.
   */
  oauth: {
    /** Runs the browser PKCE flow for a declared provider. */
    authorize(
      provider: string,
      options?: { clientId?: string; signal?: AbortSignal; timeoutMs?: number },
    ): Promise<OAuthStatus>;
    /** Validates (and refreshes if needed) the vaulted token for a provider. */
    status(
      provider: string,
      options?: { signal?: AbortSignal; timeoutMs?: number },
    ): Promise<OAuthStatus>;
    /** Deletes the vaulted tokens for a provider. */
    disconnect(provider: string): Promise<void>;
  };
  secrets: {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
    delete(key: string): Promise<void>;
  };
  shell: {
    openUrl(url: string): Promise<void>;
    /** Opens a file or folder with the system default handler (gated by manifest fsPaths). */
    openPath(path: string): Promise<void>;
    /** Reveals a file or folder in the system file manager (gated by manifest fsPaths). */
    revealPath(path: string): Promise<void>;
  };
  /**
   * Scoped filesystem access: every path must match a glob declared in the
   * manifest `fsPaths` (with `{{preference}}` placeholders interpolated from
   * the user's settings), and the user consents to those scopes at install.
   */
  fs: {
    readText(path: string): Promise<string>;
    /** Writes (or appends to) a text file, creating it if missing. */
    writeText(path: string, content: string, options?: { append?: boolean }): Promise<void>;
    delete(path: string): Promise<void>;
    /** Expands a glob (relative to a scope root, or absolute) into file entries with metadata. */
    glob(pattern: string, options?: { limit?: number }): Promise<FsEntry[]>;
    stat(path: string): Promise<FsEntry>;
    /** Creates a directory (and parents) inside a declared scope. */
    mkdir(path: string): Promise<void>;
    /** Whether a file or directory exists inside a declared scope. */
    exists(path: string): Promise<boolean>;
    copy(from: string, to: string): Promise<void>;
    move(from: string, to: string): Promise<void>;
    /** Moves a file or directory to the Recycle Bin (recoverable). */
    trash(path: string): Promise<void>;
  };
  apps: {
    list(query?: string): Promise<AppEntry[]>;
    launch(id: string): Promise<void>;
    /** The currently focused application, when it can be resolved. */
    frontmost(): Promise<FrontmostApp | null>;
    /** System default executable for a file path or extension. */
    defaultFor(path: string): Promise<string | null>;
  };
  media: {
    current(): Promise<MediaSnapshot>;
    control(command: MediaCommand): Promise<void>;
  };
  image: {
    /** Downloads, downscales and caches an allowlisted image; returns a file: URI. */
    fetch(url: string): Promise<string>;
  };

  /** Desktop integration queries (gated by their `system.*` routes). */
  system: {
    /**
     * Selected text of the foreground application. UI Automation first; with
     * `allowFallback` the shell may type Ctrl+C and read the clipboard,
     * restoring the previous content afterwards.
     */
    selectedText(options?: { allowFallback?: boolean }): Promise<string | null>;
  };
  hud: {
    show(options: HudOptions): Promise<void>;
  };

  /**
   * Toast notifications rendered by the shell (bottom-right, style-accented).
   * More expressive than `hud`: carries a message line and success/failure
   * styling. Requires `toast.show` in the manifest.
   */
  toast: {
    show(options: ToastOptions): Promise<void>;
  };

  /**
   * Blocking confirmation dialog rendered by the shell. The native call stays
   * pending until the user answers. Requires `alert.confirm` in the manifest.
   */
  alert: {
    confirm(options: ConfirmOptions): Promise<boolean>;
  };
}

function unwrapOk(result: { ok?: boolean } | undefined, method: string): void {
  if (result && result.ok === false) {
    throw new Error(`native call ${method} failed`);
  }
}

export function createCapabilities(call: NativeCaller): FlowKeyCapabilities {
  const httpFetch = async (url: string, options?: FetchOptions): Promise<HttpResponse> => {
    const { signal, ...params } = options ?? {};
    // the shell returns the body as `bodyText` (null when discardBody is set)
    const result = await call<{
      status: number;
      headers: Record<string, string>;
      bodyText?: string | null;
      bytesReceived?: number;
    }>('http.fetch', { url, ...params }, { signal });
    return {
      status: result.status,
      headers: result.headers,
      body: result.bodyText ?? undefined,
      bytesReceived: result.bytesReceived,
    };
  };

  const httpUpload = async (url: string, options?: UploadOptions): Promise<UploadResult> => {
    const { signal, ...params } = options ?? {};
    return await call<UploadResult>('http.upload', { url, ...params }, { signal });
  };

  return {
    http: {
      fetch: httpFetch,
      upload: httpUpload,
      async fetchJson<T = unknown>(url: string, options?: FetchOptions): Promise<T> {
        const response = await httpFetch(url, options);
        return JSON.parse(response.body ?? '{}') as T;
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
        const result = await call<{ items?: HistoryEntry[] }>('clipboard.history', {
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
        return await call<ClipboardReadContent>('clipboard.read');
      },
      async clear() {
        await call('clipboard.clear', {});
      },
    },
    storage: {
      async get<T = unknown>(key: string): Promise<T | null> {
        const result = await call<{ ok: boolean; value?: unknown }>('storage.get', { key });
        unwrapOk(result, 'storage.get');
        return (result.value ?? null) as T | null;
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
        const keysResult = await call<{ ok: boolean; keys?: string[] }>('storage.keys');
        const keys = keysResult.keys ?? [];
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
      async get<T = unknown>(key: string): Promise<T | null> {
        const result = await call<{ ok: boolean; value?: unknown }>('cache.get', { key });
        unwrapOk(result, 'cache.get');
        return (result.value ?? null) as T | null;
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
    oauth: {
      async authorize(provider, options) {
        return await call<OAuthStatus>(
          'oauth.authorize',
          { provider, clientId: options?.clientId },
          { signal: options?.signal, timeoutMs: options?.timeoutMs },
        );
      },
      async status(provider, options) {
        return await call<OAuthStatus>('oauth.status', { provider }, options);
      },
      async disconnect(provider) {
        await call('oauth.disconnect', { provider });
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
        const result = await call<{ ok?: boolean; entries?: FsEntry[] }>('fs.glob', {
          pattern,
          limit: options?.limit,
        });
        unwrapOk(result, 'fs.glob');
        return result.entries ?? [];
      },
      async stat(path) {
        const result = await call<FsEntry>('fs.stat', { path });
        return result;
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
        const result = await call<{ apps?: AppEntry[] }>('apps.list', { query });
        return result.apps ?? [];
      },
      async launch(id) {
        await call('apps.launch', { id });
      },
      async frontmost() {
        const result = await call<{ app?: FrontmostApp | null }>('apps.frontmost');
        return result.app ?? null;
      },
      async defaultFor(path) {
        const result = await call<{ path?: string | null }>('apps.default', { path });
        return result.path ?? null;
      },
    },
    media: {
      async current() {
        return call<MediaSnapshot>('media.current');
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
}

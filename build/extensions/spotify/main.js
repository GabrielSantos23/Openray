"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.tsx
var index_exports = {};
__export(index_exports, {
  default: () => index_default
});
module.exports = __toCommonJS(index_exports);

// ../../flowkey/cli/shims/react.ts
var host = globalThis.__FLOWKEY_HOST__;
var react = host?.react ?? {};
var useCallback = react.useCallback;
var useContext = react.useContext;
var useDebugValue = react.useDebugValue;
var useDeferredValue = react.useDeferredValue;
var useEffect = react.useEffect;
var useId = react.useId;
var useImperativeHandle = react.useImperativeHandle;
var useInsertionEffect = react.useInsertionEffect;
var useLayoutEffect = react.useLayoutEffect;
var useMemo = react.useMemo;
var useOptimistic = react.useOptimistic;
var useReducer = react.useReducer;
var useRef = react.useRef;
var useState = react.useState;
var useSyncExternalStore = react.useSyncExternalStore;
var useTransition = react.useTransition;
var Children = react.Children;
var Fragment = react.Fragment;
var Profiler = react.Profiler;
var StrictMode = react.StrictMode;
var Suspense = react.Suspense;
var cloneElement = react.cloneElement;
var createContext = react.createContext;
var createElement = react.createElement;
var forwardRef = react.forwardRef;
var isValidElement = react.isValidElement;
var lazy = react.lazy;
var memo = react.memo;
var startTransition = react.startTransition;

// ../../flowkey/cli/shims/flowkey-react-ui.ts
var host2 = globalThis.__FLOWKEY_HOST__;
var reactUi = host2?.reactUi ?? {};
function missing(name) {
  throw new Error(
    `the FlowKey sidecar did not provide @flowkey-mini/react-ui (missing ${name}); rebuild the extension with @flowkey-mini/cli`
  );
}
var List = reactUi.List ?? (() => missing("List"));
var Detail = reactUi.Detail ?? (() => missing("Detail"));
var Grid = reactUi.Grid ?? (() => missing("Grid"));
var ActionPanel = reactUi.ActionPanel ?? (() => missing("ActionPanel"));
var Action = reactUi.Action ?? (() => missing("Action"));
var Form = reactUi.Form ?? missingForm;
function missingForm() {
  throw new Error(
    "the FlowKey sidecar did not provide @flowkey-mini/react-ui (missing Form); rebuild the extension with @flowkey-mini/cli"
  );
}
var defineReactExtension = reactUi.defineReactExtension ?? ((module2) => module2);
var usePromise = reactUi.usePromise ?? (() => missing("usePromise"));
var useFetch = reactUi.useFetch ?? (() => missing("useFetch"));
var useDebounce = reactUi.useDebounce ?? (() => missing("useDebounce"));
var useCachedState = reactUi.useCachedState ?? (() => missing("useCachedState"));
var useLocalStorage = reactUi.useLocalStorage ?? (() => missing("useLocalStorage"));
var useCachedPromise = reactUi.useCachedPromise ?? (() => missing("useCachedPromise"));
var withCache = reactUi.withCache ?? (() => missing("withCache"));
var Color = reactUi.Color ?? {};
var Icon = reactUi.Icon ?? {};

// manifest.json
var manifest_default = {
  id: "spotify",
  name: "Spotify",
  version: "0.1.0",
  description: "Search Spotify, browse your library, and control playback.",
  icon: "assets/extension-icon.png",
  commands: [
    {
      id: "search",
      title: "Spotify Search",
      keywords: [
        "music",
        "song",
        "artist",
        "album"
      ],
      icon: "spotify",
      iconColor: "#1DB954",
      mode: "view"
    },
    {
      id: "your-library",
      title: "Your Library",
      keywords: [
        "spotify",
        "saved"
      ],
      icon: "spotify",
      iconColor: "#1DB954",
      mode: "view"
    },
    {
      id: "now-playing",
      title: "Now Playing",
      keywords: [
        "spotify",
        "player"
      ],
      icon: "spotify",
      iconColor: "#1DB954",
      mode: "view"
    },
    {
      id: "queue",
      title: "Spotify Queue",
      keywords: [
        "spotify"
      ],
      icon: "spotify",
      iconColor: "#1DB954",
      mode: "view"
    },
    {
      id: "devices",
      title: "Spotify Devices",
      keywords: [
        "spotify",
        "connect"
      ],
      icon: "spotify",
      iconColor: "#1DB954",
      mode: "view"
    },
    {
      id: "just-play",
      title: "Just Play",
      keywords: [
        "spotify",
        "play"
      ],
      icon: "spotify",
      iconColor: "#1DB954",
      mode: "background"
    },
    {
      id: "toggle-play-pause",
      title: "Toggle Play/Pause",
      keywords: [
        "spotify"
      ],
      icon: "spotify",
      iconColor: "#1DB954",
      mode: "background"
    },
    {
      id: "next",
      title: "Next Track",
      keywords: [
        "spotify",
        "skip"
      ],
      icon: "spotify",
      iconColor: "#1DB954",
      mode: "background"
    },
    {
      id: "previous",
      title: "Previous Track",
      keywords: [
        "spotify"
      ],
      icon: "spotify",
      iconColor: "#1DB954",
      mode: "background"
    },
    {
      id: "like",
      title: "Like Current Track",
      keywords: [
        "spotify",
        "heart"
      ],
      icon: "spotify",
      iconColor: "#1DB954",
      mode: "background"
    },
    {
      id: "dislike",
      title: "Dislike Current Track",
      keywords: [
        "spotify"
      ],
      icon: "spotify",
      iconColor: "#1DB954",
      mode: "background"
    },
    {
      id: "toggle-shuffle",
      title: "Toggle Shuffle",
      keywords: [
        "spotify"
      ],
      icon: "spotify",
      iconColor: "#1DB954",
      mode: "background"
    },
    {
      id: "cycle-repeat",
      title: "Cycle Repeat",
      keywords: [
        "spotify"
      ],
      icon: "spotify",
      iconColor: "#1DB954",
      mode: "background"
    },
    {
      id: "replay",
      title: "Replay Track",
      keywords: [
        "spotify"
      ],
      icon: "spotify",
      iconColor: "#1DB954",
      mode: "background"
    },
    {
      id: "volume-0",
      title: "Volume 0%",
      keywords: [
        "spotify",
        "mute"
      ],
      icon: "spotify",
      iconColor: "#1DB954",
      mode: "background"
    },
    {
      id: "volume-25",
      title: "Volume 25%",
      keywords: [
        "spotify"
      ],
      icon: "spotify",
      iconColor: "#1DB954",
      mode: "background"
    },
    {
      id: "volume-50",
      title: "Volume 50%",
      keywords: [
        "spotify"
      ],
      icon: "spotify",
      iconColor: "#1DB954",
      mode: "background"
    },
    {
      id: "volume-75",
      title: "Volume 75%",
      keywords: [
        "spotify"
      ],
      icon: "spotify",
      iconColor: "#1DB954",
      mode: "background"
    },
    {
      id: "volume-100",
      title: "Volume 100%",
      keywords: [
        "spotify"
      ],
      icon: "spotify",
      iconColor: "#1DB954",
      mode: "background"
    },
    {
      id: "volume-up",
      title: "Volume Up",
      keywords: [
        "spotify"
      ],
      icon: "spotify",
      iconColor: "#1DB954",
      mode: "background"
    },
    {
      id: "volume-down",
      title: "Volume Down",
      keywords: [
        "spotify"
      ],
      icon: "spotify",
      iconColor: "#1DB954",
      mode: "background"
    },
    {
      id: "start-radio",
      title: "Start Radio",
      keywords: [
        "spotify"
      ],
      icon: "spotify",
      iconColor: "#1DB954",
      mode: "background"
    },
    {
      id: "current-track",
      title: "Current Track",
      keywords: [
        "spotify"
      ],
      icon: "spotify",
      iconColor: "#1DB954",
      mode: "view"
    },
    {
      id: "copy-url",
      title: "Copy Track URL",
      keywords: [
        "spotify"
      ],
      icon: "spotify",
      iconColor: "#1DB954",
      mode: "background"
    },
    {
      id: "copy-artist-and-title",
      title: "Copy Artist and Title",
      keywords: [
        "spotify"
      ],
      icon: "spotify",
      iconColor: "#1DB954",
      mode: "background"
    },
    {
      id: "copy-embed",
      title: "Copy Embed Code",
      keywords: [
        "spotify"
      ],
      icon: "spotify",
      iconColor: "#1DB954",
      mode: "background"
    },
    {
      id: "skip-15",
      title: "Skip 15 Seconds",
      keywords: [
        "spotify"
      ],
      icon: "spotify",
      iconColor: "#1DB954",
      mode: "background"
    },
    {
      id: "back-15",
      title: "Back 15 Seconds",
      keywords: [
        "spotify"
      ],
      icon: "spotify",
      iconColor: "#1DB954",
      mode: "background"
    },
    {
      id: "add-playing-to-playlist",
      title: "Add Playing Song to Playlist",
      keywords: [
        "spotify"
      ],
      icon: "spotify",
      iconColor: "#1DB954",
      mode: "view"
    },
    {
      id: "remove-playing-from-playlist",
      title: "Remove Playing Song from Playlist",
      keywords: [
        "spotify"
      ],
      icon: "spotify",
      iconColor: "#1DB954",
      mode: "view"
    },
    {
      id: "find-lyrics",
      title: "Find Lyrics",
      keywords: [
        "spotify",
        "lyrics"
      ],
      icon: "spotify",
      iconColor: "#1DB954",
      mode: "view"
    }
  ],
  nativeMethods: [
    "http.fetch",
    "clipboard.write",
    "oauth.authorize",
    "oauth.redirectUri",
    "oauth.status",
    "oauth.disconnect",
    "secrets.get",
    "secrets.set",
    "secrets.delete",
    "image.fetch",
    "hud.show",
    "media.current",
    "media.control",
    "storage.*"
  ],
  httpHosts: [
    "api.spotify.com",
    "i.scdn.co",
    "mosaic.scdn.co",
    "thisis-images.scdn.co",
    "misc.scdn.co",
    "lrclib.net",
    ".spotifycdn.com"
  ],
  oauth: [
    "spotify"
  ],
  preferences: [
    {
      name: "clientId",
      type: "password",
      title: "Spotify client id",
      description: "Paste the client id of your own Spotify app (developer.spotify.com/dashboard). Register the exact redirect URI shown by the Connect Spotify command as the app redirect URI.",
      required: false
    }
  ]
};

// ../../flowkey/cli/shims/flowkey-native-sdk.ts
var host3 = globalThis.__FLOWKEY_HOST__;
var nativeSdk = host3?.nativeSdk ?? {};
function missing2(name) {
  throw new Error(
    `the FlowKey sidecar did not provide @flowkey-mini/native-sdk (missing ${name}); rebuild the extension with @flowkey-mini/cli`
  );
}
var defineExtension = nativeSdk.defineExtension ?? ((module2) => module2);
var createCapabilities = nativeSdk.createCapabilities ?? (() => missing2("createCapabilities"));
var randomId = nativeSdk.randomId ?? (() => missing2("randomId"));
var captureException = nativeSdk.captureException ?? ((error) => missing2("captureException"));

// src/api/client.ts
var OAUTH_TIMEOUT_MS = 15e4;
var API_CALL_TIMEOUT_MS = 2e4;
var DEV_MODE_LIMIT_CAP = 10;
var API_BASE = "https://api.spotify.com/v1";
var SpotifyApiError = class extends Error {
  constructor(code, message, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
};
var SpotifyClient = class {
  constructor(call) {
    this.call = call;
    this.devicesCache = null;
    this.oauth = createCapabilities(call).oauth;
  }
  async authorize(signal, clientId) {
    return this.oauth.authorize("spotify", {
      clientId,
      signal,
      timeoutMs: OAUTH_TIMEOUT_MS
    });
  }
  async authStatus(signal) {
    return this.oauth.status("spotify", { signal });
  }
  async disconnect() {
    await this.oauth.disconnect("spotify");
    return { ok: true };
  }
  async fetchImage(url, signal) {
    const result = await this.call(
      "image.fetch",
      { url },
      { signal, timeoutMs: API_CALL_TIMEOUT_MS }
    );
    return result.uri;
  }
  async api(path, init) {
    const result = await this.request(path, init);
    return parseBody(result.status, result.bodyText);
  }
  async apiVoid(path, init) {
    const result = await this.request(path, init);
    if (result.status >= 200 && result.status < 300) {
      return;
    }
    parseBody(result.status, result.bodyText);
  }
  async request(path, init) {
    const params = {
      url: API_BASE + path,
      method: init?.method ?? "GET",
      auth: "spotify",
      timeoutMs: 15e3
    };
    if (init?.body !== void 0) {
      params.body = JSON.stringify(init.body);
      params.headers = { "Content-Type": "application/json" };
    }
    try {
      return await this.call("http.fetch", params, {
        signal: init?.signal,
        timeoutMs: API_CALL_TIMEOUT_MS
      });
    } catch (error) {
      throw normalizeNativeError(error);
    }
  }
  me() {
    return this.api("/me");
  }
  async copyText(text) {
    await this.call("clipboard.write", { text });
  }
  search(query, types, limit = 50, signal) {
    const cappedLimit = Math.min(limit, DEV_MODE_LIMIT_CAP);
    return this.api(
      `/search?q=${encodeURIComponent(query)}&type=${encodeURIComponent(types.join(","))}&limit=${cappedLimit}`,
      { signal }
    );
  }
  currentlyPlaying(signal) {
    return this.api("/me/player/currently-playing?additional_types=episode", { signal });
  }
  playbackState(signal) {
    return this.api("/me/player?additional_types=episode", { signal });
  }
  async findLyrics(trackName, artistName, signal) {
    const cleanedTitle = cleanMediaTitle(trackName) || trackName;
    const cleanedArtist = cleanMediaTitle(artistName) || artistName;
    const queries = [
      `track_name=${encodeURIComponent(trackName)}&artist_name=${encodeURIComponent(artistName)}`,
      `track_name=${encodeURIComponent(cleanedTitle)}&artist_name=${encodeURIComponent(cleanedArtist)}`,
      `q=${encodeURIComponent(`${cleanedTitle} ${cleanedArtist}`.trim())}`,
      `q=${encodeURIComponent(cleanedTitle)}`
    ];
    for (const query of queries) {
      const hit = await this.searchLyricsOnce(query, trackName, artistName, signal);
      if (hit) return hit;
    }
    return null;
  }
  async searchLyricsOnce(query, trackName, artistName, signal) {
    const url = `https://lrclib.net/api/search?${query}`;
    const call = () => this.call(
      "http.fetch",
      { url, method: "GET", timeoutMs: 15e3 },
      { signal, timeoutMs: API_CALL_TIMEOUT_MS }
    );
    let result;
    try {
      result = await call();
    } catch (error) {
      throw normalizeNativeError(error);
    }
    if (result.status === 503) {
      try {
        result = await call();
      } catch (error) {
        throw normalizeNativeError(error);
      }
    }
    const hits = parseBody(result.status, result.bodyText, "lyrics service");
    const hit = hits?.find((entry) => typeof entry.syncedLyrics === "string" && entry.syncedLyrics) ?? hits?.find((entry) => typeof entry.plainLyrics === "string" && entry.plainLyrics);
    if (!hit) {
      return null;
    }
    const plainLyrics = typeof hit.plainLyrics === "string" ? hit.plainLyrics : "";
    const syncedLyrics = typeof hit.syncedLyrics === "string" ? hit.syncedLyrics : null;
    return {
      trackName: hit.trackName ?? trackName,
      artistName: hit.artistName ?? artistName,
      plainLyrics,
      syncedLyrics
    };
  }
  devices() {
    return this.api("/me/player/devices");
  }
  transferPlayback(deviceId, play) {
    return this.apiVoid("/me/player", { method: "PUT", body: { device_ids: [deviceId], play } });
  }
  async play(body, deviceId) {
    if (deviceId) {
      await this.apiVoid(`/me/player/play?device_id=${encodeURIComponent(deviceId)}`, {
        method: "PUT",
        body
      });
      return;
    }
    try {
      await this.apiVoid("/me/player/play", { method: "PUT", body });
      return;
    } catch (error) {
      const device = await this.fallbackPlaybackDevice();
      if (!device) {
        throw error;
      }
      await this.transferPlayback(device.id, true);
      await this.apiVoid(`/me/player/play?device_id=${encodeURIComponent(device.id)}`, {
        method: "PUT",
        body
      });
    }
  }
  async fallbackPlaybackDevice() {
    try {
      const state = await this.playbackState();
      if (state?.device?.is_active && !state.device.is_restricted) {
        return state.device;
      }
      if (!this.devicesCache || Date.now() - this.devicesCache.at > 3e4) {
        const { devices } = await this.devices();
        this.devicesCache = { at: Date.now(), devices };
      }
      return this.devicesCache.devices.find((device) => !device.is_restricted) ?? null;
    } catch {
      return null;
    }
  }
  pause() {
    return this.apiVoid("/me/player/pause", { method: "PUT" });
  }
  next() {
    return this.apiVoid("/me/player/next", { method: "POST" });
  }
  previous() {
    return this.apiVoid("/me/player/previous", { method: "POST" });
  }
  seek(positionMs) {
    return this.apiVoid(`/me/player/seek?position_ms=${Math.max(0, Math.round(positionMs))}`, {
      method: "PUT"
    });
  }
  setVolume(percent) {
    const clamped = Math.min(100, Math.max(0, Math.round(percent)));
    return this.apiVoid(`/me/player/volume?volume_percent=${clamped}`, { method: "PUT" });
  }
  setShuffle(state) {
    return this.apiVoid(`/me/player/shuffle?state=${state}`, { method: "PUT" });
  }
  setRepeat(state) {
    return this.apiVoid(`/me/player/repeat?state=${state}`, { method: "PUT" });
  }
  queue() {
    return this.api("/me/player/queue");
  }
  addToQueue(uri) {
    return this.apiVoid(`/me/player/queue?uri=${encodeURIComponent(uri)}`, { method: "POST" });
  }
  async savedTracks(limit = 50, signal) {
    return this.api(`/me/tracks?limit=${limit}`, { signal });
  }
  savedAlbums(limit = 50, signal) {
    return this.api(`/me/albums?limit=${limit}`, { signal });
  }
  savedShows(limit = 50, signal) {
    return this.api(`/me/shows?limit=${limit}`, { signal });
  }
  savedEpisodes(limit = 50, signal) {
    return this.api(`/me/episodes?limit=${limit}`, { signal });
  }
  containsSavedTracks(ids) {
    return this.api(`/me/tracks/contains?ids=${ids.join(",")}`);
  }
  addToSavedTracks(ids) {
    return this.apiVoid(`/me/tracks?ids=${ids.join(",")}`, { method: "PUT" });
  }
  removeFromSavedTracks(ids) {
    return this.apiVoid(`/me/tracks?ids=${ids.join(",")}`, { method: "DELETE" });
  }
  containsSavedAlbums(ids) {
    return this.api(`/me/albums/contains?ids=${ids.join(",")}`);
  }
  addToSavedAlbums(ids) {
    return this.apiVoid(`/me/albums?ids=${ids.join(",")}`, { method: "PUT" });
  }
  removeFromSavedAlbums(ids) {
    return this.apiVoid(`/me/albums?ids=${ids.join(",")}`, { method: "DELETE" });
  }
  followedArtists(limit = 50) {
    return this.api(`/me/following?type=artist&limit=${limit}`);
  }
  myPlaylists(limit = 50) {
    return this.api(`/me/playlists?limit=${limit}`);
  }
  artistTopTracks(artistId, market) {
    return this.api(`/artists/${artistId}/top-tracks?market=${encodeURIComponent(market)}`);
  }
  async artistAlbums(artistId, limit = 200) {
    const collected = [];
    let offset = 0;
    while (collected.length < limit) {
      const page = await this.api(
        `/artists/${artistId}/albums?limit=${Math.min(DEV_MODE_LIMIT_CAP, limit - collected.length)}&offset=${offset}`
      );
      for (const album of page.items) {
        if (album) {
          collected.push(album);
        }
      }
      if (!page.next || page.items.length === 0) {
        break;
      }
      offset += DEV_MODE_LIMIT_CAP;
    }
    return { items: collected, next: null, total: collected.length };
  }
  track(trackId, signal) {
    return this.api(`/tracks/${trackId}`, { signal });
  }
  artist(artistId) {
    return this.api(`/artists/${artistId}`);
  }
  albumTracks(albumId, limit = 50) {
    return this.api(`/albums/${albumId}/tracks?limit=${limit}`);
  }
  async playlistTracks(playlistId, limit = 500) {
    const collected = [];
    let offset = 0;
    while (collected.length < limit) {
      const page = await this.api(
        `/playlists/${playlistId}/tracks?limit=${Math.min(50, limit - collected.length)}&offset=${offset}`
      );
      for (const entry of page.items) {
        if (entry.track?.id) {
          collected.push(entry.track);
        }
      }
      if (!page.next || page.items.length === 0) {
        return collected;
      }
      offset += 50;
    }
    return collected;
  }
  addToPlaylist(playlistId, uris) {
    return this.apiVoid(`/playlists/${playlistId}/tracks`, { method: "POST", body: { uris } });
  }
  removeFromPlaylist(playlistId, uri) {
    return this.apiVoid(`/playlists/${playlistId}/tracks`, {
      method: "DELETE",
      body: { tracks: [{ uri }] }
    });
  }
  createPlaylist(userId, name, description) {
    return this.api(`/users/${userId}/playlists`, {
      method: "POST",
      body: description ? { name, description } : { name }
    });
  }
  recommendations(seeds) {
    const parts = [];
    if (seeds.tracks?.length) {
      parts.push(`seed_tracks=${seeds.tracks.join(",")}`);
    }
    if (seeds.artists?.length) {
      parts.push(`seed_artists=${seeds.artists.join(",")}`);
    }
    return this.api(`/recommendations?${parts.join("&")}&limit=50`);
  }
};
function cleanMediaTitle(title) {
  const cleaned = title.replace(/[(\[].*?[)\]]/g, " ").replace(/\b(feat\.?|ft\.?)\b.*$/i, " ").replace(/\s+-\s+[^-]*$/, " ").replace(/\s{2,}/g, " ").trim();
  return cleaned.length >= 2 ? cleaned : title.trim();
}
function parseBody(status, bodyText, service = "spotify") {
  if (status === 204 || bodyText.length === 0) {
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    throw new SpotifyApiError(
      "invalidResponse",
      `${service} returned malformed json (${status}): ${JSON.stringify(bodyText.slice(0, 60))}`,
      status
    );
  }
  if (status < 200 || status >= 300) {
    const error = parsed;
    throw new SpotifyApiError(
      error?.error?.reason ?? "apiError",
      error?.error?.message ?? `${service} returned ${status}`,
      status
    );
  }
  return parsed;
}
function normalizeNativeError(error) {
  const candidate = error;
  if (candidate?.code) {
    return new SpotifyApiError(
      candidate.code,
      candidate.message ?? candidate.code,
      candidate.status
    );
  }
  return new SpotifyApiError("nativeError", String(error));
}

// src/format.ts
function formatMs(durationMs) {
  const totalSeconds = Math.floor(durationMs / 1e3);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor(totalSeconds % 3600 / 60);
  const seconds = totalSeconds % 60;
  const pad = (value) => value.toString().padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}
function trackUrl(track) {
  return `https://open.spotify.com/track/${track.id}`;
}
function externalUrl(kind, id) {
  return `https://open.spotify.com/${kind}/${id}`;
}

// src/recent.ts
var MAX_ENTRIES = 10;
var MIN_LENGTH = 4;
var entries = [];
function rememberSearch(query) {
  const trimmed = query.trim();
  if (trimmed.length < MIN_LENGTH || entries[0] === trimmed) {
    return;
  }
  entries = [trimmed, ...entries.filter((entry) => entry !== trimmed)].slice(0, MAX_ENTRIES);
}
function recentSearches() {
  return [...entries];
}
function removeSearch(query) {
  entries = entries.filter((entry) => entry !== query);
}
function clearRecentSearches() {
  entries = [];
}

// src/store.ts
var LIBRARY_TTL_MS = 5 * 60 * 1e3;
var libraryCache = null;
function peekLibrary() {
  if (libraryCache && Date.now() - libraryCache.at < LIBRARY_TTL_MS) {
    return libraryCache.data;
  }
  return null;
}
async function loadLibrary(client) {
  const cached = peekLibrary();
  if (cached) {
    return cached;
  }
  const data = await once("library", async () => {
    const [playlists, savedAlbums, followed, savedTracks, savedShows, savedEpisodes, me] = await Promise.all([
      client.myPlaylists(50),
      client.savedAlbums(50),
      client.followedArtists(50),
      client.savedTracks(50),
      client.savedShows(50),
      client.savedEpisodes(50),
      client.me()
    ]);
    return {
      results: {
        playlists: { ...playlists, items: playlists.items.filter(Boolean) },
        albums: { ...savedAlbums, items: savedAlbums.items.map((entry) => entry.album).filter(Boolean) },
        artists: { ...followed.artists, items: followed.artists.items.filter(Boolean), total: followed.artists.items.length },
        tracks: { ...savedTracks, items: savedTracks.items.map((entry) => entry.track).filter(Boolean) },
        shows: { ...savedShows, items: savedShows.items.map((entry) => entry.show).filter(Boolean) },
        episodes: {
          ...savedEpisodes,
          items: savedEpisodes.items.map((entry) => entry.episode).filter(Boolean)
        }
      },
      me,
      likedTotal: savedTracks.total
    };
  });
  libraryCache = { at: Date.now(), data };
  return data;
}
var likedTracksCache = /* @__PURE__ */ new Map();
async function loadLikedTracks(client) {
  const cached = likedTracksCache.get("liked");
  if (cached) {
    return cached;
  }
  const tracks = await once("liked-tracks", async () => {
    const page = await client.savedTracks(50);
    return page.items.map((entry) => entry.track).filter(Boolean);
  });
  likedTracksCache.set("liked", tracks);
  return tracks;
}
function peekLikedTracks() {
  return likedTracksCache.get("liked") ?? null;
}
var albumTracksCache = /* @__PURE__ */ new Map();
var artistTopCache = /* @__PURE__ */ new Map();
var artistAlbumsCache = /* @__PURE__ */ new Map();
var inflight = /* @__PURE__ */ new Map();
var profile = null;
async function once(key, load) {
  const pending = inflight.get(key);
  if (pending) {
    return pending;
  }
  const promise = load();
  inflight.set(key, promise);
  try {
    return await promise;
  } finally {
    inflight.delete(key);
  }
}
async function loadProfile(client) {
  if (profile) {
    return profile;
  }
  profile = await once("profile", () => client.me());
  return profile;
}
async function loadAlbumTracks(client, albumId) {
  const cached = albumTracksCache.get(albumId);
  if (cached) {
    return cached;
  }
  const tracks = await once(`album:${albumId}`, async () => {
    const page = await client.albumTracks(albumId, 50);
    return page.items.filter((track) => Boolean(track));
  });
  albumTracksCache.set(albumId, tracks);
  return tracks;
}
async function loadArtistTopTracks(client, artistId) {
  const cached = artistTopCache.get(artistId);
  if (cached) {
    return cached;
  }
  const tracks = await once(`artist-top:${artistId}`, async () => {
    try {
      const { country } = await loadProfile(client);
      const { tracks: top } = await client.artistTopTracks(artistId, country || "US");
      return top.filter((track) => Boolean(track)).slice(0, 10);
    } catch (error) {
      if (error instanceof SpotifyApiError && (error.status === 403 || error.status === 404)) {
        return loadArtistTopTracksBySearch(client, artistId);
      }
      throw error;
    }
  });
  artistTopCache.set(artistId, tracks);
  return tracks;
}
async function loadArtistTopTracksBySearch(client, artistId) {
  const artist = await client.artist(artistId);
  const response = await client.search(artist.name, ["track"], 10);
  const tracks = (response.tracks?.items ?? []).filter(
    (item) => Boolean(item)
  );
  if (tracks.length === 0) {
    throw new SpotifyApiError("noTopTracks", "no tracks found for this artist");
  }
  return tracks;
}
async function loadArtistAlbums(client, artistId) {
  const cached = artistAlbumsCache.get(artistId);
  if (cached) {
    return cached;
  }
  const albums = await once(`artist-albums:${artistId}`, async () => {
    const page = await client.artistAlbums(artistId, 50);
    return page.items.filter((album) => Boolean(album));
  });
  artistAlbumsCache.set(artistId, albums);
  return albums;
}
function peekAlbumTracks(albumId) {
  return albumTracksCache.get(albumId) ?? null;
}
function peekArtistTracks(artistId) {
  return artistTopCache.get(artistId) ?? null;
}
function peekArtistAlbums(artistId) {
  return artistAlbumsCache.get(artistId) ?? null;
}

// src/search-model.ts
var SEARCH_FILTERS = [
  { value: "all", label: "All" },
  { value: "artists", label: "Artists" },
  { value: "tracks", label: "Songs" },
  { value: "albums", label: "Albums" },
  { value: "playlists", label: "Playlists" },
  { value: "shows", label: "Podcasts & Shows" },
  { value: "episodes", label: "Episodes" }
];
var ALL_TYPES = ["track", "artist", "album", "playlist", "show", "episode"];
function typesForFilter(filter) {
  switch (filter) {
    case "artists":
      return ["artist"];
    case "tracks":
      return ["track"];
    case "albums":
      return ["album"];
    case "playlists":
      return ["playlist"];
    case "shows":
      return ["show"];
    case "episodes":
      return ["episode"];
    default:
      return ALL_TYPES;
  }
}
function pruneResults(results) {
  const pruned = {};
  for (const key of ["tracks", "artists", "albums", "playlists", "shows", "episodes"]) {
    const page = results[key];
    if (page) {
      pruned[key] = { ...page, items: page.items.filter((item) => Boolean(item)) };
    }
  }
  return pruned;
}
function isAborted(error) {
  return error?.code === "aborted";
}
function describeError(error) {
  if (error instanceof SpotifyApiError) {
    const suffix = error.status ? ` (${error.status})` : "";
    const message = suffix && error.message.endsWith(suffix) ? error.message : `${error.message}${suffix}`;
    if (error.status === 403) {
      return message + " - in Development Mode, add this account under User Management in your Spotify dashboard";
    }
    return message;
  }
  const candidate = error;
  return candidate?.message ?? "Something went wrong";
}
async function startRadio(client, seeds, signal) {
  let uris = [];
  try {
    const recommendations = await client.recommendations(seeds);
    uris = (recommendations.tracks ?? []).map((track) => track.uri).filter(Boolean);
  } catch (caught) {
    if (isAborted(caught)) throw caught;
    uris = [];
  }
  if (uris.length === 0) {
    const artistId = await radioArtistId(client, seeds, signal);
    if (artistId) {
      const top = await loadArtistTopTracks(client, artistId);
      uris = top.map((track) => track.uri).filter(Boolean);
    }
  }
  if (uris.length === 0) {
    throw new SpotifyApiError("noRadioTracks", "Spotify returned no radio tracks");
  }
  const seedUris = (seeds.tracks ?? []).map((id) => `spotify:track:${id}`);
  const queue = [...seedUris, ...uris.filter((uri) => !seedUris.includes(uri))].slice(0, 25);
  await client.play({ uris: queue });
}
async function radioArtistId(client, seeds, signal) {
  if (seeds.artists?.length) {
    return seeds.artists[0];
  }
  const trackId = seeds.tracks?.[0];
  if (!trackId) {
    return null;
  }
  try {
    const track = await client.track(trackId, signal);
    return track?.artists?.[0]?.id ?? null;
  } catch (caught) {
    if (isAborted(caught)) throw caught;
    return null;
  }
}
function filterLibrary(results, query) {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) {
    return results;
  }
  const match = (haystacks) => haystacks.some((value) => value.toLowerCase().includes(needle));
  const filtered = {};
  const writable = filtered;
  for (const key of ["tracks", "artists", "albums", "playlists", "shows", "episodes"]) {
    const page = results[key];
    if (!page) continue;
    writable[key] = {
      ...page,
      items: page.items.filter((item) => {
        const candidate = item;
        return match([
          candidate.name ?? "",
          ...candidate.artists?.map((artist) => artist.name) ?? [],
          candidate.owner?.display_name ?? "",
          candidate.publisher ?? ""
        ]);
      })
    };
  }
  return filtered;
}

// ../../flowkey/cli/shims/react-jsx-runtime.ts
var host4 = globalThis.__FLOWKEY_HOST__;
var jsxRuntime = host4?.reactJsx ?? {};
function missing3(name) {
  throw new Error(
    `the FlowKey sidecar did not provide the JSX runtime (missing ${name}); rebuild the extension with @flowkey-mini/cli`
  );
}
var fallback = () => missing3("jsx");
var Fragment2 = jsxRuntime.Fragment;
var jsx = jsxRuntime.jsx ?? fallback;
var jsxs = jsxRuntime.jsxs ?? fallback;
var jsxDEV = jsxRuntime.jsxDEV ?? jsx;

// src/subviews.tsx
var ALBUM_SONGS_PREFIX = "album-songs:";
var ARTIST_SONGS_PREFIX = "artist-songs:";
var ARTIST_ALBUMS_PREFIX = "artist-albums:";
var LIKED_SONGS_PREFIX = "liked-songs:";
function albumSongsKey(albumId) {
  return ALBUM_SONGS_PREFIX + albumId;
}
function artistSongsKey(artistId) {
  return ARTIST_SONGS_PREFIX + artistId;
}
function artistAlbumsKey(artistId) {
  return ARTIST_ALBUMS_PREFIX + artistId;
}
function likedSongsKey(userId) {
  return LIKED_SONGS_PREFIX + userId;
}
function isSubViewCommand(commandId) {
  return commandId !== void 0 && (commandId.startsWith(ALBUM_SONGS_PREFIX) || commandId.startsWith(ARTIST_SONGS_PREFIX) || commandId.startsWith(ARTIST_ALBUMS_PREFIX) || commandId.startsWith(LIKED_SONGS_PREFIX));
}
function matches(query, haystacks) {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) {
    return true;
  }
  return haystacks.some((value) => value.toLowerCase().includes(needle));
}
function trackSubtitle(track) {
  return `${track.artists.map((artist) => artist.name).join(", ")} \xB7 ${formatMs(track.duration_ms)}`;
}
function TracksView({
  tracks,
  query,
  client,
  loadingTitle,
  errorTitle,
  errorMessage
}) {
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 4e3);
    return () => clearTimeout(timer);
  }, [notice]);
  if (errorMessage) {
    return /* @__PURE__ */ jsx(List, { children: /* @__PURE__ */ jsx(List.EmptyView, { title: errorTitle, description: errorMessage }) });
  }
  if (!tracks) {
    return /* @__PURE__ */ jsx(List, { children: /* @__PURE__ */ jsx(List.EmptyView, { title: loadingTitle }) });
  }
  const visible = tracks.filter(
    (track) => matches(query, [track.name, ...track.artists.map((artist) => artist.name)])
  );
  if (visible.length === 0) {
    return /* @__PURE__ */ jsx(List, { children: /* @__PURE__ */ jsx(List.EmptyView, { title: "No matching songs" }) });
  }
  return /* @__PURE__ */ jsxs(List, { children: [
    notice ? /* @__PURE__ */ jsx(List.Section, { title: "Status", children: /* @__PURE__ */ jsx(List.Item, { id: "notice", title: notice, icon: { lucide: "info" } }) }) : null,
    visible.map((track) => /* @__PURE__ */ jsx(
      List.Item,
      {
        id: track.id,
        title: track.name,
        subtitle: trackSubtitle(track),
        kind: "track",
        icon: listImage(track.album?.images),
        actions: trackActions(track, client, setNotice, new AbortController().signal)
      },
      track.id
    ))
  ] });
}
function useLoaded(cached, load, client) {
  const [value, setValue] = useState(cached);
  const [error, setError] = useState("");
  useEffect(() => {
    if (value) return;
    let alive = true;
    load(client).then((loaded) => {
      if (alive) setValue(loaded);
    }).catch((caught) => {
      if (alive) setError(caught.message ?? "Something went wrong");
    });
    return () => {
      alive = false;
    };
  }, [client, load, value]);
  return { value, error };
}
function AlbumSongsRoot(props) {
  const client = useMemo(() => new SpotifyClient(props.native.call), [props.native]);
  const albumId = (props.commandId ?? "").slice(ALBUM_SONGS_PREFIX.length);
  const { value, error } = useLoaded(peekAlbumTracks(albumId), (c) => loadAlbumTracks(c, albumId), client);
  return createElement(TracksView, {
    tracks: value,
    query: props.query,
    client,
    loadingTitle: "Loading songs\u2026",
    errorTitle: "Could not load album",
    errorMessage: error
  });
}
function LikedSongsRoot(props) {
  const client = useMemo(() => new SpotifyClient(props.native.call), [props.native]);
  const { value, error } = useLoaded(peekLikedTracks(), (c) => loadLikedTracks(c), client);
  return createElement(TracksView, {
    tracks: value,
    query: props.query,
    client,
    loadingTitle: "Loading liked songs\u2026",
    errorTitle: "Could not load liked songs",
    errorMessage: error
  });
}
function ArtistSongsRoot(props) {
  const client = useMemo(() => new SpotifyClient(props.native.call), [props.native]);
  const artistId = (props.commandId ?? "").slice(ARTIST_SONGS_PREFIX.length);
  const { value, error } = useLoaded(
    peekArtistTracks(artistId),
    (c) => loadArtistTopTracks(c, artistId),
    client
  );
  return createElement(TracksView, {
    tracks: value,
    query: props.query,
    client,
    loadingTitle: "Loading popular songs\u2026",
    errorTitle: "Could not load popular songs",
    errorMessage: error
  });
}
function ArtistAlbumsRoot(props) {
  const client = useMemo(() => new SpotifyClient(props.native.call), [props.native]);
  const artistId = (props.commandId ?? "").slice(ARTIST_ALBUMS_PREFIX.length);
  const { value, error } = useLoaded(peekArtistAlbums(artistId), (c) => loadArtistAlbums(c, artistId), client);
  if (error) {
    return createElement(
      Grid,
      { columns: 5 },
      createElement(Grid.EmptyView, { title: "Could not load albums", description: error })
    );
  }
  if (!value) {
    return createElement(Grid, { columns: 5 }, createElement(Grid.EmptyView, { title: "Loading albums\u2026" }));
  }
  const visible = value.filter(
    (album) => matches(props.query, [album.name, ...album.artists.map((artist) => artist.name)])
  );
  if (visible.length === 0) {
    return createElement(Grid, { columns: 5 }, createElement(Grid.EmptyView, { title: "No matching albums" }));
  }
  return createElement(AlbumsGrid, { albums: visible, client });
}
function AlbumsGrid({ albums, client }) {
  return createElement(
    Grid,
    { columns: 5, title: albums[0]?.artists[0]?.name ?? "Albums" },
    albums.map((album) => {
      const images = album.images ?? [];
      const url = (images.length > 1 ? images[1]?.url : images[0]?.url) ?? images[0]?.url;
      return createElement(Grid.Item, {
        key: album.id,
        id: album.id,
        title: album.name,
        subtitle: `${album.artists.map((artist) => artist.name).join(", ")} \xB7 ${album.release_date.slice(0, 4)}`,
        kind: "album",
        icon: url ? { uri: url } : void 0,
        actions: albumActions(album, client, () => {
        }, new AbortController().signal)
      });
    })
  );
}
function warmAlbumSongs(client, albumId) {
  void loadAlbumTracks(client, albumId).catch(() => {
  });
}
function warmArtistSongs(client, artistId) {
  void loadArtistTopTracks(client, artistId).catch(() => {
  });
}
function warmArtistAlbums(client, artistId) {
  void loadArtistAlbums(client, artistId).catch(() => {
  });
}

// src/search.tsx
var SEARCH_DEBOUNCE_MS = 150;
var RECENT_SAVE_DEBOUNCE_MS = 3e3;
var NOTICE_CLEAR_MS = 4e3;
var GRID_FILTERS = /* @__PURE__ */ new Set(["artists", "albums", "shows"]);
function SearchCommand({ query, filterValue, native, signal, preferences }) {
  const client = useMemo(() => new SpotifyClient(native.call), [native]);
  const configuredClientId = typeof preferences.clientId === "string" && preferences.clientId.length > 0 ? preferences.clientId : "";
  const filter = filterValue ?? "all";
  const [authState, setAuthState] = useState(
    "checking"
  );
  const [authMessage, setAuthMessage] = useState("");
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [recentVersion, setRecentVersion] = useState(0);
  const saveTimer = useRef(null);
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const status = await client.authStatus(controller.signal);
        setAuthState(status.ok ? "authorized" : "unauthorized");
      } catch (caught) {
        if (isAborted(caught)) return;
        setAuthState("unauthorized");
        setAuthMessage(describeAuthError(caught));
      }
    })();
    return () => controller.abort();
  }, [client]);
  useEffect(() => {
    if (authState !== "authorized") return;
    if (query.trim().length === 0) {
      setResults(null);
      setLoading(false);
      setError("");
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      setError("");
      (async () => {
        try {
          const response = await client.search(
            query.trim(),
            typesForFilter(filter),
            50,
            controller.signal
          );
          setResults(pruneResults(response));
        } catch (caught) {
          if (isAborted(caught)) return;
          if (caught instanceof SpotifyApiError && caught.code === "authRequired") {
            setAuthState("unauthorized");
            setAuthMessage("Your Spotify session expired.");
          } else {
            setError(describeError(caught));
          }
        } finally {
          if (!controller.signal.aborted) {
            setLoading(false);
          }
        }
      })();
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [client, authState, query, filter]);
  useEffect(() => {
    if (authState !== "authorized" || query.trim().length < 4) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const pending = query.trim();
    saveTimer.current = setTimeout(() => {
      rememberSearch(pending);
      setRecentVersion((version) => version + 1);
    }, RECENT_SAVE_DEBOUNCE_MS);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [authState, query]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), NOTICE_CLEAR_MS);
    return () => clearTimeout(timer);
  }, [notice]);
  if (authState === "checking") {
    return /* @__PURE__ */ jsx(List, { filter: SEARCH_FILTERS, children: /* @__PURE__ */ jsx(List.EmptyView, { title: "Checking Spotify connection\u2026" }, "checking") });
  }
  if (authState === "unauthorized") {
    return /* @__PURE__ */ jsx(
      ConnectView,
      {
        native,
        signal,
        configuredClientId,
        authMessage,
        setAuthState
      }
    );
  }
  if (query.trim().length === 0) {
    const recents = recentSearches();
    return /* @__PURE__ */ jsxs(List, { filter: SEARCH_FILTERS, children: [
      /* @__PURE__ */ jsx(List.EmptyView, { title: "What do you want to listen to?" }),
      notice ? /* @__PURE__ */ jsx(List.Section, { title: "Status", children: /* @__PURE__ */ jsx(List.Item, { id: "notice", title: notice, icon: { lucide: "info" } }) }) : null,
      recents.length > 0 ? /* @__PURE__ */ jsx(List.Section, { title: "Recent Searches", children: recents.map((recent) => /* @__PURE__ */ jsx(
        List.Item,
        {
          id: `recent:${recent}`,
          title: recent,
          icon: { lucide: "clock" },
          actions: /* @__PURE__ */ jsxs(ActionPanel, { children: [
            /* @__PURE__ */ jsx(
              Action,
              {
                title: "Remove Search",
                onAction: () => {
                  removeSearch(recent);
                  setRecentVersion((version) => version + 1);
                }
              }
            ),
            /* @__PURE__ */ jsx(
              Action,
              {
                title: "Remove All Searches",
                onAction: () => {
                  clearRecentSearches();
                  setRecentVersion((version) => version + 1);
                }
              }
            )
          ] })
        },
        recent
      )) }) : null
    ] });
  }
  if (GRID_FILTERS.has(filter)) {
    const items = buildGridItems(results, filter, client, setNotice, signal);
    return /* @__PURE__ */ jsxs(Grid, { columns: 5, title: gridTitle(filter), children: [
      error ? /* @__PURE__ */ jsx(Grid.EmptyView, { title: "Search failed", description: error }) : null,
      !error && loading ? /* @__PURE__ */ jsx(Grid.EmptyView, { title: "Searching\u2026" }) : null,
      !error && !loading && items.length === 0 ? /* @__PURE__ */ jsx(Grid.EmptyView, { title: "No results", description: `Nothing found for "${query.trim()}"` }) : null,
      notice ? /* @__PURE__ */ jsx(Grid.Section, { title: "Status", children: /* @__PURE__ */ jsx(Grid.Item, { id: "notice", title: notice, icon: { lucide: "info" } }) }) : null,
      items
    ] });
  }
  const sections = buildListSections(results, filter, client, setNotice, signal);
  const searching = loading || results === null;
  return /* @__PURE__ */ jsxs(List, { filter: SEARCH_FILTERS, children: [
    error ? /* @__PURE__ */ jsx(List.EmptyView, { title: "Search failed", description: error }) : null,
    !error && searching ? /* @__PURE__ */ jsx(List.EmptyView, { title: "Searching\u2026" }) : null,
    !error && !searching && sections.length === 0 ? /* @__PURE__ */ jsx(List.EmptyView, { title: "No results", description: `Nothing found for "${query.trim()}"` }) : null,
    notice ? /* @__PURE__ */ jsx(List.Section, { title: "Status", children: /* @__PURE__ */ jsx(List.Item, { id: "notice", title: notice, icon: { lucide: "info" } }) }) : null,
    sections
  ] });
}
function gridTitle(filter) {
  return SEARCH_FILTERS.find((option) => option.value === filter)?.label ?? "Results";
}
function withFreshIds(nodes, seen) {
  return nodes.map((node) => {
    const id = node?.props?.id;
    if (typeof id !== "string" || id.length === 0) return node;
    if (!seen.has(id)) {
      seen.add(id);
      return node;
    }
    let n = 2;
    while (seen.has(`${id}~${n}`)) n += 1;
    return cloneElement(node, { id: `${id}~${n}` });
  });
}
function buildListSections(results, filter, client, setNotice, signal, options = {}) {
  const sections = [];
  const seenIds = /* @__PURE__ */ new Set();
  const allLimit = (fallback2) => options.sectionLimit ?? fallback2;
  const artists = results?.artists?.items ?? [];
  const tracks = results?.tracks?.items ?? [];
  const albums = results?.albums?.items ?? [];
  const playlists = results?.playlists?.items ?? [];
  const shows = results?.shows?.items ?? [];
  const episodes = results?.episodes?.items ?? [];
  if ((filter === "all" || filter === "artists") && artists.length > 0) {
    sections.push(
      createElement(
        List.Section,
        { title: "Artists", key: "artists" },
        withFreshIds(
          artists.slice(0, filter === "all" ? allLimit(3) : 50).map((artist) => artistListItem(artist, client, setNotice, signal)),
          seenIds
        )
      )
    );
  }
  if ((filter === "all" || filter === "tracks") && tracks.length > 0) {
    sections.push(
      createElement(
        List.Section,
        { title: options.tracksTitle ?? "Songs", key: "tracks" },
        withFreshIds(
          tracks.slice(0, filter === "all" ? allLimit(4) : 50).map((track) => trackListItem(track, client, setNotice, signal)),
          seenIds
        )
      )
    );
  }
  if ((filter === "all" || filter === "albums") && albums.length > 0) {
    sections.push(
      createElement(
        List.Section,
        { title: "Albums", key: "albums" },
        withFreshIds(
          albums.slice(0, filter === "all" ? allLimit(6) : 50).map((album) => albumListItem("list", album, client, setNotice, signal)),
          seenIds
        )
      )
    );
  }
  if ((filter === "all" || filter === "playlists") && (playlists.length > 0 || filter === "playlists")) {
    sections.push(
      createElement(List.Section, { title: "Playlists", key: "playlists" }, [
        ...options.likedSongsItem ? [options.likedSongsItem] : [],
        ...withFreshIds(
          playlists.slice(0, filter === "all" ? allLimit(6) : 50).map((playlist) => playlistListItem(playlist, client, setNotice, signal)),
          seenIds
        )
      ])
    );
  }
  if ((filter === "all" || filter === "shows") && shows.length > 0) {
    sections.push(
      createElement(
        List.Section,
        { title: "Podcasts & Shows", key: "shows" },
        withFreshIds(
          shows.slice(0, filter === "all" ? allLimit(3) : 50).map((show) => showListItem("list", show, client, setNotice, signal)),
          seenIds
        )
      )
    );
  }
  if ((filter === "all" || filter === "episodes") && episodes.length > 0) {
    sections.push(
      createElement(
        List.Section,
        { title: options.episodesTitle ?? "Episodes", key: "episodes" },
        withFreshIds(
          episodes.slice(0, filter === "all" ? allLimit(3) : 50).map((episode) => episodeListItem(episode, client, setNotice, signal)),
          seenIds
        )
      )
    );
  }
  return sections.filter(Boolean);
}
function buildGridItems(results, filter, client, setNotice, signal) {
  const seenIds = /* @__PURE__ */ new Set();
  if (filter === "artists") {
    return withFreshIds(
      (results?.artists?.items ?? []).map(
        (artist) => createElement(Grid.Item, {
          key: artist.id,
          id: artist.id,
          title: artist.name,
          kind: "artist",
          icon: gridImage(artist.images),
          actions: artistActions(artist, client, setNotice, signal)
        })
      ),
      seenIds
    );
  }
  if (filter === "albums") {
    return withFreshIds(
      (results?.albums?.items ?? []).map(
        (album) => createElement(Grid.Item, {
          key: album.id,
          id: album.id,
          title: album.name,
          subtitle: `${artistNames(album.artists)} \xB7 ${album.release_date.slice(0, 4)}`,
          kind: "album",
          icon: gridImage(album.images),
          actions: albumActions(album, client, setNotice, signal)
        })
      ),
      seenIds
    );
  }
  return withFreshIds(
    (results?.shows?.items ?? []).map(
      (show) => createElement(Grid.Item, {
        key: show.id,
        id: show.id,
        title: show.name,
        subtitle: show.publisher,
        kind: "show",
        icon: gridImage(show.images),
        actions: showActions(show, client, setNotice, signal)
      })
    ),
    seenIds
  );
}
function listImage(images) {
  const url = images?.at(-1)?.url ?? images?.[0]?.url;
  return url ? { uri: url } : void 0;
}
function gridImage(images) {
  const url = (images?.length ?? 0) > 1 ? images?.[1]?.url : images?.[0]?.url;
  return url ? { uri: url } : void 0;
}
function artistNames(artists) {
  return artists.map((artist) => artist.name).join(", ");
}
function artistListItem(artist, client, setNotice, signal) {
  return createElement(List.Item, {
    key: artist.id,
    id: artist.id,
    title: artist.name,
    kind: "artist",
    icon: listImage(artist.images),
    actions: artistActions(artist, client, setNotice, signal)
  });
}
function trackListItem(track, client, setNotice, signal) {
  return createElement(List.Item, {
    key: track.id,
    id: track.id,
    title: track.name,
    subtitle: `${artistNames(track.artists)} \xB7 ${formatMs(track.duration_ms)}`,
    kind: "track",
    icon: listImage(track.album?.images),
    actions: trackActions(track, client, setNotice, signal)
  });
}
function albumListItem(mode, album, client, setNotice, signal) {
  if (mode === "grid") {
    return createElement(Grid.Item, {
      key: album.id,
      id: album.id,
      title: album.name,
      subtitle: `${artistNames(album.artists)} \xB7 ${album.release_date.slice(0, 4)}`,
      kind: "album",
      icon: gridImage(album.images),
      actions: albumActions(album, client, setNotice, signal)
    });
  }
  return createElement(List.Item, {
    key: album.id,
    id: album.id,
    title: album.name,
    subtitle: `${artistNames(album.artists)} \xB7 ${album.release_date.slice(0, 4)}`,
    kind: "album",
    icon: listImage(album.images),
    actions: albumActions(album, client, setNotice, signal)
  });
}
function playlistListItem(playlist, client, setNotice, signal) {
  return createElement(List.Item, {
    key: playlist.id,
    id: playlist.id,
    title: playlist.name,
    subtitle: playlist.owner?.display_name ?? "",
    kind: "playlist",
    icon: listImage(playlist.images),
    actions: playlistActions(playlist, client, setNotice, signal)
  });
}
function showListItem(mode, show, client, setNotice, signal) {
  return createElement(mode === "grid" ? Grid.Item : List.Item, {
    key: show.id,
    id: show.id,
    title: show.name,
    subtitle: show.publisher,
    kind: "show",
    icon: mode === "grid" ? gridImage(show.images) : listImage(show.images),
    actions: showActions(show, client, setNotice, signal)
  });
}
function episodeListItem(episode, client, setNotice, signal) {
  return createElement(List.Item, {
    key: episode.id,
    id: episode.id,
    title: episode.name,
    subtitle: episode.show?.name ?? "",
    kind: "episode",
    icon: listImage(episode.show?.images ?? episode.images),
    actions: episodeActions(episode, client, setNotice, signal)
  });
}
function artistActions(artist, client, setNotice, signal) {
  return /* @__PURE__ */ jsxs(ActionPanel, { children: [
    /* @__PURE__ */ jsx(
      Action,
      {
        title: "Play",
        icon: { lucide: "play" },
        onAction: async () => {
          try {
            await client.play({ context_uri: `spotify:artist:${artist.id}` }, void 0);
          } catch (caught) {
            setNotice(describeError(caught));
          }
        }
      }
    ),
    /* @__PURE__ */ jsx(
      Action,
      {
        title: "Start Radio",
        icon: { lucide: "forward" },
        onAction: async () => {
          try {
            await startRadio(client, { artists: [artist.id] }, signal);
            setNotice(`Radio started from ${artist.name}`);
          } catch (caught) {
            setNotice(describeError(caught));
          }
        }
      }
    ),
    /* @__PURE__ */ jsx(
      Action,
      {
        title: "Go to Songs",
        icon: { lucide: "music" },
        push: artistSongsKey(artist.id),
        onAction: () => {
          warmArtistSongs(client, artist.id);
        }
      }
    ),
    /* @__PURE__ */ jsx(
      Action,
      {
        title: "Go to Albums",
        icon: { lucide: "image" },
        push: artistAlbumsKey(artist.id),
        onAction: () => {
          warmArtistAlbums(client, artist.id);
        }
      }
    ),
    /* @__PURE__ */ jsx(
      Action,
      {
        title: "Copy Artist Link",
        icon: { lucide: "copy-clipboard" },
        onAction: async () => {
          await copyToClipboard(client, externalUrl("artist", artist.id));
          setNotice("Copied artist link");
        }
      }
    )
  ] });
}
function trackActions(track, client, setNotice, signal) {
  return /* @__PURE__ */ jsxs(ActionPanel, { children: [
    /* @__PURE__ */ jsx(
      Action,
      {
        title: "Play",
        icon: { lucide: "play" },
        onAction: async () => {
          try {
            await client.play({ uris: [track.uri] });
            setNotice(`Playing ${track.name}`);
          } catch (caught) {
            setNotice(describeError(caught));
          }
        }
      }
    ),
    /* @__PURE__ */ jsx(
      Action,
      {
        title: "Like / Unlike",
        icon: { lucide: "star" },
        onAction: async () => {
          try {
            const liked = await client.containsSavedTracks([track.id]);
            if (liked[0]) {
              await client.removeFromSavedTracks([track.id]);
              setNotice(`Removed ${track.name} from Liked Songs`);
            } else {
              await client.addToSavedTracks([track.id]);
              setNotice(`Liked ${track.name}`);
            }
          } catch (caught) {
            setNotice(describeError(caught));
          }
        }
      }
    ),
    /* @__PURE__ */ jsx(
      Action,
      {
        title: "Add to Queue",
        icon: { lucide: "list" },
        onAction: async () => {
          try {
            await client.addToQueue(track.uri);
            setNotice(`Added ${track.name} to queue`);
          } catch (caught) {
            setNotice(describeError(caught));
          }
        }
      }
    ),
    /* @__PURE__ */ jsx(
      Action,
      {
        title: "Start Radio",
        icon: { lucide: "forward" },
        onAction: async () => {
          try {
            await startRadio(client, { tracks: [track.id] }, signal);
            setNotice(`Radio started from ${track.name}`);
          } catch (caught) {
            setNotice(describeError(caught));
          }
        }
      }
    ),
    /* @__PURE__ */ jsx(
      Action,
      {
        title: "Copy Track Link",
        icon: { lucide: "copy-clipboard" },
        onAction: async () => {
          await copyToClipboard(client, trackUrl(track));
          setNotice("Copied track link");
        }
      }
    )
  ] });
}
function albumActions(album, client, setNotice, signal) {
  return /* @__PURE__ */ jsxs(ActionPanel, { children: [
    /* @__PURE__ */ jsx(
      Action,
      {
        title: "Play",
        icon: { lucide: "play" },
        onAction: async () => {
          try {
            await client.play({ context_uri: `spotify:album:${album.id}` });
          } catch (caught) {
            setNotice(describeError(caught));
          }
        }
      }
    ),
    /* @__PURE__ */ jsx(
      Action,
      {
        title: "Add / Remove from Library",
        icon: { lucide: "star" },
        onAction: async () => {
          try {
            const saved = await client.containsSavedAlbums([album.id]);
            if (saved[0]) {
              await client.removeFromSavedAlbums([album.id]);
              setNotice(`Removed ${album.name} from library`);
            } else {
              await client.addToSavedAlbums([album.id]);
              setNotice(`Added ${album.name} to library`);
            }
          } catch (caught) {
            setNotice(describeError(caught));
          }
        }
      }
    ),
    /* @__PURE__ */ jsx(
      Action,
      {
        title: "Copy Album Link",
        icon: { lucide: "copy-clipboard" },
        onAction: async () => {
          await copyToClipboard(client, externalUrl("album", album.id));
          setNotice("Copied album link");
        }
      }
    ),
    /* @__PURE__ */ jsx(
      Action,
      {
        title: "Go to Songs",
        icon: { lucide: "music" },
        push: albumSongsKey(album.id),
        onAction: () => {
          warmAlbumSongs(client, album.id);
        }
      }
    )
  ] });
}
function playlistActions(playlist, client, setNotice, signal) {
  return /* @__PURE__ */ jsxs(ActionPanel, { children: [
    /* @__PURE__ */ jsx(
      Action,
      {
        title: "Play",
        icon: { lucide: "play" },
        onAction: async () => {
          try {
            await client.play({ context_uri: `spotify:playlist:${playlist.id}` });
          } catch (caught) {
            setNotice(describeError(caught));
          }
        }
      }
    ),
    /* @__PURE__ */ jsx(
      Action,
      {
        title: "Copy Playlist Link",
        icon: { lucide: "copy-clipboard" },
        onAction: async () => {
          await copyToClipboard(client, externalUrl("playlist", playlist.id));
          setNotice("Copied playlist link");
        }
      }
    )
  ] });
}
function showActions(show, client, setNotice, signal) {
  return /* @__PURE__ */ jsxs(ActionPanel, { children: [
    /* @__PURE__ */ jsx(
      Action,
      {
        title: "Play",
        icon: { lucide: "play" },
        onAction: async () => {
          try {
            await client.play({ context_uri: `spotify:show:${show.id}` });
          } catch (caught) {
            setNotice(describeError(caught));
          }
        }
      }
    ),
    /* @__PURE__ */ jsx(
      Action,
      {
        title: "Copy Show Link",
        icon: { lucide: "copy-clipboard" },
        onAction: async () => {
          await copyToClipboard(client, externalUrl("show", show.id));
          setNotice("Copied show link");
        }
      }
    )
  ] });
}
function episodeActions(episode, client, setNotice, signal) {
  return /* @__PURE__ */ jsxs(ActionPanel, { children: [
    /* @__PURE__ */ jsx(
      Action,
      {
        title: "Play",
        icon: { lucide: "play" },
        onAction: async () => {
          try {
            await client.play({ uris: [episode.uri] });
            setNotice(`Playing ${episode.name}`);
          } catch (caught) {
            setNotice(describeError(caught));
          }
        }
      }
    ),
    /* @__PURE__ */ jsx(
      Action,
      {
        title: "Add to Queue",
        icon: { lucide: "list" },
        onAction: async () => {
          try {
            await client.addToQueue(episode.uri);
            setNotice(`Added ${episode.name} to queue`);
          } catch (caught) {
            setNotice(describeError(caught));
          }
        }
      }
    )
  ] });
}
async function copyToClipboard(client, text) {
  await client.copyText(text);
}
function describeAuthError(error) {
  const candidate = error;
  if (candidate?.code === "notConfigured") {
    return "Spotify client id is not configured on this machine. See the FlowKey README.";
  }
  return "";
}
function ConnectView({
  native,
  signal,
  configuredClientId,
  authMessage,
  setAuthState
}) {
  const client = useMemo(() => new SpotifyClient(native.call), [native]);
  const [redirectUri, setRedirectUri] = useState(null);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await native.call("oauth.redirectUri", { provider: "spotify" });
        if (!cancelled) setRedirectUri(result.redirectUri);
      } catch {
        if (!cancelled) setRedirectUri(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [native]);
  const description = notice || authMessage || (configuredClientId ? "1. Register the Redirect URI below in your Spotify app (dashboard \u2192 Edit).  2. Connect. Spotify compares the URI exactly." : "Paste your client id in FlowKey Settings \u2192 Spotify (Save), register the Redirect URI below in your Spotify app, then Connect.");
  return /* @__PURE__ */ jsxs(List, { filter: SEARCH_FILTERS, children: [
    /* @__PURE__ */ jsx(List.EmptyView, { title: "Connect Spotify", description }),
    /* @__PURE__ */ jsx(
      List.Item,
      {
        id: "redirect-uri",
        title: "Redirect URI to register",
        subtitle: redirectUri ?? "loading\u2026",
        icon: { lucide: "link", color: "#1DB954" },
        actions: /* @__PURE__ */ jsx(ActionPanel, { children: /* @__PURE__ */ jsx(
          Action,
          {
            title: "Copy Redirect URI",
            icon: { lucide: "link" },
            onAction: async () => {
              if (!redirectUri) return;
              await copyToClipboard(client, redirectUri);
              setNotice("Redirect URI copied \u2014 paste it into your Spotify app settings.");
            }
          }
        ) })
      }
    ),
    /* @__PURE__ */ jsx(
      List.Item,
      {
        id: "connect-spotify",
        title: "Connect Spotify",
        icon: { lucide: "plug", color: "#1DB954" },
        actions: /* @__PURE__ */ jsx(ActionPanel, { children: /* @__PURE__ */ jsx(
          Action,
          {
            title: "Connect Spotify",
            icon: { lucide: "forward" },
            onAction: async () => {
              if (!configuredClientId) {
                setNotice("Add your Spotify client id in FlowKey Settings \u2192 Spotify (Save), then connect again.");
                return;
              }
              setNotice("Waiting for Spotify authorization\u2026");
              try {
                const result = await client.authorize(signal, configuredClientId);
                if (result.ok) {
                  setNotice("");
                  setAuthState("authorized");
                } else {
                  setNotice("Authorization did not complete.");
                }
              } catch (caught) {
                if (isAborted(caught)) return;
                if (caught instanceof SpotifyApiError && caught.code === "notConfigured") {
                  setNotice("Add your Spotify client id in FlowKey Settings \u2192 Spotify (Save), then connect again.");
                } else {
                  setNotice(describeError(caught));
                }
              }
            }
          }
        ) })
      }
    )
  ] });
}

// src/library.tsx
var LIKED_SONGS_ICON = "https://misc.scdn.co/liked-songs-64.png";
var GRID_FILTERS2 = /* @__PURE__ */ new Set(["artists", "albums", "shows"]);
function LibraryCommand({ query, filterValue, native, signal }) {
  const client = useMemo(() => new SpotifyClient(native.call), [native]);
  const filter = filterValue ?? "all";
  const [authState, setAuthState] = useState(
    "checking"
  );
  const [data, setData] = useState(() => null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const status = await client.authStatus(controller.signal);
        setAuthState(status.ok ? "authorized" : "unauthorized");
      } catch (caught) {
        if (caught?.code === "aborted") return;
        setAuthState("unauthorized");
      }
    })();
    return () => controller.abort();
  }, [client]);
  useEffect(() => {
    if (authState !== "authorized") return;
    let alive = true;
    (async () => {
      try {
        const library = await loadLibrary(client);
        if (alive) setData(library);
      } catch (caught) {
        if (!alive) return;
        if (caught instanceof SpotifyApiError && caught.code === "authRequired") {
          setAuthState("unauthorized");
        } else {
          setError(caught.message ?? "Could not load your library");
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [authState, client]);
  if (authState === "checking") {
    return /* @__PURE__ */ jsx(List, { filter: SEARCH_FILTERS, children: /* @__PURE__ */ jsx(List.EmptyView, { title: "Checking Spotify connection\u2026" }) });
  }
  if (authState === "unauthorized") {
    return /* @__PURE__ */ jsxs(List, { filter: SEARCH_FILTERS, children: [
      /* @__PURE__ */ jsx(
        List.EmptyView,
        {
          title: "Connect Spotify",
          description: "Authorize FlowKey to browse your library. Use Spotify Search \u2192 Connect Spotify if the client id is not set yet."
        }
      ),
      /* @__PURE__ */ jsx(
        LibraryConnectItem,
        {
          client,
          signal,
          onConnected: () => setAuthState("authorized")
        }
      )
    ] });
  }
  if (error) {
    return /* @__PURE__ */ jsx(List, { filter: SEARCH_FILTERS, children: /* @__PURE__ */ jsx(List.EmptyView, { title: "Could not load your library", description: error }) });
  }
  if (!data) {
    return /* @__PURE__ */ jsx(List, { filter: SEARCH_FILTERS, children: /* @__PURE__ */ jsx(List.EmptyView, { title: "Loading your library\u2026" }) });
  }
  const results = filterLibrary(data.results, query);
  if (GRID_FILTERS2.has(filter)) {
    const items = buildGridItems(results, filter, client, () => {
    }, signal);
    if (items.length === 0) {
      return /* @__PURE__ */ jsx(Grid, { columns: 5, children: /* @__PURE__ */ jsx(Grid.EmptyView, { title: "Nothing here", description: emptyDescription(query) }) });
    }
    return /* @__PURE__ */ jsx(Grid, { columns: 5, title: gridTitle2(filter), children: items });
  }
  const sections = buildListSections(results, filter, client, () => {
  }, signal, {
    tracksTitle: "Liked Songs",
    episodesTitle: "Saved Episodes",
    sectionLimit: 6,
    likedSongsItem: likedSongsItem(data, client)
  });
  if (sections.length === 0) {
    return /* @__PURE__ */ jsx(List, { filter: SEARCH_FILTERS, children: /* @__PURE__ */ jsx(List.EmptyView, { title: "Nothing here", description: emptyDescription(query) }) });
  }
  return /* @__PURE__ */ jsx(List, { filter: SEARCH_FILTERS, children: sections });
}
function LibraryConnectItem({
  client,
  signal,
  onConnected
}) {
  return createElement(List.Item, {
    id: "connect-spotify",
    title: "Connect Spotify",
    icon: { lucide: "plug", color: "#1DB954" },
    actions: createElement(
      ActionPanel,
      null,
      createElement(Action, {
        title: "Connect Spotify",
        onAction: async () => {
          try {
            const result = await client.authorize(signal);
            if (result.ok) {
              onConnected();
            }
          } catch {
          }
        }
      })
    )
  });
}
function likedSongsItem(data, client) {
  const total = data.likedTotal;
  return createElement(List.Item, {
    id: "liked-songs",
    title: "Liked Songs",
    subtitle: `${total} songs`,
    kind: "playlist",
    icon: { uri: LIKED_SONGS_ICON },
    actions: createElement(
      ActionPanel,
      null,
      createElement(Action, {
        title: "Play",
        primary: true,
        onAction: async () => {
          await client.play({ context_uri: `spotify:user:${data.me.id}:collection` });
        }
      }),
      createElement(Action, {
        title: "Go to Songs",
        push: likedSongsKey(data.me.id),
        onAction: () => {
        }
      })
    )
  });
}
function emptyDescription(query) {
  return query.trim().length > 0 ? `Nothing in your library matches "${query.trim()}"` : "Your library is empty";
}
function gridTitle2(filter) {
  return SEARCH_FILTERS.find((option) => option.value === filter)?.label ?? "Library";
}

// src/now-playing.tsx
var POLL_INTERVAL_MS = 5e3;
function isTrack(item) {
  return item !== null && "artists" in item;
}
function nowPlayingActions({
  client,
  state,
  track,
  refresh,
  setNotice,
  liked,
  setLiked
}) {
  const run = (title, done, body) => async () => {
    try {
      await body();
      setNotice(done);
      refresh();
    } catch (caught) {
      if (isAborted(caught)) return;
      setNotice(describeError(caught));
    }
  };
  return /* @__PURE__ */ jsxs(ActionPanel, { children: [
    /* @__PURE__ */ jsx(
      Action,
      {
        title: state.is_playing ? "Pause" : "Play",
        icon: { lucide: state.is_playing ? "pause" : "play" },
        primary: true,
        onAction: run(
          "toggle",
          state.is_playing ? "Paused" : "Playing",
          () => state.is_playing ? client.pause() : client.play({})
        )
      }
    ),
    /* @__PURE__ */ jsx(
      Action,
      {
        title: "Next",
        icon: { lucide: "forward" },
        onAction: run("next", "Skipped to next track", () => client.next())
      }
    ),
    /* @__PURE__ */ jsx(
      Action,
      {
        title: "Previous",
        icon: { lucide: "rewind" },
        onAction: run("previous", "Went back to previous track", () => client.previous())
      }
    ),
    /* @__PURE__ */ jsx(
      Action,
      {
        title: liked ? "Unlike" : "Like",
        icon: { lucide: "star" },
        onAction: run("like", "Updated Liked Songs", async () => {
          if (liked) {
            await client.removeFromSavedTracks([track.id]);
            setLiked(false);
          } else {
            await client.addToSavedTracks([track.id]);
            setLiked(true);
          }
        })
      }
    ),
    /* @__PURE__ */ jsx(
      Action,
      {
        title: state.shuffle_state ? "Shuffle Off" : "Shuffle On",
        icon: { lucide: "switch" },
        onAction: run("shuffle", "Updated shuffle", () => client.setShuffle(!state.shuffle_state))
      }
    ),
    /* @__PURE__ */ jsx(
      Action,
      {
        title: `Repeat: ${state.repeat_state}`,
        icon: { lucide: "arrow-clockwise" },
        onAction: run("repeat", "Updated repeat", () => {
          const order = ["off", "track", "context"];
          const next = order[(order.indexOf(state.repeat_state) + 1) % order.length];
          return client.setRepeat(next);
        })
      }
    ),
    /* @__PURE__ */ jsx(
      Action,
      {
        title: "Copy Track Link",
        icon: { lucide: "copy-clipboard" },
        onAction: async () => {
          await client.copyText(`https://open.spotify.com/track/${track.id}`);
          setNotice("Copied track link");
        }
      }
    ),
    /* @__PURE__ */ jsx(
      Action,
      {
        title: "Copy Artist and Title",
        icon: { lucide: "copy-clipboard" },
        onAction: async () => {
          await client.copyText(
            `${track.artists.map((artist) => artist.name).join(", ")} - ${track.name}`
          );
          setNotice("Copied artist and title");
        }
      }
    )
  ] });
}
function NowPlayingCommand({ native, signal }) {
  const client = useMemo(() => new SpotifyClient(native.call), [native]);
  const [authState, setAuthState] = useState(
    "checking"
  );
  const [authMessage, setAuthMessage] = useState("");
  const [state, setState] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState("");
  const [pollVersion, setPollVersion] = useState(0);
  const mounted = useRef(true);
  const refresh = () => setPollVersion((version) => version + 1);
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    (async () => {
      try {
        const status = await client.authStatus(controller.signal);
        if (mounted.current) setAuthState(status.ok ? "authorized" : "unauthorized");
      } catch (caught) {
        if (isAborted(caught)) return;
        if (mounted.current) {
          setAuthState("unauthorized");
          setAuthMessage(caught.message ?? "Could not check Spotify connection");
        }
      }
    })();
    return () => {
      mounted.current = false;
      controller.abort();
    };
  }, [client]);
  useEffect(() => {
    if (authState !== "authorized") return;
    let alive = true;
    const controller = new AbortController();
    let timer = null;
    const poll = async () => {
      try {
        const next = await client.playbackState(controller.signal);
        if (alive) {
          setState(next);
          setLoadError("");
        }
      } catch (caught) {
        if (isAborted(caught)) return;
        if (caught instanceof SpotifyApiError && caught.code === "authRequired") {
          if (alive) setAuthState("unauthorized");
          return;
        }
        if (alive) setLoadError(describeError(caught));
      } finally {
        if (alive && !controller.signal.aborted) {
          timer = setTimeout(poll, POLL_INTERVAL_MS);
        }
      }
    };
    void poll();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      controller.abort();
    };
  }, [client, authState, pollVersion]);
  const currentTrack = state && state.item && isTrack(state.item) ? state.item : null;
  const [liked, setLiked] = useState(null);
  const likedTrackId = currentTrack?.id ?? null;
  useEffect(() => {
    if (!likedTrackId) return;
    let alive = true;
    client.containsSavedTracks([likedTrackId]).then((result) => {
      if (alive) setLiked(result[0] ?? null);
    }).catch(() => {
    });
    return () => {
      alive = false;
    };
  }, [client, likedTrackId, pollVersion]);
  if (authState === "checking") {
    return /* @__PURE__ */ jsx(List, { children: /* @__PURE__ */ jsx(List.EmptyView, { title: "Checking Spotify connection\u2026" }) });
  }
  if (authState === "unauthorized") {
    return /* @__PURE__ */ jsx(List, { children: /* @__PURE__ */ jsx(
      List.EmptyView,
      {
        title: "Connect Spotify",
        description: authMessage || "Run the Spotify Search command and connect to authorize FlowKey first."
      }
    ) });
  }
  if (loadError) {
    return /* @__PURE__ */ jsx(List, { children: /* @__PURE__ */ jsx(List.EmptyView, { title: "Could not load playback", description: loadError }) });
  }
  if (!state || !state.device) {
    return /* @__PURE__ */ jsx(List, { children: /* @__PURE__ */ jsx(
      List.EmptyView,
      {
        title: "No active Spotify device",
        description: "Open Spotify on any device and start playback, then try again."
      }
    ) });
  }
  const track = currentTrack;
  if (!track) {
    return /* @__PURE__ */ jsx(List, { children: /* @__PURE__ */ jsx(
      List.EmptyView,
      {
        title: "Nothing playing",
        description: "Start a track in Spotify to see it here."
      }
    ) });
  }
  const artists = track.artists.map((artist) => artist.name).join(", ");
  const artworkUrl = track.album?.images?.[0]?.url ?? "";
  return /* @__PURE__ */ jsx(
    Detail,
    {
      title: track.name,
      subtitle: `by ${artists}`,
      imageUri: artworkUrl || void 0,
      markdown: notice ? notice : `# ${track.name}

by ${artists}`,
      actions: nowPlayingActions({ client, state, track, refresh, setNotice, liked, setLiked }),
      children: /* @__PURE__ */ jsxs(Detail.Metadata, { children: [
        /* @__PURE__ */ jsx(Detail.Metadata.Field, { label: "Track", value: track.name }),
        /* @__PURE__ */ jsx(Detail.Metadata.Field, { label: "Duration", value: formatMs(track.duration_ms) }),
        /* @__PURE__ */ jsx(Detail.Metadata.Field, { label: "Artists", value: artists }),
        /* @__PURE__ */ jsx(Detail.Metadata.Field, { label: "Album", value: track.album?.name ?? "Unknown album" }),
        /* @__PURE__ */ jsx(Detail.Metadata.Field, { label: "Liked", value: liked === null ? "\u2026" : liked ? "Yes" : "No" })
      ] })
    }
  );
}

// src/lyrics.ts
function parseLrc(source) {
  const lines = [];
  for (const raw of source.split("\n")) {
    const match = raw.match(/^\[(\d+):(\d+(?:\.\d+)?)\](.*)$/);
    if (!match) continue;
    const text = match[3].trim();
    if (!text) continue;
    lines.push({
      timeMs: Math.round((parseInt(match[1], 10) * 60 + parseFloat(match[2])) * 1e3),
      text
    });
  }
  return lines;
}
function projectedPositionMs(media) {
  if (!media.playing) return media.positionMs;
  return media.positionMs + Math.max(0, Date.now() - media.updatedAtMs);
}
function activeLineIndex(lines, positionMs) {
  let index = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].timeMs <= positionMs) {
      index = i;
    } else {
      break;
    }
  }
  return index;
}

// src/player-commands.tsx
var SEEK_STEP_MS = 15e3;
var EMBED_SNIPPET = '<iframe src="https://open.spotify.com/embed/track/{id}" width="45%" height="152" frameBorder="0" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" loading="lazy"></iframe>';
function isTrack2(item) {
  return item !== null && "artists" in item;
}
async function mediaSkipOutcome(command, call) {
  let currentTitle = null;
  let snapshotFailed = false;
  try {
    const media = await call("media.current");
    currentTitle = media?.title?.trim() || null;
  } catch {
    snapshotFailed = true;
  }
  try {
    await call("media.control", { command });
  } catch (caught) {
    return { kind: "message", title: describeError(caught) };
  }
  if (currentTitle) {
    return {
      kind: "message",
      title: command === "next" ? `Skipped ${currentTitle}` : `Went back to ${currentTitle}`
    };
  }
  if (snapshotFailed) {
    return {
      kind: "message",
      title: command === "next" ? "Skipped to next track" : "Went back to previous track"
    };
  }
  return { kind: "noTrack" };
}
async function playbackStateWithRetry(client) {
  try {
    return await client.playbackState();
  } catch (caught) {
    if (caught instanceof SpotifyApiError && caught.code === "invalidResponse") {
      return await client.playbackState();
    }
    throw caught;
  }
}
async function withContext(client, action) {
  try {
    const state = await playbackStateWithRetry(client);
    if (!state || !state.device) {
      return { kind: "noDevice" };
    }
    const track = isTrack2(state.item) ? state.item : null;
    if (!track) {
      return { kind: "noTrack" };
    }
    const title = await action({ track, state });
    return { kind: "message", title };
  } catch (caught) {
    if (caught instanceof SpotifyApiError && caught.code === "authRequired") {
      return { kind: "authRequired" };
    }
    return { kind: "message", title: describeError(caught) };
  }
}
function OutcomeView({ outcome, workingTitle }) {
  if (outcome.kind === "working") {
    return /* @__PURE__ */ jsx(List, { children: /* @__PURE__ */ jsx(List.EmptyView, { title: workingTitle }) });
  }
  if (outcome.kind === "authRequired") {
    return /* @__PURE__ */ jsx(List, { children: /* @__PURE__ */ jsx(
      List.EmptyView,
      {
        title: "Connect Spotify",
        description: "Run the Spotify Search command and connect to authorize FlowKey first."
      }
    ) });
  }
  if (outcome.kind === "noDevice") {
    return /* @__PURE__ */ jsx(List, { children: /* @__PURE__ */ jsx(
      List.EmptyView,
      {
        title: "No active Spotify device",
        description: "Open Spotify on any device and start playback, then try again."
      }
    ) });
  }
  if (outcome.kind === "noTrack") {
    return /* @__PURE__ */ jsx(List, { children: /* @__PURE__ */ jsx(
      List.EmptyView,
      {
        title: "Nothing playing",
        description: "Start a track in Spotify to try again."
      }
    ) });
  }
  return /* @__PURE__ */ jsx(List, { children: /* @__PURE__ */ jsx(List.EmptyView, { title: outcome.title, description: outcome.description }) });
}
function usePlayerCommand(client, action) {
  const [outcome, setOutcome] = useState({ kind: "working" });
  const actionRef = useRef(action);
  actionRef.current = action;
  useEffect(() => {
    let alive = true;
    withContext(client, (context) => actionRef.current(context)).then((result) => {
      if (alive) setOutcome(result);
    });
    return () => {
      alive = false;
    };
  }, [client]);
  return outcome;
}
function outcomeHudTitle(outcome) {
  if (outcome.kind === "message") {
    return outcome.title;
  }
  if (outcome.kind === "authRequired") {
    return "Spotify not connected";
  }
  if (outcome.kind === "noDevice") {
    return "No active Spotify device";
  }
  if (outcome.kind === "noTrack") {
    return "No track playing";
  }
  return null;
}
function SimplePlayerCommand({
  native,
  workingTitle,
  action
}) {
  const client = useMemo(() => new SpotifyClient(native.call), [native]);
  const outcome = usePlayerCommand(client, (context) => action(context, client));
  useEffect(() => {
    const title = outcomeHudTitle(outcome);
    if (title) {
      void native.showHud({ title });
    }
  }, [outcome, native]);
  return /* @__PURE__ */ jsx(OutcomeView, { outcome, workingTitle });
}
function TogglePlayPauseCommand(props) {
  return /* @__PURE__ */ jsx(
    SimplePlayerCommand,
    {
      ...props,
      workingTitle: "Toggling playback\u2026",
      action: async ({ track, state }, client) => {
        if (state.is_playing) {
          await client.pause();
          return `Paused ${track.name}`;
        }
        await client.play({});
        return `Playing ${track.name}`;
      }
    }
  );
}
function MediaSkipCommand({
  native,
  workingTitle,
  command
}) {
  const [outcome, setOutcome] = useState({ kind: "working" });
  useEffect(() => {
    let alive = true;
    void mediaSkipOutcome(command, native.call).then((result) => {
      if (alive) setOutcome(result);
    });
    return () => {
      alive = false;
    };
  }, [native, command]);
  useEffect(() => {
    const title = outcomeHudTitle(outcome);
    if (title) {
      void native.showHud({ title });
    }
  }, [outcome, native]);
  return /* @__PURE__ */ jsx(OutcomeView, { outcome, workingTitle });
}
function NextCommand(props) {
  return /* @__PURE__ */ jsx(MediaSkipCommand, { ...props, workingTitle: "Skipping\u2026", command: "next" });
}
function PreviousCommand(props) {
  return /* @__PURE__ */ jsx(MediaSkipCommand, { ...props, workingTitle: "Going back\u2026", command: "previous" });
}
function JustPlayCommand(props) {
  return /* @__PURE__ */ jsx(
    SimplePlayerCommand,
    {
      ...props,
      workingTitle: "Resuming\u2026",
      action: async ({ track }, client) => {
        await client.play({});
        return `Playing ${track.name}`;
      }
    }
  );
}
function LikeCommand(props) {
  return /* @__PURE__ */ jsx(
    SimplePlayerCommand,
    {
      ...props,
      workingTitle: "Liking track\u2026",
      action: async ({ track }, client) => {
        await client.addToSavedTracks([track.id]);
        return `Liked ${track.name}`;
      }
    }
  );
}
function DislikeCommand(props) {
  return /* @__PURE__ */ jsx(
    SimplePlayerCommand,
    {
      ...props,
      workingTitle: "Removing from Liked Songs\u2026",
      action: async ({ track }, client) => {
        await client.removeFromSavedTracks([track.id]);
        return `Removed ${track.name} from Liked Songs`;
      }
    }
  );
}
function ToggleShuffleCommand(props) {
  return /* @__PURE__ */ jsx(
    SimplePlayerCommand,
    {
      ...props,
      workingTitle: "Toggling shuffle\u2026",
      action: async ({ state }, client) => {
        const next = !state.shuffle_state;
        await client.setShuffle(next);
        return next ? "Shuffle on" : "Shuffle off";
      }
    }
  );
}
function CycleRepeatCommand(props) {
  return /* @__PURE__ */ jsx(
    SimplePlayerCommand,
    {
      ...props,
      workingTitle: "Cycling repeat\u2026",
      action: async ({ state }, client) => {
        const order = ["off", "track", "context"];
        const next = order[(order.indexOf(state.repeat_state) + 1) % order.length];
        await client.setRepeat(next);
        return `Repeat: ${next}`;
      }
    }
  );
}
function ReplayCommand(props) {
  return /* @__PURE__ */ jsx(
    SimplePlayerCommand,
    {
      ...props,
      workingTitle: "Restarting track\u2026",
      action: async ({ track }, client) => {
        await client.seek(0);
        return `Restarted ${track.name}`;
      }
    }
  );
}
function Skip15Command(props) {
  return /* @__PURE__ */ jsx(
    SimplePlayerCommand,
    {
      ...props,
      workingTitle: "Skipping forward\u2026",
      action: async ({ track, state }, client) => {
        const target = (state.progress_ms ?? 0) + SEEK_STEP_MS;
        await client.seek(Math.min(target, track.duration_ms));
        return `Skipped forward in ${track.name}`;
      }
    }
  );
}
function Back15Command(props) {
  return /* @__PURE__ */ jsx(
    SimplePlayerCommand,
    {
      ...props,
      workingTitle: "Rewinding\u2026",
      action: async ({ track, state }, client) => {
        await client.seek(Math.max((state.progress_ms ?? 0) - SEEK_STEP_MS, 0));
        return `Rewound ${track.name}`;
      }
    }
  );
}
function VolumeCommand(props) {
  return /* @__PURE__ */ jsx(
    SimplePlayerCommand,
    {
      ...props,
      workingTitle: "Setting volume\u2026",
      action: async ({ state }, client) => {
        const current = state.device?.volume_percent ?? 50;
        const target = props.percent !== void 0 ? props.percent : Math.min(100, Math.max(0, current + (props.delta ?? 0)));
        await client.setVolume(target);
        return `Volume: ${target}%`;
      }
    }
  );
}
function StartRadioCommand(props) {
  return /* @__PURE__ */ jsx(
    SimplePlayerCommand,
    {
      ...props,
      workingTitle: "Starting radio\u2026",
      action: async ({ track }, client) => {
        const recommendations = await client.recommendations({ tracks: [track.id] });
        const uris = (recommendations.tracks ?? []).filter(Boolean).slice(0, 20).map((entry) => entry.uri);
        if (uris.length === 0) {
          throw new SpotifyApiError("noRadio", "no radio tracks found for this track");
        }
        await client.play({ uris: [track.uri, ...uris] });
        return `Radio started from ${track.name}`;
      }
    }
  );
}
function CopyUrlCommand(props) {
  return /* @__PURE__ */ jsx(
    SimplePlayerCommand,
    {
      ...props,
      workingTitle: "Copying\u2026",
      action: async ({ track }, client) => {
        await client.copyText(`https://open.spotify.com/track/${track.id}`);
        return "Copied track link";
      }
    }
  );
}
function CopyArtistAndTitleCommand(props) {
  return /* @__PURE__ */ jsx(
    SimplePlayerCommand,
    {
      ...props,
      workingTitle: "Copying\u2026",
      action: async ({ track }, client) => {
        const artists = track.artists.map((artist) => artist.name).join(", ");
        await client.copyText(`${artists} - ${track.name}`);
        return "Copied artist and title";
      }
    }
  );
}
function CopyEmbedCommand(props) {
  return /* @__PURE__ */ jsx(
    SimplePlayerCommand,
    {
      ...props,
      workingTitle: "Copying\u2026",
      action: async ({ track }, client) => {
        await client.copyText(EMBED_SNIPPET.replace("{id}", track.id));
        return "Copied embed snippet";
      }
    }
  );
}
function usePlaybackContext(client) {
  const [result, setResult] = useState({ kind: "working" });
  useEffect(() => {
    let alive = true;
    client.playbackState().then((state) => {
      if (!alive) return;
      if (!state || !state.device) {
        setResult({ kind: "error", message: "No active Spotify device" });
        return;
      }
      const track = isTrack2(state.item) ? state.item : null;
      if (!track) {
        setResult({ kind: "error", message: "Nothing playing" });
        return;
      }
      setResult({ kind: "context", context: { track, state } });
    }).catch((caught) => {
      if (!alive) return;
      if (caught instanceof SpotifyApiError && caught.code === "authRequired") {
        setResult({ kind: "authRequired" });
      } else {
        setResult({ kind: "error", message: describeError(caught) });
      }
    });
    return () => {
      alive = false;
    };
  }, [client]);
  return result;
}
function ContextGate({
  result,
  children
}) {
  if (result.kind === "working") {
    return /* @__PURE__ */ jsx(List, { children: /* @__PURE__ */ jsx(List.EmptyView, { title: "Loading playback\u2026" }) });
  }
  if (result.kind === "authRequired") {
    return /* @__PURE__ */ jsx(List, { children: /* @__PURE__ */ jsx(
      List.EmptyView,
      {
        title: "Connect Spotify",
        description: "Run the Spotify Search command and connect to authorize FlowKey first."
      }
    ) });
  }
  if (result.kind === "error") {
    return /* @__PURE__ */ jsx(List, { children: /* @__PURE__ */ jsx(List.EmptyView, { title: result.message }) });
  }
  return children(result.context);
}
function CurrentTrackCommand(props) {
  const client = useMemo(() => new SpotifyClient(props.native.call), [props.native]);
  const result = usePlaybackContext(client);
  return /* @__PURE__ */ jsx(ContextGate, { result, children: ({ track, state }) => /* @__PURE__ */ jsx(
    Detail,
    {
      title: track.name,
      subtitle: `by ${track.artists.map((artist) => artist.name).join(", ")}`,
      children: /* @__PURE__ */ jsxs(Detail.Metadata, { children: [
        /* @__PURE__ */ jsx(Detail.Metadata.Field, { label: "Track", value: track.name }),
        /* @__PURE__ */ jsx(Detail.Metadata.Field, { label: "Duration", value: formatMs(track.duration_ms) }),
        /* @__PURE__ */ jsx(
          Detail.Metadata.Field,
          {
            label: "Progress",
            value: state.progress_ms === null ? formatMs(track.duration_ms) : `${formatMs(state.progress_ms)} / ${formatMs(track.duration_ms)}`
          }
        ),
        /* @__PURE__ */ jsx(Detail.Metadata.Field, { label: "Album", value: track.album?.name ?? "Unknown album" }),
        /* @__PURE__ */ jsx(
          Detail.Metadata.Field,
          {
            label: "Device",
            value: state.device ? state.device.name : "Unknown"
          }
        )
      ] })
    }
  ) });
}
function QueueCommand(props) {
  const client = useMemo(() => new SpotifyClient(props.native.call), [props.native]);
  const [queue, setQueue] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    let alive = true;
    client.queue().then((result) => {
      if (alive) setQueue(result);
    }).catch((caught) => {
      if (alive && !isAborted(caught)) setError(describeError(caught));
    });
    return () => {
      alive = false;
    };
  }, [client]);
  const current = queue && isTrack2(queue.currently_playing) ? queue.currently_playing : null;
  const queuedTracks = queue ? queue.queue.filter(isTrack2) : [];
  const entries2 = queuedTracks.filter(
    (track, index) => queuedTracks.findIndex((other) => other.id === track.id) === index
  );
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 4e3);
    return () => clearTimeout(timer);
  }, [notice]);
  if (error) {
    return /* @__PURE__ */ jsx(List, { children: /* @__PURE__ */ jsx(List.EmptyView, { title: "Could not load queue", description: error }) });
  }
  if (!queue) {
    return /* @__PURE__ */ jsx(List, { children: /* @__PURE__ */ jsx(List.EmptyView, { title: "Loading queue\u2026" }) });
  }
  const artworkIcon = (track) => {
    const url = track.album?.images?.at(-1)?.url;
    return url ? { uri: url } : void 0;
  };
  return /* @__PURE__ */ jsxs(List, { children: [
    entries2.length === 0 && !current ? /* @__PURE__ */ jsx(List.EmptyView, { title: "Queue is empty" }) : null,
    current ? /* @__PURE__ */ jsx(List.Section, { title: "Now Playing", children: /* @__PURE__ */ jsx(
      List.Item,
      {
        id: "current",
        title: current.name,
        subtitle: current.artists.map((artist) => artist.name).join(", "),
        kind: "track",
        icon: artworkIcon(current),
        actions: trackActions(current, client, setNotice, props.signal)
      }
    ) }) : null,
    entries2.length > 0 ? /* @__PURE__ */ jsx(List.Section, { title: "Next Up", children: entries2.map((track) => /* @__PURE__ */ jsx(
      List.Item,
      {
        id: track.id,
        title: track.name,
        subtitle: `${track.artists.map((artist) => artist.name).join(", ")} \xB7 ${formatMs(track.duration_ms)}`,
        kind: "track",
        icon: artworkIcon(track),
        actions: trackActions(track, client, setNotice, props.signal)
      },
      track.id
    )) }) : null,
    notice ? /* @__PURE__ */ jsx(List.Section, { title: "Status", children: /* @__PURE__ */ jsx(List.Item, { id: "notice", title: notice, icon: { lucide: "info" } }) }) : null
  ] });
}
function DevicesCommand(props) {
  const client = useMemo(() => new SpotifyClient(props.native.call), [props.native]);
  const [devices, setDevices] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    client.devices().then((result) => {
      if (alive) setDevices(result.devices.filter(Boolean));
    }).catch((caught) => {
      if (alive && !isAborted(caught)) setError(describeError(caught));
    });
    return () => {
      alive = false;
    };
  }, [client]);
  if (error) {
    return /* @__PURE__ */ jsx(List, { children: /* @__PURE__ */ jsx(List.EmptyView, { title: "Could not load devices", description: error }) });
  }
  if (!devices) {
    return /* @__PURE__ */ jsx(List, { children: /* @__PURE__ */ jsx(List.EmptyView, { title: "Loading devices\u2026" }) });
  }
  if (devices.length === 0) {
    return /* @__PURE__ */ jsx(List, { children: /* @__PURE__ */ jsx(List.EmptyView, { title: "No Spotify devices found" }) });
  }
  return /* @__PURE__ */ jsx(List, { children: devices.map((device) => /* @__PURE__ */ jsx(
    List.Item,
    {
      id: device.id,
      title: device.name,
      subtitle: `${device.type}${device.is_active ? " \xB7 active" : ""} \xB7 volume ${device.volume_percent ?? "?"}%`,
      kind: "device",
      icon: { lucide: device.is_active ? "speaker" : "speaker-off" },
      actions: /* @__PURE__ */ jsx(ActionPanel, { children: /* @__PURE__ */ jsx(
        Action,
        {
          title: "Transfer Playback Here",
          onAction: async () => {
            try {
              await client.transferPlayback(device.id, true);
            } catch (caught) {
              if (!isAborted(caught)) setError(describeError(caught));
            }
          }
        }
      ) })
    },
    device.id
  )) });
}
function playlistTrackCount(playlist) {
  const tracks = playlist.tracks;
  if (typeof tracks === "number") return tracks;
  if (Array.isArray(tracks)) return tracks.length;
  return tracks?.total ?? 0;
}
function playlistArtwork(playlist) {
  const url = playlist.images?.at(-1)?.url ?? playlist.images?.[0]?.url;
  return url ? { uri: url } : void 0;
}
function playlistSubtitle(playlist) {
  const parts = [];
  const count = playlistTrackCount(playlist);
  if (count > 0) parts.push(`${count} tracks`);
  const owner = playlist.owner?.display_name ?? "";
  if (owner) parts.push(owner);
  return parts.join(" \xB7 ") || "playlist";
}
function useOwnedPlaylists(client, ready) {
  const [state, setState] = useState({
    playlists: null,
    error: ""
  });
  useEffect(() => {
    if (!ready) return;
    let alive = true;
    Promise.all([client.myPlaylists(50), client.me()]).then(([page, me]) => {
      if (!alive) return;
      const mine = (page.items ?? []).filter(
        (playlist) => Boolean(playlist) && playlist.owner?.id === me.id
      );
      setState({ playlists: mine, error: "" });
    }).catch((caught) => {
      if (!alive || isAborted(caught)) return;
      setState({ playlists: null, error: describeError(caught) });
    });
    return () => {
      alive = false;
    };
  }, [client, ready]);
  return state;
}
function PlaylistPicker({
  title,
  playlists,
  actionLabel,
  onPick
}) {
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 4e3);
    return () => clearTimeout(timer);
  }, [notice]);
  return /* @__PURE__ */ jsxs(List, { children: [
    notice ? /* @__PURE__ */ jsx(List.Section, { title: "Status", children: /* @__PURE__ */ jsx(List.Item, { id: "notice", title: notice, icon: { lucide: "info" } }) }) : null,
    /* @__PURE__ */ jsx(List.Section, { title, children: playlists.map((playlist) => /* @__PURE__ */ jsx(
      List.Item,
      {
        id: playlist.id,
        title: playlist.name,
        subtitle: playlistSubtitle(playlist),
        kind: "playlist",
        icon: playlistArtwork(playlist),
        actions: /* @__PURE__ */ jsx(ActionPanel, { children: /* @__PURE__ */ jsx(
          Action,
          {
            title: actionLabel,
            onAction: async () => {
              try {
                await onPick(playlist);
                setNotice(`${actionLabel}: done`);
              } catch (caught) {
                if (!isAborted(caught)) setNotice(describeError(caught));
              }
            }
          }
        ) })
      },
      playlist.id
    )) })
  ] });
}
function AddToPlaylistCommand(props) {
  const client = useMemo(() => new SpotifyClient(props.native.call), [props.native]);
  const result = usePlaybackContext(client);
  const { playlists, error } = useOwnedPlaylists(client, result.kind === "context");
  return /* @__PURE__ */ jsx(ContextGate, { result, children: ({ track }) => {
    if (error) {
      return /* @__PURE__ */ jsx(List, { children: /* @__PURE__ */ jsx(List.EmptyView, { title: "Could not load playlists", description: error }) });
    }
    if (!playlists) {
      return /* @__PURE__ */ jsx(List, { children: /* @__PURE__ */ jsx(List.EmptyView, { title: "Loading playlists\u2026" }) });
    }
    if (playlists.length === 0) {
      return /* @__PURE__ */ jsx(List, { children: /* @__PURE__ */ jsx(List.EmptyView, { title: "No editable playlists found" }) });
    }
    return /* @__PURE__ */ jsx(
      PlaylistPicker,
      {
        title: `Add ${track.name} to\u2026`,
        playlists,
        actionLabel: "Add Track",
        onPick: async (playlist) => {
          await client.addToPlaylist(playlist.id, [track.uri]);
        }
      }
    );
  } });
}
function RemoveFromPlaylistCommand(props) {
  const client = useMemo(() => new SpotifyClient(props.native.call), [props.native]);
  const result = usePlaybackContext(client);
  const { playlists, error } = useOwnedPlaylists(client, result.kind === "context");
  return /* @__PURE__ */ jsx(ContextGate, { result, children: ({ track }) => {
    if (error) {
      return /* @__PURE__ */ jsx(List, { children: /* @__PURE__ */ jsx(List.EmptyView, { title: "Could not load playlists", description: error }) });
    }
    if (!playlists) {
      return /* @__PURE__ */ jsx(List, { children: /* @__PURE__ */ jsx(List.EmptyView, { title: "Loading playlists\u2026" }) });
    }
    if (playlists.length === 0) {
      return /* @__PURE__ */ jsx(List, { children: /* @__PURE__ */ jsx(List.EmptyView, { title: "No editable playlists found" }) });
    }
    return /* @__PURE__ */ jsx(
      PlaylistPicker,
      {
        title: `Remove ${track.name} from\u2026`,
        playlists,
        actionLabel: "Remove Track",
        onPick: async (playlist) => {
          await client.removeFromPlaylist(playlist.id, track.uri);
        }
      }
    );
  } });
}
function lyricsMarkdown(lyrics, media, activeIndex) {
  const header = [];
  if (media?.artist) header.push("**Artist:** " + media.artist);
  if (media?.album) header.push("**Album:** " + media.album);
  const body = lyrics.synced ? lyrics.lines.map((line, i) => {
    if (i === activeIndex) return `## \u266A ${line.text}`;
    if (activeIndex >= 0 && i < activeIndex) return `~~${line.text}~~`;
    return " " + line.text;
  }).join("\n\n") : lyrics.lines.map((line) => " " + line.text).join("\n\n");
  return (header.length > 0 ? header.join("\n\n") + "\n\n---\n\n" : "") + body;
}
function FindLyricsCommand(props) {
  const client = useMemo(() => new SpotifyClient(props.native.call), [props.native]);
  const [media, setMedia] = useState(null);
  const [lyrics, setLyrics] = useState(null);
  const [error, setError] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const mediaRef = useRef(null);
  const lyricsRef = useRef(null);
  const fetchedFor = useRef("");
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const state = await props.native.call("media.current");
        if (!alive) return;
        const previous = mediaRef.current;
        mediaRef.current = state;
        if ((previous?.title ?? "") !== (state?.title ?? "") || (previous?.artist ?? "") !== (state?.artist ?? "")) {
          setMedia(state);
        }
      } catch {
      }
    };
    void poll();
    const timer = setInterval(poll, 1e3);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [props.native]);
  useEffect(() => {
    const title = media?.title?.trim();
    if (!title) return;
    const artist = media?.artist?.trim() ?? "";
    const stamp = title + "|" + artist;
    if (fetchedFor.current === stamp) return;
    fetchedFor.current = stamp;
    let alive = true;
    setLyrics(null);
    setError("");
    const timer = setTimeout(() => {
      if (alive) setError("The lyrics service did not answer in time.");
    }, 45e3);
    client.findLyrics(title, artist).then((hit) => {
      if (!alive) return;
      if (!hit) {
        setError("No lyrics found for this track.");
        return;
      }
      const lines = hit.syncedLyrics ? parseLrc(hit.syncedLyrics) : [];
      const state = {
        synced: lines.length > 1,
        lines: lines.length > 1 ? lines : [{ timeMs: 0, text: hit.plainLyrics }],
        plain: hit.plainLyrics,
        title: hit.trackName
      };
      lyricsRef.current = state;
      setLyrics(state);
    }).catch((caught) => {
      if (alive && !isAborted(caught)) setError(describeError(caught));
    }).finally(() => {
      clearTimeout(timer);
    });
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [media, client]);
  useEffect(() => {
    const timer = setInterval(() => {
      const current = mediaRef.current;
      const lines = lyricsRef.current;
      if (!current || !lines?.synced) return;
      const index = activeLineIndex(lines.lines, projectedPositionMs(current));
      setActiveIndex((previous) => previous === index ? previous : index);
    }, 250);
    return () => clearInterval(timer);
  }, []);
  if (error) {
    return /* @__PURE__ */ jsx(List, { children: /* @__PURE__ */ jsx(List.EmptyView, { title: error }) });
  }
  if (!media?.title) {
    return /* @__PURE__ */ jsx(List, { children: /* @__PURE__ */ jsx(
      List.EmptyView,
      {
        title: "Nothing is playing right now",
        description: "Start playback on any media app and reopen Find Lyrics."
      }
    ) });
  }
  if (!lyrics) {
    return /* @__PURE__ */ jsx(List, { children: /* @__PURE__ */ jsx(List.EmptyView, { title: `Searching lyrics for ${media.title}\u2026` }) });
  }
  return /* @__PURE__ */ jsx(
    Detail,
    {
      title: lyrics.title,
      mediaKeys: true,
      markdown: lyricsMarkdown(lyrics, media, activeIndex),
      actions: /* @__PURE__ */ jsxs(ActionPanel, { children: [
        /* @__PURE__ */ jsx(
          Action,
          {
            title: "Play / Pause",
            icon: { lucide: "play" },
            onAction: async () => {
              await props.native.call("media.control", { command: "playPause" });
            }
          }
        ),
        /* @__PURE__ */ jsx(
          Action,
          {
            title: "Next Track",
            icon: { lucide: "forward" },
            onAction: async () => {
              await props.native.call("media.control", { command: "next" });
            }
          }
        ),
        /* @__PURE__ */ jsx(
          Action,
          {
            title: "Previous Track",
            icon: { lucide: "rewind" },
            onAction: async () => {
              await props.native.call("media.control", { command: "previous" });
            }
          }
        )
      ] })
    }
  );
}

// src/index.tsx
function Volume0(props) {
  return /* @__PURE__ */ jsx(VolumeCommand, { ...props, percent: 0 });
}
function Volume25(props) {
  return /* @__PURE__ */ jsx(VolumeCommand, { ...props, percent: 25 });
}
function Volume50(props) {
  return /* @__PURE__ */ jsx(VolumeCommand, { ...props, percent: 50 });
}
function Volume75(props) {
  return /* @__PURE__ */ jsx(VolumeCommand, { ...props, percent: 75 });
}
function Volume100(props) {
  return /* @__PURE__ */ jsx(VolumeCommand, { ...props, percent: 100 });
}
function VolumeUp(props) {
  return /* @__PURE__ */ jsx(VolumeCommand, { ...props, delta: 10 });
}
function VolumeDown(props) {
  return /* @__PURE__ */ jsx(VolumeCommand, { ...props, delta: -10 });
}
var PLAYER_COMMANDS = {
  "toggle-play-pause": TogglePlayPauseCommand,
  next: NextCommand,
  previous: PreviousCommand,
  "just-play": JustPlayCommand,
  like: LikeCommand,
  dislike: DislikeCommand,
  "toggle-shuffle": ToggleShuffleCommand,
  "cycle-repeat": CycleRepeatCommand,
  replay: ReplayCommand,
  "skip-15": Skip15Command,
  "back-15": Back15Command,
  "volume-0": Volume0,
  "volume-25": Volume25,
  "volume-50": Volume50,
  "volume-75": Volume75,
  "volume-100": Volume100,
  "volume-up": VolumeUp,
  "volume-down": VolumeDown,
  "start-radio": StartRadioCommand,
  "current-track": CurrentTrackCommand,
  "copy-url": CopyUrlCommand,
  "copy-artist-and-title": CopyArtistAndTitleCommand,
  "copy-embed": CopyEmbedCommand,
  queue: QueueCommand,
  devices: DevicesCommand,
  "add-playing-to-playlist": AddToPlaylistCommand,
  "remove-playing-from-playlist": RemoveFromPlaylistCommand,
  "find-lyrics": FindLyricsCommand
};
var index_default = defineReactExtension({
  manifest: manifest_default,
  component: (props) => {
    const commandId = props.commandId ?? "search";
    if (isSubViewCommand(commandId)) {
      if (commandId.startsWith("album-songs:")) {
        return createElement(AlbumSongsRoot, props);
      }
      if (commandId.startsWith("artist-songs:")) {
        return createElement(ArtistSongsRoot, props);
      }
      if (commandId.startsWith("liked-songs:")) {
        return createElement(LikedSongsRoot, props);
      }
      return createElement(ArtistAlbumsRoot, props);
    }
    if (commandId === "search") {
      return createElement(SearchCommand, props);
    }
    if (commandId === "your-library") {
      return createElement(LibraryCommand, props);
    }
    if (commandId === "now-playing") {
      return createElement(NowPlayingCommand, props);
    }
    const playerCommand = PLAYER_COMMANDS[commandId];
    if (playerCommand) {
      return createElement(playerCommand, props);
    }
    return createElement(
      List,
      null,
      createElement(List.EmptyView, {
        title: "Command not available yet",
        description: `The '${commandId}' command lands in a later slice.`
      })
    );
  }
});

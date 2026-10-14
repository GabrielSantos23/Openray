import type {
  Paged,
  SpotifyAlbum,
  SpotifyArtist,
  SpotifyDevice,
  SpotifyEpisode,
  SpotifyPlaybackState,
  SpotifyPlaylist,
  SpotifyProfile,
  SpotifyQueue,
  SpotifyShow,
  SpotifyTrack,
} from './types';
import { createCapabilities, type OAuthStatus } from '@flowkey-mini/native-sdk';

export type NativeCallFn = <T = unknown>(
  method: string,
  params?: Record<string, unknown>,
  options?: { signal?: AbortSignal; timeoutMs?: number },
) => Promise<T>;

export const OAUTH_TIMEOUT_MS = 150_000;
export const API_CALL_TIMEOUT_MS = 20_000;
export const DEV_MODE_LIMIT_CAP = 10;
const API_BASE = 'https://api.spotify.com/v1';

export class SpotifyApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

interface FetchResult {
  status: number;
  bodyText: string;
}

/** OAuth route result — the shell vaults tokens and only reports state. */
export type AuthorizeResult = OAuthStatus;

export class SpotifyClient {
  private readonly oauth: ReturnType<typeof createCapabilities>['oauth'];

  constructor(private readonly call: NativeCallFn) {
    this.oauth = createCapabilities(call).oauth;
  }

  async authorize(signal?: AbortSignal, clientId?: string): Promise<AuthorizeResult> {
    return this.oauth.authorize('spotify', {
      clientId,
      signal,
      timeoutMs: OAUTH_TIMEOUT_MS,
    });
  }

  async authStatus(signal?: AbortSignal): Promise<AuthorizeResult> {
    return this.oauth.status('spotify', { signal });
  }

  async disconnect(): Promise<{ ok: boolean }> {
    await this.oauth.disconnect('spotify');
    return { ok: true };
  }

  async fetchImage(url: string, signal?: AbortSignal): Promise<string> {
    const result = await this.call<{ ok: boolean; uri: string }>(
      'image.fetch',
      { url },
      { signal, timeoutMs: API_CALL_TIMEOUT_MS },
    );
    return result.uri;
  }

  private async api<T>(
    path: string,
    init?: { method?: string; body?: unknown; signal?: AbortSignal },
  ): Promise<T> {
    const result = await this.request(path, init);
    return parseBody<T>(result.status, result.bodyText);
  }

  private async apiVoid(
    path: string,
    init?: { method?: string; body?: unknown; signal?: AbortSignal },
  ): Promise<void> {
    const result = await this.request(path, init);
    if (result.status >= 200 && result.status < 300) {
      return;
    }
    parseBody<void>(result.status, result.bodyText);
  }

  private async request(
    path: string,
    init?: { method?: string; body?: unknown; signal?: AbortSignal },
  ): Promise<FetchResult> {
    const params: Record<string, unknown> = {
      url: API_BASE + path,
      method: init?.method ?? 'GET',
      auth: 'spotify',
      timeoutMs: 15_000,
    };
    if (init?.body !== undefined) {
      params.body = JSON.stringify(init.body);
      params.headers = { 'Content-Type': 'application/json' };
    }
    try {
      return await this.call<FetchResult>('http.fetch', params, {
        signal: init?.signal,
        timeoutMs: API_CALL_TIMEOUT_MS,
      });
    } catch (error) {
      throw normalizeNativeError(error);
    }
  }

  me(): Promise<SpotifyProfile> {
    return this.api<SpotifyProfile>('/me');
  }

  async copyText(text: string): Promise<void> {
    await this.call('clipboard.write', { text });
  }

  search(
    query: string,
    types: string[],
    limit = 50,
    signal?: AbortSignal,
  ): Promise<Record<string, Paged<unknown>>> {
    const cappedLimit = Math.min(limit, DEV_MODE_LIMIT_CAP);
    return this.api(
      `/search?q=${encodeURIComponent(query)}&type=${encodeURIComponent(types.join(','))}&limit=${cappedLimit}`,
      { signal },
    );
  }

  currentlyPlaying(signal?: AbortSignal): Promise<SpotifyPlaybackState | null> {
    return this.api('/me/player/currently-playing?additional_types=episode', { signal });
  }

  playbackState(signal?: AbortSignal): Promise<SpotifyPlaybackState | null> {
    return this.api('/me/player?additional_types=episode', { signal });
  }

  async findLyrics(
    trackName: string,
    artistName: string,
    signal?: AbortSignal,
  ): Promise<{
    trackName: string;
    artistName: string;
    plainLyrics: string;
    syncedLyrics?: string | null;
  } | null> {
    const url =
      `https://lrclib.net/api/search?track_name=${encodeURIComponent(trackName)}` +
      `&artist_name=${encodeURIComponent(artistName)}`;
    const call = () =>
      this.call<FetchResult>(
        'http.fetch',
        { url, method: 'GET', timeoutMs: 15_000 },
        { signal, timeoutMs: API_CALL_TIMEOUT_MS },
      );
    let result: FetchResult;
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
    const hits = parseBody<
      {
        plainLyrics?: string | null;
        syncedLyrics?: string | null;
        trackName?: string;
        artistName?: string;
      }[]
    >(result.status, result.bodyText, 'lyrics service');
    const hit =
      hits?.find((entry) => typeof entry.syncedLyrics === 'string' && entry.syncedLyrics) ??
      hits?.find((entry) => typeof entry.plainLyrics === 'string' && entry.plainLyrics);
    if (!hit) {
      return null;
    }
    const plainLyrics = typeof hit.plainLyrics === 'string' ? hit.plainLyrics : '';
    const syncedLyrics = typeof hit.syncedLyrics === 'string' ? hit.syncedLyrics : null;
    return {
      trackName: hit.trackName ?? trackName,
      artistName: hit.artistName ?? artistName,
      plainLyrics,
      syncedLyrics,
    };
  }

  devices(): Promise<{ devices: SpotifyDevice[] }> {
    return this.api('/me/player/devices');
  }

  transferPlayback(deviceId: string, play?: boolean): Promise<void> {
    return this.apiVoid('/me/player', { method: 'PUT', body: { device_ids: [deviceId], play } });
  }

  async play(body: Record<string, unknown>, deviceId?: string): Promise<void> {
    if (deviceId) {
      await this.apiVoid(`/me/player/play?device_id=${encodeURIComponent(deviceId)}`, {
        method: 'PUT',
        body,
      });
      return;
    }
    try {
      await this.apiVoid('/me/player/play', { method: 'PUT', body });
      return;
    } catch (error) {
      const device = await this.fallbackPlaybackDevice();
      if (!device) {
        throw error;
      }
      await this.transferPlayback(device.id, true);
      await this.apiVoid(`/me/player/play?device_id=${encodeURIComponent(device.id)}`, {
        method: 'PUT',
        body,
      });
    }
  }

  private devicesCache: { at: number; devices: SpotifyDevice[] } | null = null;

  private async fallbackPlaybackDevice(): Promise<SpotifyDevice | null> {
    try {
      const state = await this.playbackState();
      if (state?.device?.is_active && !state.device.is_restricted) {
        return state.device;
      }
      if (!this.devicesCache || Date.now() - this.devicesCache.at > 30_000) {
        const { devices } = await this.devices();
        this.devicesCache = { at: Date.now(), devices };
      }
      return this.devicesCache.devices.find((device) => !device.is_restricted) ?? null;
    } catch {
      return null;
    }
  }

  pause(): Promise<void> {
    return this.apiVoid('/me/player/pause', { method: 'PUT' });
  }

  next(): Promise<void> {
    return this.apiVoid('/me/player/next', { method: 'POST' });
  }

  previous(): Promise<void> {
    return this.apiVoid('/me/player/previous', { method: 'POST' });
  }

  seek(positionMs: number): Promise<void> {
    return this.apiVoid(`/me/player/seek?position_ms=${Math.max(0, Math.round(positionMs))}`, {
      method: 'PUT',
    });
  }

  setVolume(percent: number): Promise<void> {
    const clamped = Math.min(100, Math.max(0, Math.round(percent)));
    return this.apiVoid(`/me/player/volume?volume_percent=${clamped}`, { method: 'PUT' });
  }

  setShuffle(state: boolean): Promise<void> {
    return this.apiVoid(`/me/player/shuffle?state=${state}`, { method: 'PUT' });
  }

  setRepeat(state: 'off' | 'track' | 'context'): Promise<void> {
    return this.apiVoid(`/me/player/repeat?state=${state}`, { method: 'PUT' });
  }

  queue(): Promise<SpotifyQueue> {
    return this.api('/me/player/queue');
  }

  addToQueue(uri: string): Promise<void> {
    return this.apiVoid(`/me/player/queue?uri=${encodeURIComponent(uri)}`, { method: 'POST' });
  }

  async savedTracks(limit = 50, signal?: AbortSignal): Promise<Paged<{ track: SpotifyTrack }>> {
    return this.api(`/me/tracks?limit=${limit}`, { signal });
  }

  savedAlbums(limit = 50, signal?: AbortSignal): Promise<Paged<{ album: SpotifyAlbum }>> {
    return this.api(`/me/albums?limit=${limit}`, { signal });
  }

  savedShows(limit = 50, signal?: AbortSignal): Promise<Paged<{ show: SpotifyShow }>> {
    return this.api(`/me/shows?limit=${limit}`, { signal });
  }

  savedEpisodes(limit = 50, signal?: AbortSignal): Promise<Paged<{ episode: SpotifyEpisode }>> {
    return this.api(`/me/episodes?limit=${limit}`, { signal });
  }

  containsSavedTracks(ids: string[]): Promise<boolean[]> {
    return this.api(`/me/tracks/contains?ids=${ids.join(',')}`);
  }

  addToSavedTracks(ids: string[]): Promise<void> {
    return this.apiVoid(`/me/tracks?ids=${ids.join(',')}`, { method: 'PUT' });
  }

  removeFromSavedTracks(ids: string[]): Promise<void> {
    return this.apiVoid(`/me/tracks?ids=${ids.join(',')}`, { method: 'DELETE' });
  }

  containsSavedAlbums(ids: string[]): Promise<boolean[]> {
    return this.api(`/me/albums/contains?ids=${ids.join(',')}`);
  }

  addToSavedAlbums(ids: string[]): Promise<void> {
    return this.apiVoid(`/me/albums?ids=${ids.join(',')}`, { method: 'PUT' });
  }

  removeFromSavedAlbums(ids: string[]): Promise<void> {
    return this.apiVoid(`/me/albums?ids=${ids.join(',')}`, { method: 'DELETE' });
  }

  followedArtists(
    limit = 50,
  ): Promise<{ artists: { items: SpotifyArtist[]; next: string | null } }> {
    return this.api(`/me/following?type=artist&limit=${limit}`);
  }

  myPlaylists(limit = 50): Promise<Paged<SpotifyPlaylist>> {
    return this.api(`/me/playlists?limit=${limit}`);
  }

  artistTopTracks(artistId: string, market: string): Promise<{ tracks: SpotifyTrack[] }> {
    return this.api(`/artists/${artistId}/top-tracks?market=${encodeURIComponent(market)}`);
  }

  async artistAlbums(artistId: string, limit = 200): Promise<Paged<SpotifyAlbum>> {
    const collected: SpotifyAlbum[] = [];
    let offset = 0;
    while (collected.length < limit) {
      const page = await this.api<Paged<SpotifyAlbum>>(
        `/artists/${artistId}/albums?limit=${Math.min(DEV_MODE_LIMIT_CAP, limit - collected.length)}&offset=${offset}`,
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

  artist(artistId: string): Promise<SpotifyArtist> {
    return this.api(`/artists/${artistId}`);
  }

  albumTracks(albumId: string, limit = 50): Promise<Paged<SpotifyTrack>> {
    return this.api(`/albums/${albumId}/tracks?limit=${limit}`);
  }

  async playlistTracks(playlistId: string, limit = 500): Promise<SpotifyTrack[]> {
    const collected: SpotifyTrack[] = [];
    let offset = 0;
    while (collected.length < limit) {
      const page = await this.api<Paged<{ track: SpotifyTrack }>>(
        `/playlists/${playlistId}/tracks?limit=${Math.min(50, limit - collected.length)}&offset=${offset}`,
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

  addToPlaylist(playlistId: string, uris: string[]): Promise<void> {
    return this.apiVoid(`/playlists/${playlistId}/tracks`, { method: 'POST', body: { uris } });
  }

  removeFromPlaylist(playlistId: string, uri: string): Promise<void> {
    return this.apiVoid(`/playlists/${playlistId}/tracks`, {
      method: 'DELETE',
      body: { tracks: [{ uri }] },
    });
  }

  createPlaylist(userId: string, name: string, description?: string): Promise<SpotifyPlaylist> {
    return this.api(`/users/${userId}/playlists`, {
      method: 'POST',
      body: description ? { name, description } : { name },
    });
  }

  recommendations(seeds: { tracks?: string[]; artists?: string[] }): Promise<{
    tracks: SpotifyTrack[];
  }> {
    const parts: string[] = [];
    if (seeds.tracks?.length) {
      parts.push(`seed_tracks=${seeds.tracks.join(',')}`);
    }
    if (seeds.artists?.length) {
      parts.push(`seed_artists=${seeds.artists.join(',')}`);
    }
    return this.api(`/recommendations?${parts.join('&')}&limit=50`);
  }
}

function parseBody<T>(status: number, bodyText: string, service = 'spotify'): T {
  if (status === 204 || bodyText.length === 0) {
    return null as T;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    throw new SpotifyApiError(
      'invalidResponse',
      `${service} returned malformed json (${status}): ${JSON.stringify(bodyText.slice(0, 60))}`,
      status,
    );
  }
  if (status < 200 || status >= 300) {
    const error = parsed as { error?: { message?: string; reason?: string } };
    throw new SpotifyApiError(
      error?.error?.reason ?? 'apiError',
      error?.error?.message ?? `${service} returned ${status}`,
      status,
    );
  }
  return parsed as T;
}

function normalizeNativeError(error: unknown): SpotifyApiError {
  const candidate = error as { code?: string; message?: string; status?: number };
  if (candidate?.code) {
    return new SpotifyApiError(
      candidate.code,
      candidate.message ?? candidate.code,
      candidate.status,
    );
  }
  return new SpotifyApiError('nativeError', String(error));
}

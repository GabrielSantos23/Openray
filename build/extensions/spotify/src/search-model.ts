/**
 * Pure search/result helpers shared by the tree renderer (search.tsx,
 * library.tsx) and the web renderer. No react or react-ui imports here —
 * the web bundle cannot carry the tree reconciler.
 */
import { SpotifyApiError, type SpotifyClient } from './api/client';
import type {
  Paged,
  SpotifyAlbum,
  SpotifyArtist,
  SpotifyEpisode,
  SpotifyPlaylist,
  SpotifyShow,
  SpotifyTrack,
} from './api/types';

export const SEARCH_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'artists', label: 'Artists' },
  { value: 'tracks', label: 'Songs' },
  { value: 'albums', label: 'Albums' },
  { value: 'playlists', label: 'Playlists' },
  { value: 'shows', label: 'Podcasts & Shows' },
  { value: 'episodes', label: 'Episodes' },
];

export const ALL_TYPES = ['track', 'artist', 'album', 'playlist', 'show', 'episode'];

export type SearchResults = {
  tracks?: Paged<SpotifyTrack>;
  artists?: Paged<SpotifyArtist>;
  albums?: Paged<SpotifyAlbum>;
  playlists?: Paged<SpotifyPlaylist>;
  shows?: Paged<SpotifyShow>;
  episodes?: Paged<SpotifyEpisode>;
};

export function typesForFilter(filter: string): string[] {
  switch (filter) {
    case 'artists':
      return ['artist'];
    case 'tracks':
      return ['track'];
    case 'albums':
      return ['album'];
    case 'playlists':
      return ['playlist'];
    case 'shows':
      return ['show'];
    case 'episodes':
      return ['episode'];
    default:
      return ALL_TYPES;
  }
}

export function pruneResults(results: SearchResults): SearchResults {
  const pruned: SearchResults = {};
  for (const key of ['tracks', 'artists', 'albums', 'playlists', 'shows', 'episodes'] as const) {
    const page = results[key];
    if (page) {
      pruned[key] = { ...page, items: page.items.filter((item): item is never => Boolean(item)) };
    }
  }
  return pruned;
}

export function collectArtworkUrls(results: SearchResults | null): string[] {
  if (!results) return [];
  const urls: string[] = [];
  const push = (url?: string | null) => {
    if (url) urls.push(url);
  };
  for (const artist of results.artists?.items ?? []) {
    push(artist.images?.[0]?.url);
  }
  for (const album of results.albums?.items ?? []) {
    push(album.images?.[0]?.url);
  }
  for (const playlist of results.playlists?.items ?? []) {
    push(playlist.images?.at(-1)?.url);
  }
  for (const show of results.shows?.items ?? []) {
    push(show.images?.[0]?.url);
  }
  for (const episode of results.episodes?.items ?? []) {
    push(episode.show?.images?.at(-1)?.url ?? episode.images?.at(-1)?.url);
  }
  for (const track of results.tracks?.items ?? []) {
    push(track.album?.images?.at(-1)?.url);
  }
  return urls;
}

export function isAborted(error: unknown): boolean {
  return (error as { code?: string })?.code === 'aborted';
}

export function describeError(error: unknown): string {
  if (error instanceof SpotifyApiError) {
    const suffix = error.status ? ` (${error.status})` : '';
    return suffix && error.message.endsWith(suffix) ? error.message : `${error.message}${suffix}`;
  }
  const candidate = error as { message?: string };
  return candidate?.message ?? 'Something went wrong';
}

export async function startRadio(
  client: SpotifyClient,
  seeds: { tracks?: string[]; artists?: string[] },
  signal?: AbortSignal,
): Promise<void> {
  const recommendations = await client.recommendations(seeds);
  const uris = (recommendations.tracks ?? []).map((track) => track.uri);
  if (uris.length === 0) {
    throw new SpotifyApiError('noRadioTracks', 'Spotify returned no radio tracks');
  }
  await client.play({ uris });
}

/** Case-insensitive local filter over names, artists, owners and publishers. */
export function filterLibrary(results: SearchResults, query: string): SearchResults {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) {
    return results;
  }
  const match = (haystacks: string[]) =>
    haystacks.some((value) => value.toLowerCase().includes(needle));
  const filtered: SearchResults = {};
  const writable = filtered as Record<string, unknown>;
  for (const key of ['tracks', 'artists', 'albums', 'playlists', 'shows', 'episodes'] as const) {
    const page = results[key];
    if (!page) continue;
    writable[key] = {
      ...page,
      items: page.items.filter((item) => {
        const candidate = item as {
          name?: string;
          artists?: { name: string }[];
          owner?: { display_name?: string };
          publisher?: string;
        };
        return match([
          candidate.name ?? '',
          ...(candidate.artists?.map((artist) => artist.name) ?? []),
          candidate.owner?.display_name ?? '',
          candidate.publisher ?? '',
        ]);
      }),
    };
  }
  return filtered as SearchResults;
}

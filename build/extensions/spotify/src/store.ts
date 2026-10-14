import { SpotifyApiError, type SpotifyClient } from './api/client';
import type {
  Paged,
  SpotifyAlbum,
  SpotifyArtist,
  SpotifyEpisode,
  SpotifyPlaylist,
  SpotifyProfile,
  SpotifyShow,
  SpotifyTrack,
} from './api/types';

export interface LibraryResults {
  tracks?: Paged<SpotifyTrack>;
  artists?: Paged<SpotifyArtist>;
  albums?: Paged<SpotifyAlbum>;
  playlists?: Paged<SpotifyPlaylist>;
  shows?: Paged<SpotifyShow>;
  episodes?: Paged<SpotifyEpisode>;
}

export interface LibraryData {
  results: LibraryResults;
  me: SpotifyProfile;
  likedTotal: number;
}

const LIBRARY_TTL_MS = 5 * 60 * 1000;
let libraryCache: { at: number; data: LibraryData } | null = null;

export function peekLibrary(): LibraryData | null {
  if (libraryCache && Date.now() - libraryCache.at < LIBRARY_TTL_MS) {
    return libraryCache.data;
  }
  return null;
}

export function resetLibraryCache(): void {
  libraryCache = null;
}

export async function loadLibrary(client: SpotifyClient): Promise<LibraryData> {
  const cached = peekLibrary();
  if (cached) {
    return cached;
  }
  const data = await once('library', async () => {
    const [playlists, savedAlbums, followed, savedTracks, savedShows, savedEpisodes, me] =
      await Promise.all([
        client.myPlaylists(50),
        client.savedAlbums(50),
        client.followedArtists(50),
        client.savedTracks(50),
        client.savedShows(50),
        client.savedEpisodes(50),
        client.me(),
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
          items: savedEpisodes.items.map((entry) => entry.episode).filter(Boolean),
        },
      },
      me,
      likedTotal: savedTracks.total,
    } satisfies LibraryData;
  });
  libraryCache = { at: Date.now(), data };
  return data;
}

const likedTracksCache = new Map<string, SpotifyTrack[]>();

export async function loadLikedTracks(client: SpotifyClient): Promise<SpotifyTrack[]> {
  const cached = likedTracksCache.get('liked');
  if (cached) {
    return cached;
  }
  const tracks = await once('liked-tracks', async () => {
    const page = await client.savedTracks(50);
    return page.items.map((entry) => entry.track).filter(Boolean);
  });
  likedTracksCache.set('liked', tracks);
  return tracks;
}

export function peekLikedTracks(): SpotifyTrack[] | null {
  return likedTracksCache.get('liked') ?? null;
}

const albumTracksCache = new Map<string, SpotifyTrack[]>();
const artistTopCache = new Map<string, SpotifyTrack[]>();
const artistAlbumsCache = new Map<string, SpotifyAlbum[]>();
const inflight = new Map<string, Promise<unknown>>();
let profile: SpotifyProfile | null = null;

async function once<T>(key: string, load: () => Promise<T>): Promise<T> {
  const pending = inflight.get(key) as Promise<T> | undefined;
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

export async function loadProfile(client: SpotifyClient): Promise<SpotifyProfile> {
  if (profile) {
    return profile;
  }
  profile = await once('profile', () => client.me());
  return profile;
}

export async function loadAlbumTracks(client: SpotifyClient, albumId: string): Promise<SpotifyTrack[]> {
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

export async function loadArtistTopTracks(client: SpotifyClient, artistId: string): Promise<SpotifyTrack[]> {
  const cached = artistTopCache.get(artistId);
  if (cached) {
    return cached;
  }
  const tracks = await once(`artist-top:${artistId}`, async () => {
    try {
      const { country } = await loadProfile(client);
      const { tracks: top } = await client.artistTopTracks(artistId, country || 'US');
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

async function loadArtistTopTracksBySearch(client: SpotifyClient, artistId: string): Promise<SpotifyTrack[]> {
  const artist = await client.artist(artistId);
  const response = await client.search(artist.name, ['track'], 10);
  const tracks = (response.tracks?.items ?? []).filter(
    (item): item is SpotifyTrack => Boolean(item),
  );
  if (tracks.length === 0) {
    throw new SpotifyApiError('noTopTracks', 'no tracks found for this artist');
  }
  return tracks;
}

export async function loadArtistAlbums(client: SpotifyClient, artistId: string): Promise<SpotifyAlbum[]> {
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

export function peekAlbumTracks(albumId: string): SpotifyTrack[] | null {
  return albumTracksCache.get(albumId) ?? null;
}

export function peekArtistTracks(artistId: string): SpotifyTrack[] | null {
  return artistTopCache.get(artistId) ?? null;
}

export function peekArtistAlbums(artistId: string): SpotifyAlbum[] | null {
  return artistAlbumsCache.get(artistId) ?? null;
}

export function resetCaches(): void {
  libraryCache = null;
  likedTracksCache.clear();
  albumTracksCache.clear();
  artistTopCache.clear();
  artistAlbumsCache.clear();
  inflight.clear();
  profile = null;
}

const artworkCache = new Map<string, string>();

export async function loadArtwork(client: SpotifyClient, url: string): Promise<string | null> {
  const cached = artworkCache.get(url);
  if (cached) {
    return cached;
  }
  const key = `artwork:${url}`;
  const pending = inflight.get(key) as Promise<string | null> | undefined;
  if (pending) {
    return pending;
  }
  const promise = client
    .fetchImage(url)
    .then((uri) => {
      artworkCache.set(url, uri);
      return uri;
    })
    .catch(() => null);
  inflight.set(key, promise);
  try {
    return await promise;
  } finally {
    inflight.delete(key);
  }
}

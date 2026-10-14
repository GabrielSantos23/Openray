import { createElement, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { CommandProps } from '@flowkey-mini/react-ui';
import { Action, ActionPanel, Grid, List } from '@flowkey-mini/react-ui';
import { SpotifyClient } from './api/client';
import type { SpotifyAlbum, SpotifyTrack } from './api/types';
import { formatMs } from './format';
import {
  loadAlbumTracks,
  loadArtistAlbums,
  loadArtwork,
  loadArtistTopTracks,
  loadLikedTracks,
  peekAlbumTracks,
  peekArtistAlbums,
  peekArtistTracks,
  peekLikedTracks,
} from './store';
import { albumActions, trackActions } from './search';

const ALBUM_SONGS_PREFIX = 'album-songs:';
const ARTIST_SONGS_PREFIX = 'artist-songs:';
const ARTIST_ALBUMS_PREFIX = 'artist-albums:';
const LIKED_SONGS_PREFIX = 'liked-songs:';

export function albumSongsKey(albumId: string): string {
  return ALBUM_SONGS_PREFIX + albumId;
}

export function artistSongsKey(artistId: string): string {
  return ARTIST_SONGS_PREFIX + artistId;
}

export function artistAlbumsKey(artistId: string): string {
  return ARTIST_ALBUMS_PREFIX + artistId;
}

export function likedSongsKey(userId: string): string {
  return LIKED_SONGS_PREFIX + userId;
}

export function isSubViewCommand(commandId: string | undefined): boolean {
  return (
    commandId !== undefined &&
    (commandId.startsWith(ALBUM_SONGS_PREFIX) ||
      commandId.startsWith(ARTIST_SONGS_PREFIX) ||
      commandId.startsWith(ARTIST_ALBUMS_PREFIX) ||
      commandId.startsWith(LIKED_SONGS_PREFIX))
  );
}

function matches(query: string, haystacks: string[]): boolean {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) {
    return true;
  }
  return haystacks.some((value) => value.toLowerCase().includes(needle));
}

function trackSubtitle(track: SpotifyTrack): string {
  return `${track.artists.map((artist) => artist.name).join(', ')} · ${formatMs(track.duration_ms)}`;
}

function TracksView({
  tracks,
  query,
  client,
  loadingTitle,
  errorTitle,
  errorMessage,
}: {
  tracks: SpotifyTrack[] | null;
  query: string;
  client: SpotifyClient;
  loadingTitle: string;
  errorTitle: string;
  errorMessage: string;
}) {
  if (errorMessage) {
    return (
      <List>
        <List.EmptyView title={errorTitle} description={errorMessage} />
      </List>
    );
  }
  if (!tracks) {
    return (
      <List>
        <List.EmptyView title={loadingTitle} />
      </List>
    );
  }
  const visible = tracks.filter((track) =>
    matches(query, [track.name, ...track.artists.map((artist) => artist.name)]),
  );
  if (visible.length === 0) {
    return (
      <List>
        <List.EmptyView title="No matching songs" />
      </List>
    );
  }
  return (
    <List>
      {visible.map((track) => (
        <List.Item
          key={track.id}
          id={track.id}
          title={track.name}
          subtitle={trackSubtitle(track)}
          kind="track"
          actions={trackActions(track, client, () => {}, new AbortController().signal)}
        />
      ))}
    </List>
  );
}

function useLoaded<T>(
  cached: T | null,
  load: (client: SpotifyClient) => Promise<T>,
  client: SpotifyClient,
): { value: T | null; error: string } {
  const [value, setValue] = useState<T | null>(cached);
  const [error, setError] = useState('');
  useEffect(() => {
    if (value) return;
    let alive = true;
    load(client)
      .then((loaded) => {
        if (alive) setValue(loaded);
      })
      .catch((caught) => {
        if (alive) setError((caught as Error).message ?? 'Something went wrong');
      });
    return () => {
      alive = false;
    };
  }, [client, load, value]);
  return { value, error };
}

export function AlbumSongsRoot(props: CommandProps): ReactNode {
  const client = useMemo(() => new SpotifyClient(props.native.call), [props.native]);
  const albumId = (props.commandId ?? '').slice(ALBUM_SONGS_PREFIX.length);
  const { value, error } = useLoaded(peekAlbumTracks(albumId), (c) => loadAlbumTracks(c, albumId), client);
  return createElement(TracksView, {
    tracks: value,
    query: props.query,
    client,
    loadingTitle: 'Loading songs…',
    errorTitle: 'Could not load album',
    errorMessage: error,
  });
}

export function LikedSongsRoot(props: CommandProps): ReactNode {
  const client = useMemo(() => new SpotifyClient(props.native.call), [props.native]);
  const { value, error } = useLoaded(peekLikedTracks(), (c) => loadLikedTracks(c), client);
  return createElement(TracksView, {
    tracks: value,
    query: props.query,
    client,
    loadingTitle: 'Loading liked songs…',
    errorTitle: 'Could not load liked songs',
    errorMessage: error,
  });
}

export function ArtistSongsRoot(props: CommandProps): ReactNode {
  const client = useMemo(() => new SpotifyClient(props.native.call), [props.native]);
  const artistId = (props.commandId ?? '').slice(ARTIST_SONGS_PREFIX.length);
  const { value, error } = useLoaded(
    peekArtistTracks(artistId),
    (c) => loadArtistTopTracks(c, artistId),
    client,
  );
  return createElement(TracksView, {
    tracks: value,
    query: props.query,
    client,
    loadingTitle: 'Loading popular songs…',
    errorTitle: 'Could not load popular songs',
    errorMessage: error,
  });
}

export function ArtistAlbumsRoot(props: CommandProps): ReactNode {
  const client = useMemo(() => new SpotifyClient(props.native.call), [props.native]);
  const artistId = (props.commandId ?? '').slice(ARTIST_ALBUMS_PREFIX.length);
  const { value, error } = useLoaded(peekArtistAlbums(artistId), (c) => loadArtistAlbums(c, artistId), client);
  if (error) {
    return createElement(
      Grid,
      { columns: 5 },
      createElement(Grid.EmptyView, { title: 'Could not load albums', description: error }),
    );
  }
  if (!value) {
    return createElement(Grid, { columns: 5 }, createElement(Grid.EmptyView, { title: 'Loading albums…' }));
  }
  const visible = value.filter((album) =>
    matches(props.query, [album.name, ...album.artists.map((artist) => artist.name)]),
  );
  if (visible.length === 0) {
    return createElement(Grid, { columns: 5 }, createElement(Grid.EmptyView, { title: 'No matching albums' }));
  }
  return createElement(AlbumsGrid, { albums: visible, client });
}

function AlbumsGrid({ albums, client }: { albums: SpotifyAlbum[]; client: SpotifyClient }): ReactNode {
  const [artwork, setArtwork] = useState<Record<string, string>>({});
  const urls = albums.map((album) => album.images[0]?.url ?? '').filter(Boolean);
  useEffect(() => {
    let alive = true;
    (async () => {
      for (const url of urls) {
        const uri = await loadArtwork(client, url);
        if (alive && uri) {
          setArtwork((previous) => ({ ...previous, [url]: uri }));
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [client, urls.join('|')]);
  return createElement(
    Grid,
    { columns: 5, title: albums[0]?.artists[0]?.name ?? 'Albums' },
    albums.map((album) =>
      createElement(Grid.Item, {
        key: album.id,
        id: album.id,
        title: album.name,
        subtitle: `${album.artists.map((artist) => artist.name).join(', ')} · ${album.release_date.slice(0, 4)}`,
        kind: 'album',
        icon: artwork[album.images[0]?.url ?? ''] ? { uri: artwork[album.images[0]?.url ?? ''] } : undefined,
        actions: albumActions(album, client, () => {}, new AbortController().signal),
      }),
    ),
  );
}

export function warmAlbumSongs(client: SpotifyClient, albumId: string): void {
  void loadAlbumTracks(client, albumId).catch(() => {});
}

export function warmArtistSongs(client: SpotifyClient, artistId: string): void {
  void loadArtistTopTracks(client, artistId).catch(() => {});
}

export function warmArtistAlbums(client: SpotifyClient, artistId: string): void {
  void loadArtistAlbums(client, artistId).catch(() => {});
}

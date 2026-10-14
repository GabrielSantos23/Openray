import { createElement, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { CommandProps } from '@flowkey-mini/react-ui';
import { Action, ActionPanel, Grid, List } from '@flowkey-mini/react-ui';
import { SpotifyApiError, SpotifyClient } from './api/client';
import type {
  SpotifyAlbum,
  SpotifyArtist,
  SpotifyEpisode,
  SpotifyPlaylist,
  SpotifyShow,
  SpotifyTrack,
} from './api/types';
import { externalUrl, formatMs, trackUrl } from './format';
import { clearRecentSearches, recentSearches, rememberSearch, removeSearch } from './recent';
import {
  collectArtworkUrls,
  describeError,
  isAborted,
  pruneResults,
  SEARCH_FILTERS,
  startRadio,
  typesForFilter,
  type SearchResults,
} from './search-model';
import {
  albumSongsKey,
  artistAlbumsKey,
  artistSongsKey,
  warmAlbumSongs,
  warmArtistAlbums,
  warmArtistSongs,
} from './subviews';

const SEARCH_DEBOUNCE_MS = 150;
const RECENT_SAVE_DEBOUNCE_MS = 3000;
const NOTICE_CLEAR_MS = 4000;
const GRID_FILTERS = new Set(['artists', 'albums', 'shows']);

export { SEARCH_FILTERS } from './search-model';

export function SearchCommand({ query, filterValue, native, signal, preferences }: CommandProps) {
  const client = useMemo(() => new SpotifyClient(native.call), [native]);
  const configuredClientId =
    typeof preferences.clientId === 'string' && preferences.clientId.length > 0
      ? preferences.clientId
      : '';
  const filter = filterValue ?? 'all';
  const [authState, setAuthState] = useState<'checking' | 'unauthorized' | 'authorized'>(
    'checking',
  );
  const [authMessage, setAuthMessage] = useState('');
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [artwork, setArtwork] = useState<Record<string, string>>({});
  const [recentVersion, setRecentVersion] = useState(0);
  const artworkDone = useRef(new Set<string>());
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const status = await client.authStatus(controller.signal);
        setAuthState(status.ok ? 'authorized' : 'unauthorized');
      } catch (caught) {
        if (isAborted(caught)) return;
        setAuthState('unauthorized');
        setAuthMessage(describeAuthError(caught));
      }
    })();
    return () => controller.abort();
  }, [client]);

  useEffect(() => {
    if (authState !== 'authorized') return;
    if (query.trim().length === 0) {
      setResults(null);
      setLoading(false);
      setError('');
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      setError('');
      (async () => {
        try {
          const response = await client.search(
            query.trim(),
            typesForFilter(filter),
            50,
            controller.signal,
          );
          setResults(pruneResults(response as SearchResults));
        } catch (caught) {
          if (isAborted(caught)) return;
          if (caught instanceof SpotifyApiError && caught.code === 'authRequired') {
            setAuthState('unauthorized');
            setAuthMessage('Your Spotify session expired.');
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
    if (authState !== 'authorized' || query.trim().length < 4) return;
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

  const artworkKey = collectArtworkUrls(results).join('|');
  useEffect(() => {
    let alive = true;
    (async () => {
      for (const url of artworkKey.split('|')) {
        if (!url || artworkDone.current.has(url)) continue;
        artworkDone.current.add(url);
        try {
          const uri = await client.fetchImage(url, signal);
          if (alive) setArtwork((previous) => ({ ...previous, [url]: uri }));
        } catch {
          if (alive) artworkDone.current.delete(url);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [client, signal, artworkKey]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), NOTICE_CLEAR_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  if (authState === 'checking') {
    return (
      <List filter={SEARCH_FILTERS}>
        <List.EmptyView key="checking" title="Checking Spotify connection…" />
      </List>
    );
  }

  if (authState === 'unauthorized') {
    return (
      <List filter={SEARCH_FILTERS}>
        <List.EmptyView
          title="Connect Spotify"
          description={
            authMessage ||
            (configuredClientId
              ? 'Authorize FlowKey to search and control your Spotify.'
              : 'Paste your Spotify client id in FlowKey Settings (Spotify section) first, then connect.')
          }
        />
        <List.Item
          id="connect-spotify"
          title="Connect Spotify"
          icon={{ lucide: 'plug', color: '#1DB954' }}
          actions={
            <ActionPanel>
              <Action
                title="Connect Spotify"
                onAction={async () => {
                  if (!configuredClientId) {
                    setNotice(
                      'Add your Spotify client id in FlowKey Settings, then connect again.',
                    );
                    return;
                  }
                  setNotice('Waiting for Spotify authorization…');
                  try {
                    const result = await client.authorize(signal, configuredClientId);
                    if (result.ok) {
                      setNotice('');
                      setAuthState('authorized');
                    } else {
                      setNotice('Authorization did not complete.');
                    }
                  } catch (caught) {
                    if (isAborted(caught)) return;
                    if (caught instanceof SpotifyApiError && caught.code === 'notConfigured') {
                      setNotice(
                        'Add your Spotify client id in FlowKey Settings, then connect again.',
                      );
                    } else {
                      setNotice(describeError(caught));
                    }
                  }
                }}
              />
            </ActionPanel>
          }
        />
      </List>
    );
  }

  if (query.trim().length === 0) {
    const recents = recentSearches();
    return (
      <List filter={SEARCH_FILTERS}>
        <List.EmptyView title="What do you want to listen to?" />
        {notice ? (
          <List.Section title="Status">
            <List.Item id="notice" title={notice} icon={{ lucide: 'info' }} />
          </List.Section>
        ) : null}
        {recents.length > 0 ? (
          <List.Section title="Recent Searches">
            {recents.map((recent) => (
              <List.Item
                key={recent}
                id={`recent:${recent}`}
                title={recent}
                icon={{ lucide: 'clock' }}
                actions={
                  <ActionPanel>
                    <Action
                      title="Remove Search"
                      onAction={() => {
                        removeSearch(recent);
                        setRecentVersion((version) => version + 1);
                      }}
                    />
                    <Action
                      title="Remove All Searches"
                      onAction={() => {
                        clearRecentSearches();
                        setRecentVersion((version) => version + 1);
                      }}
                    />
                  </ActionPanel>
                }
              />
            ))}
          </List.Section>
        ) : null}
      </List>
    );
  }

  if (GRID_FILTERS.has(filter)) {
    const items = buildGridItems(results, filter, artwork, client, setNotice, signal);
    return (
      <Grid columns={5} title={gridTitle(filter)}>
        {error ? <Grid.EmptyView title="Search failed" description={error} /> : null}
        {!error && loading ? <Grid.EmptyView title="Searching…" /> : null}
        {!error && !loading && items.length === 0 ? (
          <Grid.EmptyView title="No results" description={`Nothing found for "${query.trim()}"`} />
        ) : null}
        {items}
      </Grid>
    );
  }

  const sections = buildListSections(results, filter, artwork, client, setNotice, signal);
  const searching = loading || results === null;
  return (
    <List filter={SEARCH_FILTERS}>
      {error ? <List.EmptyView title="Search failed" description={error} /> : null}
      {!error && searching ? <List.EmptyView title="Searching…" /> : null}
      {!error && !searching && sections.length === 0 ? (
        <List.EmptyView title="No results" description={`Nothing found for "${query.trim()}"`} />
      ) : null}
      {sections}
    </List>
  );
}

function gridTitle(filter: string): string {
  return SEARCH_FILTERS.find((option) => option.value === filter)?.label ?? 'Results';
}

export interface SectionOptions {
  tracksTitle?: string;
  episodesTitle?: string;
  sectionLimit?: number;
  likedSongsItem?: ReactNode;
}

export function buildListSections(
  results: SearchResults | null,
  filter: string,
  artwork: Record<string, string>,
  client: SpotifyClient,
  setNotice: (message: string) => void,
  signal: AbortSignal,
  options: SectionOptions = {},
): ReactNode[] {
  const sections: ReactNode[] = [];
  const allLimit = (fallback: number) => options.sectionLimit ?? fallback;
  const artists = results?.artists?.items ?? [];
  const tracks = results?.tracks?.items ?? [];
  const albums = results?.albums?.items ?? [];
  const playlists = results?.playlists?.items ?? [];
  const shows = results?.shows?.items ?? [];
  const episodes = results?.episodes?.items ?? [];

  if ((filter === 'all' || filter === 'artists') && artists.length > 0) {
    sections.push(
      createElement(
        List.Section,
        { title: 'Artists', key: 'artists' },
        artists
          .slice(0, filter === 'all' ? allLimit(3) : 50)
          .map((artist) =>
            artistListItem(
              artist,
              artwork[artist.images?.[0]?.url ?? ''],
              client,
              setNotice,
              signal,
            ),
          ),
      ),
    );
  }
  if ((filter === 'all' || filter === 'tracks') && tracks.length > 0) {
    sections.push(
      createElement(
        List.Section,
        { title: options.tracksTitle ?? 'Songs', key: 'tracks' },
        tracks
          .slice(0, filter === 'all' ? allLimit(4) : 50)
          .map((track) => trackListItem(track, artwork, client, setNotice, signal)),
      ),
    );
  }
  if ((filter === 'all' || filter === 'albums') && albums.length > 0) {
    sections.push(
      createElement(
        List.Section,
        { title: 'Albums', key: 'albums' },
        albums
          .slice(0, filter === 'all' ? allLimit(6) : 50)
          .map((album) => albumListItem('list', album, artwork, client, setNotice, signal)),
      ),
    );
  }
  if (
    (filter === 'all' || filter === 'playlists') &&
    (playlists.length > 0 || filter === 'playlists')
  ) {
    sections.push(
      createElement(List.Section, { title: 'Playlists', key: 'playlists' }, [
        ...(options.likedSongsItem ? [options.likedSongsItem] : []),
        ...playlists
          .slice(0, filter === 'all' ? allLimit(6) : 50)
          .map((playlist) => playlistListItem(playlist, artwork, client, setNotice, signal)),
      ]),
    );
  }
  if ((filter === 'all' || filter === 'shows') && shows.length > 0) {
    sections.push(
      createElement(
        List.Section,
        { title: 'Podcasts & Shows', key: 'shows' },
        shows
          .slice(0, filter === 'all' ? allLimit(3) : 50)
          .map((show) => showListItem('list', show, artwork, client, setNotice, signal)),
      ),
    );
  }
  if ((filter === 'all' || filter === 'episodes') && episodes.length > 0) {
    sections.push(
      createElement(
        List.Section,
        { title: options.episodesTitle ?? 'Episodes', key: 'episodes' },
        episodes
          .slice(0, filter === 'all' ? allLimit(3) : 50)
          .map((episode) => episodeListItem(episode, artwork, client, setNotice, signal)),
      ),
    );
  }
  return sections.filter(Boolean);
}

export function buildGridItems(
  results: SearchResults | null,
  filter: string,
  artwork: Record<string, string>,
  client: SpotifyClient,
  setNotice: (message: string) => void,
  signal: AbortSignal,
): ReactNode[] {
  if (filter === 'artists') {
    return (results?.artists?.items ?? []).map((artist) =>
      createElement(Grid.Item, {
        key: artist.id,
        id: artist.id,
        title: artist.name,
        kind: 'artist',
        icon: iconSpec(artwork[artist.images?.[0]?.url ?? '']),
        actions: artistActions(artist, client, setNotice, signal),
      }),
    );
  }
  if (filter === 'albums') {
    return (results?.albums?.items ?? []).map((album) =>
      createElement(Grid.Item, {
        key: album.id,
        id: album.id,
        title: album.name,
        subtitle: `${artistNames(album.artists)} · ${album.release_date.slice(0, 4)}`,
        kind: 'album',
        icon: iconSpec(artwork[album.images?.[0]?.url ?? '']),
        actions: albumActions(album, client, setNotice, signal),
      }),
    );
  }
  return (results?.shows?.items ?? []).map((show) =>
    createElement(Grid.Item, {
      key: show.id,
      id: show.id,
      title: show.name,
      subtitle: show.publisher,
      kind: 'show',
      icon: iconSpec(artwork[show.images?.[0]?.url ?? '']),
      actions: showActions(show, client, setNotice, signal),
    }),
  );
}

type Mode = 'list' | 'grid';

function iconSpec(uri: string | undefined) {
  return uri ? { uri } : undefined;
}

function artistNames(artists: { name: string }[]): string {
  return artists.map((artist) => artist.name).join(', ');
}

function artistListItem(
  artist: SpotifyArtist,
  iconUri: string | undefined,
  client: SpotifyClient,
  setNotice: (message: string) => void,
  signal: AbortSignal,
): ReactNode {
  return createElement(List.Item, {
    key: artist.id,
    id: artist.id,
    title: artist.name,
    kind: 'artist',
    icon: iconSpec(iconUri),
    actions: artistActions(artist, client, setNotice, signal),
  });
}

function trackListItem(
  track: SpotifyTrack,
  artwork: Record<string, string>,
  client: SpotifyClient,
  setNotice: (message: string) => void,
  signal: AbortSignal,
): ReactNode {
  return createElement(List.Item, {
    key: track.id,
    id: track.id,
    title: track.name,
    subtitle: `${artistNames(track.artists)} · ${formatMs(track.duration_ms)}`,
    kind: 'track',
    icon: iconSpec(artwork[track.album?.images?.at(-1)?.url ?? '']),
    actions: trackActions(track, client, setNotice, signal),
  });
}

function albumListItem(
  mode: Mode,
  album: SpotifyAlbum,
  artwork: Record<string, string>,
  client: SpotifyClient,
  setNotice: (message: string) => void,
  signal: AbortSignal,
): ReactNode {
  if (mode === 'grid') {
    return createElement(Grid.Item, {
      key: album.id,
      id: album.id,
      title: album.name,
      subtitle: `${artistNames(album.artists)} · ${album.release_date.slice(0, 4)}`,
      kind: 'album',
      icon: iconSpec(artwork[album.images?.[0]?.url ?? '']),
      actions: albumActions(album, client, setNotice, signal),
    });
  }
  return createElement(List.Item, {
    key: album.id,
    id: album.id,
    title: album.name,
    subtitle: `${artistNames(album.artists)} · ${album.release_date.slice(0, 4)}`,
    kind: 'album',
    icon: iconSpec(artwork[album.images?.[0]?.url ?? '']),
    actions: albumActions(album, client, setNotice, signal),
  });
}

function playlistListItem(
  playlist: SpotifyPlaylist,
  artwork: Record<string, string>,
  client: SpotifyClient,
  setNotice: (message: string) => void,
  signal: AbortSignal,
): ReactNode {
  return createElement(List.Item, {
    key: playlist.id,
    id: playlist.id,
    title: playlist.name,
    subtitle: playlist.owner?.display_name ?? '',
    kind: 'playlist',
    icon: iconSpec(artwork[playlist.images?.at(-1)?.url ?? '']),
    actions: playlistActions(playlist, client, setNotice, signal),
  });
}

function showListItem(
  mode: Mode,
  show: SpotifyShow,
  artwork: Record<string, string>,
  client: SpotifyClient,
  setNotice: (message: string) => void,
  signal: AbortSignal,
): ReactNode {
  return createElement(mode === 'grid' ? Grid.Item : List.Item, {
    key: show.id,
    id: show.id,
    title: show.name,
    subtitle: show.publisher,
    kind: 'show',
    icon: iconSpec(artwork[show.images?.[0]?.url ?? '']),
    actions: showActions(show, client, setNotice, signal),
  });
}

function episodeListItem(
  episode: SpotifyEpisode,
  artwork: Record<string, string>,
  client: SpotifyClient,
  setNotice: (message: string) => void,
  signal: AbortSignal,
): ReactNode {
  return createElement(List.Item, {
    key: episode.id,
    id: episode.id,
    title: episode.name,
    subtitle: episode.show?.name ?? '',
    kind: 'episode',
    icon: iconSpec(artwork[episode.show?.images?.at(-1)?.url ?? episode.images?.at(-1)?.url ?? '']),
    actions: episodeActions(episode, client, setNotice, signal),
  });
}

function artistActions(
  artist: SpotifyArtist,
  client: SpotifyClient,
  setNotice: (message: string) => void,
  signal: AbortSignal,
): ReactNode {
  return (
    <ActionPanel>
      <Action
        title="Play"
        onAction={async () => {
          try {
            await client.play({ context_uri: `spotify:artist:${artist.id}` }, undefined);
          } catch (caught) {
            setNotice(describeError(caught));
          }
        }}
      />
      <Action
        title="Start Radio"
        onAction={async () => {
          try {
            await startRadio(client, { artists: [artist.id] }, signal);
            setNotice(`Radio started from ${artist.name}`);
          } catch (caught) {
            setNotice(describeError(caught));
          }
        }}
      />
      <Action
        title="Go to Songs"
        push={artistSongsKey(artist.id)}
        onAction={() => {
          warmArtistSongs(client, artist.id);
        }}
      />
      <Action
        title="Go to Albums"
        push={artistAlbumsKey(artist.id)}
        onAction={() => {
          warmArtistAlbums(client, artist.id);
        }}
      />
      <Action
        title="Copy Artist Link"
        onAction={async () => {
          await copyToClipboard(client, externalUrl('artist', artist.id));
          setNotice('Copied artist link');
        }}
      />
    </ActionPanel>
  );
}

export function trackActions(
  track: SpotifyTrack,
  client: SpotifyClient,
  setNotice: (message: string) => void,
  signal: AbortSignal,
): ReactNode {
  return (
    <ActionPanel>
      <Action
        title="Play"
        onAction={async () => {
          try {
            await client.play({ uris: [track.uri] });
            setNotice(`Playing ${track.name}`);
          } catch (caught) {
            setNotice(describeError(caught));
          }
        }}
      />
      <Action
        title="Like / Unlike"
        onAction={async () => {
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
        }}
      />
      <Action
        title="Add to Queue"
        onAction={async () => {
          try {
            await client.addToQueue(track.uri);
            setNotice(`Added ${track.name} to queue`);
          } catch (caught) {
            setNotice(describeError(caught));
          }
        }}
      />
      <Action
        title="Start Radio"
        onAction={async () => {
          try {
            await startRadio(client, { tracks: [track.id] }, signal);
            setNotice(`Radio started from ${track.name}`);
          } catch (caught) {
            setNotice(describeError(caught));
          }
        }}
      />
      <Action
        title="Copy Track Link"
        onAction={async () => {
          await copyToClipboard(client, trackUrl(track));
          setNotice('Copied track link');
        }}
      />
    </ActionPanel>
  );
}

export function albumActions(
  album: SpotifyAlbum,
  client: SpotifyClient,
  setNotice: (message: string) => void,
  signal: AbortSignal,
): ReactNode {
  return (
    <ActionPanel>
      <Action
        title="Play"
        onAction={async () => {
          try {
            await client.play({ context_uri: `spotify:album:${album.id}` });
          } catch (caught) {
            setNotice(describeError(caught));
          }
        }}
      />
      <Action
        title="Add / Remove from Library"
        onAction={async () => {
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
        }}
      />
      <Action
        title="Copy Album Link"
        onAction={async () => {
          await copyToClipboard(client, externalUrl('album', album.id));
          setNotice('Copied album link');
        }}
      />
      <Action
        title="Go to Songs"
        push={albumSongsKey(album.id)}
        onAction={() => {
          warmAlbumSongs(client, album.id);
        }}
      />
    </ActionPanel>
  );
}

function playlistActions(
  playlist: SpotifyPlaylist,
  client: SpotifyClient,
  setNotice: (message: string) => void,
  signal: AbortSignal,
): ReactNode {
  return (
    <ActionPanel>
      <Action
        title="Play"
        onAction={async () => {
          try {
            await client.play({ context_uri: `spotify:playlist:${playlist.id}` });
          } catch (caught) {
            setNotice(describeError(caught));
          }
        }}
      />
      <Action
        title="Copy Playlist Link"
        onAction={async () => {
          await copyToClipboard(client, externalUrl('playlist', playlist.id));
          setNotice('Copied playlist link');
        }}
      />
    </ActionPanel>
  );
}

function showActions(
  show: SpotifyShow,
  client: SpotifyClient,
  setNotice: (message: string) => void,
  signal: AbortSignal,
): ReactNode {
  return (
    <ActionPanel>
      <Action
        title="Play"
        onAction={async () => {
          try {
            await client.play({ context_uri: `spotify:show:${show.id}` });
          } catch (caught) {
            setNotice(describeError(caught));
          }
        }}
      />
      <Action
        title="Copy Show Link"
        onAction={async () => {
          await copyToClipboard(client, externalUrl('show', show.id));
          setNotice('Copied show link');
        }}
      />
    </ActionPanel>
  );
}

function episodeActions(
  episode: SpotifyEpisode,
  client: SpotifyClient,
  setNotice: (message: string) => void,
  signal: AbortSignal,
): ReactNode {
  return (
    <ActionPanel>
      <Action
        title="Play"
        onAction={async () => {
          try {
            await client.play({ uris: [episode.uri] });
            setNotice(`Playing ${episode.name}`);
          } catch (caught) {
            setNotice(describeError(caught));
          }
        }}
      />
      <Action
        title="Add to Queue"
        onAction={async () => {
          try {
            await client.addToQueue(episode.uri);
            setNotice(`Added ${episode.name} to queue`);
          } catch (caught) {
            setNotice(describeError(caught));
          }
        }}
      />
    </ActionPanel>
  );
}

async function copyToClipboard(client: SpotifyClient, text: string): Promise<void> {
  await client.copyText(text);
}

function describeAuthError(error: unknown): string {
  const candidate = error as { code?: string; message?: string };
  if (candidate?.code === 'notConfigured') {
    return 'Spotify client id is not configured on this machine. See the FlowKey README.';
  }
  return '';
}

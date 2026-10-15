import { cloneElement, createElement, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';
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
  const [recentVersion, setRecentVersion] = useState(0);
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
      <ConnectView
        native={native}
        signal={signal}
        configuredClientId={configuredClientId}
        authMessage={authMessage}
        setAuthState={setAuthState}
      />
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
    const items = buildGridItems(results, filter, client, setNotice, signal);
    return (
      <Grid columns={5} title={gridTitle(filter)}>
        {error ? <Grid.EmptyView title="Search failed" description={error} /> : null}
        {!error && loading ? <Grid.EmptyView title="Searching…" /> : null}
        {!error && !loading && items.length === 0 ? (
          <Grid.EmptyView title="No results" description={`Nothing found for "${query.trim()}"`} />
        ) : null}
        {notice ? (
          <Grid.Section title="Status">
            <Grid.Item id="notice" title={notice} icon={{ lucide: 'info' }} />
          </Grid.Section>
        ) : null}
        {items}
      </Grid>
    );
  }

  const sections = buildListSections(results, filter, client, setNotice, signal);
  const searching = loading || results === null;
  return (
    <List filter={SEARCH_FILTERS}>
      {error ? <List.EmptyView title="Search failed" description={error} /> : null}
      {!error && searching ? <List.EmptyView title="Searching…" /> : null}
      {!error && !searching && sections.length === 0 ? (
        <List.EmptyView title="No results" description={`Nothing found for "${query.trim()}"`} />
      ) : null}
      {notice ? (
        <List.Section title="Status">
          <List.Item id="notice" title={notice} icon={{ lucide: 'info' }} />
        </List.Section>
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

/**
 * The serializer rejects a repeated item id across the whole tree (Raycast's own duplicate-key
 * error). Spotify search can return the same entity in two sections — or twice in one — so later
 * duplicates get a stable `~n` suffix instead of failing the render.
 */
function withFreshIds(nodes: ReactNode[], seen: Set<string>): ReactNode[] {
  return nodes.map((node) => {
    const id = (node as { props?: { id?: unknown } } | null)?.props?.id;
    if (typeof id !== 'string' || id.length === 0) return node;
    if (!seen.has(id)) {
      seen.add(id);
      return node;
    }
    let n = 2;
    while (seen.has(`${id}~${n}`)) n += 1;
    return cloneElement(node as ReactElement, { id: `${id}~${n}` });
  });
}

export function buildListSections(
  results: SearchResults | null,
  filter: string,
  client: SpotifyClient,
  setNotice: (message: string) => void,
  signal: AbortSignal,
  options: SectionOptions = {},
): ReactNode[] {
  const sections: ReactNode[] = [];
  const seenIds = new Set<string>();
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
        withFreshIds(
          artists
            .slice(0, filter === 'all' ? allLimit(3) : 50)
            .map((artist) => artistListItem(artist, client, setNotice, signal)),
          seenIds,
        ),
      ),
    );
  }
  if ((filter === 'all' || filter === 'tracks') && tracks.length > 0) {
    sections.push(
      createElement(
        List.Section,
        { title: options.tracksTitle ?? 'Songs', key: 'tracks' },
        withFreshIds(
          tracks
            .slice(0, filter === 'all' ? allLimit(4) : 50)
            .map((track) => trackListItem(track, client, setNotice, signal)),
          seenIds,
        ),
      ),
    );
  }
  if ((filter === 'all' || filter === 'albums') && albums.length > 0) {
    sections.push(
      createElement(
        List.Section,
        { title: 'Albums', key: 'albums' },
        withFreshIds(
          albums
            .slice(0, filter === 'all' ? allLimit(6) : 50)
            .map((album) => albumListItem('list', album, client, setNotice, signal)),
          seenIds,
        ),
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
        ...withFreshIds(
          playlists
            .slice(0, filter === 'all' ? allLimit(6) : 50)
            .map((playlist) => playlistListItem(playlist, client, setNotice, signal)),
          seenIds,
        ),
      ]),
    );
  }
  if ((filter === 'all' || filter === 'shows') && shows.length > 0) {
    sections.push(
      createElement(
        List.Section,
        { title: 'Podcasts & Shows', key: 'shows' },
        withFreshIds(
          shows
            .slice(0, filter === 'all' ? allLimit(3) : 50)
            .map((show) => showListItem('list', show, client, setNotice, signal)),
          seenIds,
        ),
      ),
    );
  }
  if ((filter === 'all' || filter === 'episodes') && episodes.length > 0) {
    sections.push(
      createElement(
        List.Section,
        { title: options.episodesTitle ?? 'Episodes', key: 'episodes' },
        withFreshIds(
          episodes
            .slice(0, filter === 'all' ? allLimit(3) : 50)
            .map((episode) => episodeListItem(episode, client, setNotice, signal)),
          seenIds,
        ),
      ),
    );
  }
  return sections.filter(Boolean);
}

export function buildGridItems(
  results: SearchResults | null,
  filter: string,
  client: SpotifyClient,
  setNotice: (message: string) => void,
  signal: AbortSignal,
): ReactNode[] {
  const seenIds = new Set<string>();
  if (filter === 'artists') {
    return withFreshIds(
      (results?.artists?.items ?? []).map((artist) =>
        createElement(Grid.Item, {
          key: artist.id,
          id: artist.id,
          title: artist.name,
          kind: 'artist',
          icon: gridImage(artist.images),
          actions: artistActions(artist, client, setNotice, signal),
        }),
      ),
      seenIds,
    );
  }
  if (filter === 'albums') {
    return withFreshIds(
      (results?.albums?.items ?? []).map((album) =>
        createElement(Grid.Item, {
          key: album.id,
          id: album.id,
          title: album.name,
          subtitle: `${artistNames(album.artists)} · ${album.release_date.slice(0, 4)}`,
          kind: 'album',
          icon: gridImage(album.images),
          actions: albumActions(album, client, setNotice, signal),
        }),
      ),
      seenIds,
    );
  }
  return withFreshIds(
    (results?.shows?.items ?? []).map((show) =>
      createElement(Grid.Item, {
        key: show.id,
        id: show.id,
        title: show.name,
        subtitle: show.publisher,
        kind: 'show',
        icon: gridImage(show.images),
        actions: showActions(show, client, setNotice, signal),
      }),
    ),
    seenIds,
  );
}

type Mode = 'list' | 'grid';

// Icons ride as the CDN URL itself — the renderer's <img> loads it directly, so no artwork has
// to be proxied through the worker (large data: URIs there OOM the worker on big result sets).
// List rows take the smallest rendition; grid tiles take the mid one so they stay sharp at 2x.
function listImage(images: { url?: string }[] | undefined): { uri: string } | undefined {
  const url = images?.at(-1)?.url ?? images?.[0]?.url;
  return url ? { uri: url } : undefined;
}

function gridImage(images: { url?: string }[] | undefined): { uri: string } | undefined {
  const url = (images?.length ?? 0) > 1 ? images?.[1]?.url : images?.[0]?.url;
  return url ? { uri: url } : undefined;
}

function artistNames(artists: { name: string }[]): string {
  return artists.map((artist) => artist.name).join(', ');
}

function artistListItem(
  artist: SpotifyArtist,
  client: SpotifyClient,
  setNotice: (message: string) => void,
  signal: AbortSignal,
): ReactNode {
  return createElement(List.Item, {
    key: artist.id,
    id: artist.id,
    title: artist.name,
    kind: 'artist',
    icon: listImage(artist.images),
    actions: artistActions(artist, client, setNotice, signal),
  });
}

function trackListItem(
  track: SpotifyTrack,
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
    icon: listImage(track.album?.images),
    actions: trackActions(track, client, setNotice, signal),
  });
}

function albumListItem(
  mode: Mode,
  album: SpotifyAlbum,
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
      icon: gridImage(album.images),
      actions: albumActions(album, client, setNotice, signal),
    });
  }
  return createElement(List.Item, {
    key: album.id,
    id: album.id,
    title: album.name,
    subtitle: `${artistNames(album.artists)} · ${album.release_date.slice(0, 4)}`,
    kind: 'album',
    icon: listImage(album.images),
    actions: albumActions(album, client, setNotice, signal),
  });
}

function playlistListItem(
  playlist: SpotifyPlaylist,
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
    icon: listImage(playlist.images),
    actions: playlistActions(playlist, client, setNotice, signal),
  });
}

function showListItem(
  mode: Mode,
  show: SpotifyShow,
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
    icon: mode === 'grid' ? gridImage(show.images) : listImage(show.images),
    actions: showActions(show, client, setNotice, signal),
  });
}

function episodeListItem(
  episode: SpotifyEpisode,
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
    icon: listImage(episode.show?.images ?? episode.images),
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
        icon={{ lucide: 'play' }}
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
        icon={{ lucide: 'forward' }}
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
        icon={{ lucide: 'music' }}
        push={artistSongsKey(artist.id)}
        onAction={() => {
          warmArtistSongs(client, artist.id);
        }}
      />
      <Action
        title="Go to Albums"
        icon={{ lucide: 'image' }}
        push={artistAlbumsKey(artist.id)}
        onAction={() => {
          warmArtistAlbums(client, artist.id);
        }}
      />
      <Action
        title="Copy Artist Link"
        icon={{ lucide: 'copy-clipboard' }}
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
        icon={{ lucide: 'play' }}
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
        icon={{ lucide: 'star' }}
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
        icon={{ lucide: 'list' }}
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
        icon={{ lucide: 'forward' }}
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
        icon={{ lucide: 'copy-clipboard' }}
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
        icon={{ lucide: 'play' }}
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
        icon={{ lucide: 'star' }}
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
        icon={{ lucide: 'copy-clipboard' }}
        onAction={async () => {
          await copyToClipboard(client, externalUrl('album', album.id));
          setNotice('Copied album link');
        }}
      />
      <Action
        title="Go to Songs"
        icon={{ lucide: 'music' }}
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
        icon={{ lucide: 'play' }}
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
        icon={{ lucide: 'copy-clipboard' }}
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
        icon={{ lucide: 'play' }}
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
        icon={{ lucide: 'copy-clipboard' }}
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
        icon={{ lucide: 'play' }}
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
        icon={{ lucide: 'list' }}
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

/**
 * The sign-in screen. The #1 failure mode is a redirect URI that does not match the one
 * registered in the Spotify dashboard (Spotify compares the string exactly), so the exact
 * callback URL is shown on the page with a copy action, and Connect explains all three steps.
 */
function ConnectView({
  native,
  signal,
  configuredClientId,
  authMessage,
  setAuthState,
}: {
  native: CommandProps['native'];
  signal: AbortSignal;
  configuredClientId: string | null;
  authMessage: string;
  setAuthState: (state: 'checking' | 'unauthorized' | 'authorized') => void;
}): ReactNode {
  const client = useMemo(() => new SpotifyClient(native.call), [native]);
  const [redirectUri, setRedirectUri] = useState<string | null>(null);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await native.call<{ redirectUri: string }>('oauth.redirectUri', { provider: 'spotify' });
        if (!cancelled) setRedirectUri(result.redirectUri);
      } catch {
        if (!cancelled) setRedirectUri(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [native]);

  const description =
    notice ||
    authMessage ||
    (configuredClientId
      ? '1. Register the Redirect URI below in your Spotify app (dashboard → Edit).  2. Connect. Spotify compares the URI exactly.'
      : 'Paste your client id in FlowKey Settings → Spotify (Save), register the Redirect URI below in your Spotify app, then Connect.');

  return (
    <List filter={SEARCH_FILTERS}>
      <List.EmptyView title="Connect Spotify" description={description} />
      <List.Item
        id="redirect-uri"
        title="Redirect URI to register"
        subtitle={redirectUri ?? 'loading…'}
        icon={{ lucide: 'link', color: '#1DB954' }}
        actions={
          <ActionPanel>
            <Action
              title="Copy Redirect URI"
              icon={{ lucide: 'link' }}
              onAction={async () => {
                if (!redirectUri) return;
                await copyToClipboard(client, redirectUri);
                setNotice('Redirect URI copied — paste it into your Spotify app settings.');
              }}
            />
          </ActionPanel>
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
              icon={{ lucide: 'forward' }}
              onAction={async () => {
                if (!configuredClientId) {
                  setNotice('Add your Spotify client id in FlowKey Settings → Spotify (Save), then connect again.');
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
                    setNotice('Add your Spotify client id in FlowKey Settings → Spotify (Save), then connect again.');
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

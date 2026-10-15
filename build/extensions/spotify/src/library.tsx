import { createElement, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { CommandProps } from '@flowkey-mini/react-ui';
import { Action, ActionPanel, Grid, List } from '@flowkey-mini/react-ui';
import { SpotifyApiError, SpotifyClient } from './api/client';
import { buildGridItems, buildListSections } from './search';
import { filterLibrary, SEARCH_FILTERS, type SearchResults } from './search-model';
import { likedSongsKey } from './subviews';
import { loadLibrary, type LibraryData } from './store';

// The renderer loads this CDN image directly (like every other artwork in the extension).
const LIKED_SONGS_ICON = 'https://misc.scdn.co/liked-songs-64.png';
const GRID_FILTERS = new Set(['artists', 'albums', 'shows']);

export function LibraryCommand({ query, filterValue, native, signal }: CommandProps) {
  const client = useMemo(() => new SpotifyClient(native.call), [native]);
  const filter = filterValue ?? 'all';
  const [authState, setAuthState] = useState<'checking' | 'unauthorized' | 'authorized'>(
    'checking',
  );
  const [data, setData] = useState<LibraryData | null>(() => null);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const status = await client.authStatus(controller.signal);
        setAuthState(status.ok ? 'authorized' : 'unauthorized');
      } catch (caught) {
        if ((caught as { code?: string })?.code === 'aborted') return;
        setAuthState('unauthorized');
      }
    })();
    return () => controller.abort();
  }, [client]);

  useEffect(() => {
    if (authState !== 'authorized') return;
    let alive = true;
    (async () => {
      try {
        const library = await loadLibrary(client);
        if (alive) setData(library);
      } catch (caught) {
        if (!alive) return;
        if (caught instanceof SpotifyApiError && caught.code === 'authRequired') {
          setAuthState('unauthorized');
        } else {
          setError((caught as Error).message ?? 'Could not load your library');
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [authState, client]);

  if (authState === 'checking') {
    return (
      <List filter={SEARCH_FILTERS}>
        <List.EmptyView title="Checking Spotify connection…" />
      </List>
    );
  }

  if (authState === 'unauthorized') {
    return (
      <List filter={SEARCH_FILTERS}>
        <List.EmptyView
          title="Connect Spotify"
          description="Authorize FlowKey to browse your library. Use Spotify Search → Connect Spotify if the client id is not set yet."
        />
        <LibraryConnectItem
          client={client}
          signal={signal}
          onConnected={() => setAuthState('authorized')}
        />
      </List>
    );
  }

  if (error) {
    return (
      <List filter={SEARCH_FILTERS}>
        <List.EmptyView title="Could not load your library" description={error} />
      </List>
    );
  }

  if (!data) {
    return (
      <List filter={SEARCH_FILTERS}>
        <List.EmptyView title="Loading your library…" />
      </List>
    );
  }

  const results = filterLibrary(data.results, query);
  if (GRID_FILTERS.has(filter)) {
    const items = buildGridItems(results, filter, client, () => {}, signal);
    if (items.length === 0) {
      return (
        <Grid columns={5}>
          <Grid.EmptyView title="Nothing here" description={emptyDescription(query)} />
        </Grid>
      );
    }
    return (
      <Grid columns={5} title={gridTitle(filter)}>
        {items}
      </Grid>
    );
  }

  const sections = buildListSections(results, filter, client, () => {}, signal, {
    tracksTitle: 'Liked Songs',
    episodesTitle: 'Saved Episodes',
    sectionLimit: 6,
    likedSongsItem: likedSongsItem(data, client),
  });
  if (sections.length === 0) {
    return (
      <List filter={SEARCH_FILTERS}>
        <List.EmptyView title="Nothing here" description={emptyDescription(query)} />
      </List>
    );
  }
  return <List filter={SEARCH_FILTERS}>{sections}</List>;
}

function LibraryConnectItem({
  client,
  signal,
  onConnected,
}: {
  client: SpotifyClient;
  signal: AbortSignal;
  onConnected: () => void;
}): ReactNode {
  return createElement(List.Item, {
    id: 'connect-spotify',
    title: 'Connect Spotify',
    icon: { lucide: 'plug', color: '#1DB954' },
    actions: createElement(
      ActionPanel,
      null,
      createElement(Action, {
        title: 'Connect Spotify',
        onAction: async () => {
          try {
            const result = await client.authorize(signal);
            if (result.ok) {
              onConnected();
            }
          } catch {}
        },
      }),
    ),
  });
}

function likedSongsItem(data: LibraryData, client: SpotifyClient): ReactNode {
  const total = data.likedTotal;
  return createElement(List.Item, {
    id: 'liked-songs',
    title: 'Liked Songs',
    subtitle: `${total} songs`,
    kind: 'playlist',
    icon: { uri: LIKED_SONGS_ICON },
    actions: createElement(
      ActionPanel,
      null,
      createElement(Action, {
        title: 'Play',
        primary: true,
        onAction: async () => {
          await client.play({ context_uri: `spotify:user:${data.me.id}:collection` });
        },
      }),
      createElement(Action, {
        title: 'Go to Songs',
        push: likedSongsKey(data.me.id),
        onAction: () => {},
      }),
    ),
  });
}

function emptyDescription(query: string): string {
  return query.trim().length > 0
    ? `Nothing in your library matches "${query.trim()}"`
    : 'Your library is empty';
}

function gridTitle(filter: string): string {
  return SEARCH_FILTERS.find((option) => option.value === filter)?.label ?? 'Library';
}

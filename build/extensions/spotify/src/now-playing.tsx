import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { CommandProps } from '@flowkey-mini/react-ui';
import { Action, ActionPanel, Detail, List } from '@flowkey-mini/react-ui';
import { SpotifyApiError, SpotifyClient } from './api/client';
import type { SpotifyPlaybackState, SpotifyTrack } from './api/types';
import { formatMs } from './format';
import { describeError, isAborted } from './search-model';
import { loadArtwork } from './store';

const POLL_INTERVAL_MS = 5000;

function isTrack(item: SpotifyPlaybackState['item']): item is SpotifyTrack {
  return item !== null && 'artists' in item;
}

function nowPlayingActions({
  client,
  state,
  track,
  refresh,
  setNotice,
  liked,
  setLiked,
}: {
  client: SpotifyClient;
  state: SpotifyPlaybackState;
  track: SpotifyTrack;
  refresh: () => void;
  setNotice: (message: string) => void;
  liked: boolean | null;
  setLiked: (liked: boolean | null) => void;
}) {
  const run = (title: string, done: string, body: () => Promise<void>) => async () => {
    try {
      await body();
      setNotice(done);
      refresh();
    } catch (caught) {
      if (isAborted(caught)) return;
      setNotice(describeError(caught));
    }
  };
  return (
    <ActionPanel>
      <Action
        title={state.is_playing ? 'Pause' : 'Play'}
        primary
        onAction={run('toggle', state.is_playing ? 'Paused' : 'Playing', () =>
          state.is_playing ? client.pause() : client.play({}),
        )}
      />
      <Action title="Next" onAction={run('next', 'Skipped to next track', () => client.next())} />
      <Action
        title="Previous"
        onAction={run('previous', 'Went back to previous track', () => client.previous())}
      />
      <Action
        title={liked ? 'Unlike' : 'Like'}
        onAction={run('like', 'Updated Liked Songs', async () => {
          if (liked) {
            await client.removeFromSavedTracks([track.id]);
            setLiked(false);
          } else {
            await client.addToSavedTracks([track.id]);
            setLiked(true);
          }
        })}
      />
      <Action
        title={state.shuffle_state ? 'Shuffle Off' : 'Shuffle On'}
        onAction={run('shuffle', 'Updated shuffle', () => client.setShuffle(!state.shuffle_state))}
      />
      <Action
        title={`Repeat: ${state.repeat_state}`}
        onAction={run('repeat', 'Updated repeat', () => {
          const order: SpotifyPlaybackState['repeat_state'][] = ['off', 'track', 'context'];
          const next = order[(order.indexOf(state.repeat_state) + 1) % order.length];
          return client.setRepeat(next);
        })}
      />
      <Action
        title="Copy Track Link"
        onAction={async () => {
          await client.copyText(`https://open.spotify.com/track/${track.id}`);
          setNotice('Copied track link');
        }}
      />
      <Action
        title="Copy Artist and Title"
        onAction={async () => {
          await client.copyText(
            `${track.artists.map((artist) => artist.name).join(', ')} - ${track.name}`,
          );
          setNotice('Copied artist and title');
        }}
      />
    </ActionPanel>
  );
}

export function NowPlayingCommand({ native, signal }: CommandProps): ReactNode {
  const client = useMemo(() => new SpotifyClient(native.call), [native]);
  const [authState, setAuthState] = useState<'checking' | 'unauthorized' | 'authorized'>(
    'checking',
  );
  const [authMessage, setAuthMessage] = useState('');
  const [state, setState] = useState<SpotifyPlaybackState | null>(null);
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState('');
  const [pollVersion, setPollVersion] = useState(0);
  const mounted = useRef(true);
  const refresh = () => setPollVersion((version) => version + 1);

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    (async () => {
      try {
        const status = await client.authStatus(controller.signal);
        if (mounted.current) setAuthState(status.ok ? 'authorized' : 'unauthorized');
      } catch (caught) {
        if (isAborted(caught)) return;
        if (mounted.current) {
          setAuthState('unauthorized');
          setAuthMessage((caught as Error).message ?? 'Could not check Spotify connection');
        }
      }
    })();
    return () => {
      mounted.current = false;
      controller.abort();
    };
  }, [client]);

  useEffect(() => {
    if (authState !== 'authorized') return;
    let alive = true;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = async () => {
      try {
        const next = await client.playbackState(controller.signal);
        if (alive) {
          setState(next);
          setLoadError('');
        }
      } catch (caught) {
        if (isAborted(caught)) return;
        if (caught instanceof SpotifyApiError && caught.code === 'authRequired') {
          if (alive) setAuthState('unauthorized');
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
  const artworkUrl = currentTrack?.album?.images[0]?.url ?? '';
  const [imageUri, setImageUri] = useState<string | null>(null);
  useEffect(() => {
    if (!artworkUrl) return;
    let alive = true;
    loadArtwork(client, artworkUrl).then((uri) => {
      if (alive && uri) setImageUri(uri);
    });
    return () => {
      alive = false;
    };
  }, [client, artworkUrl]);

  const [liked, setLiked] = useState<boolean | null>(null);
  const likedTrackId = currentTrack?.id ?? null;
  useEffect(() => {
    if (!likedTrackId) return;
    let alive = true;
    client
      .containsSavedTracks([likedTrackId])
      .then((result) => {
        if (alive) setLiked(result[0] ?? null);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [client, likedTrackId, pollVersion]);

  if (authState === 'checking') {
    return (
      <List>
        <List.EmptyView title="Checking Spotify connection…" />
      </List>
    );
  }
  if (authState === 'unauthorized') {
    return (
      <List>
        <List.EmptyView
          title="Connect Spotify"
          description={
            authMessage || 'Run the Spotify Search command and connect to authorize FlowKey first.'
          }
        />
      </List>
    );
  }
  if (loadError) {
    return (
      <List>
        <List.EmptyView title="Could not load playback" description={loadError} />
      </List>
    );
  }
  if (!state || !state.device) {
    return (
      <List>
        <List.EmptyView
          title="No active Spotify device"
          description="Open Spotify on any device and start playback, then try again."
        />
      </List>
    );
  }
  const track = currentTrack;
  if (!track) {
    return (
      <List>
        <List.EmptyView
          title="Nothing playing"
          description="Start a track in Spotify to see it here."
        />
      </List>
    );
  }
  const artists = track.artists.map((artist) => artist.name).join(', ');
  return (
    <Detail
      title={track.name}
      subtitle={`by ${artists}`}
      imageUri={imageUri ?? undefined}
      markdown={notice || undefined}
      actions={nowPlayingActions({ client, state, track, refresh, setNotice, liked, setLiked })}
    >
      <Detail.Metadata>
        <Detail.Metadata.Field label="Track" value={track.name} />
        <Detail.Metadata.Field label="Duration" value={formatMs(track.duration_ms)} />
        <Detail.Metadata.Field
          label="Progress"
          value={
            state.progress_ms === null
              ? formatMs(track.duration_ms)
              : `${formatMs(state.progress_ms)} / ${formatMs(track.duration_ms)}`
          }
        />
        <Detail.Metadata.Field label="Artists" value={artists} />
        <Detail.Metadata.Field label="Album" value={track.album?.name ?? 'Unknown album'} />
        <Detail.Metadata.Field label="Liked" value={liked === null ? '…' : liked ? 'Yes' : 'No'} />
        <Detail.Metadata.Field
          label="Device"
          value={state.device ? state.device.name : 'Unknown'}
        />
      </Detail.Metadata>
    </Detail>
  );
}

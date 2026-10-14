import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { CommandProps } from '@flowkey-mini/react-ui';
import { Action, ActionPanel, Detail, List } from '@flowkey-mini/react-ui';
import { SpotifyApiError, SpotifyClient, type NativeCallFn } from './api/client';
import type { SpotifyDevice, SpotifyPlaybackState, SpotifyTrack } from './api/types';
import { formatMs } from './format';
import {
  activeLineIndex,
  parseLrc,
  projectedPositionMs,
  sameMedia,
  type LyricsState,
  type MediaState,
} from './lyrics';
import { describeError, isAborted } from './search-model';
import { loadLibrary } from './store';

const VOLUME_STEP = 10;
const SEEK_STEP_MS = 15_000;
const EMBED_SNIPPET =
  '<iframe src="https://open.spotify.com/embed/track/{id}" width="45%" height="152" frameBorder="0" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" loading="lazy"></iframe>';

function isTrack(item: SpotifyPlaybackState['item']): item is SpotifyTrack {
  return item !== null && 'artists' in item;
}

export interface PlaybackContext {
  track: SpotifyTrack;
  state: SpotifyPlaybackState;
}

type RunOutcome =
  | { kind: 'working' }
  | { kind: 'message'; title: string; description?: string }
  | { kind: 'authRequired' }
  | { kind: 'noDevice' }
  | { kind: 'noTrack' };

export type MediaSkipCommand = 'next' | 'previous';

/**
 * Skips via the Windows media transport controls (`media.control`) instead of the
 * Spotify Web API, so Next/Previous work without Spotify auth or an active device.
 * The SMTC snapshot only feeds the result message; the skip itself is best-effort.
 */
export async function mediaSkipOutcome(
  command: MediaSkipCommand,
  call: NativeCallFn,
): Promise<RunOutcome> {
  let currentTitle: string | null = null;
  let snapshotFailed = false;
  try {
    const media = await call<MediaState | null>('media.current');
    currentTitle = media?.title?.trim() || null;
  } catch {
    snapshotFailed = true;
  }
  try {
    await call('media.control', { command });
  } catch (caught) {
    return { kind: 'message', title: describeError(caught) };
  }
  if (currentTitle) {
    return {
      kind: 'message',
      title: command === 'next' ? `Skipped ${currentTitle}` : `Went back to ${currentTitle}`,
    };
  }
  if (snapshotFailed) {
    return {
      kind: 'message',
      title: command === 'next' ? 'Skipped to next track' : 'Went back to previous track',
    };
  }
  return { kind: 'noTrack' };
}

async function playbackStateWithRetry(client: SpotifyClient): Promise<SpotifyPlaybackState | null> {
  try {
    return await client.playbackState();
  } catch (caught) {
    if (caught instanceof SpotifyApiError && caught.code === 'invalidResponse') {
      return await client.playbackState();
    }
    throw caught;
  }
}

async function withContext(
  client: SpotifyClient,
  action: (context: PlaybackContext) => Promise<string>,
): Promise<RunOutcome> {
  try {
    const state = await playbackStateWithRetry(client);
    if (!state || !state.device) {
      return { kind: 'noDevice' };
    }
    const track = isTrack(state.item) ? state.item : null;
    if (!track) {
      return { kind: 'noTrack' };
    }
    const title = await action({ track, state });
    return { kind: 'message', title };
  } catch (caught) {
    if (caught instanceof SpotifyApiError && caught.code === 'authRequired') {
      return { kind: 'authRequired' };
    }
    return { kind: 'message', title: describeError(caught) };
  }
}

function OutcomeView({ outcome, workingTitle }: { outcome: RunOutcome; workingTitle: string }) {
  if (outcome.kind === 'working') {
    return (
      <List>
        <List.EmptyView title={workingTitle} />
      </List>
    );
  }
  if (outcome.kind === 'authRequired') {
    return (
      <List>
        <List.EmptyView
          title="Connect Spotify"
          description="Run the Spotify Search command and connect to authorize FlowKey first."
        />
      </List>
    );
  }
  if (outcome.kind === 'noDevice') {
    return (
      <List>
        <List.EmptyView
          title="No active Spotify device"
          description="Open Spotify on any device and start playback, then try again."
        />
      </List>
    );
  }
  if (outcome.kind === 'noTrack') {
    return (
      <List>
        <List.EmptyView
          title="Nothing playing"
          description="Start a track in Spotify to try again."
        />
      </List>
    );
  }
  return (
    <List>
      <List.EmptyView title={outcome.title} description={outcome.description} />
    </List>
  );
}

function usePlayerCommand(
  client: SpotifyClient,
  action: (context: PlaybackContext) => Promise<string>,
): RunOutcome {
  const [outcome, setOutcome] = useState<RunOutcome>({ kind: 'working' });
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

function outcomeHudTitle(outcome: RunOutcome): string | null {
  if (outcome.kind === 'message') {
    return outcome.title;
  }
  if (outcome.kind === 'authRequired') {
    return 'Spotify not connected';
  }
  if (outcome.kind === 'noDevice') {
    return 'No active Spotify device';
  }
  if (outcome.kind === 'noTrack') {
    return 'No track playing';
  }
  return null;
}

function SimplePlayerCommand({
  native,
  workingTitle,
  action,
}: CommandProps & {
  workingTitle: string;
  action: (context: PlaybackContext, client: SpotifyClient) => Promise<string>;
}): ReactNode {
  const client = useMemo(() => new SpotifyClient(native.call), [native]);
  const outcome = usePlayerCommand(client, (context) => action(context, client));
  useEffect(() => {
    const title = outcomeHudTitle(outcome);
    if (title) {
      void native.showHud({ title });
    }
  }, [outcome, native]);
  return <OutcomeView outcome={outcome} workingTitle={workingTitle} />;
}

export function TogglePlayPauseCommand(props: CommandProps): ReactNode {
  return (
    <SimplePlayerCommand
      {...props}
      workingTitle="Toggling playback…"
      action={async ({ track, state }, client) => {
        if (state.is_playing) {
          await client.pause();
          return `Paused ${track.name}`;
        }
        await client.play({});
        return `Playing ${track.name}`;
      }}
    />
  );
}

function MediaSkipCommand({
  native,
  workingTitle,
  command,
}: CommandProps & { workingTitle: string; command: MediaSkipCommand }): ReactNode {
  const [outcome, setOutcome] = useState<RunOutcome>({ kind: 'working' });
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
  return <OutcomeView outcome={outcome} workingTitle={workingTitle} />;
}

export function NextCommand(props: CommandProps): ReactNode {
  return <MediaSkipCommand {...props} workingTitle="Skipping…" command="next" />;
}

export function PreviousCommand(props: CommandProps): ReactNode {
  return <MediaSkipCommand {...props} workingTitle="Going back…" command="previous" />;
}

export function JustPlayCommand(props: CommandProps): ReactNode {
  return (
    <SimplePlayerCommand
      {...props}
      workingTitle="Resuming…"
      action={async ({ track }, client) => {
        await client.play({});
        return `Playing ${track.name}`;
      }}
    />
  );
}

export function LikeCommand(props: CommandProps): ReactNode {
  return (
    <SimplePlayerCommand
      {...props}
      workingTitle="Liking track…"
      action={async ({ track }, client) => {
        await client.addToSavedTracks([track.id]);
        return `Liked ${track.name}`;
      }}
    />
  );
}

export function DislikeCommand(props: CommandProps): ReactNode {
  return (
    <SimplePlayerCommand
      {...props}
      workingTitle="Removing from Liked Songs…"
      action={async ({ track }, client) => {
        await client.removeFromSavedTracks([track.id]);
        return `Removed ${track.name} from Liked Songs`;
      }}
    />
  );
}

export function ToggleShuffleCommand(props: CommandProps): ReactNode {
  return (
    <SimplePlayerCommand
      {...props}
      workingTitle="Toggling shuffle…"
      action={async ({ state }, client) => {
        const next = !state.shuffle_state;
        await client.setShuffle(next);
        return next ? 'Shuffle on' : 'Shuffle off';
      }}
    />
  );
}

export function CycleRepeatCommand(props: CommandProps): ReactNode {
  return (
    <SimplePlayerCommand
      {...props}
      workingTitle="Cycling repeat…"
      action={async ({ state }, client) => {
        const order: SpotifyPlaybackState['repeat_state'][] = ['off', 'track', 'context'];
        const next = order[(order.indexOf(state.repeat_state) + 1) % order.length];
        await client.setRepeat(next);
        return `Repeat: ${next}`;
      }}
    />
  );
}

export function ReplayCommand(props: CommandProps): ReactNode {
  return (
    <SimplePlayerCommand
      {...props}
      workingTitle="Restarting track…"
      action={async ({ track }, client) => {
        await client.seek(0);
        return `Restarted ${track.name}`;
      }}
    />
  );
}

export function Skip15Command(props: CommandProps): ReactNode {
  return (
    <SimplePlayerCommand
      {...props}
      workingTitle="Skipping forward…"
      action={async ({ track, state }, client) => {
        const target = (state.progress_ms ?? 0) + SEEK_STEP_MS;
        await client.seek(Math.min(target, track.duration_ms));
        return `Skipped forward in ${track.name}`;
      }}
    />
  );
}

export function Back15Command(props: CommandProps): ReactNode {
  return (
    <SimplePlayerCommand
      {...props}
      workingTitle="Rewinding…"
      action={async ({ track, state }, client) => {
        await client.seek(Math.max((state.progress_ms ?? 0) - SEEK_STEP_MS, 0));
        return `Rewound ${track.name}`;
      }}
    />
  );
}

export function VolumeCommand(
  props: CommandProps & { percent?: number; delta?: number },
): ReactNode {
  return (
    <SimplePlayerCommand
      {...props}
      workingTitle="Setting volume…"
      action={async ({ state }, client) => {
        const current = state.device?.volume_percent ?? 50;
        const target =
          props.percent !== undefined
            ? props.percent
            : Math.min(100, Math.max(0, current + (props.delta ?? 0)));
        await client.setVolume(target);
        return `Volume: ${target}%`;
      }}
    />
  );
}

export function StartRadioCommand(props: CommandProps): ReactNode {
  return (
    <SimplePlayerCommand
      {...props}
      workingTitle="Starting radio…"
      action={async ({ track }, client) => {
        const recommendations = await client.recommendations({ tracks: [track.id] });
        const uris = (recommendations.tracks ?? [])
          .filter(Boolean)
          .slice(0, 20)
          .map((entry) => entry.uri);
        if (uris.length === 0) {
          throw new SpotifyApiError('noRadio', 'no radio tracks found for this track');
        }
        await client.play({ uris: [track.uri, ...uris] });
        return `Radio started from ${track.name}`;
      }}
    />
  );
}

export function CopyUrlCommand(props: CommandProps): ReactNode {
  return (
    <SimplePlayerCommand
      {...props}
      workingTitle="Copying…"
      action={async ({ track }, client) => {
        await client.copyText(`https://open.spotify.com/track/${track.id}`);
        return 'Copied track link';
      }}
    />
  );
}

export function CopyArtistAndTitleCommand(props: CommandProps): ReactNode {
  return (
    <SimplePlayerCommand
      {...props}
      workingTitle="Copying…"
      action={async ({ track }, client) => {
        const artists = track.artists.map((artist) => artist.name).join(', ');
        await client.copyText(`${artists} - ${track.name}`);
        return 'Copied artist and title';
      }}
    />
  );
}

export function CopyEmbedCommand(props: CommandProps): ReactNode {
  return (
    <SimplePlayerCommand
      {...props}
      workingTitle="Copying…"
      action={async ({ track }, client) => {
        await client.copyText(EMBED_SNIPPET.replace('{id}', track.id));
        return 'Copied embed snippet';
      }}
    />
  );
}

function usePlayerAction(client: SpotifyClient, action: () => Promise<string>): RunOutcome {
  const [outcome, setOutcome] = useState<RunOutcome>({ kind: 'working' });
  const actionRef = useRef(action);
  actionRef.current = action;
  useEffect(() => {
    let alive = true;
    actionRef.current().then(
      (title) => {
        if (alive) setOutcome({ kind: 'message', title });
      },
      (caught) => {
        if (alive) {
          if (caught instanceof SpotifyApiError && caught.code === 'authRequired') {
            setOutcome({ kind: 'authRequired' });
          } else {
            setOutcome({ kind: 'message', title: describeError(caught) });
          }
        }
      },
    );
    return () => {
      alive = false;
    };
  }, [client]);
  return outcome;
}

type TrackContext =
  | { kind: 'working' }
  | { kind: 'error'; message: string }
  | { kind: 'authRequired' }
  | { kind: 'context'; context: PlaybackContext };

function usePlaybackContext(client: SpotifyClient): TrackContext {
  const [result, setResult] = useState<TrackContext>({ kind: 'working' });
  useEffect(() => {
    let alive = true;
    client
      .playbackState()
      .then((state) => {
        if (!alive) return;
        if (!state || !state.device) {
          setResult({ kind: 'error', message: 'No active Spotify device' });
          return;
        }
        const track = isTrack(state.item) ? state.item : null;
        if (!track) {
          setResult({ kind: 'error', message: 'Nothing playing' });
          return;
        }
        setResult({ kind: 'context', context: { track, state } });
      })
      .catch((caught) => {
        if (!alive) return;
        if (caught instanceof SpotifyApiError && caught.code === 'authRequired') {
          setResult({ kind: 'authRequired' });
        } else {
          setResult({ kind: 'error', message: describeError(caught) });
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
  children,
}: {
  result: TrackContext;
  children: (context: PlaybackContext) => ReactNode;
}): ReactNode {
  if (result.kind === 'working') {
    return (
      <List>
        <List.EmptyView title="Loading playback…" />
      </List>
    );
  }
  if (result.kind === 'authRequired') {
    return (
      <List>
        <List.EmptyView
          title="Connect Spotify"
          description="Run the Spotify Search command and connect to authorize FlowKey first."
        />
      </List>
    );
  }
  if (result.kind === 'error') {
    return (
      <List>
        <List.EmptyView title={result.message} />
      </List>
    );
  }
  return children(result.context);
}

export function CurrentTrackCommand(props: CommandProps): ReactNode {
  const client = useMemo(() => new SpotifyClient(props.native.call), [props.native]);
  const result = usePlaybackContext(client);
  return (
    <ContextGate result={result}>
      {({ track, state }) => (
        <Detail
          title={track.name}
          subtitle={`by ${track.artists.map((artist) => artist.name).join(', ')}`}
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
            <Detail.Metadata.Field label="Album" value={track.album?.name ?? 'Unknown album'} />
            <Detail.Metadata.Field
              label="Device"
              value={state.device ? state.device.name : 'Unknown'}
            />
          </Detail.Metadata>
        </Detail>
      )}
    </ContextGate>
  );
}

export function QueueCommand(props: CommandProps): ReactNode {
  const client = useMemo(() => new SpotifyClient(props.native.call), [props.native]);
  const [queue, setQueue] = useState<Awaited<ReturnType<SpotifyClient['queue']>> | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    client
      .queue()
      .then((result) => {
        if (alive) setQueue(result);
      })
      .catch((caught) => {
        if (alive && !isAborted(caught)) setError(describeError(caught));
      });
    return () => {
      alive = false;
    };
  }, [client]);
  if (error) {
    return (
      <List>
        <List.EmptyView title="Could not load queue" description={error} />
      </List>
    );
  }
  if (!queue) {
    return (
      <List>
        <List.EmptyView title="Loading queue…" />
      </List>
    );
  }
  const entries = queue.queue.filter(isTrack);
  const current = isTrack(queue.currently_playing) ? queue.currently_playing : null;
  return (
    <List>
      {entries.length === 0 && !current ? <List.EmptyView title="Queue is empty" /> : null}
      {current ? (
        <List.Section title="Now Playing">
          <List.Item
            id="current"
            title={current.name}
            subtitle={current.artists.map((artist) => artist.name).join(', ')}
            kind="track"
          />
        </List.Section>
      ) : null}
      {entries.length > 0 ? (
        <List.Section title="Next Up">
          {entries.map((track) => (
            <List.Item
              key={track.id}
              id={track.id}
              title={track.name}
              subtitle={`${track.artists.map((artist) => artist.name).join(', ')} · ${formatMs(track.duration_ms)}`}
              kind="track"
              actions={
                <ActionPanel>
                  <Action
                    title="Play Now"
                    onAction={async () => {
                      try {
                        await client.play({ uris: [track.uri] });
                      } catch (caught) {
                        if (!isAborted(caught)) setError(describeError(caught));
                      }
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

export function DevicesCommand(props: CommandProps): ReactNode {
  const client = useMemo(() => new SpotifyClient(props.native.call), [props.native]);
  const [devices, setDevices] = useState<SpotifyDevice[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    client
      .devices()
      .then((result) => {
        if (alive) setDevices(result.devices.filter(Boolean));
      })
      .catch((caught) => {
        if (alive && !isAborted(caught)) setError(describeError(caught));
      });
    return () => {
      alive = false;
    };
  }, [client]);
  if (error) {
    return (
      <List>
        <List.EmptyView title="Could not load devices" description={error} />
      </List>
    );
  }
  if (!devices) {
    return (
      <List>
        <List.EmptyView title="Loading devices…" />
      </List>
    );
  }
  if (devices.length === 0) {
    return (
      <List>
        <List.EmptyView title="No Spotify devices found" />
      </List>
    );
  }
  return (
    <List>
      {devices.map((device) => (
        <List.Item
          key={device.id}
          id={device.id}
          title={device.name}
          subtitle={`${device.type}${device.is_active ? ' · active' : ''} · volume ${device.volume_percent ?? '?'}%`}
          kind="device"
          icon={{ lucide: device.is_active ? 'speaker' : 'speaker-off' }}
          actions={
            <ActionPanel>
              <Action
                title="Transfer Playback Here"
                onAction={async () => {
                  try {
                    await client.transferPlayback(device.id, true);
                  } catch (caught) {
                    if (!isAborted(caught)) setError(describeError(caught));
                  }
                }}
              />
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}

export function AddToPlaylistCommand(props: CommandProps): ReactNode {
  const client = useMemo(() => new SpotifyClient(props.native.call), [props.native]);
  const result = usePlaybackContext(client);
  const [playlists, setPlaylists] = useState<Awaited<ReturnType<typeof loadLibrary>> | null>(null);
  const [libraryError, setLibraryError] = useState('');
  useEffect(() => {
    if (result.kind !== 'context') return;
    let alive = true;
    loadLibrary(client)
      .then((library) => {
        if (alive) setPlaylists(library);
      })
      .catch((caught) => {
        if (alive && !isAborted(caught)) setLibraryError(describeError(caught));
      });
    return () => {
      alive = false;
    };
  }, [client, result]);
  return (
    <ContextGate result={result}>
      {({ track }) => {
        if (libraryError) {
          return (
            <List>
              <List.EmptyView title="Could not load playlists" description={libraryError} />
            </List>
          );
        }
        if (!playlists) {
          return (
            <List>
              <List.EmptyView title="Loading playlists…" />
            </List>
          );
        }
        const owned = playlists.results.playlists?.items.filter(
          (playlist) => playlist && playlist.owner?.id === playlists.me.id,
        );
        if (!owned || owned.length === 0) {
          return (
            <List>
              <List.EmptyView title="No editable playlists found" />
            </List>
          );
        }
        return (
          <List>
            <List.Section title={`Add ${track.name} to…`}>
              {owned.map((playlist) => (
                <List.Item
                  key={playlist.id}
                  id={playlist.id}
                  title={playlist.name}
                  subtitle={`${playlist.tracks?.total ?? 0} tracks`}
                  kind="playlist"
                  actions={
                    <ActionPanel>
                      <Action
                        title="Add Track"
                        onAction={async () => {
                          try {
                            await client.addToPlaylist(playlist.id, [track.uri]);
                          } catch (caught) {
                            if (!isAborted(caught)) setLibraryError(describeError(caught));
                          }
                        }}
                      />
                    </ActionPanel>
                  }
                />
              ))}
            </List.Section>
          </List>
        );
      }}
    </ContextGate>
  );
}

export function RemoveFromPlaylistCommand(props: CommandProps): ReactNode {
  const client = useMemo(() => new SpotifyClient(props.native.call), [props.native]);
  const result = usePlaybackContext(client);
  const [playlists, setPlaylists] = useState<Awaited<ReturnType<typeof loadLibrary>> | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (result.kind !== 'context') return;
    let alive = true;
    loadLibrary(client)
      .then((library) => {
        if (alive) setPlaylists(library);
      })
      .catch((caught) => {
        if (alive && !isAborted(caught)) setError(describeError(caught));
      });
    return () => {
      alive = false;
    };
  }, [client, result]);
  return (
    <ContextGate result={result}>
      {({ track }) => {
        if (error) {
          return (
            <List>
              <List.EmptyView title="Something went wrong" description={error} />
            </List>
          );
        }
        if (!playlists) {
          return (
            <List>
              <List.EmptyView title="Loading playlists…" />
            </List>
          );
        }
        const owned = playlists.results.playlists?.items.filter(
          (playlist) => playlist && playlist.owner?.id === playlists.me.id,
        );
        if (!owned || owned.length === 0) {
          return (
            <List>
              <List.EmptyView title="No editable playlists found" />
            </List>
          );
        }
        return (
          <List>
            <List.Section title={`Remove ${track.name} from…`}>
              {owned.map((playlist) => (
                <List.Item
                  key={playlist.id}
                  id={playlist.id}
                  title={playlist.name}
                  subtitle={`${playlist.tracks?.total ?? 0} tracks`}
                  kind="playlist"
                  actions={
                    <ActionPanel>
                      <Action
                        title="Remove Track"
                        onAction={async () => {
                          try {
                            await client.removeFromPlaylist(playlist.id, track.uri);
                          } catch (caught) {
                            if (!isAborted(caught)) setError(describeError(caught));
                          }
                        }}
                      />
                    </ActionPanel>
                  }
                />
              ))}
            </List.Section>
          </List>
        );
      }}
    </ContextGate>
  );
}

function lyricsMarkdown(
  lyrics: LyricsState,
  media: MediaState | null,
  activeIndex: number,
): string {
  const header: string[] = [];
  if (media?.artist) header.push('**Artist:** ' + media.artist);
  if (media?.album) header.push('**Album:** ' + media.album);
  const body = lyrics.synced
    ? lyrics.lines
        .map((line, i) => {
          if (i === activeIndex) return `**♪ ${line.text}**`;
          if (activeIndex >= 0 && i < activeIndex) return `~~${line.text}~~`;
          return ' ' + line.text;
        })
        .join('\n\n')
    : lyrics.lines.map((line) => ' ' + line.text).join('\n\n');
  return (header.length > 0 ? header.join('\n\n') + '\n\n---\n\n' : '') + body;
}
export function FindLyricsCommand(props: CommandProps): ReactNode {
  const client = useMemo(() => new SpotifyClient(props.native.call), [props.native]);
  const [media, setMedia] = useState<MediaState | null>(null);
  const [lyrics, setLyrics] = useState<LyricsState | null>(null);
  const [error, setError] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  const mediaRef = useRef<MediaState | null>(null);
  const lyricsRef = useRef<LyricsState | null>(null);
  const fetchedFor = useRef('');

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const state = await props.native.call<MediaState | null>('media.current');
        if (alive && !sameMedia(mediaRef.current, state)) {
          mediaRef.current = state;
          setMedia(state);
        }
      } catch {
        /* polling resumes on the next tick */
      }
    };
    void poll();
    const timer = setInterval(poll, 1000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [props.native]);

  useEffect(() => {
    const title = media?.title?.trim();
    if (!title) return;
    const artist = media?.artist?.trim() ?? '';
    const stamp = title + '|' + artist;
    if (fetchedFor.current === stamp) return;
    fetchedFor.current = stamp;
    let alive = true;
    setLyrics(null);
    setError('');
    client
      .findLyrics(title, artist)
      .then((hit) => {
        if (!alive) return;
        if (!hit) {
          setError('No lyrics found for this track.');
          return;
        }
        const lines = hit.syncedLyrics ? parseLrc(hit.syncedLyrics) : [];
        const state: LyricsState = {
          synced: lines.length > 1,
          lines: lines.length > 1 ? lines : [{ timeMs: 0, text: hit.plainLyrics }],
          plain: hit.plainLyrics,
          title: hit.trackName,
        };
        lyricsRef.current = state;
        setLyrics(state);
      })
      .catch((caught) => {
        if (alive && !isAborted(caught)) setError(describeError(caught));
      });
    return () => {
      alive = false;
    };
  }, [media, client]);

  useEffect(() => {
    const timer = setInterval(() => {
      const current = mediaRef.current;
      const lines = lyricsRef.current;
      if (!current || !lines?.synced) return;
      const index = activeLineIndex(lines.lines, projectedPositionMs(current));
      setActiveIndex((previous) => (previous === index ? previous : index));
    }, 250);
    return () => clearInterval(timer);
  }, []);

  if (error) {
    return (
      <List>
        <List.EmptyView title={error} />
      </List>
    );
  }
  if (!media?.title) {
    return (
      <List>
        <List.EmptyView
          title="Nothing is playing right now"
          description="Start playback on any media app and reopen Find Lyrics."
        />
      </List>
    );
  }
  if (!lyrics) {
    return (
      <List>
        <List.EmptyView title={`Searching lyrics for ${media.title}…`} />
      </List>
    );
  }
  return (
    <Detail
      title={lyrics.title}
      mediaKeys
      markdown={lyricsMarkdown(lyrics, media, activeIndex)}
      actions={
        <ActionPanel>
          <Action
            title="Play / Pause"
            onAction={async () => {
              await props.native.call('media.control', { command: 'playPause' });
            }}
          />
          <Action
            title="Next Track"
            onAction={async () => {
              await props.native.call('media.control', { command: 'next' });
            }}
          />
          <Action
            title="Previous Track"
            onAction={async () => {
              await props.native.call('media.control', { command: 'previous' });
            }}
          />
        </ActionPanel>
      }
    />
  );
}

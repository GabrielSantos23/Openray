import { createElement, type ReactNode } from 'react';
import { defineReactExtension, List, type CommandProps } from '@flowkey-mini/react-ui';
import manifest from '../manifest.json';
import { SearchCommand } from './search';
import {
  AlbumSongsRoot,
  ArtistAlbumsRoot,
  ArtistSongsRoot,
  isSubViewCommand,
  LikedSongsRoot,
} from './subviews';
import { LibraryCommand } from './library';
import { NowPlayingCommand } from './now-playing';
import {
  AddToPlaylistCommand,
  Back15Command,
  CopyArtistAndTitleCommand,
  CopyEmbedCommand,
  CopyUrlCommand,
  CurrentTrackCommand,
  DevicesCommand,
  DislikeCommand,
  FindLyricsCommand,
  JustPlayCommand,
  LikeCommand,
  NextCommand,
  PreviousCommand,
  QueueCommand,
  RemoveFromPlaylistCommand,
  ReplayCommand,
  Skip15Command,
  StartRadioCommand,
  TogglePlayPauseCommand,
  ToggleShuffleCommand,
  VolumeCommand,
  CycleRepeatCommand,
} from './player-commands';

function Volume0(props: CommandProps): ReactNode {
  return <VolumeCommand {...props} percent={0} />;
}
function Volume25(props: CommandProps): ReactNode {
  return <VolumeCommand {...props} percent={25} />;
}
function Volume50(props: CommandProps): ReactNode {
  return <VolumeCommand {...props} percent={50} />;
}
function Volume75(props: CommandProps): ReactNode {
  return <VolumeCommand {...props} percent={75} />;
}
function Volume100(props: CommandProps): ReactNode {
  return <VolumeCommand {...props} percent={100} />;
}
function VolumeUp(props: CommandProps): ReactNode {
  return <VolumeCommand {...props} delta={10} />;
}
function VolumeDown(props: CommandProps): ReactNode {
  return <VolumeCommand {...props} delta={-10} />;
}

const PLAYER_COMMANDS: Record<string, (props: CommandProps) => ReactNode> = {
  'toggle-play-pause': TogglePlayPauseCommand,
  next: NextCommand,
  previous: PreviousCommand,
  'just-play': JustPlayCommand,
  like: LikeCommand,
  dislike: DislikeCommand,
  'toggle-shuffle': ToggleShuffleCommand,
  'cycle-repeat': CycleRepeatCommand,
  replay: ReplayCommand,
  'skip-15': Skip15Command,
  'back-15': Back15Command,
  'volume-0': Volume0,
  'volume-25': Volume25,
  'volume-50': Volume50,
  'volume-75': Volume75,
  'volume-100': Volume100,
  'volume-up': VolumeUp,
  'volume-down': VolumeDown,
  'start-radio': StartRadioCommand,
  'current-track': CurrentTrackCommand,
  'copy-url': CopyUrlCommand,
  'copy-artist-and-title': CopyArtistAndTitleCommand,
  'copy-embed': CopyEmbedCommand,
  queue: QueueCommand,
  devices: DevicesCommand,
  'add-playing-to-playlist': AddToPlaylistCommand,
  'remove-playing-from-playlist': RemoveFromPlaylistCommand,
  'find-lyrics': FindLyricsCommand,
};

export default defineReactExtension({
  manifest: manifest as unknown as import('@flowkey-mini/native-sdk').ExtensionManifest,
  component: (props: CommandProps) => {
    const commandId = props.commandId ?? 'search';
    if (isSubViewCommand(commandId)) {
      if (commandId.startsWith('album-songs:')) {
        return createElement(AlbumSongsRoot, props);
      }
      if (commandId.startsWith('artist-songs:')) {
        return createElement(ArtistSongsRoot, props);
      }
      if (commandId.startsWith('liked-songs:')) {
        return createElement(LikedSongsRoot, props);
      }
      return createElement(ArtistAlbumsRoot, props);
    }
    if (commandId === 'search') {
      return createElement(SearchCommand, props);
    }
    if (commandId === 'your-library') {
      return createElement(LibraryCommand, props);
    }
    if (commandId === 'now-playing') {
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
        title: 'Command not available yet',
        description: `The '${commandId}' command lands in a later slice.`,
      }),
    );
  },
});

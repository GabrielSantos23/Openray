/**
 * Pure lyrics/playback-position helpers shared by the tree renderer
 * (player-commands) and the web renderer (Find Lyrics screen).
 */

/** Snapshot of the Windows SMTC media session (`media.current`). */
export interface MediaState {
  playing: boolean;
  title: string | null;
  artist: string | null;
  album: string | null;
  positionMs: number;
  durationMs: number;
  updatedAtMs: number;
}

export interface LyricLine {
  timeMs: number;
  text: string;
}

export interface LyricsState {
  synced: boolean;
  lines: LyricLine[];
  plain: string;
  title: string;
}

export function parseLrc(source: string): LyricLine[] {
  const lines: LyricLine[] = [];
  for (const raw of source.split('\n')) {
    const match = raw.match(/^\[(\d+):(\d+(?:\.\d+)?)\](.*)$/);
    if (!match) continue;
    const text = match[3].trim();
    if (!text) continue;
    lines.push({
      timeMs: Math.round((parseInt(match[1], 10) * 60 + parseFloat(match[2])) * 1000),
      text,
    });
  }
  return lines;
}

/** Position extrapolated from the sampled snapshot while playback continues. */
export function projectedPositionMs(media: MediaState): number {
  if (!media.playing) return media.positionMs;
  return media.positionMs + Math.max(0, Date.now() - media.updatedAtMs);
}

export function activeLineIndex(lines: LyricLine[], positionMs: number): number {
  let index = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].timeMs <= positionMs) {
      index = i;
    } else {
      break;
    }
  }
  return index;
}

export function sameMedia(a: MediaState | null, b: MediaState | null): boolean {
  if (!a || !b) return false;
  return (
    a.playing === b.playing &&
    a.title === b.title &&
    a.artist === b.artist &&
    Math.abs(projectedPositionMs(a) - projectedPositionMs(b)) < 900
  );
}

export function formatMs(durationMs: number): string {
  const totalSeconds = Math.floor(durationMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number) => value.toString().padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

export function trackUrl(track: { id: string }): string {
  return `https://open.spotify.com/track/${track.id}`;
}

export function externalUrl(kind: string, id: string): string {
  return `https://open.spotify.com/${kind}/${id}`;
}

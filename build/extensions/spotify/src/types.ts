export interface SpotifyImage {
  url: string;
  width: number | null;
  height: number | null;
}

export interface SpotifyArtist {
  id: string;
  name: string;
  images?: SpotifyImage[];
}

export interface SpotifyAlbum {
  id: string;
  name: string;
  images: SpotifyImage[];
  artists: SpotifyArtist[];
  release_date: string;
  total_tracks: number;
}

export interface SpotifyTrack {
  id: string;
  name: string;
  uri: string;
  duration_ms: number;
  artists: SpotifyArtist[];
  album?: SpotifyAlbum;
}

export interface SpotifyPlaylist {
  id: string;
  name: string;
  images: SpotifyImage[];
  owner: { id: string; display_name: string };
  tracks: { total: number };
}

export interface SpotifyShow {
  id: string;
  name: string;
  images: SpotifyImage[];
  publisher: string;
  total_episodes: number;
}

export interface SpotifyEpisode {
  id: string;
  name: string;
  uri: string;
  duration_ms: number;
  images: SpotifyImage[];
  show: { id: string; name: string; images: SpotifyImage[] };
  description: string;
}

export interface SpotifyDevice {
  id: string;
  is_active: boolean;
  is_restricted: boolean;
  name: string;
  type: string;
  volume_percent: number;
}

export interface SpotifyPlaybackState {
  device: SpotifyDevice | null;
  repeat_state: 'off' | 'track' | 'context';
  shuffle_state: boolean;
  context: { uri: string } | null;
  progress_ms: number | null;
  is_playing: boolean;
  item: SpotifyTrack | SpotifyEpisode | null;
}

export interface SpotifyQueue {
  currently_playing: SpotifyTrack | SpotifyEpisode | null;
  queue: (SpotifyTrack | SpotifyEpisode)[];
}

export interface SpotifyProfile {
  id: string;
  display_name: string;
  product: string;
  country: string;
}

export interface Paged<T> {
  items: T[];
  next: string | null;
  total: number;
}

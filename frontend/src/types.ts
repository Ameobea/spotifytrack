export interface ReactRouterRouteProps {
  match: {
    params: { [key: string]: string };
  };
}

export type ValueOf<T> = T[keyof T];

export type Timeframe = 'short' | 'medium' | 'long';

interface TimeFrames<T> {
  short: T[];
  medium: T[];
  long: T[];
}

interface Track {
  album: {
    available_markets: string[];
    name: string;
    release_date: string;
    uri: string;
    artists: { name: string; uri: string }[];
    images: Image[];
  };
  duration_ms: number;
  preview_url: string;
  name: string;
  popularity: number;
  uri: string;
}

interface Image {
  height: number;
  url: string;
  width: number;
}

interface Artist {
  followers: {
    total: number;
  };
  genres: string[];
  id: string;
  images: Image[];
  name: string;
  popularity: number;
  uri: string;
}

export interface UserStats {
  last_update_time: string;
  tracks: TimeFrames<Track>;
  artists: TimeFrames<Artist>;
}

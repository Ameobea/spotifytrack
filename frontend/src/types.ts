import { getState } from 'src/store';

export type ReduxStore = ReturnType<typeof getState>;

export interface ReactRouterRouteProps {
  match: {
    params: { [key: string]: string };
  };
}

export type ValueOf<T> = T[keyof T];

export type Timeframe = 'short' | 'medium' | 'long';

export interface TimeFrames<T> {
  short: T[];
  medium: T[];
  long: T[];
}

export interface Track {
  album: {
    available_markets: string[];
    name: string;
    release_date: string;
    uri: string;
    artists: { name: string; uri: string; id: string }[];
    images: Image[];
  };
  duration_ms: number;
  preview_url: string;
  name: string;
  popularity: number;
  uri: string;
  id: string;
}

interface Image {
  height: number;
  url: string;
  width: number;
}

export interface Artist {
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

export type UserStats = Partial<{
  last_update_time: string;
  tracks: TimeFrames<string>;
  artists: TimeFrames<string>;
  artistStats: {
    [artistId: string]: {
      topTracks: { trackId: string; score: number }[];
      popularityHistory: {
        timestamp: Date;
        popularityPerTimePeriod: [number | null, number | null, number | null];
      }[];
    };
  };
  genreHistory?: {
    popularityByGenre: { [genre: string]: (number | null)[] };
    timestamps: Date[];
  };
}>;

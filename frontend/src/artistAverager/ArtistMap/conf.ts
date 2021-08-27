export const BASE_ARTIST_COLOR = 0x11aa99;
export const PLAYING_ARTIST_COLOR = 0xee44ab;
export const HIGHLIGHTED_ARTIST_COLOR = 0xffa30a;
export const BASE_CONNECTION_COLOR = 0x2288ee;

export const DEFAULT_FOV = 90;

export const MOVEMENT_SPEED_UNITS_PER_SECOND = 1490;
export const SHIFT_SPEED_MULTIPLIER = 3.87;

export const BASE_ARTIST_GEOMETRY_SIZE = 1.7;
export const ARTIST_GEOMETRY_OPACITY = 0.48;
export const BLOOMED_CONNECTION_OPACITY = 0.009;

export const SECONDS_BETWEEN_POSITION_UPDATES = 0.15;

export const MUSIC_FADE_IN_TIME_SECS = 0.35;
export const MUSIC_FADE_OUT_TIME_SECS = 3.6;
export const MUSIC_DISTANCE_ROLLOFF_FACTOR = 1.7;
export const SPEED_BOOST_MUSIC_DISTANCE_ROLLOFF_FACTOR = 0.6;
export const MIN_MUSIC_PLAY_TIME_SECS = 0.8;

export const getArtistSize = (popularity: number, isHighlighted: boolean): number => {
  const x = popularity / 100;
  let size = Math.pow(Math.pow(x, 2) * 10, 2.5) + 4.89 * Math.pow(x, 6) + 53 * x + 10;
  if (isHighlighted) {
    size *= 2.3;
  }
  return size;
};

export const getArtistLabelScaleFactor = (distance: number, popularity: number) => {
  // Scale linearly with distance just like real life
  let score = (1 / (distance * 0.00025)) * 0.87;

  // Apply exponential scaling with popularity
  score -= 1;
  score += (popularity / 100) * 2;

  return Math.max(Math.min(score, 18), 0);
};

export const getArtistColor = (isHighlighted: boolean, isPlaying: boolean): number => {
  if (isPlaying) {
    return PLAYING_ARTIST_COLOR;
  }

  if (isHighlighted) {
    return HIGHLIGHTED_ARTIST_COLOR;
  }

  return BASE_ARTIST_COLOR;
};

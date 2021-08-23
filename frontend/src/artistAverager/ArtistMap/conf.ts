export const BASE_ARTIST_COLOR = 0x22eecc;
export const BASE_CONNECTION_COLOR = 0x2288ee;

export const MOVEMENT_SPEED_UNITS_PER_SECOND = 48;

export const ARTIST_LABEL_TEXT_SIZE = 44.8;
export const ARTIST_GEOMETRY_SIZE = 1.7;

export const SECONDS_BETWEEN_POSITION_UPDATES = 0.15;

export const getArtistSize = (popularity: number): number => {
  const x = popularity / 100;
  return Math.pow(Math.pow(x, 2) * 10, 2.5) + 12 * Math.pow(x, 6) + 0.025 * x + 10;
};

export const getDistanceScaleFactor = (distance: number, popularity: number) => {
  // Scale linearly with distance just like real life
  let score = (1 / (distance * 0.0004)) * 0.3;

  // Apply exponential scaling with popularity
  score -= 1;
  score += (popularity / 100) * 2;

  return Math.min(score, 8);
};

import type { Quality } from './ArtistMapInst';

export const BASE_ARTIST_COLOR = 0x1586a6;
export const PLAYING_ARTIST_COLOR = 0xfe54bb;
export const HIGHLIGHTED_ARTIST_COLOR = 0xad4a03;
export const BASE_CONNECTION_COLOR = 0x0072dd;
export const ARTIST_GEOMETRY_DETAIL = 3;
export const AMBIENT_LIGHT_COLOR = 0x727272;
export const ARTIST_LABEL_TEXT_COLOR = '#f2f2f2';

export const DEFAULT_FOV = 84.3;
export const CAMERA_PIVOT_COEFFICIENT = 0.96;
export const CAMERA_OVERRIDE_TARGET_TOLERANCE = 0.02;
export const FRAME_TIMING_BUFFER_SIZE = Math.round(60 * 2);

export const MOVEMENT_SPEED_UNITS_PER_SECOND = 3020;
export const SHIFT_SPEED_MULTIPLIER = 2.395;
export const MAX_ARTIST_PLAY_CLICK_DISTANCE = 30_000;
export const INITIAL_ORBIT_POSITION = {
  x: -4160.963871145082,
  y: -83571.31242528294,
  z: 132532.40676410656,
};
export const INITIAL_CAMERA_ROTATION = {
  x: 0.7313413434972131,
  y: -0.08025528825788147,
  z: 0.07181496403499675,
};
export const INITIAL_ORBIT_TARGET = {
  x: 1631.6685787933548,
  y: -13573.465913281103,
  z: -31932.713515335818,
};

export const PLAYING_ARTIST_LABEL_FADE_OUT_TIME_MS = 2800;

export const BASE_ARTIST_GEOMETRY_SIZE = 1.7;
export const ARTIST_GEOMETRY_OPACITY = 0.2;
export const DEFAULT_QUALITY: Quality = 7;

export const getBloomedConnectionOpacity = (quality: Quality): number => {
  const baseOpacity = 0.0102;

  if (quality >= DEFAULT_QUALITY) {
    return baseOpacity;
  }

  const qualityDiff = DEFAULT_QUALITY - quality;
  const addedOpacity = Math.pow(qualityDiff, 2) * 0.0002;
  return baseOpacity + addedOpacity;
};

export const getHighlightedArtistsInterOpacity = (
  intraLineCount: number,
  interLineCount: number
): number => {
  let opacity = 0.0222;

  if (intraLineCount < 30) {
    opacity += 0.015;
  }
  if (intraLineCount < 100) {
    opacity += 0.01;
  }
  if (intraLineCount < 500) {
    opacity += 0.008;
  }

  if (interLineCount > 5000) {
    opacity -= 0.0052;
  }
  if (interLineCount > 3000) {
    opacity -= 0.002;
  }

  return opacity;
};

export const CROSSHAIR_COLOR = 'rgba(188, 188, 188, 0.38)';
export const CROSSHAIR_WIDTH_PX = 2;

export const GALAXY_BLOG_POST_LINK = 'https://cprimozic.net/blog/building-music-galaxy/';

export const BLOOM_PARAMS = {
  bloomStrength: 2.45,
  bloomThreshold: 0,
  bloomRadius: 0.12,
};

export const getSecondsBetweenPositionUpdates = (quality: number) => 1 / quality + 0.15;

export const MUSIC_FADE_IN_TIME_SECS = 0.35;
export const MUSIC_FADE_OUT_TIME_SECS = 3.6;
export const MUSIC_DISTANCE_ROLLOFF_FACTOR = 0.84;
export const SPEED_BOOST_MUSIC_DISTANCE_ROLLOFF_FACTOR = 0.6;
export const MIN_MUSIC_PLAY_TIME_SECS = 0.8;
export const DEFAULT_VOLUME = 0.6;

export const getArtistSize = (
  popularity: number,
  isHighlighted: boolean,
  isPlaying: boolean
): number => {
  // Playing artists have a separate, dedicated geometry so we want to hide this one without dealing with actually removing
  // it from the instanced mesh.
  if (isPlaying) {
    return 0.001;
  }

  const x = popularity / 100;
  let size = Math.pow(Math.pow(x, 2) * 10, 2.5) + 4.89 * Math.pow(x, 6) + 41 * x + 10;
  if (isHighlighted) {
    // Avoid really huge popular artists
    if (popularity > 87) {
      size *= 1.3;
    } else if (popularity > 30) {
      size *= 2.82;
    } else if (popularity > 20) {
      size *= 3.3;
    } else {
      size *= 4;
    }
  }
  return size;
};

export const getArtistLabelScaleFactor = (
  distance: number,
  popularity: number,
  zoom: number,
  isMobile: boolean
) => {
  // Scale linearly with distance just like real life
  let score = (1 / (distance * (isMobile ? 0.00020245 : 0.00015))) * 0.95;

  // Apply exponential scaling with popularity
  score -= 1;
  score += (popularity / 100) * 2;

  // Make labels larger when FOV is lower to account for the zoom effect it has
  score *= 1 / Math.pow(1 / zoom, 1.5);

  return Math.max(Math.min(score, 18), 0);
};

export const getArtistFlyToDurationMs = (distance: number): number => {
  return 2500 + 1000 * (distance / 27_500);
};

export const getHighlightedArtistsIntraOpacity = (
  controlMode: 'orbit' | 'pointerlock' | 'flyorbit',
  totalHighlightedArtistCount: number
) => {
  if (controlMode === 'orbit') {
    if (totalHighlightedArtistCount <= 50) {
      return 0.205;
    }

    return totalHighlightedArtistCount >= 100 ? 0.087 : 0.124;
  }

  return totalHighlightedArtistCount >= 100 ? 0.033 : 0.0525;
};

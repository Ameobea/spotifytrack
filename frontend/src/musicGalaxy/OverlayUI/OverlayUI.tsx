import React, { useEffect, useReducer, useRef } from 'react';
import { getIsMobile, getUserSpotifyID } from '../ArtistMapInst';

import {
  ARTIST_LABEL_TEXT_COLOR,
  CROSSHAIR_COLOR,
  CROSSHAIR_WIDTH_PX,
  DEFAULT_FOV,
  getArtistLabelScaleFactor,
  PLAYING_ARTIST_LABEL_FADE_OUT_TIME_MS,
} from '../conf';
import ArtistSearch, { CollapsedArtistSearch } from './ArtistSearch';
import CheatSheet, {
  CollapsedCheatSheet,
  CollapsedMobileCheatSheet,
  MobileCheatSheet,
} from './CheatSheet';
import OnboardingSidebar from './OnboardingSidebar';
import './OverlayUI.scss';

interface State {
  labels: Map<string | number, { id: string | number; text: string; width: number }>;
  textImages: Map<string | number, HTMLImageElement>;
  fadingOutPlayingArtistLabels: { artistID: number; fadeOutStartTime: number }[];
  lastPlayingArtistID: number | null;
}

type Action =
  | { type: 'createLabel'; id: number | string; text: string }
  | { type: 'deleteLabel'; id: number | string }
  | { type: 'deleteAllLabels' }
  | { type: 'pointerLocked' }
  | { type: 'pointerUnlocked' };

export class UIEventRegistry {
  private callback: ((actions: Action[]) => void) | null = null;
  private pendingActions: Action[] = [];

  public currentFOV = DEFAULT_FOV;
  public controlMode: 'orbit' | 'pointerlock' | 'trackball' = 'orbit';
  public getLabelPosition: (id: number | string) => {
    x: number;
    y: number;
    isInFrontOfCamera: boolean;
    distance: number;
    popularity: number;
  };
  public getShouldUpdate: () => boolean;
  public getArtistName: (artistID: number) => string;
  public getShouldRenderCrosshair: () => boolean;
  public curPlaying: number | null = null;
  public getIfArtistIDsAreInEmbedding: (artistIDs: number[]) => boolean[];
  public lookAtArtistID: (artistID: number) => void;
  public flyToArtistID: (artistID: number) => void;
  public lockPointer: () => void;
  public isMobile = getIsMobile();

  constructor({
    getLabelPosition,
    getShouldUpdate,
    getArtistName,
    getShouldRenderCrosshair,
    getIfArtistIDsAreInEmbedding,
    lookAtArtistID,
    lockPointer,
    flyToArtistID,
  }: {
    getLabelPosition: (artistID: number | string) => {
      x: number;
      y: number;
      isInFrontOfCamera: boolean;
      distance: number;
      popularity: number;
    };
    getShouldUpdate: () => boolean;
    getArtistName: (artistID: number) => string;
    getShouldRenderCrosshair: () => boolean;
    getIfArtistIDsAreInEmbedding: (artistIDs: number[]) => boolean[];
    lookAtArtistID: (artistID: number) => void;
    lockPointer: () => void;
    flyToArtistID: (artistID: number) => void;
  }) {
    this.getLabelPosition = getLabelPosition;
    this.getShouldUpdate = getShouldUpdate;
    this.getArtistName = getArtistName;
    this.getShouldRenderCrosshair = getShouldRenderCrosshair;
    this.getIfArtistIDsAreInEmbedding = getIfArtistIDsAreInEmbedding;
    this.lookAtArtistID = lookAtArtistID;
    this.flyToArtistID = flyToArtistID;
    this.lockPointer = lockPointer;
  }

  public createLabel(id: number | string, text: string) {
    this.pendingActions.push({ type: 'createLabel', id, text });
  }

  public deleteLabel(id: number | string) {
    this.pendingActions.push({ type: 'deleteLabel', id });
  }

  public deleteAllLabels() {
    this.pendingActions.push({ type: 'deleteAllLabels' });
  }

  public onPointerLocked() {
    this.callback?.([{ type: 'pointerLocked' }]);
  }

  public onPointerUnlocked() {
    this.callback?.([{ type: 'pointerUnlocked' }]);
  }

  public flush() {
    if (this.callback) {
      this.callback(this.pendingActions);
      this.pendingActions = [];
    }
  }

  public registerCallbacks(callback: (actions: Action[]) => void) {
    this.callback = callback;
    this.flush();
  }

  public deregisterCallbacks(callback: (actions: Action[]) => void) {
    if (this.callback !== callback) {
      throw new Error('Tried to deregister callback different than what are currently registered');
    }
    this.callback = null;
  }
}

interface OverlayUIProps {
  width: number;
  height: number;
  eventRegistry: UIEventRegistry;
  onPointerDown: (evt: React.MouseEvent<HTMLCanvasElement, MouseEvent>) => void;
}

const initialState: State = {
  labels: new Map(),
  textImages: new Map(),
  fadingOutPlayingArtistLabels: [],
  lastPlayingArtistID: null,
};

const textWidthCache: Map<string, number> = new Map();

const measureText: (text: string) => number = (() => {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  const fontSize = 12;
  const fontFamily = 'PT Sans';
  ctx.font = `${fontSize}px ${fontFamily}`;

  return (text: string) => {
    if (textWidthCache.has(text)) {
      return textWidthCache.get(text)!;
    }
    const width = ctx.measureText(text).width;
    textWidthCache.set(text, width);
    return width;
  };
})();

const renderCrosshair = (ctx: CanvasRenderingContext2D) => {
  ctx.strokeStyle = CROSSHAIR_COLOR;
  ctx.lineWidth = CROSSHAIR_WIDTH_PX;
  ctx.beginPath();

  const midpointX = ctx.canvas.width / 2;
  const midpointY = ctx.canvas.height / 2;

  ctx.moveTo(midpointX, midpointY - 9);
  ctx.lineTo(midpointX, midpointY - 2.6);
  ctx.moveTo(midpointX, midpointY + 2.6);
  ctx.lineTo(midpointX, midpointY + 9);
  ctx.moveTo(midpointX - 9, midpointY);
  ctx.lineTo(midpointX - 2.6, midpointY);
  ctx.moveTo(midpointX + 2.6, midpointY);
  ctx.lineTo(midpointX + 9, midpointY);
  ctx.stroke();
};

const renderCurPlaying = (
  {
    x,
    y,
    text,
    isInFrontOfCamera,
  }: { x: number; y: number; text: string; isInFrontOfCamera: boolean },
  ctx: CanvasRenderingContext2D,
  isMobile: boolean,
  opacity?: number
) => {
  const isBehind = !isInFrontOfCamera;
  const width = measureText(text) * 1.5 * (isMobile ? 0.6 : 1);

  let actualX = x;
  let actualY = y;

  const x1 = ctx.canvas.width / 2;
  const y1 = ctx.canvas.height / 2;
  const x2 = x;
  const y2 = y;
  const slope = (y2 - y1) / (x2 - x1);
  const yIntercept = y1 - slope * x1;

  const screenTopIntercept = (0 - yIntercept) / slope;
  const screenBottomIntercept = (ctx.canvas.height - yIntercept) / slope;

  const pos =
    y1 - y2 > 0 !== isBehind
      ? { x: screenTopIntercept, y: 0 }
      : { x: screenBottomIntercept, y: ctx.canvas.height };

  if (!Number.isFinite(slope) || !Number.isFinite(yIntercept)) {
    actualX = 0;
    actualY = 0;
  } else if (!isBehind && x > 0 && x < ctx.canvas.width && y > 0 && y < ctx.canvas.height) {
    actualX = x;
    actualY = y;
  } else {
    const x1 = ctx.canvas.width / 2;
    const y1 = ctx.canvas.height / 2;
    const x2 = pos.x;
    const y2 = pos.y;

    const slope = (y2 - y1) / (x2 - x1);
    const yIntercept = y1 - slope * x1;

    const screenLeftIntercept = slope * 0 + yIntercept;
    const screenRightIntercept = slope * ctx.canvas.width + yIntercept;

    const isTopOrBottom = pos.x >= 0 && pos.x <= ctx.canvas.width;
    if (isTopOrBottom) {
      const isTop = pos.y === 0;
      actualX = isTop ? screenTopIntercept : screenBottomIntercept;
      actualY = pos.y;
    } else {
      const isLeft = pos.x < 0;
      actualX = isLeft ? 0 : ctx.canvas.width;
      actualY = isLeft ? screenLeftIntercept : screenRightIntercept;
    }
  }

  const height = isMobile ? 20 : 32;
  actualX -= width / 2;
  actualY -= height;

  const padding = isMobile ? 2 : 10;
  actualX = Math.max(padding * 2, Math.min(actualX, ctx.canvas.width - width - padding * 2));
  actualY = Math.max(padding * 2, Math.min(actualY, ctx.canvas.height - padding * 2));

  ctx.globalAlpha = opacity ?? 1;
  ctx.fillStyle = '#141414';
  ctx.fillRect(
    actualX - padding + (isMobile ? 2 : 0),
    actualY - padding,
    width + padding * 2,
    height - (isMobile ? 2 : 0)
  );
  ctx.fill();
  ctx.fillStyle = opacity === undefined ? '#ee44ab' : '#eee';
  ctx.font = `${isMobile ? 0.6 * 18 : 18}px PT Sans`;
  ctx.fillText(text, actualX, actualY + 13);
  ctx.globalAlpha = 1;
};

export interface OverlayState {
  onboardingOpen: boolean;
  artistSearchOpen: boolean;
}

const buildDefaultOverlayState = (): OverlayState => ({
  onboardingOpen: !getUserSpotifyID(),
  artistSearchOpen: true,
});

export type OverlayAction =
  | { type: 'CLOSE_ONBOARDING' }
  | { type: 'OPEN_ARTIST_SEARCH' }
  | { type: 'CLOSE_ARTIST_SEARCH' };

const overlayStateReducer = (state: OverlayState, action: OverlayAction): OverlayState => {
  switch (action.type) {
    case 'CLOSE_ONBOARDING':
      return { ...state, onboardingOpen: false };
    case 'OPEN_ARTIST_SEARCH':
      return { ...state, artistSearchOpen: true };
    case 'CLOSE_ARTIST_SEARCH':
      return { ...state, artistSearchOpen: false };
    default:
      console.warn('Unhandled action:', action);
      return state;
  }
};

const renderOrbitModeLabel = (
  ctx: CanvasRenderingContext2D,
  label: { id: string | number; text: string; width: number },
  { x, y, distance }: { x: number; y: number; distance: number },
  minDistance: number,
  maxDistance: number
) => {
  const normalizedDistance = (distance - minDistance) / (maxDistance - minDistance);
  // Scale linearly based on distance
  const scale = (1 - normalizedDistance) * 0.6 + 0.45;
  const opacity = Math.min(1, scale * 1.1);

  const fontSize = Math.round(12 * scale * 100) / 100;
  ctx.font = `${fontSize}px PT Sans`;
  ctx.fillStyle = `#141414${Math.floor(Math.min(opacity + 0.1, 0.85) * 0xff).toString(16)}`;
  ctx.fillRect(
    x - label.width / 2.3 - 3 * scale,
    y - 12 * scale,
    (label.width + 6 * scale) * scale,
    16 * scale
  );

  ctx.fillStyle = `${ARTIST_LABEL_TEXT_COLOR}${Math.floor(
    Math.min(opacity * 1.3 + 0.15, 1) * 0xff
  ).toString(16)}`;
  ctx.fillText(label.text, x - label.width / 2.3, y);
};

const OverlayUI: React.FC<OverlayUIProps> = ({ eventRegistry, width, height, onPointerDown }) => {
  const labelState = useRef(initialState);
  const canvasRef = useRef<CanvasRenderingContext2D | null>(null);
  const [overlayState, dispatchOverlayAction] = useReducer(
    overlayStateReducer,
    buildDefaultOverlayState()
  );

  useEffect(() => {
    const handleActions = (actions: Action[]) => {
      actions.forEach((action) => {
        switch (action.type) {
          case 'createLabel':
            labelState.current.labels.set(action.id, {
              id: action.id,
              text: action.text,
              width: measureText(action.text),
            });
            break;
          case 'deleteLabel':
            labelState.current.labels.delete(action.id);
            break;
          case 'deleteAllLabels':
            labelState.current.labels.clear();
            break;
          case 'pointerLocked':
            dispatchOverlayAction({ type: 'CLOSE_ONBOARDING' });
            dispatchOverlayAction({ type: 'CLOSE_ARTIST_SEARCH' });
            break;
          case 'pointerUnlocked':
            dispatchOverlayAction({ type: 'CLOSE_ONBOARDING' });
            dispatchOverlayAction({ type: 'OPEN_ARTIST_SEARCH' });
            break;
          default:
            console.warn('Unhandled action:', action);
        }
      });
    };

    eventRegistry.registerCallbacks(handleActions);

    return () => {
      eventRegistry.deregisterCallbacks(handleActions);
    };
  }, [eventRegistry]);

  useEffect(() => {
    const updateLabelPositions = () => {
      requestAnimationFrame(updateLabelPositions);

      if (!canvasRef.current) {
        return;
      }

      const shouldUpdate = eventRegistry.getShouldUpdate();
      if (
        !shouldUpdate &&
        labelState.current.fadingOutPlayingArtistLabels.length === 0 &&
        labelState.current.lastPlayingArtistID === eventRegistry.curPlaying
      ) {
        return;
      }

      const ctx = canvasRef.current!;
      ctx.fillStyle = 'rgba(0, 0, 0, 0)';
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

      if (eventRegistry.curPlaying !== labelState.current.lastPlayingArtistID) {
        if (labelState.current.lastPlayingArtistID !== null) {
          labelState.current.fadingOutPlayingArtistLabels.push({
            artistID: labelState.current.lastPlayingArtistID,
            fadeOutStartTime: Date.now(),
          });
        }
        labelState.current.lastPlayingArtistID = eventRegistry.curPlaying;
      }

      // If we're rendering orbit mode labels, we need to sort them by distance, furthest to closest
      const labelsToRender = (
        eventRegistry.controlMode === 'orbit'
          ? [...labelState.current.labels.entries()].sort((a, b) => {
              const aDistance = eventRegistry.getLabelPosition(a[0]).distance;
              const bDistance = eventRegistry.getLabelPosition(b[0]).distance;
              return bDistance - aDistance;
            })
          : [...labelState.current.labels.entries()]
      ).map(([id, label]) => ({
        id,
        label,
        position: eventRegistry.getLabelPosition(label.id),
      }));

      const { minDistance, maxDistance } = labelsToRender.reduce(
        (acc, { position }) => {
          if (position.distance < acc.minDistance) {
            acc.minDistance = position.distance;
          }
          if (position.distance > acc.maxDistance) {
            acc.maxDistance = position.distance;
          }
          return acc;
        },
        {
          minDistance: Infinity,
          maxDistance: 0,
        }
      );

      for (const {
        id: artistID,
        label,
        position: { x, y, isInFrontOfCamera, distance, popularity },
      } of labelsToRender) {
        if (
          artistID === eventRegistry.curPlaying ||
          labelState.current.fadingOutPlayingArtistLabels.some((f) => f.artistID === artistID)
        ) {
          continue;
        }

        if (
          !isInFrontOfCamera ||
          x < -300 ||
          x > ctx.canvas.width + 300 ||
          y < -300 ||
          y > ctx.canvas.height + 300
        ) {
          continue;
        }

        if (eventRegistry.controlMode === 'orbit') {
          renderOrbitModeLabel(ctx, label, { x, y, distance }, minDistance, maxDistance);
          continue;
        }

        const scale = getArtistLabelScaleFactor(
          distance,
          popularity,
          eventRegistry.currentFOV,
          eventRegistry.isMobile
        );

        if (scale === 0) {
          continue;
        }

        const fontSize = Math.round(12 * scale * 10) / 10;
        ctx.font = `${fontSize}px PT Sans`;
        ctx.fillStyle = ARTIST_LABEL_TEXT_COLOR;
        ctx.fillText(label.text, x - (label.width * scale) / 2.3, y);
      }

      const now = Date.now();
      labelState.current.fadingOutPlayingArtistLabels =
        labelState.current.fadingOutPlayingArtistLabels.filter(
          (datum) => now - datum.fadeOutStartTime < PLAYING_ARTIST_LABEL_FADE_OUT_TIME_MS
        );

      for (const { artistID, fadeOutStartTime } of labelState.current
        .fadingOutPlayingArtistLabels) {
        const pos = eventRegistry.getLabelPosition(artistID);
        // Linearly fade out over the fade duration
        const opacity = 1 - (now - fadeOutStartTime) / PLAYING_ARTIST_LABEL_FADE_OUT_TIME_MS;
        renderCurPlaying(
          { ...pos, text: eventRegistry.getArtistName(artistID) },
          ctx,
          eventRegistry.isMobile,
          opacity
        );
      }

      if (eventRegistry.curPlaying !== null) {
        const pos = eventRegistry.getLabelPosition(eventRegistry.curPlaying);
        renderCurPlaying(
          {
            ...pos,
            text: eventRegistry.getArtistName(eventRegistry.curPlaying),
          },
          ctx,
          eventRegistry.isMobile
        );
      }

      if (eventRegistry.getShouldRenderCrosshair()) {
        renderCrosshair(ctx);
      }
    };

    const handle = requestAnimationFrame(updateLabelPositions);

    return () => {
      cancelAnimationFrame(handle);
    };
  }, [eventRegistry, height, width]);

  return (
    <>
      {overlayState.onboardingOpen ? (
        <OnboardingSidebar
          dispatchOverlayAction={dispatchOverlayAction}
          lockPointer={() => eventRegistry.lockPointer()}
        />
      ) : overlayState.artistSearchOpen ? (
        <>{eventRegistry.isMobile ? <MobileCheatSheet /> : <CheatSheet />}</>
      ) : eventRegistry.isMobile ? (
        <CollapsedMobileCheatSheet />
      ) : (
        <CollapsedCheatSheet />
      )}
      {overlayState.artistSearchOpen ? (
        <>
          <ArtistSearch
            onSubmit={({ internalID }, command) => {
              switch (command) {
                case 'look-at':
                  eventRegistry.lookAtArtistID(internalID);
                  break;
                case 'fly-to':
                  eventRegistry.flyToArtistID(internalID);
                  break;
                default:
                  console.warn('Unhandled artist search command:', command);
              }
            }}
            getIfArtistIDsAreInEmbedding={(artistIDs) =>
              eventRegistry.getIfArtistIDsAreInEmbedding(artistIDs)
            }
          />
        </>
      ) : (
        <CollapsedArtistSearch />
      )}
      <canvas
        onClick={onPointerDown}
        className="artist-map-overlay-ui"
        width={width}
        height={height}
        style={{ width, height }}
        ref={(node) => {
          if (!node) {
            return;
          }
          const ctx = node?.getContext('2d');
          if (!ctx) {
            return;
          }

          const dpr = window.devicePixelRatio;
          const canvas = node;
          const rect = canvas.getBoundingClientRect();
          canvas.width = rect.width * dpr;
          canvas.height = rect.height * dpr;
          ctx.scale(dpr, dpr);
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';

          canvasRef.current = ctx;
        }}
      />
    </>
  );
};

export default OverlayUI;

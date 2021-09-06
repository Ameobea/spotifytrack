import React, { useEffect, useRef } from 'react';

import {
  ARTIST_LABEL_TEXT_COLOR,
  CROSSHAIR_COLOR,
  CROSSHAIR_WIDTH_PX,
  DEFAULT_FOV,
  getArtistLabelScaleFactor,
  PLAYING_ARTIST_LABEL_FADE_OUT_TIME_MS,
} from './conf';
import './OverlayUI.scss';

interface State {
  labels: Map<string | number, { id: string | number; text: string; width: number }>;
  textImages: Map<string | number, HTMLImageElement>;
  fadingOutPlayingArtistLabels: { artistID: number; fadeOutStartTime: number }[];
  lastPlayingArtistID: number | null;
}

type Action =
  | { type: 'createLabel'; id: number | string; text: string }
  | { type: 'deleteLabel'; id: number | string };

export class UIEventRegistry {
  private callback: ((actions: Action[]) => void) | null = null;
  private pendingActions: Action[] = [];

  public currentFOV = DEFAULT_FOV;
  public getLabelPosition: (
    id: number | string
  ) => { x: number; y: number; isInFrontOfCamera: boolean; distance: number; popularity: number };
  public getShouldUpdate: () => boolean;
  public getArtistName: (artistID: number) => string;
  public getShouldRenderCrosshair: () => boolean;
  public curPlaying: number | null = null;

  constructor(
    getLabelPosition: (
      artistID: number | string
    ) => { x: number; y: number; isInFrontOfCamera: boolean; distance: number; popularity: number },
    getShouldUpdate: () => boolean,
    getArtistName: (artistID: number) => string,
    getShouldRenderCrosshair: () => boolean
  ) {
    this.getLabelPosition = getLabelPosition;
    this.getShouldUpdate = getShouldUpdate;
    this.getArtistName = getArtistName;
    this.getShouldRenderCrosshair = getShouldRenderCrosshair;
  }

  public createLabel(id: number | string, text: string) {
    this.pendingActions.push({ type: 'createLabel', id, text });
  }

  public deleteLabel(id: number | string) {
    this.pendingActions.push({ type: 'deleteLabel', id });
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
  onPointerDown: (evt: MouseEvent) => void;
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
  opacity?: number
) => {
  const isBehind = !isInFrontOfCamera;
  const width = measureText(text) * 1.5;

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

  actualX -= width / 2;
  actualY -= 30;

  actualX = Math.max(20, Math.min(actualX, ctx.canvas.width - width - 20));
  actualY = Math.max(20, Math.min(actualY, ctx.canvas.height - 20));

  ctx.globalAlpha = opacity ?? 1;
  ctx.fillStyle = '#141414';
  ctx.fillRect(actualX - 10, actualY - 10, width + 20, 32);
  ctx.fill();
  ctx.fillStyle = opacity === undefined ? '#ee44ab' : '#eee';
  ctx.font = '18px PT Sans';
  ctx.fillText(text, actualX, actualY + 13);
  ctx.globalAlpha = 1;
};

const OverlayUI: React.FC<OverlayUIProps> = ({ eventRegistry, width, height, onPointerDown }) => {
  const state = useRef(initialState);
  const canvasRef = useRef<CanvasRenderingContext2D | null>(null);

  useEffect(() => {
    const handleActions = (actions: Action[]) => {
      actions.forEach((action) => {
        switch (action.type) {
          case 'createLabel':
            state.current.labels.set(action.id, {
              id: action.id,
              text: action.text,
              width: measureText(action.text),
            });
            break;
          case 'deleteLabel':
            state.current.labels.delete(action.id);
            break;
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
        state.current.fadingOutPlayingArtistLabels.length === 0 &&
        state.current.lastPlayingArtistID === eventRegistry.curPlaying
      ) {
        return;
      }

      const ctx = canvasRef.current!;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.fillStyle = 'rgba(0, 0, 0, 0)';
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

      if (eventRegistry.curPlaying !== state.current.lastPlayingArtistID) {
        if (state.current.lastPlayingArtistID !== null) {
          state.current.fadingOutPlayingArtistLabels.push({
            artistID: state.current.lastPlayingArtistID,
            fadeOutStartTime: Date.now(),
          });
        }
        state.current.lastPlayingArtistID = eventRegistry.curPlaying;
      }

      for (const [artistID, label] of state.current.labels.entries()) {
        if (
          artistID === eventRegistry.curPlaying ||
          state.current.fadingOutPlayingArtistLabels.some((f) => f.artistID === artistID)
        ) {
          continue;
        }

        const { x, y, isInFrontOfCamera, distance, popularity } = eventRegistry.getLabelPosition(
          label.id
        );

        if (
          !isInFrontOfCamera ||
          x < -300 ||
          x > ctx.canvas.width + 300 ||
          y < -300 ||
          y > ctx.canvas.height + 300
        ) {
          continue;
        }

        const scale = getArtistLabelScaleFactor(distance, popularity, eventRegistry.currentFOV);

        if (scale === 0) {
          continue;
        }

        const fontSize = Math.round(12 * scale * 10) / 10;
        ctx.font = `${fontSize}px PT Sans`;
        ctx.fillStyle = ARTIST_LABEL_TEXT_COLOR;
        ctx.fillText(label.text, x - (label.width * scale) / 2.3, y);
      }

      const now = Date.now();
      state.current.fadingOutPlayingArtistLabels = state.current.fadingOutPlayingArtistLabels.filter(
        (datum) => now - datum.fadeOutStartTime < PLAYING_ARTIST_LABEL_FADE_OUT_TIME_MS
      );

      for (const { artistID, fadeOutStartTime } of state.current.fadingOutPlayingArtistLabels) {
        const pos = eventRegistry.getLabelPosition(artistID);
        // Linearly fade out over the fade duration
        const opacity = 1 - (now - fadeOutStartTime) / PLAYING_ARTIST_LABEL_FADE_OUT_TIME_MS;
        renderCurPlaying({ ...pos, text: eventRegistry.getArtistName(artistID) }, ctx, opacity);
      }

      if (eventRegistry.curPlaying !== null) {
        const pos = eventRegistry.getLabelPosition(eventRegistry.curPlaying);
        renderCurPlaying(
          {
            ...pos,
            text: eventRegistry.getArtistName(eventRegistry.curPlaying),
          },
          ctx
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
        canvasRef.current = node?.getContext('2d');
      }}
    />
  );
};

export default OverlayUI;

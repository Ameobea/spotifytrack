import React, { useEffect, useRef } from 'react';

import { DEFAULT_FOV, getArtistLabelScaleFactor } from './conf';
import './OverlayUI.scss';

interface State {
  labels: Map<string | number, { id: string | number; text: string; width: number }>;
  textImages: Map<string | number, HTMLImageElement>;
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
  public curPlaying: number | null = null;

  constructor(
    getLabelPosition: (
      artistID: number | string
    ) => { x: number; y: number; isInFrontOfCamera: boolean; distance: number; popularity: number },
    getShouldUpdate: () => boolean,
    getArtistName: (artistID: number) => string
  ) {
    this.getLabelPosition = getLabelPosition;
    this.getShouldUpdate = getShouldUpdate;
    this.getArtistName = getArtistName;
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
  onClick: () => void;
}

const initialState: State = {
  labels: new Map(),
  textImages: new Map(),
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

const renderCurPlaying = (
  {
    x,
    y,
    text,
    isInFrontOfCamera,
  }: { x: number; y: number; text: string; isInFrontOfCamera: boolean },
  ctx: CanvasRenderingContext2D
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

  ctx.fillStyle = '#373737';
  ctx.fillRect(actualX - 10, actualY - 10, width + 20, 32);
  ctx.fill();
  ctx.fillStyle = '#eee';
  ctx.font = '18px PT Sans';
  ctx.fillText(text, actualX, actualY + 13);
};

const OverlayUI: React.FC<OverlayUIProps> = ({ eventRegistry, width, height, onClick }) => {
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
      if (!shouldUpdate) {
        return;
      }

      const ctx = canvasRef.current!;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.fillStyle = 'rgba(0, 0, 0, 0)';
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

      for (const label of state.current.labels.values()) {
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
        ctx.fillStyle = '#e3e3e3';
        ctx.fillText(label.text, x - (label.width * scale) / 2.3, y);
      }

      if (eventRegistry.curPlaying !== null) {
        const curPlayingPos = eventRegistry.getLabelPosition(eventRegistry.curPlaying);
        renderCurPlaying(
          {
            ...curPlayingPos,
            text: eventRegistry.getArtistName(eventRegistry.curPlaying),
          },
          ctx
        );
      }
    };

    const handle = requestAnimationFrame(updateLabelPositions);

    return () => {
      cancelAnimationFrame(handle);
    };
  }, [eventRegistry, height, width]);

  return (
    <canvas
      onClick={onClick}
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

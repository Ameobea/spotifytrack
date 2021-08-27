import React, { useEffect, useRef } from 'react';

import { getArtistLabelScaleFactor } from './conf';
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

  public getLabelPosition: (
    id: number | string
  ) => { x: number; y: number; shouldRender: boolean; distance: number; popularity: number };
  public getShouldUpdate: () => boolean;

  constructor(
    getLabelPosition: (
      artistID: number | string
    ) => { x: number; y: number; shouldRender: boolean; distance: number; popularity: number },
    getShouldUpdate: () => boolean
  ) {
    this.getLabelPosition = getLabelPosition;
    this.getShouldUpdate = getShouldUpdate;
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
      ctx.clearRect(0, 0, width, height);

      for (const label of state.current.labels.values()) {
        const { x, y, shouldRender, distance, popularity } = eventRegistry.getLabelPosition(
          label.id
        );

        if (
          !shouldRender ||
          x < -300 ||
          x > ctx.canvas.width + 300 ||
          y < -300 ||
          y > ctx.canvas.height + 300
        ) {
          continue;
        }

        const scale = getArtistLabelScaleFactor(distance, popularity);

        if (scale === 0) {
          continue;
        }

        const fontSize = Math.round(12 * scale * 10) / 10;
        ctx.font = `${fontSize}px PT Sans`;
        ctx.fillStyle = '#e3e3e3';
        ctx.fillText(label.text, x - (label.width * scale) / 2.3, y);
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

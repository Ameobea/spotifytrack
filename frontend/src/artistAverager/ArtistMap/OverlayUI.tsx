import React, { useEffect, useReducer } from 'react';
import { getDistanceScaleFactor } from './conf';

import './OverlayUI.scss';

interface LabelProps {
  id: string | number;
  text: string;
  eventRegistry: UIEventRegistry;
  width: number;
  height: number;
}

const Label: React.FC<LabelProps> = ({ id, text, eventRegistry, width, height }) => (
  <div
    ref={(node) => node && setLabelStyle(eventRegistry, node, width, height)}
    className="artist-map-label"
    data-artist-id={id}
  >
    {text}
  </div>
);

interface State {
  labels: { [id: string]: { id: string | number; text: string } };
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

const reducer = (state: State, action: Action): State => {
  switch (action.type) {
    case 'createLabel':
      return {
        ...state,
        labels: {
          ...state.labels,
          [action.id]: { id: action.id, text: action.text },
        },
      };
    case 'deleteLabel':
      const newState = { ...state, labels: { ...state.labels } };
      delete newState.labels[action.id];
      return newState;
    default:
      console.error('Unhandled action type:' + (action as any).type);
      return state;
  }
};

interface OverlayUIProps {
  width: number;
  height: number;
  eventRegistry: UIEventRegistry;
}

const initialState: State = {
  labels: {},
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

const setLabelStyle = (
  eventRegistry: UIEventRegistry,
  node: HTMLElement,
  width: number,
  height: number
) => {
  const rawID = node.getAttribute('data-artist-id');
  if (rawID === null) {
    console.error('Missing "data-artist-id" attribute on label');
    return;
  }

  const id = Number.isNaN(+rawID) ? rawID : +rawID;
  const { x, y, shouldRender, distance, popularity } = eventRegistry.getLabelPosition(id);
  const scale = getDistanceScaleFactor(distance, popularity);

  if (
    !shouldRender ||
    x < -0.2 * width ||
    x > 1.2 * width ||
    y < -0.2 * height ||
    y > 1.2 * height
  ) {
    node.style.display = 'none';
  } else {
    node.style.display = 'block';
    node.style.left = `${x - (measureText(node.innerText) * scale) / 2}px`;
    node.style.top = `${y}px`;
    node.style.transform = `scale(${scale})`;
    node.style.zIndex = `${Math.round(9_100_000 - distance)}`;
  }
};

const OverlayUI: React.FC<OverlayUIProps> = ({ eventRegistry, width, height }) => {
  const [state, dispatch] = useReducer(reducer, initialState);

  useEffect(() => {
    const handleActions = (actions: Action[]) => {
      actions.forEach(dispatch);
    };

    eventRegistry.registerCallbacks(handleActions);

    return () => {
      eventRegistry.deregisterCallbacks(handleActions);
    };
  }, [eventRegistry]);

  useEffect(() => {
    const updateLabelPositions = () => {
      requestAnimationFrame(updateLabelPositions);

      const shouldUpdate = eventRegistry.getShouldUpdate();
      if (!shouldUpdate) {
        return;
      }

      const allLabels: NodeListOf<HTMLDivElement> = document.querySelectorAll('.artist-map-label');

      allLabels.forEach((node) => setLabelStyle(eventRegistry, node, width, height));
    };

    const handle = requestAnimationFrame(updateLabelPositions);

    return () => {
      cancelAnimationFrame(handle);
    };
  }, [eventRegistry, height, width]);

  return (
    <div className="artist-map-overlay-ui" style={{ width, height }}>
      {Object.entries(state.labels).map(([id, { text }]) => {
        return (
          <Label
            key={id}
            id={id}
            text={text}
            eventRegistry={eventRegistry}
            width={width}
            height={height}
          />
        );
      })}
    </div>
  );
};

export default OverlayUI;

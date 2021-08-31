import { UnreachableException, useWindowSize } from 'ameo-utils';
import React, { useEffect, useRef, useState } from 'react';

import { ArtistMapInst, initArtistMapInst } from './ArtistMapInst';
import OverlayUI, { UIEventRegistry } from './OverlayUI';

const ArtistMap: React.FC = () => {
  const [inst, setInst] = useState<ArtistMapInst | null>(null);
  const [eventRegistry, setEventRegistry] = useState<UIEventRegistry | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    if (!canvas.current) {
      throw new UnreachableException('Whole artist map ctx was fetched before canvas was rendered');
    }
    initArtistMapInst(canvas.current).then((inst) => {
      setInst(inst);
      setEventRegistry(inst.eventRegistry);
    });
  }, []);
  const { width, height } = useWindowSize();

  return (
    <div
      className="artist-map"
      onWheel={(evt) => {
        const deltaY = evt.deltaY;
        if (deltaY === 0) {
          return;
        }

        inst?.handleScroll(deltaY);
      }}
    >
      {eventRegistry ? (
        <OverlayUI
          eventRegistry={eventRegistry}
          width={width}
          height={height}
          onClick={() => inst?.handlePointerDown()}
        />
      ) : null}
      <canvas className="artist-map-canvas" width={width} height={height} ref={canvas} />
    </div>
  );
};

export default ArtistMap;

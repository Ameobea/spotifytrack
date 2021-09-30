import { useWindowSize } from 'ameo-utils/util/react';
import React, { useEffect, useRef, useState } from 'react';

import { ArtistMapInst, initArtistMapInst } from './ArtistMapInst';
import OverlayUI, { UIEventRegistry } from './OverlayUI/OverlayUI';

const ArtistMap: React.FC = () => {
  const [inst, setInst] = useState<ArtistMapInst | null>(null);
  const [eventRegistry, setEventRegistry] = useState<UIEventRegistry | null>(null);
  const didInit = useRef(false);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    if (!canvas.current || didInit.current) {
      return;
    }

    didInit.current = true;
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
          onPointerDown={(evt) => inst?.handlePointerDown(evt)}
        />
      ) : null}
      <canvas
        className="artist-map-canvas"
        width={width}
        height={height}
        ref={(ref) => {
          if (!ref) {
            return;
          }
          canvas.current = ref;

          if (!didInit.current) {
            didInit.current = true;
            initArtistMapInst(ref).then((inst) => {
              setInst(inst);
              setEventRegistry(inst.eventRegistry);
            });
          }
        }}
      />
    </div>
  );
};

export default ArtistMap;

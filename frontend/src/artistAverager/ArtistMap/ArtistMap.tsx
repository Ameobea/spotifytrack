import { UnreachableException } from 'ameo-utils';
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

  return (
    <div className="artist-map">
      {eventRegistry ? (
        <OverlayUI eventRegistry={eventRegistry} width={1920} height={1080} />
      ) : null}
      <canvas className="artist-map-canvas" height={1000} width={1920} ref={canvas} />
    </div>
  );
};

export default ArtistMap;

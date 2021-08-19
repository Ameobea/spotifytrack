import { UnreachableException } from 'ameo-utils';
import React, { useEffect, useRef, useState } from 'react';
import { ArtistMapInst, initArtistMapInst } from './ArtistMapInst';

const ArtistMap: React.FC = () => {
  const [inst, setInst] = useState<ArtistMapInst | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    if (!canvas.current) {
      throw new UnreachableException('Whole artist map ctx was fetched before canvas was rendered');
    }
    initArtistMapInst(canvas.current); //.then(setInst);
  }, []);

  return (
    <div className="artist-map">
      <canvas className="artist-map-canvas" height={1000} width={1000} ref={canvas} />
    </div>
  );
};

export default ArtistMap;

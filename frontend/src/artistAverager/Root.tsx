import React from 'react';

import ArtistInput from './ArtistInput';

const ArtistAveragerRoot: React.FC = () => (
  <div className="artist-averager-root">
    <h1>Artist Averager</h1>
    <ArtistInput
      onSelect={(spotifyID: string) => {
        console.log({ spotifyID });
        // TODO
      }}
    />
  </div>
);

export default ArtistAveragerRoot;

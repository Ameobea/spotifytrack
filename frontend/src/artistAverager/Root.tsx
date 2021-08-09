import React, { useEffect, useState } from 'react';

import ArtistInput from './ArtistInput';
import AverageArtistsListing from './AverageArtistsListing';
import SubmitButton from './SubmitButton';

const ArtistAveragerRoot: React.FC = () => {
  const [artist1SpotifyID, setArtist1SpotifyID] = useState<string | null>(
    window.location.hash ? window.location.hash.split('-')[0].substring(1) : null
  );
  const [artist2SpotifyID, setArtist2SpotifyID] = useState<string | null>(
    window.location.hash ? window.location.hash.split('-')[1] : null
  );
  const [isSubmitted, setIsSubmitted] = useState(!!window.location.hash);

  useEffect(() => {
    setIsSubmitted(false);
  }, [artist1SpotifyID, artist2SpotifyID]);

  return (
    <div className="artist-averager-root">
      <h1>Artist Averager</h1>
      <div className="artist-inputs">
        <ArtistInput
          onSelect={setArtist1SpotifyID}
          onClear={() => {
            if (artist1SpotifyID) {
              setArtist1SpotifyID(null);
            }
          }}
          style={{ backgroundColor: 'rgb(1, 92, 6)' }}
        />
        <ArtistInput
          onSelect={setArtist2SpotifyID}
          onClear={() => {
            if (artist2SpotifyID) {
              setArtist2SpotifyID(null);
            }
          }}
          style={{ backgroundColor: 'rgb(218, 207, 65)', color: '#222' }}
        />
      </div>
      <SubmitButton
        disabled={!artist1SpotifyID || !artist2SpotifyID}
        onSubmit={() => setIsSubmitted(true)}
      />
      {isSubmitted && artist1SpotifyID && artist2SpotifyID ? (
        <AverageArtistsListing artistSpotifyIDs={[artist1SpotifyID, artist2SpotifyID]} />
      ) : null}
    </div>
  );
};

export default ArtistAveragerRoot;

import React, { useEffect, useState } from 'react';

import ArtistInput from './ArtistInput';
import AverageArtistsListing from './AverageArtistsListing';
import SubmitButton from './SubmitButton';

const ArtistAveragerRoot: React.FC = () => {
  const [artist1, setArtist1] = useState<{ spotifyID: string; name: string } | null>(null);
  const [artist2, setArtist2] = useState<{ spotifyID: string; name: string } | null>(null);
  const [isSubmitted, setIsSubmitted] = useState(!!window.location.hash);

  useEffect(() => {
    if (!artist1 || !artist2) {
      setIsSubmitted(false);
    }
  }, [artist1, artist2]);

  return (
    <div className="artist-averager-root">
      <h1>Artist Averager</h1>
      <div className="artist-inputs">
        <ArtistInput
          onSelect={setArtist1}
          onClear={() => {
            if (artist1) {
              setArtist1(null);
            }
          }}
          style={{ backgroundColor: 'rgb(1, 92, 6)' }}
        />
        <ArtistInput
          onSelect={setArtist2}
          onClear={() => {
            if (artist2) {
              setArtist2(null);
            }
          }}
          style={{ backgroundColor: 'rgb(218, 207, 65)', color: '#222' }}
        />
      </div>
      {isSubmitted ? null : (
        <SubmitButton disabled={!artist1 || !artist2} onSubmit={() => setIsSubmitted(true)} />
      )}
      {isSubmitted && artist1 && artist2 ? (
        <AverageArtistsListing
          artistSpotifyIDs={[artist1.spotifyID, artist2.spotifyID]}
          artist1Name={artist1.name}
          artist2Name={artist2.name}
        />
      ) : null}
    </div>
  );
};

export default ArtistAveragerRoot;

import { UnreachableException } from 'ameo-utils';
import React, { useState } from 'react';

import ArtistInput from 'src/artistAverager/ArtistInput';
import './ArtistSearch.scss';

interface ArtistSearchProps {
  onSubmit: (artist: { spotifyID: string; name: string; internalID: number }) => void;
  getIfArtistIDsAreInEmbedding: (artistIDs: number[]) => boolean[];
}

const ArtistSearch: React.FC<ArtistSearchProps> = ({ onSubmit, getIfArtistIDsAreInEmbedding }) => {
  const [selectedArtist, setSelectedArtist] = useState<{
    spotifyID: string;
    name: string;
    internalID?: number | null;
  } | null>(null);

  return (
    <div className="artist-search">
      <ArtistInput
        selectedArtist={selectedArtist}
        onSelect={setSelectedArtist}
        onClear={() => setSelectedArtist(null)}
        showImage={false}
        filterAutocompleteResults={(autocompleteResults) => {
          const internalIDs = autocompleteResults.map((artist) => artist.internalID ?? -1);
          const hasInEmbeddingFlags = getIfArtistIDsAreInEmbedding(internalIDs);
          return autocompleteResults.filter((_res, i) => hasInEmbeddingFlags[i]);
        }}
      />
      <button
        className="artist-search-submit-button"
        disabled={!selectedArtist}
        onClick={() => {
          if (
            !selectedArtist ||
            selectedArtist.internalID === null ||
            selectedArtist.internalID === undefined
          ) {
            throw new UnreachableException();
          }

          onSubmit({
            internalID: selectedArtist.internalID,
            spotifyID: selectedArtist.spotifyID,
            name: selectedArtist.name,
          });
        }}
      >
        Submit
      </button>
    </div>
  );
};

export default ArtistSearch;

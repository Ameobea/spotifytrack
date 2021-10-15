import { UnreachableException } from 'ameo-utils';
import React, { useState } from 'react';

import ArtistInput from 'src/artistAverager/ArtistInput';
import './ArtistSearch.scss';

interface ArtistSearchProps {
  onSubmit: (
    artist: { spotifyID: string; name: string; internalID: number },
    command: 'look-at' | 'fly-to'
  ) => void;
  getIfArtistIDsAreInEmbedding: (artistIDs: number[]) => boolean[];
  onCloseUI: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
}

const ArtistSearch: React.FC<ArtistSearchProps> = ({
  onSubmit,
  getIfArtistIDsAreInEmbedding,
  onCloseUI,
  onFocus,
  onBlur,
}) => {
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
        placeholder="Search for an artist"
        onFocus={onFocus}
        onBlur={onBlur}
      />
      <button
        className="artist-search-look-at-button"
        disabled={!selectedArtist}
        onClick={() => {
          if (
            !selectedArtist ||
            selectedArtist.internalID === null ||
            selectedArtist.internalID === undefined
          ) {
            throw new UnreachableException();
          }

          onSubmit(
            {
              internalID: selectedArtist.internalID,
              spotifyID: selectedArtist.spotifyID,
              name: selectedArtist.name,
            },
            'look-at'
          );
        }}
      >
        Look At
      </button>
      <button
        className="artist-search-fly-to-button"
        disabled={!selectedArtist}
        onClick={() => {
          if (
            !selectedArtist ||
            selectedArtist.internalID === null ||
            selectedArtist.internalID === undefined
          ) {
            throw new UnreachableException();
          }

          onSubmit(
            {
              internalID: selectedArtist.internalID,
              spotifyID: selectedArtist.spotifyID,
              name: selectedArtist.name,
            },
            'fly-to'
          );
        }}
      >
        Fly To
      </button>
      <button className="artist-search-close-button" onClick={onCloseUI}>
        Close
      </button>
    </div>
  );
};

export const CollapsedArtistSearch: React.FC<{ isMobile: boolean; onShowUI: () => void }> = ({
  isMobile,
  onShowUI,
}) =>
  isMobile ? (
    <button className="mobile-open-ui-button" onClick={onShowUI}>
      Show Search
    </button>
  ) : (
    <div className="collapsed-artist-search">Press Escape to search for an artist</div>
  );

export default ArtistSearch;

import React from 'react';
import { useQuery } from 'react-query';

import Loading from 'src/components/Loading';
import { getProxiedImageURL } from 'src/util/index';
import { getAverageArtists, AverageArtistItem as AverageArtistItemType } from './api';
import './AverageArtistsListing.scss';
import SimilarityBar from './SimilarityBar';

const AverageArtistItem: React.FC<AverageArtistItemType> = ({
  artist,
  similarityToTargetPoint,
  similarityToArtist1,
  similarityToArtist2,
}) => {
  const artist1Diff = 1 - similarityToArtist1;
  const artist2Diff = 1 - similarityToArtist2;
  const similarityBarPos = artist2Diff / (artist1Diff + artist2Diff);
  const artistURL = `https://open.spotify.com/artist/${artist.id}`;

  return (
    <div className="average-artist-item">
      <img
        className="artist-image"
        alt={artist.name}
        src={getProxiedImageURL(200, artist.images?.[0]?.url ?? '')}
      />
      <div style={{ display: 'flex', flexDirection: 'column', marginLeft: 20 }}>
        <div className="artist-name">
          <a href={artistURL} target="_blank" rel="noopener noreferrer">
            {artist.name}
          </a>
        </div>
        {(similarityToTargetPoint * 100).toFixed(0)}% Match
      </div>
      <div className="similarity-bar-container">
        <SimilarityBar pos={similarityBarPos} />
      </div>
    </div>
  );
};

const ArtistSimilarities: React.FC<{ similarity: number }> = ({ similarity }) => (
  <div className="artist-similarities">
    These artists are {(similarity * 100).toFixed(0)}% similar to each other
  </div>
);

interface AverageArtistsListingProps {
  artistSpotifyIDs: [string, string];
}

const AverageArtistsListing: React.FC<AverageArtistsListingProps> = ({
  artistSpotifyIDs: [artist1ID, artist2ID],
}) => {
  const { data: averageArtists } = useQuery(
    ['averageArtists', artist1ID, artist2ID],
    ({ queryKey: [, artist1ID, artist2ID] }) => getAverageArtists(artist1ID, artist2ID)
  );

  return (
    <div className="average-artists-listing">
      {averageArtists ? (
        <>
          <ArtistSimilarities similarity={averageArtists.similarity} />
          {averageArtists.artists.map((artist) => (
            <AverageArtistItem key={artist.artist.id} {...artist} />
          ))}
        </>
      ) : (
        <Loading />
      )}
    </div>
  );
};

export default AverageArtistsListing;

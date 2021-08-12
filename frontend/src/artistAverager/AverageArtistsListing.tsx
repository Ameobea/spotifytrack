import React, { useState } from 'react';
import { useQuery } from 'react-query';

import Loading from 'src/components/Loading';
import type { Track } from 'src/types';
import { getProxiedImageURL } from 'src/util/index';
import mkTrackCard from 'src/Cards/TrackCard';
import { getAverageArtists, AverageArtistItem as AverageArtistItemType } from './api';
import './AverageArtistsListing.scss';
import SimilarityBar from './SimilarityBar';

const TrackCard = mkTrackCard(React.Fragment);

interface TopTracksProps {
  tracks: Track[];
  playing: string | false;
  setPlaying: (playing: string | false) => void;
}

const TopTracks: React.FC<TopTracksProps> = ({ tracks, playing, setPlaying }) => {
  return (
    <div className="top-tracks">
      {tracks.map((track) => (
        <TrackCard
          key={track.id}
          title={track.name}
          artists={track.album.artists}
          previewUrl={track.preview_url}
          imageSrc={track.album.images[0]?.url}
          playing={playing}
          setPlaying={setPlaying}
          mobile={false /* TODO */}
        />
      ))}
    </div>
  );
};

interface AverageArtistItemProps extends AverageArtistItemType {
  artist1Name: string;
  artist2Name: string;
  playing: string | false;
  setPlaying: (playing: string | false) => void;
}

const AverageArtistItem: React.FC<AverageArtistItemProps> = ({
  artist,
  topTracks,
  similarityToTargetPoint,
  similarityToArtist1,
  similarityToArtist2,
  artist1Name,
  artist2Name,
  playing,
  setPlaying,
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
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          marginLeft: 20,
          maxWidth: 180,
          width: 180,
        }}
      >
        <div className="artist-name">
          <a href={artistURL} target="_blank" rel="noopener noreferrer">
            {artist.name}
          </a>
        </div>
        <div>{(Math.pow(similarityToTargetPoint, 2) * 100).toFixed(0)}% Match</div>
        <div className="similarity-bar-container">
          <SimilarityBar
            pos={similarityBarPos}
            artist1Name={artist1Name}
            artist2Name={artist2Name}
          />
        </div>
      </div>
      <TopTracks tracks={topTracks} playing={playing} setPlaying={setPlaying} />
    </div>
  );
};

const ArtistSimilarities: React.FC<{ similarity: number }> = ({ similarity }) => (
  <div className="artist-similarities">
    <h2>
      These artists are{' '}
      <b style={{ fontSize: 29 }}>{(Math.pow(similarity, 1.8) * 100).toFixed(0)}%</b> similar
    </h2>
  </div>
);

interface AverageArtistsListingProps {
  artistSpotifyIDs: [string, string];
  artist1Name: string;
  artist2Name: string;
}

const AverageArtistsListing: React.FC<AverageArtistsListingProps> = ({
  artistSpotifyIDs: [artist1ID, artist2ID],
  artist1Name,
  artist2Name,
}) => {
  const [playing, setPlaying] = useState<string | false>(false);
  const { data: averageArtists, error } = useQuery(
    ['averageArtists', artist1ID, artist2ID],
    ({ queryKey: [, artist1ID, artist2ID] }) => getAverageArtists(artist1ID, artist2ID)
  );

  return (
    <div className="average-artists-listing">
      {averageArtists ? (
        <>
          <ArtistSimilarities similarity={averageArtists.similarity} />
          {averageArtists.artists.map((artist) => (
            <AverageArtistItem
              key={artist.artist.id}
              artist1Name={artist1Name}
              artist2Name={artist2Name}
              playing={playing}
              setPlaying={setPlaying}
              {...artist}
            />
          ))}
        </>
      ) : null}
      {!averageArtists && !error ? <Loading /> : null}
      {error ? (
        <div className="error">Nothing found for these artists; try choosing some others</div>
      ) : null}
    </div>
  );
};

export default AverageArtistsListing;

import { withMobileProp } from 'ameo-utils/dist/responsive';
import React, { useState } from 'react';
import { useQuery } from 'react-query';
import { useRouteMatch } from 'react-router';
import { Link } from 'react-router-dom';

import { fetchComparison } from 'src/api';
import { ImageBoxGrid, Artist as ArtistCard, Track as TrackCard } from 'src/Cards';
import './Compare.scss';

const CompareInner: React.FC<{ mobile: boolean }> = ({ mobile }) => {
  const {
    params: { user1, user2 },
  } = useRouteMatch<{ user1: string; user2: string }>();
  const [playing, setPlaying] = useState<string | false>(false);

  const { data, error } = useQuery({
    queryKey: ['compare', user1, user2],
    queryFn: fetchComparison,
    config: { staleTime: Infinity, refetchOnMount: false },
  });

  if (error) {
    return (
      <div className="compare">
        There was an error fetching data for these users; try again later
      </div>
    );
  } else if (data === null) {
    return (
      <div className="compare">
        Data is missing for one or both of these users. In order for this tool to work, both users
        must have previously connected to Spotifytrack.
      </div>
    );
  } else if (data === undefined) {
    return <div className="compare loading">Loading...</div>;
  }

  return (
    <div className="compare">
      <h1>
        Shared Musical Interests between{' '}
        <Link to={`/stats/${user1}`}>
          <span className="username">{user1}</span>
        </Link>{' '}
        and{' '}
        <Link to={`/stats/${user2}`}>
          <span className="username">{user2}</span>
        </Link>
      </h1>

      <ImageBoxGrid
        renderItem={(i) => {
          const track = data.tracks[i];

          return (
            <TrackCard
              key={track.id}
              title={track.name}
              artists={track.album.artists}
              previewUrl={track.preview_url}
              imageSrc={track.album.images[0].url}
              playing={playing}
              setPlaying={setPlaying}
              mobile={mobile}
            />
          );
        }}
        getItemCount={() => data.tracks.length}
        initialItems={Math.min(mobile ? 9 : 10, data.tracks.length)}
        title="Tracks"
        disableTimeframes
      />

      <ImageBoxGrid
        renderItem={(i) => {
          const artist = data.artists[i];

          return (
            <ArtistCard
              name={artist.name}
              genres={artist.genres}
              imageSrc={artist.images[0]?.url}
              id={artist.id}
              mobile={mobile}
            />
          );
        }}
        getItemCount={() => data.artists.length}
        initialItems={Math.min(mobile ? 9 : 10, data.artists.length)}
        title="Artists"
        disableTimeframes
      />
    </div>
  );
};

const Compare = withMobileProp({ maxDeviceWidth: 800 })(CompareInner);

export default Compare;

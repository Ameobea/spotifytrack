import React, { useState } from 'react';

import { ReactRouterRouteProps, UserStats } from '../types';
import { useOnce } from '../util/hooks';
import { fetchUserStats } from '../api';
import { dispatch, actionCreators, useSelector } from 'src/store';
import { ImageBoxGrid, Artist, Track } from 'src/Cards';

const StatsDetails: React.FunctionComponent<{ stats: UserStats }> = ({ stats }) => {
  const [playing, setPlaying] = useState<string | false>(false);

  return (
    <div style={{ marginLeft: '15vw', marginRight: '15vw' }}>
      <ImageBoxGrid
        renderItem={(i, timeframe) => {
          const track = stats.tracks[timeframe][i];
          return (
            <Track
              title={track.name}
              artists={track.album.artists}
              previewUrl={track.preview_url}
              album={track.album.name}
              imageSrc={track.album.images[0].url}
              playing={playing}
              setPlaying={setPlaying}
            />
          );
        }}
        initialItems={10}
        maxItems={stats.tracks.short.length}
        title="Tracks"
      />

      <ImageBoxGrid
        renderItem={(i, timeframe) => {
          const artist = stats.artists[timeframe][i];
          return (
            <Artist
              name={artist.name}
              genres={artist.genres}
              imageSrc={artist.images[0].url}
              uri={artist.uri}
            />
          );
        }}
        initialItems={10}
        maxItems={stats.artists.short.length}
        title="Artists"
      />
    </div>
  );
};

const Stats: React.FunctionComponent<ReactRouterRouteProps> = ({
  match: {
    params: { username },
  },
}) => {
  const statsForUser = useSelector(({ userStats }) => userStats[username]);

  useOnce(async () => {
    if (!statsForUser) {
      const userStats = await fetchUserStats(username);
      dispatch(actionCreators.userStats.ADD_USER_STATS(username, userStats)); // TODO
    }
  });

  return (
    <main>
      <h1>
        User stats for <b>{username}</b>
        {statsForUser ? (
          <StatsDetails stats={statsForUser} />
        ) : (
          <>
            <br />
            <br />
            Loading...
          </>
        )}
      </h1>
    </main>
  );
};

export default Stats;

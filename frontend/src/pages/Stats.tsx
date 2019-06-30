import React, { useState } from 'react';
import * as R from 'ramda';
import { Link } from 'react-router-dom';
import { PropTypesOf } from 'ameo-utils/dist/util/react';

import { ReactRouterRouteProps, UserStats, TimeFrames, Track, Artist } from 'src/types';
import { useOnce } from 'src/util/hooks';
import { fetchUserStats } from 'src/api';
import { mapObj } from 'src/util';
import { dispatch, actionCreators, useSelector } from 'src/store';
import { ImageBoxGrid, Artist as ArtistCard, Track as TrackCard } from 'src/Cards';
import ArtistStats from 'src/pages/ArtistStats';
import Loading from 'src/components/Loading';
import './Stats.scss';
import { useUsername } from 'src/store/selectors';

export const ArtistCards: React.FC<
  {
    horizontallyScrollable?: boolean;
  } & Partial<PropTypesOf<typeof ImageBoxGrid>>
> = ({ horizontallyScrollable, ...props }) => {
  const { artistsCorpus } = useSelector(({ entityStore: { tracks, artists } }) => ({
    tracksCorpus: tracks,
    artistsCorpus: artists,
  }));
  const username = useUsername()!;
  const stats = useSelector(({ userStats }) => userStats[username]);

  if (!stats) {
    return <Loading />;
  }

  return (
    <ImageBoxGrid
      horizontallyScrollable={horizontallyScrollable}
      renderItem={(i, timeframe) => {
        const artistId = stats.artists[timeframe][i];
        if (!artistId) {
          return null;
        }
        const artist = artistsCorpus[artistId];
        if (!artist) {
          console.error(`No artist metadata for artist ${artistId}`);
          return null;
        }

        return (
          <ArtistCard
            name={artist.name}
            genres={artist.genres}
            imageSrc={artist.images[0].url}
            uri={artist.uri}
            id={artist.id}
          />
        );
      }}
      getItemCount={timeframe => stats.artists[timeframe].length}
      initialItems={10}
      title="Artists"
      {...props}
    />
  );
};

const StatsDetails: React.FunctionComponent<{ stats: UserStats }> = ({ stats }) => {
  const { tracksCorpus } = useSelector(({ entityStore: { tracks, artists } }) => ({
    tracksCorpus: tracks,
    artistsCorpus: artists,
  }));
  const [playing, setPlaying] = useState<string | false>(false);

  return (
    <div className="details">
      <ImageBoxGrid
        renderItem={(i, timeframe) => {
          const trackId = stats.tracks[timeframe][i];
          if (!trackId) {
            return null;
          }
          const track = tracksCorpus[trackId];

          return (
            <TrackCard
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
        getItemCount={timeframe => stats.tracks[timeframe].length}
        initialItems={10}
        title="Tracks"
      />

      <ArtistCards />
    </div>
  );
};

const Stats: React.FunctionComponent<ReactRouterRouteProps> = ({
  match,
  match: {
    params: { username },
  },
}) => {
  const statsForUser = useSelector(({ userStats }) => userStats[username]);

  useOnce(async () => {
    if (statsForUser && statsForUser.tracks && statsForUser.artists) {
      return;
    }

    const {
      last_update_time,
      tracks,
      artists,
    }: {
      last_update_time: string;
      tracks: TimeFrames<Track>;
      artists: TimeFrames<Artist>;
    } = await fetchUserStats(username);

    dispatch(
      actionCreators.entityStore.ADD_TRACKS(
        R.flatten(Object.values(tracks)).reduce(
          (acc: { [trackId: string]: Track }, datum: Track) => ({ ...acc, [datum.id]: datum }),
          {}
        )
      )
    );
    dispatch(
      actionCreators.entityStore.ADD_ARTISTS(
        R.flatten(Object.values(artists)).reduce(
          (acc: { [artistId: string]: Artist }, datum: Artist) => ({ ...acc, [datum.id]: datum }),
          {}
        )
      )
    );
    dispatch(
      actionCreators.userStats.ADD_USER_STATS(username, {
        last_update_time,
        // TODO: Fix this type hackery when you're less lazy and ennui-riddled
        tracks: mapObj((tracks as any) as { [key: string]: { id: string }[] }, tracks =>
          tracks.map(R.prop('id'))
        ) as any,
        artists: mapObj((artists as any) as { [key: string]: { id: string }[] }, artists =>
          artists.map(R.prop('id'))
        ) as any,
        artistStats: {},
      })
    );
  });

  return (
    <main className="stats">
      <span className="headline">
        User stats for{' '}
        <Link to={`/stats/${username}/`}>
          <span className="username">{username}</span>
        </Link>
      </span>

      {statsForUser && statsForUser.tracks && statsForUser.artists ? (
        <>
          {match.params.artistId ? (
            <ArtistStats match={match} />
          ) : (
            <StatsDetails stats={statsForUser} />
          )}
        </>
      ) : (
        <>
          <br />
          <br />
          <Loading />
        </>
      )}
    </main>
  );
};

export default Stats;

import React, { useState } from 'react';
import * as R from 'ramda';
import { Link } from 'react-router-dom';
import { PropTypesOf } from 'ameo-utils/dist/util/react';
import { withMobileProp } from 'ameo-utils/dist/responsive';

import { ReactRouterRouteProps, UserStats, TimeFrames, Track, Artist, ValueOf } from 'src/types';
import { useOnce } from 'src/util/hooks';
import { fetchUserStats } from 'src/api';
import { mapObj } from 'src/util';
import { dispatch, actionCreators, useSelector, UserStatsState } from 'src/store';
import { ImageBoxGrid, Artist as ArtistCard, Track as TrackCard } from 'src/Cards';
import ArtistStats from 'src/pages/ArtistStats';
import GenreStats from 'src/pages/GenreStats';
import Loading from 'src/components/Loading';
import GenresTreemap from 'src/components/GenresTreemap';
import { useUsername } from 'src/store/selectors';
import Timeline from 'src/components/Timeline';
import './Stats.scss';

export const ArtistCards: React.FC<
  {
    horizontallyScrollable?: boolean;
    mobile: boolean;
  } & Partial<PropTypesOf<typeof ImageBoxGrid>>
> = ({ horizontallyScrollable, mobile, ...props }) => {
  const { artistsCorpus } = useSelector(({ entityStore: { artists } }) => ({
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
        if (!stats.artists) {
          return null;
        }
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
            imageSrc={artist.images[0]?.url}
            // uri={artist.uri}
            id={artist.id}
          />
        );
      }}
      getItemCount={(timeframe) => (stats.artists ? stats.artists[timeframe].length : 0)}
      initialItems={mobile ? 9 : 10}
      title="Artists"
      {...props}
    />
  );
};

const StatsDetailsInner: React.FC<{ stats: UserStats; mobile: boolean }> = ({ stats, mobile }) => {
  const { tracksCorpus } = useSelector(({ entityStore: { tracks, artists } }) => ({
    tracksCorpus: tracks,
    artistsCorpus: artists,
  }));
  const [playing, setPlaying] = useState<string | false>(false);

  return (
    <div className="details">
      <ImageBoxGrid
        renderItem={(i, timeframe) => {
          if (!stats.tracks) {
            return null;
          }
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
              imageSrc={track.album.images[0].url}
              playing={playing}
              setPlaying={setPlaying}
            />
          );
        }}
        getItemCount={(timeframe) => (stats.tracks ? stats.tracks[timeframe].length : 0)}
        initialItems={mobile ? 9 : 10}
        title="Tracks"
      />

      <ArtistCards mobile={mobile} />

      <Timeline />

      <h3 className="image-box-grid-title">Top Genres</h3>
      <GenresTreemap />
    </div>
  );
};

const StatsDetails = withMobileProp({ maxDeviceWidth: 800 })(StatsDetailsInner);

const StatsContent: React.FC<
  { username: string; statsForUser: ValueOf<UserStatsState> } & Pick<ReactRouterRouteProps, 'match'>
> = ({ match, username, statsForUser }) => {
  if (match.params.artistId) {
    return <ArtistStats match={match} />;
  } else if (match.params.genre) {
    return <GenreStats username={username} genre={match.params.genre} />;
  } else {
    return <StatsDetails stats={statsForUser!} />;
  }
};

const Stats: React.FC<ReactRouterRouteProps> = ({
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
        tracks: mapObj((tracks as any) as { [key: string]: { id: string }[] }, (tracks) =>
          tracks.map(R.prop('id'))
        ) as any,
        artists: mapObj((artists as any) as { [key: string]: { id: string }[] }, (artists) =>
          artists.map(R.prop('id'))
        ) as any,
        artistStats: {},
      })
    );
  });

  return (
    <main className="stats">
      <div className="headline-wrapper">
        <span className="headline" style={{ textAlign: 'center', marginBottom: -62 }}>
          User stats for{' '}
          <Link to={`/stats/${username}/`} style={{ textDecorationColor: '#ddd' }}>
            <span className="username">{username}</span>
          </Link>
        </span>
      </div>

      {statsForUser && statsForUser.tracks && statsForUser.artists ? (
        <StatsContent username={username} match={match} statsForUser={statsForUser} />
      ) : (
        <Loading style={{ marginTop: 100 }} />
      )}
    </main>
  );
};

export default Stats;

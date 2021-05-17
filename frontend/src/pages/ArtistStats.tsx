import React, { useMemo, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import * as R from 'ramda';
import { withMobileProp } from 'ameo-utils/dist/responsive';

import { useSelector, dispatch, actionCreators } from 'src/store';
import { ReactRouterRouteProps, ArtistStats as ArtistStatsType, Artist } from 'src/types';
import { fetchArtistStats } from 'src/api';
import { colors } from 'src/style';
import Loading from 'src/components/Loading';
import { LineChart, BarChart } from 'src/components/Charts';
import { ArtistCards } from 'src/pages/Stats';
import './ArtistStats.scss';
import { useUsername } from 'src/store/selectors';

const GenreChip: React.FC<{ username: string; genre: string }> = ({ username, genre }) => (
  <Link className="genre-chip-link" to={`/stats/${username}/genre/${genre}/`}>
    <div className="genre-chip">{genre}</div>
  </Link>
);

const GenresListing: React.FC<{ genres: string[]; username: string }> = ({ username, genres }) => (
  <div className="genres-listing">
    {genres.map((genre) => (
      <GenreChip key={genre} username={username} genre={genre} />
    ))}
  </div>
);

interface TopContentProps {
  mobile: boolean;
  artistStats: ArtistStatsType | undefined;
  series:
    | {
        name: string;
        data: [Date, number | null][];
      }[]
    | null;
  artist: Artist | undefined;
  username: string;
}

const TopContent: React.FC<TopContentProps> = ({
  artistStats,
  series,
  artist,
  mobile,
  username,
}) => {
  if (!artistStats || !series) {
    return <Loading style={{ height: 300, marginTop: 140 }} />;
  }

  if (!R.isEmpty(artistStats.topTracks) && !R.isEmpty(artistStats.popularityHistory)) {
    return (
      <>
        <p>Top genres:</p>
        <GenresListing username={username} genres={artist!.genres} />

        <LineChart
          style={{ height: 300 }}
          series={series}
          otherConfig={{
            title: { text: mobile ? '' : `Popularity History for ${artist!.name}` },
            grid: { bottom: mobile ? 48 : 60 },
            xAxis: {
              type: 'time',
              name: 'Update Time',
              nameLocation: 'center',
              nameGap: mobile ? 15 : 28,
              nameTextStyle: {
                color: '#ccc',
                fontSize: mobile ? 10 : 14,
                padding: mobile ? 16 : 12,
              },
            },
            yAxis: {
              type: 'value',
              inverse: true,
              name: 'Popularity Ranking',
              nameLocation: 'middle',
              nameGap: 50,
              nameTextStyle: {
                color: '#ccc',
                fontSize: 14,
              },
            },
            tooltip: { trigger: 'axis' },
          }}
        />
      </>
    );
  }

  return (
    <div
      style={{
        marginTop: mobile ? 140 : 100,
        marginBottom: 0,
        fontSize: mobile ? 18 : 23,
        textAlign: 'center',
        height: 363,
      }}
    >
      No stats were found for this artist.
      <br />
      If you&apos;ve listened to them for the first time recently, it may take a day or two for them
      to show up here due to Spotify&apos;s delay in reporting stats
    </div>
  );
};

interface BottomContentProps {
  mobile: boolean;
  artistStats: ArtistStatsType | undefined;
}

const BottomContent: React.FC<BottomContentProps> = ({ artistStats, mobile }) => {
  const topTracksCorpus = useSelector(({ entityStore: { tracks } }) =>
    artistStats?.topTracks ? R.pick(artistStats.topTracks.map(R.prop('trackId')), tracks) : null
  );

  if (!artistStats?.topTracks || !topTracksCorpus) {
    return <Loading style={{ height: 400 }} />;
  } else if (R.isEmpty(artistStats.topTracks)) {
    return <div style={{ textAlign: 'center' }}>No top tracks available for artist</div>;
  }

  return (
    <BarChart
      mobile={mobile}
      data={artistStats.topTracks.map(R.prop('score'))}
      categories={artistStats.topTracks.map(({ trackId }) => topTracksCorpus[trackId].name)}
      style={{ height: 400, width: '100%' }}
      otherConfig={{
        xAxis: { axisLabel: { interval: 0, rotate: 70 } },
        grid: { bottom: 200 },
      }}
    />
  );
};

const ArtistStats: React.FC<ReactRouterRouteProps & { mobile: boolean }> = ({ match, mobile }) => {
  const { username, artistId } = match.params;
  const artistStats: ArtistStatsType | undefined = useSelector(({ userStats }) =>
    R.path([username, 'artistStats', artistId], userStats)
  );
  const artist = useSelector(({ entityStore: { artists } }) => artists[artistId]);
  const { displayName } = useUsername();

  const series = useMemo(
    () =>
      artistStats
        ? ['Short', 'Medium', 'Long'].map((name, i) => ({
            name,
            data: artistStats.popularityHistory.map(({ timestamp, popularityPerTimePeriod }): [
              Date,
              number | null
            ] => [timestamp, popularityPerTimePeriod[i]]),
          }))
        : null,
    [artistStats]
  );
  console.log({ series, artistStats });

  const fetchedStatsFor = useRef<string | null>(null);
  useEffect(() => {
    if (fetchedStatsFor.current === artistId || !!series) {
      return;
    }

    fetchedStatsFor.current = artistId;
    (async () => {
      try {
        const res = await fetchArtistStats(username, artistId);
        if (!res) {
          console.warn(`No history found for artist id ${artistId} user ${username}`);
          dispatch(actionCreators.entityStore.ADD_TRACKS({}));
          dispatch(actionCreators.userStats.SET_ARTIST_STATS(username, artistId, [], []));
          return;
        }

        const { artist, top_tracks, popularity_history, tracks_by_id } = res;

        console.log('dispatching');
        dispatch(actionCreators.entityStore.ADD_TRACKS(tracks_by_id));
        dispatch(actionCreators.entityStore.ADD_ARTISTS({ [artist.id]: artist }));
        dispatch(
          actionCreators.userStats.SET_ARTIST_STATS(
            username,
            artistId,
            top_tracks.map(([trackId, score]) => ({ trackId, score })),
            popularity_history.map(([timestamp, popularityPerTimePeriod]) => ({
              timestamp: new Date(timestamp),
              popularityPerTimePeriod,
            }))
          )
        );
      } catch (err) {
        console.error(
          `Error fetching artist history for artist id ${artistId} user ${username}: `,
          err
        );
        dispatch(actionCreators.entityStore.ADD_TRACKS({}));
        dispatch(actionCreators.userStats.SET_ARTIST_STATS(username, artistId, [], []));
      }
    })();
  });

  return (
    <div className="artist-stats">
      {artist ? (
        <h1 style={mobile ? { marginTop: mobile ? 42 : 32 } : undefined}>
          <Link to={`/stats/${username}`}>{displayName}</Link>&apos;s artist stats for{' '}
          <span style={{ color: colors.pink }}> {artist.name}</span>
        </h1>
      ) : null}

      <TopContent
        artist={artist}
        mobile={mobile}
        username={username}
        artistStats={artistStats}
        series={series}
      />

      <ArtistCards
        mobile={mobile}
        disableHeader
        hideShowMore
        style={{ width: '100%', paddingTop: 30, paddingBottom: 30 }}
        initialItems={100}
        horizontallyScrollable
      />

      <BottomContent mobile={mobile} artistStats={artistStats} />
    </div>
  );
};

export default withMobileProp({ maxDeviceWidth: 800 })(ArtistStats);

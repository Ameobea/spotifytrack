import React, { useMemo } from 'react';
import * as R from 'ramda';

import { useSelector, dispatch, actionCreators } from 'src/store';
import { useOnce } from 'src/util/hooks';
import { ReactRouterRouteProps, ReduxStore, ValueOf, Track, Artist } from 'src/types';
import { fetchArtistStats } from 'src/api';
import { colors } from 'src/style';
import Loading from 'src/components/Loading';
import LineChart from 'src/components/LineChart';

const ArtistStats: React.FC<ReactRouterRouteProps> = ({ match }) => {
  const [username, artistId] = [match.params.username, match.params.artistId];
  const artistStats:
    | ValueOf<NonNullable<ValueOf<ReduxStore['userStats']>>['artistStats']>
    | undefined = useSelector(({ userStats }) =>
    R.path([username, 'artistStats', artistId], userStats)
  );
  const artist = useSelector(
    ({ entityStore: { artists } }) => artists[artistId] as Artist | undefined
  );

  const series = useMemo(
    () =>
      artistStats
        ? ['Short', 'Medium', 'Long'].map((name, i) => ({
            name,
            data: artistStats.popularityHistory.map(
              ({ timestamp, popularityPerTimePeriod }): [Date, number | null] => [
                timestamp,
                popularityPerTimePeriod[i],
              ]
            ),
          }))
        : null,
    [artistStats]
  );

  useOnce(() => {
    if (artistStats) {
      return;
    }

    (async () => {
      const {
        artist,
        top_tracks,
        popularity_history,
        tracks_by_id,
      }: {
        artist: Artist;
        top_tracks: [string, number][]; // (trackId, score)
        popularity_history: [string, [number | null, number | null, number | null]][]; // (timestamp string, [short_ranking, medium_ranking, long_ranking])
        tracks_by_id: { [trackId: string]: Track };
      } = await fetchArtistStats(username, artistId);

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
    })();
  });

  if (!artistStats || !artist || !series) {
    return <Loading />;
  }

  return (
    <>
      <h1>
        Artist stats for <span style={{ color: colors.pink }}> {artist.name}</span>
      </h1>

      <LineChart
        style={{ maxWidth: 800 }}
        series={series}
        otherConfig={{
          title: { text: `Popularity History for ${artist.name}` },
          xAxis: {
            type: 'time',
            name: 'Update Time',
            nameLocation: 'center',
            nameTextStyle: {
              color: '#ccc',
              fontSize: 14,
              padding: 12,
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
};

export default ArtistStats;

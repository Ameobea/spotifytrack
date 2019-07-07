import React, { useMemo, useRef, useEffect } from 'react';
import * as R from 'ramda';

import { useSelector, dispatch, actionCreators } from 'src/store';
import { ReactRouterRouteProps, ReduxStore, ValueOf, Track, Artist } from 'src/types';
import { fetchArtistStats } from 'src/api';
import { colors } from 'src/style';
import Loading from 'src/components/Loading';
import { LineChart, BarChart } from 'src/components/Charts';
import { ArtistCards } from 'src/pages/Stats';

const ArtistStats: React.FC<ReactRouterRouteProps> = ({ match }) => {
  const [username, artistId] = [match.params.username, match.params.artistId];
  const artistStats:
    | ValueOf<NonNullable<ValueOf<ReduxStore['userStats']>>['artistStats']>
    | undefined = useSelector(({ userStats }) =>
    R.path([username, 'artistStats', artistId], userStats)
  );
  const artist = useSelector(({ entityStore: { artists } }) => artists[artistId]);
  const topTracksCorpus = useSelector(({ entityStore: { tracks } }) =>
    artistStats && artistStats.topTracks
      ? R.pick(artistStats.topTracks.map(R.prop('trackId')), tracks)
      : null
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

  const fetchedStatsFor = useRef<string | null>(null);
  useEffect(() => {
    if (fetchedStatsFor.current === artistId || !!series) {
      return;
    }

    fetchedStatsFor.current = artistId;
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

  return (
    <div
      style={{
        marginLeft: 'auto',
        marginRight: 'auto',
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minWidth: 800,
      }}
    >
      {!artistStats || !artist || !series ? (
        <Loading style={{ height: 300 + 85 }} />
      ) : (
        <>
          <h1>
            Artist stats for <span style={{ color: colors.pink }}> {artist.name}</span>
          </h1>

          <LineChart
            style={{ height: 300 }}
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
      )}

      <ArtistCards
        disableHeader
        hideShowMore
        style={{ width: '80vw', paddingTop: 30, paddingBottom: 30 }}
        initialItems={100}
        horizontallyScrollable
      />

      {artistStats && artistStats.topTracks && topTracksCorpus ? (
        <>
          {R.isEmpty(artistStats.topTracks) ? (
            <div style={{ textAlign: 'center' }}>No top tracks available for artist</div>
          ) : (
            <BarChart
              data={artistStats.topTracks.map(R.prop('score'))}
              categories={artistStats.topTracks.map(({ trackId }) => topTracksCorpus[trackId].name)}
              style={{ height: 400 }}
              otherConfig={{
                xAxis: {
                  axisLabel: {
                    interval: 0,
                    rotate: 70,
                  },
                },
                grid: {
                  bottom: 200,
                },
              }}
            />
          )}
        </>
      ) : (
        <Loading style={{ height: 400 }} />
      )}
    </div>
  );
};

export default ArtistStats;

import React from 'react';
import * as R from 'ramda';

import { useSelector, dispatch, actionCreators } from 'src/store';
import { useOnce } from 'src/util/hooks';
import { ReactRouterRouteProps, ReduxStore, ValueOf, Track } from 'src/types';
import { fetchArtistStats } from 'src/api';
import Loading from 'src/components/Loading';

const ArtistStats: React.FC<ReactRouterRouteProps> = ({ match }) => {
  const [username, artistId] = [match.params.username, match.params.artistId];
  const artistStats:
    | ValueOf<NonNullable<ValueOf<ReduxStore['userStats']>>['artistStats']>
    | undefined = useSelector(({ userStats }) =>
    R.path([username, 'artistStats', artistId], userStats)
  );

  useOnce(() => {
    if (artistStats) {
      return;
    }

    (async () => {
      const {
        top_tracks,
        popularity_history,
        tracks_by_id,
      }: {
        top_tracks: [string, number][]; // (trackId, score)
        popularity_history: [string, [number | null, number | null, number | null]][]; // (timestamp string, [short_ranking, medium_ranking, long_ranking])
        tracks_by_id: { [trackId: string]: Track };
      } = await fetchArtistStats(username, artistId);

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
      dispatch(actionCreators.entityStore.ADD_TRACKS(tracks_by_id));
    })();
  });

  if (!artistStats) {
    return <Loading />;
  }

  return <div>TODO</div>;
};

export default ArtistStats;

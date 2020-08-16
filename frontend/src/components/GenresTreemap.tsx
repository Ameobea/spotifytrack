import React from 'react';
import { Option } from 'funfix-core';
import * as R from 'ramda';
import { useOnChange } from 'ameo-utils/dist/util/react';

import { Treemap } from 'src/components/Charts';
import { useSelector, actionCreators, dispatch } from 'src/store';
import Loading from 'src/components/Loading';
import { useUsername } from 'src/store/selectors';
import { fetchGenreHistory } from 'src/api';
import { withMobileProp } from 'ameo-utils/dist/responsive';

const GenresTreemap: React.FC<{ mobile: boolean }> = ({ mobile }) => {
  const username = useUsername();

  useOnChange(username, async (username: string | null) => {
    if (!username) {
      return;
    }

    const {
      timestamps,
      history_by_genre: popularityByGenre,
    }: {
      timestamps: string[];
      history_by_genre: { [genre: string]: (number | null)[] };
    } = await fetchGenreHistory(username);

    dispatch(
      actionCreators.userStats.SET_GENRE_HISTORY(username, {
        popularityByGenre,
        timestamps: timestamps.map((ts) => new Date(ts)),
      })
    );
  });

  const genrePopularityHistory = useSelector(({ userStats }) => {
    if (!username) {
      return null;
    }

    return Option.of(userStats[username])
      .flatMap((stats) => Option.of(stats.genreHistory))
      .orNull();
  });

  if (!username) {
    return null;
  }

  if (!genrePopularityHistory) {
    return <Loading />;
  }

  return (
    <Treemap
      data={Object.entries(genrePopularityHistory.popularityByGenre).map(([genre, scores]) => ({
        name: genre,
        value: R.last(scores),
      }))}
      style={{ height: mobile ? 'max(30vh, 300px)' : 'max(68vh, 400px)' }}
    />
  );
};

export default withMobileProp({ maxDeviceWidth: 800 })(GenresTreemap);

import React from 'react';

import { ReactRouterRouteProps } from '../types';
import { useOnce } from '../util/hooks';
import { fetchUserStats } from '../api';
import { dispatch, actionCreators, useSelector } from 'src/store';

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
      </h1>
    </main>
  );
};

export default Stats;

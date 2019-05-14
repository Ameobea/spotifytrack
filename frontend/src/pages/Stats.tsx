import React from 'react';
import { useSelector, useDispatch } from 'react-redux';

import { Store, ReactRouterRouteProps } from '../types';
import { useOnce } from '../util/hooks';

const fetchUserStats = async username => {
  // TODO;
};

const Stats: React.FunctionComponent<ReactRouterRouteProps> = ({
  match: {
    params: { username },
  },
}) => {
  const statsForUser = useSelector(({ userStats }: Store) => userStats.users[username]);

  const dispatch = useDispatch();
  useOnce(async () => {
    if (!statsForUser) {
      const userStats = await fetchUserStats(username);
      dispatch({ type: 'TODO' }); // TODO
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

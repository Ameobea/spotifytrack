import * as R from 'ramda';
import { buildStore, buildActionGroup, buildModule } from 'jantix';
import { createBrowserHistory } from 'history';
import { routerMiddleware, connectRouter } from 'connected-react-router';

import { UserStats } from '../types';

export const history = createBrowserHistory();

const customReducers = {
  router: connectRouter(history),
};

const middleware = routerMiddleware(history);

const userStats = {
  ADD_USER_STATS: buildActionGroup({
    actionCreator: (username: string, stats: UserStats) => ({
      type: 'ADD_USER_STATS',
      username,
      stats,
    }),
    subReducer: (state: { [username: string]: UserStats }, { username, stats }) => ({
      ...state,
      [username]: stats,
    }),
  }),
  CLEAR_USER_STATS: buildActionGroup({
    actionCreator: (username: string) => ({ type: 'CLEAR_USER_STATS', username }),
    subReducer: (state: { [username: string]: UserStats }, { username }) =>
      R.omit([username], state),
  }),
};

const jantixModules = {
  userStats: buildModule<{ [username: string]: UserStats | undefined }, typeof userStats>(
    {},
    userStats
  ),
};

export const { dispatch, getState, actionCreators, useSelector, store } = buildStore<
  typeof jantixModules,
  typeof customReducers
>(jantixModules, middleware, customReducers);

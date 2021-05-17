import * as R from 'ramda';
import { buildStore, buildActionGroup, buildModule } from 'jantix';
import { createBrowserHistory } from 'history';
import { routerMiddleware, connectRouter } from 'connected-react-router';

import { UserStats, Track, Artist } from '../types';

export const history = createBrowserHistory();

const customReducers = {
  router: connectRouter(history),
};

const middleware = routerMiddleware(history);

interface EntityStoreState {
  tracks: { [trackId: string]: Track };
  artists: { [artistId: string]: Artist | undefined };
  userDisplayNames: { [username: string]: string | null };
}

const entityStore = {
  ADD_TRACKS: buildActionGroup({
    actionCreator: (tracksById: { [trackId: string]: Track }) => ({
      type: 'ADD_TRACKS',
      tracks: tracksById,
    }),
    subReducer: (state: EntityStoreState, { tracks }) => ({
      ...state,
      tracks: { ...state.tracks, ...tracks },
    }),
  }),
  ADD_ARTISTS: buildActionGroup({
    actionCreator: (artistsById: { [artistId: string]: Artist }) => ({
      type: 'ADD_ARTISTS',
      artists: artistsById,
    }),
    subReducer: (state: EntityStoreState, { artists }) => ({
      ...state,
      artists: { ...state.artists, ...artists },
    }),
  }),
  ADD_USER_DISPLAY_NAME: buildActionGroup({
    actionCreator: (username: string, displayName: string | null) => ({
      type: 'ADD_USER_DISPLAY_NAME',
      username,
      displayName,
    }),
    subReducer: (state: EntityStoreState, { username, displayName }) => ({
      ...state,
      userDisplayNames: { ...state.userDisplayNames, [username]: displayName },
    }),
  }),
};

export interface UserStatsState {
  [username: string]: UserStats | undefined;
}

const userStats = {
  ADD_USER_STATS: buildActionGroup({
    actionCreator: (username: string, stats: UserStats) => ({
      type: 'ADD_USER_STATS',
      username,
      stats,
    }),
    subReducer: (state: UserStatsState, { username, stats }) => ({
      ...state,
      [username]: stats,
    }),
  }),
  CLEAR_USER_STATS: buildActionGroup({
    actionCreator: (username: string) => ({ type: 'CLEAR_USER_STATS', username }),
    subReducer: (state: UserStatsState, { username }) => R.omit([username], state),
  }),
  SET_ARTIST_STATS: buildActionGroup({
    actionCreator: (
      username: string,
      artistId: string,
      topTracks: { trackId: string; score: number }[],
      popularityHistory: {
        timestamp: Date;
        popularityPerTimePeriod: [number | null, number | null, number | null];
      }[]
    ) => ({ type: 'SET_ARTIST_STATS', username, artistId, topTracks, popularityHistory }),
    subReducer: (
      state: UserStatsState,
      { username, artistId, topTracks, popularityHistory }
    ): UserStatsState => {
      const existingUserStats: UserStats = state[username] || {};
      const existingArtistStats = existingUserStats.artistStats || {};

      return {
        ...state,
        [username]: {
          ...existingUserStats,
          artistStats: {
            ...existingArtistStats,
            [artistId]: {
              topTracks,
              popularityHistory,
            },
          },
        },
      };
    },
  }),
  SET_GENRE_HISTORY: buildActionGroup({
    actionCreator: (username: string, genreHistory: NonNullable<UserStats['genreHistory']>) => ({
      type: 'SET_GENRE_HISTORY',
      username,
      genreHistory,
    }),
    subReducer: (state: UserStatsState, { username, genreHistory }): UserStatsState => {
      const existingUserStats = state[username] || {};

      return {
        ...state,
        [username]: {
          ...existingUserStats,
          genreHistory,
        },
      };
    },
  }),
};

const jantixModules = {
  userStats: buildModule<UserStatsState, typeof userStats>({}, userStats),
  entityStore: buildModule<EntityStoreState, typeof entityStore>(
    { tracks: {}, artists: {}, userDisplayNames: {} },
    entityStore
  ),
};

export const { dispatch, getState, actionCreators, useSelector, store } = buildStore<
  typeof jantixModules,
  typeof customReducers
>(jantixModules, middleware, customReducers);

(window as any).getState = getState;
(window as any).dispatch = dispatch;
(window as any).actionCreators = actionCreators;

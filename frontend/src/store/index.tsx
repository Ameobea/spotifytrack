import { createBrowserHistory } from 'history';
import { applyMiddleware, compose, createStore, combineReducers } from 'redux';
import { routerMiddleware, connectRouter } from 'connected-react-router';

import userStatsReducer, { State as UserStatsState } from './reducers/userStats';

export const history = createBrowserHistory();

const composeEnhancers = (window as any).__REDUX_DEVTOOLS_EXTENSION_COMPOSE__ || compose;

const reducers = {
  router: connectRouter(history),
  userStats: userStatsReducer,
};

export const store = createStore(
  combineReducers(reducers),
  composeEnhancers(applyMiddleware(routerMiddleware(history)))
);

export interface Store {
  router: { [key: string]: any };
  userStats: UserStatsState;
}

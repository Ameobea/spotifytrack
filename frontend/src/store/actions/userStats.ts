import { ValueOf } from '../../types';

export const ADD_USER_STATS: 'ADD_USER_STATS' = 'ADD_USER_STATS';
export const addUserStats = (username: string, stats: UserStats) => ({
  type: ADD_USER_STATS,
  username,
  stats,
});

const CLEAR_ALL_USER_STATS: 'CLEAR_ALL_USER_STATS' = 'CLEAR_ALL_USER_STATS';
const clearAllUserStats = () => ({ type: CLEAR_ALL_USER_STATS });

export type ValueOf<T> = T[keyof T];

/**
 * HKT that, given a mapping with values that are functions, returns a type representing the full
 * set of possible return values from each function in that mapping.
 */
type ActionValuesOf<T extends { [name: string]: (...args: any[]) => any }> = ValueOf<
  { [K in keyof T]: ReturnType<T[K]> }
>;

/**
 * HKT that, given an object of action creators, returns the type of the reducer mapping that will
 * reduce the created actions.
 */
type SubReducersOf<
  Actions extends { [name: string]: (...args: any[]) => { type: any; [key: string]: any } }
> = {
  [T in ActionValuesOf<Actions>['type']]: (
    state: State,
    action: Extract<ActionValues, { type: T }>
  ) => State
};

// ------------------------------------------------------------------------------------------------

interface UserStats {
  username: string;
  displayName: string;
}

interface State {
  users: { [username: string]: UserStats };
}

const actions = {
  addUserStats,
  clearAllUserStats,
};

// ------------------------------------------------------------------------------------------------

type ActionValues = ActionValuesOf<typeof actions>;

// Derive the type for our subreducers mapping based off of the action creators object
type SubReducers = SubReducersOf<typeof actions>;

// ------------------------------------------------------------------------------------------------

const subReducers: SubReducers = {
  [ADD_USER_STATS]: (state, action) => ({
    users: { ...state.users, [action.username]: action.stats },
  }),
  [CLEAR_ALL_USER_STATS]: (_state, _action) => ({
    users: {},
  }),
};

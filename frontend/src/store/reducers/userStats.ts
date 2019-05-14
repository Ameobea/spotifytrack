interface UserStats {
  username: string;
  displayName: string;
}

export interface State {
  users: { [username: string]: UserStats };
}

const initialState: State = { users: {} };

const userStatsReducer = (state = initialState, action) => {
  const subReducer = {}[action.type];

  return subReducer ? subReducer(state) : state;
};

export default userStatsReducer;

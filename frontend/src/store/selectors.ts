import { getUserDisplayName } from 'src/api';
import { actionCreators, dispatch, useSelector } from './';

const combineWithDisplayName = (
  displayNamesByUsername: { [username: string]: string | null },
  username: string
): {
  username: string;
  displayName: string | null | undefined;
} => {
  const displayName: string | null | undefined = displayNamesByUsername[username];
  if (displayName === undefined) {
    dispatch(actionCreators.entityStore.ADD_USER_DISPLAY_NAME(username, null));

    getUserDisplayName(username).then((displayName) =>
      dispatch(actionCreators.entityStore.ADD_USER_DISPLAY_NAME(username, displayName))
    );
  }

  return { username, displayName: displayName };
};

export const useUsername = (username?: string) =>
  useSelector(
    ({
      router: {
        location: { pathname },
      },
      entityStore: { userDisplayNames: displayNamesByUsername },
    }) => {
      const match = pathname.match(/\/stats\/([^\/]+)\/?.*$/);
      if (match || username) {
        return combineWithDisplayName(displayNamesByUsername, username ?? match![1]);
      }

      const match2 = pathname.match(/\/compare\/([^\/]+)\/?.*/);
      if (match2) {
        return combineWithDisplayName(displayNamesByUsername, match2[1]);
      }

      return { username: null, displayName: null };
    }
  );

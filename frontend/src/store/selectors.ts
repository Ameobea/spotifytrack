import { getUserDisplayName } from 'src/api';
import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'react-router-dom';
import { actionCreators, dispatch, useSelector } from './';

const getUsernameFromPathname = (pathname: string): string | null => {
  const match = pathname.match(/\/stats\/([^\/]+)\/?.*$/);
  if (match) {
    return match[1];
  }

  const match2 = pathname.match(/\/compare\/([^\/]+)\/?.*/);
  if (match2) {
    return match2[1];
  }

  return null;
};

export const useUsername = (username?: string) => {
  const { pathname } = useLocation();
  const usernameFromRoute = getUsernameFromPathname(pathname);

  const resolvedUsername = username ?? usernameFromRoute;
  const displayName = useSelector(({ entityStore: { userDisplayNames } }) =>
    resolvedUsername ? userDisplayNames[resolvedUsername] : null
  );

  useEffect(() => {
    if (!resolvedUsername || displayName !== undefined) {
      return;
    }
    dispatch(actionCreators.entityStore.ADD_USER_DISPLAY_NAME(resolvedUsername, null));
  }, [resolvedUsername, displayName]);

  const { data: fetchedDisplayName, error: displayNameError } = useQuery({
    queryKey: ['displayName', resolvedUsername],
    queryFn: () => getUserDisplayName(resolvedUsername!),
    enabled: !!resolvedUsername && displayName === null,
    staleTime: Infinity,
    refetchOnMount: false,
  });
  useEffect(() => {
    if (!resolvedUsername || fetchedDisplayName === undefined) {
      return;
    }
    dispatch(actionCreators.entityStore.ADD_USER_DISPLAY_NAME(resolvedUsername, fetchedDisplayName));
  }, [resolvedUsername, fetchedDisplayName]);
  useEffect(() => {
    if (!resolvedUsername || !displayNameError) {
      return;
    }
    dispatch(actionCreators.entityStore.ADD_USER_DISPLAY_NAME(resolvedUsername, resolvedUsername));
  }, [resolvedUsername, displayNameError]);

  return { username: resolvedUsername, displayName };
};

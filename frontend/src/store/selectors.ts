import { useSelector } from './';

export const useUsername = () =>
  useSelector(({ router: { location: { pathname } } }) => {
    const match = pathname.match(/\/stats\/([^\/]+)\/?.*$/);
    return match ? match[1] : null;
  });

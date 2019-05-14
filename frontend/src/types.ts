export { Store } from './store';

export interface ReactRouterRouteProps {
  match: {
    params: { [key: string]: string };
  };
}

export interface ReactRouterRouteProps {
  match: {
    params: { [key: string]: string };
  };
}

export type ValueOf<T> = T[keyof T];

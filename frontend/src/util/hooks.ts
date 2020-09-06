import { useEffect, useRef } from 'react';
import { RouteComponentProps, useHistory } from 'react-router';

export const useOnce = (cb: () => void) => {
  const called = useRef(false);

  useEffect(() => {
    if (!called.current) {
      called.current = true;
      cb();
    }
  });
};

export type PushFn = RouteComponentProps['history']['push'];

export const usePush = () => {
  const history = useHistory();
  return history.push.bind(history);
};

import { useEffect, useRef } from 'react';
import { NavigateOptions, To, useNavigate } from 'react-router-dom';

export const useOnce = (cb: () => void) => {
  const called = useRef(false);

  useEffect(() => {
    if (!called.current) {
      called.current = true;
      cb();
    }
  });
};

export type PushFn = (to: To, options?: NavigateOptions) => void;

export const usePush = () => {
  const navigate = useNavigate();
  return navigate;
};

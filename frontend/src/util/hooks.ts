import { useEffect, useRef } from 'react';

export const useOnce = (cb: () => void) => {
  const called = useRef(false);

  useEffect(() => {
    if (!called.current) {
      called.current = true;
      cb();
    }
  });
};

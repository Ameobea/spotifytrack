import * as R from 'ramda';

export const mapObj = <T, T2>(
  obj: { [key: string]: T },
  pred: (x: T) => T2
): { [key: string]: T2 } =>
  Object.entries(obj).reduce((acc, [key, val]) => ({ ...acc, [key]: pred(val) }), {});

export const map = <T, T2>(x: T | null | undefined, pred: (x: T) => T2): T2 | null | undefined =>
  R.isNil(x) ? x : pred(x);

export const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

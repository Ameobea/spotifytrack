import * as R from 'ramda';

import { getSentry } from './sentry';
import { UnreachableException } from 'ameo-utils';

export const mapObj = <T, T2>(
  obj: { [key: string]: T },
  pred: (x: T) => T2
): { [key: string]: T2 } =>
  Object.entries(obj).reduce((acc, [key, val]) => ({ ...acc, [key]: pred(val) }), {});

export const map = <T, T2>(x: T | null | undefined, pred: (x: T) => T2): T2 | null | undefined =>
  R.isNil(x) ? x : pred(x);

export const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const clamp = (min: number, max: number, x: number) => Math.min(Math.max(min, x), max);

export async function retryRequest(req: () => Promise<Response>, retries = 18, delayMs = 300) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await req();
      if (res.ok || res.status === 404) {
        return res;
      }

      console.error(`Request failed: ${res.status} ${res.statusText}, attempt=${i + 1}`);
      getSentry()?.captureException(
        new Error(`Request failed: ${res.status} ${res.statusText}, attempt=${i + 1}, ${res.url}`)
      );
      if (i === retries - 1) {
        throw new Error('Failed to fetch after multiple attempts; status code=' + res.status);
      }
    } catch (e) {
      console.error('Bad response when making API request: ', e);
      if (i === retries - 1) {
        getSentry()?.captureException(e);
        throw e;
      }
    }

    await delay(delayMs * i);
  }

  throw new UnreachableException();
}

export const retryAsync = async <T>(
  fn: () => Promise<T>,
  attempts = 18,
  delayMs = 300
): Promise<T> => {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fn();
      return res;
    } catch (err) {
      if (i === attempts - 1) {
        // Out of attempts
        throw err;
      }

      await delay(delayMs);
    }
  }
  throw new UnreachableException();
};

export const makeRetryable =
  <Args extends any[], T>(fn: (...args: Args) => Promise<T>, attempts = 18, delayMs = 300) =>
  async (...args: Args) =>
    retryAsync(() => fn(...args), attempts, delayMs);

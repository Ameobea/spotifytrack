import * as Sentry from '@sentry/react';
import { Integrations } from '@sentry/tracing';

export const initSentry = () => {
  if (!window.location.host.includes('localhost')) {
    Sentry.init({
      dsn: 'https://d3ca8b37e2eb4573af6046aed3f62428@sentry.ameo.design/4',
      integrations: [new Integrations.BrowserTracing()],
      tracesSampleRate: 1,
    });
  }
};

export const getSentry = () => (window.location.host.includes('localhost') ? null : Sentry);

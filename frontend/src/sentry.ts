import * as Sentry from '@sentry/react';

export const initSentry = () => {
  if (!window.location.host.includes('localhost')) {
    Sentry.init({
      dsn: 'https://ec9bc1948e5fa979264ea96691dc2eda@sentry.ameo.design/2',
      integrations: [Sentry.captureConsoleIntegration({ levels: ['error'] })],
      tracesSampleRate: 1,
    });
  }
};

export const getSentry = () => (window.location.host.includes('localhost') ? null : Sentry);

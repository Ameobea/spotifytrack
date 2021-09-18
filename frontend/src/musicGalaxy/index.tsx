import ReactDOM from 'react-dom';
import React from 'react';
import { QueryClient, QueryClientProvider } from 'react-query';

import '../index.scss';
import './index.scss';
import ArtistMap from './ArtistMap';
import { initSentry } from 'src/sentry';

initSentry();

const reactQueryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false } },
});

initSentry();

ReactDOM.createRoot(document.getElementById('root')).render(
  <QueryClientProvider client={reactQueryClient}>
    <ArtistMap />
  </QueryClientProvider>
);

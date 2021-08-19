import ReactDOM from 'react-dom';
import React from 'react';
import { QueryClient, QueryClientProvider } from 'react-query';

import '../index.scss';
import './index.scss';
import ArtistAveragerRoot from './Root';
import { initSentry } from 'src/sentry';
import ArtistMap from './ArtistMap/ArtistMap';

const reactQueryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false } },
});

initSentry();

ReactDOM.createRoot(document.getElementById('root')).render(
  <QueryClientProvider client={reactQueryClient}>
    {/* <ArtistAveragerRoot /> */}
    <ArtistMap />
  </QueryClientProvider>
);

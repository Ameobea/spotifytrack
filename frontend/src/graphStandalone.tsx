import ReactDOM from 'react-dom';
import React from 'react';
import { QueryClient, QueryClientProvider } from 'react-query';
import { Provider } from 'react-redux';

import './index.scss';
import './graphStandalone.scss';
import { RelatedArtistsGraphForUser } from './components/RelatedArtistsGraph';
import { store } from 'src/store';
import { initSentry } from './sentry';

initSentry();

const reactQueryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false } },
});

const GraphStandalone: React.FC = () => {
  return (
    <div className="graph-standalone">
      <RelatedArtistsGraphForUser fullHeight username="ameobea" />
    </div>
  );
};

ReactDOM.createRoot(document.getElementById('root')).render(
  <Provider store={store}>
    <QueryClientProvider client={reactQueryClient}>
      <GraphStandalone />
    </QueryClientProvider>
  </Provider>
);

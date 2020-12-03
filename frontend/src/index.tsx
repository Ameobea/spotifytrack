import React, { Suspense } from 'react';
import ReactDOM from 'react-dom';
import { Route, Switch } from 'react-router';
import { Provider } from 'react-redux';
import { ConnectedRouter } from 'connected-react-router';
import * as Sentry from '@sentry/react';
import { Integrations } from '@sentry/tracing';
import { ReactQueryConfigProvider } from 'react-query';

import Loading from 'src/components/Loading';
const LazyHome = import('src/pages/Home');
const LazyStats = import('src/pages/Stats');
const LazyCompare = import('./components/Compare');
import { history, store } from 'src/store';
import './index.scss';
import OAuthRedirect from './components/OAuthRedirect';
import Footer from './components/Footer';

Sentry.init({
  dsn: 'https://d3ca8b37e2eb4573af6046aed3f62428@sentry.ameo.design/4',
  integrations: [new Integrations.BrowserTracing()],
  tracesSampleRate: 0.1,
});

const [Home, Stats, Compare] = [LazyHome, LazyStats, LazyCompare].map((LazyPage) => {
  const Comp = React.lazy(() => LazyPage);
  const RenderComp = ({ ...props }: any) => <Comp {...props} />;
  return RenderComp;
});

const App = () => (
  <ConnectedRouter history={history}>
    <Suspense fallback={<Loading />}>
      <Switch>
        <Route exact path="/" render={Home} />
        <Route exact path="/stats/:username" component={Stats} />
        <Route exact path="/stats/:username/artist/:artistId" component={Stats} />
        <Route exact path="/stats/:username/genre/:genre" component={Stats} />
        <Route exact path="/compare/:user1/:user2" component={Compare} />
        <Route path="/connect" component={OAuthRedirect} />
      </Switch>
    </Suspense>
    <Footer />
  </ConnectedRouter>
);

ReactDOM.render(
  <Provider store={store}>
    <ReactQueryConfigProvider config={{ queries: { refetchOnWindowFocus: false } }}>
      <App />
    </ReactQueryConfigProvider>
  </Provider>,
  document.getElementById('root')!
);

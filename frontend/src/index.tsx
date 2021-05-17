import React, { Suspense } from 'react';
import ReactDOM from 'react-dom';
import { Route, Switch } from 'react-router';
import { Provider } from 'react-redux';
import { ConnectedRouter } from 'connected-react-router';
import { QueryClient, QueryClientProvider } from 'react-query';

import Loading from 'src/components/Loading';
import { history, store } from 'src/store';
import './index.scss';
import OAuthRedirect from './components/OAuthRedirect';
import Footer from './components/Footer';
import Home from 'src/pages/Home';
import CompareToLanding from './pages/CompareToLanding';
import { initSentry } from './sentry';

initSentry();

const [Stats, Compare] = [
  () => import('src/pages/Stats'),
  () => import('./components/Compare'),
].map((doImport) => {
  const Comp = React.lazy(doImport);
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
        <Route exact path="/compare/:username" component={CompareToLanding} />
        <Route exact path="/compare/:user1/:user2" component={Compare} />
        <Route path="/connect" component={OAuthRedirect} />
      </Switch>
    </Suspense>
    <Footer />
  </ConnectedRouter>
);

const reactQueryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false } },
});

ReactDOM.render(
  <Provider store={store}>
    <QueryClientProvider client={reactQueryClient}>
      <App />
    </QueryClientProvider>
  </Provider>,
  document.getElementById('root')!
);

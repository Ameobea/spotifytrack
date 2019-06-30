import React, { Suspense } from 'react';
import ReactDOM from 'react-dom';
import { Route, Switch } from 'react-router';
import { Provider } from 'react-redux';
import { ConnectedRouter } from 'connected-react-router';

import { API_BASE_URL } from 'src/conf';
import Loading from 'src/components/Loading';
const LazyHome = import('src/pages/Home');
const LazyStats = import('src/pages/Stats');
import { history, store } from 'src/store';
import './index.scss';

const [Home, Stats] = [LazyHome, LazyStats].map(LazyPage => {
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
        <Route
          path="/connect"
          component={() => {
            window.location.href = `${API_BASE_URL}/authorize`;
            return null;
          }}
        />
      </Switch>
    </Suspense>
  </ConnectedRouter>
);

ReactDOM.render(
  <Provider store={store}>
    <App />
  </Provider>,
  document.getElementById('root')!
);

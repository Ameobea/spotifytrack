import React, { Suspense } from 'react';
import ReactDOM from 'react-dom';
import { Route, Switch } from 'react-router';
import { Provider } from 'react-redux';
import { ConnectedRouter } from 'connected-react-router';

const LazyHome = import('./pages/Home');
const LazyStats = import('./pages/Stats');
import { history, store } from './store';
import './index.scss';

const [Home, Stats] = [LazyHome, LazyStats].map(LazyPage => {
  const Comp = React.lazy(() => LazyPage);
  const RenderComp = ({ ...props }: any) => <Comp {...props} />;
  return RenderComp;
});

const Loading = () => <h2>Loading...</h2>;

const App = () => (
  <ConnectedRouter history={history}>
    <Suspense fallback={<Loading />}>
      <Switch>
        <Route exact path="/" render={Home} />
        <Route exact path="/stats/:username" component={Stats} />
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

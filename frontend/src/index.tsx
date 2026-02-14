import React, { Suspense } from 'react';
import ReactDOM from 'react-dom';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Provider } from 'react-redux';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import Loading from 'src/components/Loading';
import { store } from 'src/store';
import './index.css';
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
  const RenderComp = () => <Comp />;
  return RenderComp;
});

const App = () => (
  <BrowserRouter>
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/stats/:username" element={<Stats />} />
        <Route path="/stats/:username/artist/:artistId" element={<Stats />} />
        <Route path="/stats/:username/genre/:genre" element={<Stats />} />
        <Route path="/compare/:username" element={<CompareToLanding />} />
        <Route path="/compare/:user1/:user2" element={<Compare />} />
        <Route path="/connect" element={<OAuthRedirect />} />
      </Routes>
    </Suspense>
    <Footer />
  </BrowserRouter>
);

const reactQueryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false } },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <Provider store={store}>
    <QueryClientProvider client={reactQueryClient}>
      <App />
    </QueryClientProvider>
  </Provider>
);

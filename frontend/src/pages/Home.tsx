import React from 'react';
import { Link } from 'react-router-dom';

import { ReactRouterRouteProps } from '../types';

const Home: React.FunctionComponent<ReactRouterRouteProps> = () => (
  <main>
    <h1>SpotifyTrack</h1>
    <p>Welcome to SpotifyTrack! 100% under construction; stick around for updates!</p>
    <Link to="/connect">Connect to Spotify</Link> to view your own stats
    <br />
    <br />
    <Link to="/stats/ameobea">Ameobea&apos;s Stats</Link>
  </main>
);

export default Home;

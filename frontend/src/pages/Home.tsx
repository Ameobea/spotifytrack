import React from 'react';
import { Link } from 'react-router-dom';

import { ReactRouterRouteProps } from '../types';
import './Home.scss';

const Home: React.FC<ReactRouterRouteProps> = () => (
  <main className="home">
    <h1>SpotifyTrack</h1>

    <p className="description">Spotifytrack is blah blah blah etc. etc. etc.</p>

    {/* TODO: Make this a slideshow */}
    <div className="example-image">
      <img src="/images/artist_stats.png"></img>
    </div>

    <div className="buttons-container">
      <Link to="/connect">
        <button>Connect to Spotify</button>
      </Link>

      <Link to="/stats/ameobea">
        <button>View Example User Stats</button>
      </Link>
    </div>
  </main>
);

export default Home;

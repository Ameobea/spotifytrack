import React from 'react';
import { Link } from 'react-router-dom';
import { Carousel } from 'react-responsive-carousel';
import 'react-responsive-carousel/lib/styles/carousel.min.css';

import { ReactRouterRouteProps } from '../types';
import './Home.scss';
import '../components/BigButton.scss';

const Home: React.FC<ReactRouterRouteProps> = () => (
  <main className="home">
    <h1>Spotifytrack</h1>
    <h2>Hub for Spotify Statistics + Musical Taste Analysis</h2>

    <div className="description-container">
      <p className="description">
        Spotifytrack is a tool that allows you to look back on your listening history on Spotify. It
        keeps track of which tracks you listen to, the first time you find new artists, how your
        genre preferences change over time, and much more.
      </p>
      <p>
        It&apos;s 100% free to use, takes seconds to set up, and will automatically update your
        stats every day. To start, just click &apos;Connect to Spotify&apos;!
      </p>
    </div>

    <div className="buttons-container">
      <Link to="/connect">
        <button className="big-button">Connect to Spotify</button>
      </Link>

      <Link to="/stats/ameobea">
        <button className="big-button">View Example User Profile</button>
      </Link>
    </div>

    <Carousel className="example-carousel" showThumbs={false} autoPlay infiniteLoop interval={5338}>
      <div className="example-image">
        <img
          src="https://spotifytrack.b-cdn.net/images/artist_stats.png"
          alt="A screenshot of the artist stats view for a user's Spotifytrack page"
        ></img>
      </div>
      <div className="example-image">
        <img
          src="https://spotifytrack.b-cdn.net/images/genre_stats.png"
          alt="A screenshot of the genre stats view for a user's Spotifytrack page"
        ></img>
      </div>
      <div className="example-image">
        <img
          src="https://spotifytrack.b-cdn.net/images/user_home.png"
          alt="A screenshot of the home page of a user's Spotifytrack page showing their top tracks"
        ></img>
      </div>
    </Carousel>

    <div className="description-container">
      <h3>Features</h3>
      <ul>
        <li>
          View the first time you listened to your favorite artists and tracks on Spotify. Browse
          back to see what music you were listening to at different points in the past
        </li>
        <li>
          Compare your top tracks + artists to your friends and generate a sharable link so they can
          view your overlap in musical preferences as well
        </li>
        <li>
          Explore the interactive 3D <a href="https://galaxy.spotifytrack.net">Music Galaxy</a>,
          personalized with your personal Spotify data. Listen to new songs and explore
          relationships between artists to discover new musicians and styles
        </li>
      </ul>
    </div>
  </main>
);

export default Home;

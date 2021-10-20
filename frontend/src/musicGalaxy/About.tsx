import React from 'react';

import './About.scss';
import { GALAXY_BLOG_POST_LINK } from './conf';

const CloseButton: React.FC<{ onClose: () => void }> = ({ onClose }) => (
  <button className="galaxy-about-close-button" onClick={onClose}>
    ×
  </button>
);

const About: React.FC<{ onClose: () => void }> = ({ onClose }) => (
  <div
    className="galaxy-about-page-backdrop"
    onClick={(evt) => {
      if ((evt.target as any)?.className !== 'galaxy-about-close-button') {
        return;
      }
      onClose();
    }}
  >
    <div className="galaxy-about-page">
      <CloseButton onClose={onClose} />
      <h2>About Music Galaxy</h2>
      <p>
        Music Galaxy is a tool for music exploration and discovery outside of the context of genres.
        Artists are positioned such that other nearby artists are more likely to have similar
        listeners. This means that nearby &quot;similar&quot; artists may differ dramatically in
        style while still being connected by their listeners.
      </p>
      <p>
        The galaxy was generated using data from Spotify&apos;s public API, specifically the artist
        relationship data shown in the &quot;Fans also like&quot; section on the Spotify app.{' '}
      </p>
      <p>
        I scraped the artist relationship graph for hundreds of thousands of artists from this API
        converted the resulting graph into a 4D embedding via{' '}
        <a target="_blank" href="https://snap.stanford.edu/node2vec/">
          node2vec
        </a>{' '}
        which was then projected down to 3D via PCA.
      </p>
      <p>
        For more details, I wrote a{' '}
        <a target="_blank" href={GALAXY_BLOG_POST_LINK}>
          technical blog post
        </a>{' '}
        on the creation of this project.
      </p>
      <p>
        Music Galaxy is part of the broader{' '}
        <a target="_blank" href="https://spotifytrack.net">
          Spotifytrack
        </a>{' '}
        project which has various stats and charts for tracking + analyzing your personal musical
        journey over time.
      </p>
      <p>
        The visualization itself is created with Three.js and powered by a backend written in Rust.
        Full source code is available{' '}
        <a
          target="_blank"
          href="https://github.com/Ameobea/spotifytrack/tree/main/frontend/src/musicGalaxy"
        >
          on Github
        </a>
        .
      </p>
      <hr />
      Thank you very much to the people who helped test and provide feedback on this project during
      its development:
      <ul>
        <li>errepe</li>
        <li>Teitonii</li>
        <li>Banement</li>
        <li>Ancillary</li>
      </ul>
    </div>
  </div>
);

export default About;

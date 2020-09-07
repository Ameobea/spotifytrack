import React from 'react';
import { useLocation } from 'react-router';

import './Footer.scss';

const Footer: React.FC = () => {
  const { pathname } = useLocation();

  if (pathname.startsWith('/connect')) {
    return null;
  }

  return (
    <footer>
      <div>
        Spotifytrack created by{' '}
        <a target="_blank" href="https://cprimozic.net/">
          Casey Primozic / ameo
        </a>
      </div>
      <div>
        {' '}
        Full Source Code on{' '}
        <a href="https://github.com/ameobea/spotifytrack" target="_blank">
          Github
        </a>
      </div>
    </footer>
  );
};

export default Footer;

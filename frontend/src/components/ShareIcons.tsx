import { IconButton } from '@rmwc/icon-button';
import React from 'react';

import './ShareIcons.scss';

const ShareIcons: React.FC = () => (
  <div className="share-icons">
    <IconButton
      icon="/twitter.png"
      style={{ height: 28, width: 20, marginLeft: 8, backgroundSize: 34, marginTop: 2 }}
      tag="a"
      target="_blank"
      href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(
        "See what music I've been listening to and compare our musical tastes on Spotifytrack: " +
          window.location.href
      )}`}
    />
    <IconButton
      icon="/facebook.png"
      style={{ height: 28, width: 20, marginLeft: 8, marginRight: 8, marginTop: 2 }}
      tag="a"
      target="popup"
      onClick={() => {
        window.open(
          `https://www.facebook.com/sharer.php?u=${encodeURIComponent(
            window.location.href
          )}&href=${encodeURIComponent(window.location.href)}&quote=${encodeURIComponent(
            "See what music I've been listening to and compare our musical tastes on Spotifytrack"
          )}`,
          'popup',
          'width=800,height=400'
        );
        return false;
      }}
    />
  </div>
);

export default ShareIcons;

import React from 'react';
import { Link } from 'react-router-dom';

import { logEvent } from 'src/eventAnalytics';
import './ReconnectBanner.css';

const ReconnectBanner: React.FC = () => (
  <div className="reconnect-banner" role="alert">
    <div className="reconnect-banner-text">
      <span className="reconnect-banner-title">Your Spotify connection has expired.</span>
      <span>New updates will not be recorded until you reconnect your account.</span>
    </div>
    <Link to="/connect">
      <button
        className="reconnect-banner-button"
        onClick={() => logEvent('oauth', 'connect_click', { from: 'reconnect_banner' })}
      >
        Reconnect Spotify
      </button>
    </Link>
  </div>
);

export default ReconnectBanner;

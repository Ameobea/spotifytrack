import React from 'react';
import { useLocation } from 'react-router';

import { API_BASE_URL } from 'src/conf';

const OAuthRedirect: React.FC = () => {
  const { search } = useLocation();
  window.location.href = `${API_BASE_URL}/authorize${search}`;

  return (
    <div style={{ textAlign: 'center', fontSize: 20 }}>
      You are being redirected to Spotify in order to obtain access to your listening data
    </div>
  );
};

export default OAuthRedirect;

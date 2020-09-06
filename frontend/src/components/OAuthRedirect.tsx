import React from 'react';
import { useLocation } from 'react-router';

import { API_BASE_URL } from 'src/conf';

const OAuthRedirect: React.FC = () => {
  const { search } = useLocation();

  window.location.href = `${API_BASE_URL}/authorize${search}`;
  return null;
};

export default OAuthRedirect;

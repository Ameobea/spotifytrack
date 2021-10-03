import React from 'react';
import { API_BASE_URL } from 'src/conf';

import './OnboardingSidebar.scss';
import { OverlayAction } from './OverlayUI';

interface ActionButtonProps {
  onClick: () => void;
}

const ActionButton: React.FC<ActionButtonProps> = ({ onClick, children }) => (
  <button className="onboarding-sidebar-action-button" onClick={onClick}>
    {children}
  </button>
);

interface OnboardingSidebarProps {
  dispatchOverlayAction: (overlayAction: OverlayAction) => void;
  lockPointer: () => void;
  isMobile: boolean;
}

const OnboardingSidebar: React.FC<OnboardingSidebarProps> = ({
  dispatchOverlayAction,
  lockPointer,
  isMobile,
}) => {
  return (
    <div className="onboarding-sidebar">
      {isMobile ? null : <h2>Music Galaxy</h2>}
      {isMobile ? null : (
        <p>
          Text here describing what this thing is. Telling about what it does in simple terms
          without being too descriptive or spending too much screen space explaining.
        </p>
      )}

      <ActionButton
        onClick={() => {
          window.location.href = `${API_BASE_URL}/authorize?playlist_perms=false&state=galaxy`;
        }}
      >
        Personalize with Your Spotify Data
        <br />
        <i style={{ fontSize: 13 }}>(Recommended)</i>
      </ActionButton>
      <ActionButton
        onClick={() => {
          dispatchOverlayAction({ type: 'CLOSE_ONBOARDING' });
          lockPointer();
        }}
      >
        Explore Without Connecting
      </ActionButton>
    </div>
  );
};

export default OnboardingSidebar;

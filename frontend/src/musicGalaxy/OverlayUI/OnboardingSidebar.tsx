import React from 'react';

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
}

const OnboardingSidebar: React.FC<OnboardingSidebarProps> = ({
  dispatchOverlayAction,
  lockPointer,
}) => {
  return (
    <div className="onboarding-sidebar">
      <h2>Music Galaxy</h2>
      <p>
        Text here describing what this thing is. Telling about what it does in simple terms without
        being too descriptive or spending too much screen space explaining.
      </p>

      <ActionButton
        onClick={() => {
          dispatchOverlayAction({ type: 'CLOSE_ONBOARDING' });
          dispatchOverlayAction({ type: 'CLOSE_ARTIST_SEARCH' });
          // TODO
        }}
      >
        Personalize with Your Spotify Data
        <br />
        <i style={{ fontSize: 13 }}>(Highly Recommended)</i>
      </ActionButton>
      <ActionButton
        onClick={() => {
          dispatchOverlayAction({ type: 'CLOSE_ONBOARDING' });
          dispatchOverlayAction({ type: 'CLOSE_ARTIST_SEARCH' });
          lockPointer();
        }}
      >
        Explore Without Connecting
      </ActionButton>
    </div>
  );
};

export default OnboardingSidebar;

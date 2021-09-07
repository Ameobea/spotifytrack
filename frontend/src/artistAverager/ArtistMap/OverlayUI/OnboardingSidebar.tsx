import React from 'react';

import './OnboardingSidebar.scss';

interface ActionButtonProps {
  onClick: () => void;
}

const ActionButton: React.FC<ActionButtonProps> = ({ onClick, children }) => (
  <button className="onboarding-sidebar-action-button" onClick={onClick}>
    {children}
  </button>
);

interface OnboardingSidebarProps {
  setOnboardingSidebarOpen: (open: boolean) => void;
}

const OnboardingSidebar: React.FC<OnboardingSidebarProps> = ({ setOnboardingSidebarOpen }) => {
  return (
    <div className="onboarding-sidebar">
      <h2>Music Galaxy</h2>
      <p>
        Text here describing what this thing is. Telling about what it does in simple terms without
        being too descriptive or spending too much screen space explaining.
      </p>

      <ActionButton
        onClick={() => {
          setOnboardingSidebarOpen(false);
          // TODO
        }}
      >
        Personalize with Your Spotify Data
        <br />
        <i>(Highly Recommended)</i>
      </ActionButton>
      <ActionButton
        onClick={() => {
          setOnboardingSidebarOpen(false);
          // TODO
        }}
      >
        Explore Without Connecting
      </ActionButton>
    </div>
  );
};

export default OnboardingSidebar;

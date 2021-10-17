import React from 'react';

import { API_BASE_URL } from 'src/conf';
import { getSentry } from 'src/sentry';
import { GALAXY_BLOG_POST_LINK } from '../conf';
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
  setAboutPageOpen: () => void;
}

const DesktopOnboardingSidebar: React.FC<OnboardingSidebarProps> = ({
  dispatchOverlayAction,
  lockPointer,
  setAboutPageOpen,
}) => (
  <div className="onboarding-sidebar">
    <h2>Music Galaxy</h2>
    <p>
      This is a visualization of the relationships and audience listening patterns of over 70,000
      music groups + artists. Artists are placed nearby other artists with similar listeners.
    </p>
    {document.referrer.includes('ycombinator') || document.referrer.includes('lobste') ? (
      <p>
        I also wrote a{' '}
        <a target="_blank" href={GALAXY_BLOG_POST_LINK}>
          detailed technical blog post
        </a>{' '}
        about the development of this project.
      </p>
    ) : null}
    <p>
      <b>Search for an artist to enter fly mode.</b>
    </p>
    <p>Start with an artist you know and explore from there!</p>
    <p>
      Check the{' '}
      <a href="#about" onClick={setAboutPageOpen}>
        About Page
      </a>{' '}
      for more info.
    </p>

    <ActionButton
      onClick={() => {
        getSentry()?.captureMessage(
          'Music Galaxy: Onboarding Sidebar: Clicked Link Spotify button'
        );
        window.location.href = `${API_BASE_URL}/authorize?playlist_perms=false&state=galaxy`;
      }}
    >
      Personalize with Your Spotify Data
      <br />
      <i style={{ fontSize: 13 }}>(Recommended)</i>
    </ActionButton>
    <ActionButton
      onClick={() => {
        getSentry()?.captureMessage(
          'Music Galaxy: Onboarding Sidebar: Clicked Explore Without Connecting button'
        );
        dispatchOverlayAction({ type: 'CLOSE_ONBOARDING' });
        lockPointer();
      }}
    >
      Explore Without Connecting
    </ActionButton>
  </div>
);

const MobileOnboardingSidebar: React.FC<OnboardingSidebarProps> = ({
  dispatchOverlayAction,
  lockPointer,
}) => (
  <div className="onboarding-sidebar">
    <div>
      <p>
        This is a visualization of the relationships between over 70,000 music groups + artists.
        Artists are placed near other artists with similar listeners.
      </p>
      <p style={{ textAlign: 'center' }}>
        <b>Search for an artist to enter fly mode.</b>
      </p>
    </div>
    <div>
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
  </div>
);

const OnboardingSidebar: React.FC<OnboardingSidebarProps> = (props) =>
  props.isMobile ? <MobileOnboardingSidebar {...props} /> : <DesktopOnboardingSidebar {...props} />;

export default OnboardingSidebar;

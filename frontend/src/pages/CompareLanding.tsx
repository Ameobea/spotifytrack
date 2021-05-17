import React from 'react';
import { IconButton } from '@rmwc/icon-button';
import '@rmwc/icon-button/styles';

import { SITE_URL } from 'src/conf';
import { useUsername } from 'src/store/selectors';
import './CompareLanding.scss';

const buildCompareLink = (username: string): string => `${SITE_URL}/compare/${username}`;

const CopyCompareLink: React.FC = () => {
  const { username } = useUsername();
  if (!username) {
    return null;
  }
  const compareLink = buildCompareLink(username);

  return (
    <div className="copy-compare-link">
      Send this link to someone else who uses Spotify or share on social media so you both can
      visualize the overlaps in your listening habits, generate a shared taste playlist, and more!
      <br />
      <br />
      <div className="link-container">
        <a href={compareLink}>{compareLink}</a>

        <div className="icons-container">
          <IconButton
            icon={'/content_copy_black_24dp.svg'}
            style={{
              height: 20,
              width: 20,
              marginLeft: 14,
              marginTop: 3,
            }}
            onClick={() => {
              navigator.clipboard.writeText(compareLink);
            }}
            ripple={{ accent: true }}
            label="Copy compare link to clipboard"
          />
          <IconButton
            icon="/twitter.png"
            style={{ height: 28, width: 20, marginLeft: 8, backgroundSize: 34, marginTop: 2 }}
            tag="a"
            target="_blank"
            href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(
              'Visualize how our musical preferences overlap + generate a shared taste Spotify playlist ' +
                compareLink
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
                  compareLink
                )}&quote=${encodeURIComponent(
                  'Visualize how our musical preferences overlap + generate a shared taste Spotify playlist'
                )}`,
                'popup',
                'width=800,height=400'
              );
              return false;
            }}
          />
        </div>
      </div>
    </div>
  );
};

const CompareLanding: React.FC = () => (
  <div className="compare-landing">
    <h2>Compare with Someone Else</h2>
    <CopyCompareLink />
  </div>
);

export default CompareLanding;

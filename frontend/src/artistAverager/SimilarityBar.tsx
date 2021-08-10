import React from 'react';
import { Tooltip } from 'react-tippy';
import 'react-tippy/dist/tippy.css';

import './SimilarityBar.scss';

interface SimilarityBarProps {
  /**
   * Between 0 and 1, determines how far the bar is full
   */
  pos: number;
  artist1Name: string;
  artist2Name: string;
}

const SimilarityBar: React.FC<SimilarityBarProps> = ({ pos, artist1Name, artist2Name }) => (
  <Tooltip
    title={`${(pos * 100).toFixed(0)}% like ${artist1Name}, ${((1 - pos) * 100).toFixed(
      0
    )}% like ${artist2Name}`}
    position="bottom"
    trigger="mouseenter"
  >
    <div className="similarity-bar">
      <div className="similarity-bar-bar" style={{ width: `${pos * 140}px` }} />
    </div>
  </Tooltip>
);

export default SimilarityBar;

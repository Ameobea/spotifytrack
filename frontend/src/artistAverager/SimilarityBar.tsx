import React from 'react';

import './SimilarityBar.scss';

interface SimilarityBarProps {
  /**
   * Between 0 and 1, determines how far the bar is full
   */
  pos: number;
}

const SimilarityBar: React.FC<SimilarityBarProps> = ({ pos }) => (
  <div className="similarity-bar">
    <div className="similarity-bar-bar" style={{ width: `${pos * 350}px` }} />
  </div>
);

export default SimilarityBar;

import React from 'react';

import './Loading.scss';

// TODO: Make this a cool animated SVG thing; maybe a growing tree or something.
const Loading: React.FC<{ style?: React.CSSProperties }> = ({ style }) => (
  <div style={style} className="loading">
    Loading...
  </div>
);

export default Loading;

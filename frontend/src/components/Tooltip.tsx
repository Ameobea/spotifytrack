import React from 'react';

import './Tooltip.scss';

const Tooltip: React.FC<{ tooltip: React.ReactNode; style?: React.CSSProperties }> = ({
  tooltip,
  style,
  children,
}) => (
  <span className="__tooltip" style={style}>
    {children}
    <span className="__tooltip-content">{tooltip}</span>
  </span>
);

export default Tooltip;

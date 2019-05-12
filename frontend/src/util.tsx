import React from 'react';

interface ANewTabProps {
  to: string;
  children?: React.ReactElement;
  text: string;
  [other: string]: any;
}

export const ANewTab = ({ to, children, text, ...props }: ANewTabProps) => (
  <a href={to} target="_blank" rel="noopener noreferrer" {...props}>
    {children || text || ''}
  </a>
);

export const truncateWithElipsis = (s: string, maxLength: number): string => {
  let truncated = s.slice(0, maxLength);
  if (truncated.length !== s.length) {
    truncated += '…';
  }

  return truncated;
};

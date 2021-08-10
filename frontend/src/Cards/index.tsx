import React, { useState, Fragment } from 'react';
import * as R from 'ramda';
import { withMobileProp } from 'ameo-utils/dist/responsive';

import type { Timeframe } from 'src/types';
import './Cards.scss';
import mkTrack from './TrackCard';
import { ArtistStatsLink } from './ArtistCard';

const TIMEFRAMES: Timeframe[] = ['short' as const, 'medium' as const, 'long' as const];

interface TimeframeSelectorProps {
  timeframe: Timeframe;
  setTimeframe: (newTimeframe: Timeframe) => void;
}

export const TimeframeSelector: React.FC<TimeframeSelectorProps> = ({
  timeframe,
  setTimeframe,
}) => (
  <div className="timeframe-selector">
    Timeframe:{' '}
    {TIMEFRAMES.map((frame, i, frames) => (
      <Fragment key={i}>
        <span
          style={{
            textDecoration: 'underline',
            ...(frame === timeframe ? { fontWeight: 'bold', fontSize: 22 } : { cursor: 'pointer' }),
          }}
          onClick={() => setTimeframe(frame)}
        >
          {frame}
        </span>
        {i !== frames.length - 1 ? ' \u2022 ' : null}
      </Fragment>
    ))}
  </div>
);

interface ImageBoxGridProps {
  renderItem: (i: number, timeframe: Timeframe) => React.ReactNode;
  getItemCount: (timeframe: string) => number;
  initialItems: number;
  title?: string | null;
  horizontallyScrollable?: boolean;
  disableHeader?: boolean;
  hideShowMore?: boolean;
  disableTimeframes?: boolean;
  style?: React.CSSProperties;
  mobile: boolean;
}

const ImageBoxGridInner: React.FC<ImageBoxGridProps> = ({
  renderItem,
  getItemCount,
  initialItems,
  title,
  horizontallyScrollable,
  disableHeader,
  disableTimeframes,
  hideShowMore,
  style,
}) => {
  const [timeframe, setTimeframe] = useState<Timeframe>('short');
  const [isExpanded, setIsExpanded] = useState(false);
  const totalItems = getItemCount(timeframe);
  const itemCount = isExpanded ? totalItems : Math.min(initialItems, totalItems);

  const hasItems = totalItems > 0;

  return (
    <div style={style}>
      {!disableHeader && !!title ? <h3 className="image-box-grid-title">{title}</h3> : null}
      {!disableTimeframes ? (
        <TimeframeSelector timeframe={timeframe} setTimeframe={setTimeframe} />
      ) : null}
      <div className={`image-box-grid${horizontallyScrollable ? ' horizontally-scrollable' : ''}`}>
        {hasItems ? (
          R.times((i) => <Fragment key={i}>{renderItem(i, timeframe)}</Fragment>, itemCount)
        ) : (
          <>{disableTimeframes ? 'No items to display' : 'No items for timeframe'}</>
        )}
      </div>

      {!isExpanded && hasItems && !hideShowMore && totalItems > initialItems ? (
        <div onClick={() => setIsExpanded(true)} className="show-more">
          Show More
        </div>
      ) : null}
    </div>
  );
};

export const ImageBoxGrid = withMobileProp({ maxDeviceWidth: 800 })(ImageBoxGridInner);

export const Track = mkTrack(ArtistStatsLink);

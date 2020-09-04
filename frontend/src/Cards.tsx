import React, { useRef, useEffect, useState, Fragment } from 'react';
import * as R from 'ramda';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPlay, faPause } from '@fortawesome/free-solid-svg-icons';
import { Link } from 'react-router-dom';

import { Timeframe } from 'src/types';
import { truncateWithElipsis, map } from 'src/util';
import { useUsername } from './store/selectors';
import './Cards.scss';
import { withMobileProp } from 'ameo-utils/dist/responsive';

interface ImageBoxProps {
  imageSrc: string;
  imgAlt: string;
  linkTo?: string;
}

const ImageBox: React.FC<ImageBoxProps> = ({ imageSrc, imgAlt, children, linkTo }) => {
  const image = <img alt={imgAlt} src={imageSrc} className="image-container" />;

  return (
    <div className="image-box">
      <div className="track">
        {linkTo ? <Link to={linkTo}>{image}</Link> : image}

        <div className="image-box-content">{children}</div>
      </div>
    </div>
  );
};

interface TrackProps {
  title: string;
  artists: {
    name: string;
    // uri: string;
    id: string;
  }[];
  previewUrl: string;
  // album: string;
  imageSrc: string;
  playing: string | false;
  setPlaying: (currentlyPlayingPreviewUrl: string | false) => void;
}

export const buildArtistStatsUrl = (username: string, artistId: string): string =>
  `/stats/${username}/artist/${artistId}/`;

const ArtistStatsLink: React.FC<{ artistId: string }> = ({ artistId, children }) => {
  const username = useUsername();
  if (!username) {
    return <>children</>;
  }

  return <Link to={buildArtistStatsUrl(username, artistId)}>{children}</Link>;
};

export const Track: React.FC<TrackProps> = ({
  title,
  artists,
  previewUrl,
  imageSrc,
  playing,
  setPlaying,
}) => {
  const isPlaying = playing && playing === previewUrl;
  const audioTag = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const audioElem = audioTag.current;
    if (!audioElem) {
      return;
    }

    audioElem.volume = 0.2;
    if (!onended) {
      audioElem.onended = () => setPlaying(false);
    }

    if (isPlaying) {
      audioElem.play();
    } else {
      audioElem.pause();
    }
  });

  return (
    <ImageBox
      imgAlt={`Album art for ${title} by ${artists.map(R.prop('name')).join(', ')}`}
      imageSrc={imageSrc}
    >
      <div className="card-data">
        <div title={title} style={{ maxHeight: 37, overflowY: 'hidden' }}>
          {truncateWithElipsis(title, 30)}
        </div>
        <div
          style={{ zIndex: 2, lineHeight: '1em', maxHeight: 48, overflowY: 'hidden', marginTop: 2 }}
        >
          {artists.map(({ name, id }, i) => {
            return (
              <Fragment key={id}>
                <ArtistStatsLink artistId={id}>{name}</ArtistStatsLink>
                {i !== artists.length - 1 ? ', ' : null}
              </Fragment>
            );
          })}
        </div>
        <audio preload="none" ref={audioTag} src={previewUrl} />
      </div>

      <div
        className="play-pause-button-wrapper"
        onClick={() => setPlaying(isPlaying ? false : previewUrl)}
      >
        {previewUrl ? <FontAwesomeIcon icon={isPlaying ? faPause : faPlay} /> : null}
      </div>
    </ImageBox>
  );
};

// TODO: Make this configurable, or better yet automatic based off of the user's top genres.
//       Not high-priority.
const DEFAULT_PREFERRED_GENRES = new Set([
  'vapor twitch',
  'vapor soul',
  'art pop',
  'indie pop',
  'indietronica',
  'folk-pop',
  'chillwave',
]);

interface ArtistProps {
  id: string;
  name: string;
  genres: string[];
  imageSrc: string;
  // uri: string;
  preferredGenres?: Set<string>;
}

const Genre: React.FC<{ username: string; genre: string }> = ({ username, genre }) => (
  <Link to={`/stats/${username}/genre/${genre}/`}>{genre}</Link>
);

export const Artist: React.FC<ArtistProps> = ({
  id,
  name,
  genres,
  imageSrc,
  preferredGenres = DEFAULT_PREFERRED_GENRES,
}) => {
  const username = useUsername();
  // Make sure that preferred genres show up and aren't trimmed off
  const [preferred, other] = R.partition((genre) => preferredGenres.has(genre), genres);
  const trimmedGenres = [...preferred, ...other].slice(0, 6);

  return (
    <ImageBox
      imgAlt={name}
      imageSrc={imageSrc}
      linkTo={map(username, (username) => buildArtistStatsUrl(username, id)) || undefined}
    >
      <div className="card-data">
        <div>
          <ArtistStatsLink artistId={id}>{name}</ArtistStatsLink>
        </div>
        <div style={{ lineHeight: '1em', maxHeight: 31, overflowY: 'hidden' }}>
          {trimmedGenres.map((genre, i) => (
            <Fragment key={genre}>
              <Genre username={username!} genre={genre} />
              {i !== trimmedGenres.length - 1 ? ', ' : null}
            </Fragment>
          ))}
        </div>
      </div>
    </ImageBox>
  );
};

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
  title: string;
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
      {!disableHeader ? <h3 className="image-box-grid-title">{title}</h3> : null}
      {!disableTimeframes ? (
        <TimeframeSelector timeframe={timeframe} setTimeframe={setTimeframe} />
      ) : null}
      <div className={`image-box-grid${horizontallyScrollable ? ' horizontally-scrollable' : ''}`}>
        {hasItems ? (
          R.times((i) => <Fragment key={i}>{renderItem(i, timeframe)}</Fragment>, itemCount)
        ) : (
          <>No items for timeframe</>
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

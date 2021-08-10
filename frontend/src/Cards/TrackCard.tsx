import React, { Fragment, useEffect, useRef } from 'react';
import { faPause, faPlay } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';

import { truncateWithElipsis } from 'src/util';

import ImageBox from './ImageBox';

interface TrackProps {
  title: string;
  artists: {
    name: string;
    id: string;
  }[];
  previewUrl: string;
  imageSrc?: string | null;
  playing: string | false;
  setPlaying: (currentlyPlayingPreviewUrl: string | false) => void;
  mobile: boolean;
}

export const mkTrack = (ArtistStatsLink: React.ComponentType<{ artistId: string }>) => {
  const Track: React.FC<TrackProps> = ({
    title,
    artists,
    previewUrl,
    imageSrc,
    playing,
    setPlaying,
    mobile,
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
        imgAlt={`Album art for ${title} by ${artists.map((artist) => artist.name).join(', ')}`}
        imageSrc={imageSrc}
        mobile={mobile}
      >
        <div className="card-data">
          <div title={title} style={{ maxHeight: 37, overflowY: 'hidden' }}>
            {truncateWithElipsis(title, 30)}
          </div>
          <div
            style={{
              zIndex: 2,
              lineHeight: '1em',
              maxHeight: 48,
              overflowY: 'hidden',
              marginTop: 2,
            }}
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
  return Track;
};

export default mkTrack;

import React, { Fragment } from 'react';
import { Link } from 'react-router-dom';
import * as R from 'ramda';

import { useUsername } from 'src/store/selectors';
import { map } from 'src/util2';
import './Cards.scss';
import ImageBox from './ImageBox';

export const buildArtistStatsUrl = (username: string, artistId: string): string =>
  `/stats/${username}/artist/${artistId}/`;

export const ArtistStatsLink: React.FC<{ artistId: string }> = ({ artistId, children }) => {
  const { username } = useUsername();
  if (!username) {
    return <>{children}</>;
  }

  return <Link to={buildArtistStatsUrl(username, artistId)}>{children}</Link>;
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
  preferredGenres?: Set<string>;
  mobile: boolean;
}

const Genre: React.FC<{ username: string | null; genre: string }> = ({ username, genre }) =>
  username ? <Link to={`/stats/${username}/genre/${genre}/`}>{genre}</Link> : <>{genre}</>;

const Artist: React.FC<ArtistProps> = ({
  id,
  name,
  genres,
  imageSrc,
  preferredGenres = DEFAULT_PREFERRED_GENRES,
  mobile,
}) => {
  const { username } = useUsername();
  // Make sure that preferred genres show up and aren't trimmed off
  const [preferred, other] = R.partition((genre) => preferredGenres.has(genre), genres);
  const trimmedGenres = [...preferred, ...other].slice(0, 6);

  return (
    <ImageBox
      imgAlt={name}
      imageSrc={imageSrc}
      linkTo={map(username, (username) => buildArtistStatsUrl(username, id)) || undefined}
      mobile={mobile}
    >
      <div className="card-data">
        <div>
          <ArtistStatsLink artistId={id}>{name}</ArtistStatsLink>
        </div>
        <div style={{ lineHeight: '1em', maxHeight: 30, overflowY: 'hidden' }}>
          {trimmedGenres.map((genre, i) => (
            <Fragment key={genre}>
              <Genre username={username} genre={genre} />
              {i !== trimmedGenres.length - 1 ? ', ' : null}
            </Fragment>
          ))}
        </div>
      </div>
    </ImageBox>
  );
};

export default Artist;

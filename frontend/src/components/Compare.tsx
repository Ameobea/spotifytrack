import { withMobileProp } from 'ameo-utils/dist/responsive';
import React, { useEffect, useState } from 'react';
import { useQuery } from 'react-query';
import { useRouteMatch } from 'react-router';
import { Link, useLocation } from 'react-router-dom';

import { fetchComparison } from 'src/api';
import { ImageBoxGrid, Artist as ArtistCard, Track as TrackCard } from 'src/Cards';
import { usePush } from 'src/util/hooks';
import './Compare.scss';

const CompareInner: React.FC<{ mobile: boolean }> = ({ mobile }) => {
  const {
    params: { user1, user2 },
  } = useRouteMatch<{ user1: string; user2: string }>();
  const [playing, setPlaying] = useState<string | false>(false);
  const { search: queryString } = useLocation();
  const push = usePush();
  const [generatedPlaylist, setGeneratedPlaylist] = useState<{
    name: string;
    track_count: number;
  } | null>(null);

  const { data, error } = useQuery({
    queryKey: ['compare', user1, user2],
    queryFn: fetchComparison,
    config: { staleTime: Infinity, refetchOnMount: false },
  });

  useEffect(() => {
    if (!data) {
      return;
    }

    try {
      const qs = new URLSearchParams(queryString);
      const encodedPlaylist = qs.get('playlist');

      if (encodedPlaylist && !generatedPlaylist) {
        setGeneratedPlaylist(JSON.parse(decodeURIComponent(encodedPlaylist)));
      }
    } catch (err) {
      console.warn('Error parsing search params: ', err);
    }
  }, [queryString, generatedPlaylist, data]);

  if (error) {
    return (
      <div className="compare">
        There was an error fetching data for these users; try again later
      </div>
    );
  } else if (data === null) {
    return (
      <div className="compare">
        Data is missing for one or both of these users. In order for this tool to work, both users
        must have previously connected to Spotifytrack.
      </div>
    );
  } else if (data === undefined) {
    return <div className="compare loading">Loading...</div>;
  }

  return (
    <div className="compare">
      <h1>
        Shared Musical Interests between{' '}
        <Link to={`/stats/${user1}`}>
          <span className="username">{data.user1_username}</span>
        </Link>{' '}
        and{' '}
        <Link to={`/stats/${user2}`}>
          <span className="username">{data.user2_username}</span>
        </Link>
      </h1>

      {data.tracks.length === 0 && data.artists.length === 0 ? (
        <>
          Amazing - there is absolutely no musical overlap between these two people! You&apos;re
          truly polar opposites of musical taste.
        </>
      ) : (
        (() => {
          if (generatedPlaylist) {
            return (
              <div style={{ fontSize: 20, textAlign: 'center' }}>
                Playlist generated: <b>&quot;{generatedPlaylist.name}&quot;</b>
                <br /> It&apos;s in your Spotify right now - give it a listen and share it with your
                friend!
              </div>
            );
          } else {
            return (
              <button
                onClick={() => {
                  const req = { user1_id: user1, user2_id: user2 };
                  const url = `/connect?playlist_perms=true&state=${encodeURIComponent(
                    JSON.stringify(req)
                  )}`;
                  push(url);
                }}
              >
                Generate a Shared Taste Playlist
              </button>
            );
          }
        })()
      )}

      <ImageBoxGrid
        renderItem={(i) => {
          const track = data.tracks[i];

          return (
            <TrackCard
              key={track.id}
              title={track.name}
              artists={track.album.artists}
              previewUrl={track.preview_url}
              imageSrc={track.album.images[0].url}
              playing={playing}
              setPlaying={setPlaying}
              mobile={mobile}
            />
          );
        }}
        getItemCount={() => data.tracks.length}
        initialItems={Math.min(mobile ? 9 : 10, data.tracks.length)}
        title="Tracks"
        disableTimeframes
      />

      <ImageBoxGrid
        renderItem={(i) => {
          const artist = data.artists[i];

          return (
            <ArtistCard
              name={artist.name}
              genres={artist.genres}
              imageSrc={artist.images[0]?.url}
              id={artist.id}
              mobile={mobile}
            />
          );
        }}
        getItemCount={() => data.artists.length}
        initialItems={Math.min(mobile ? 9 : 10, data.artists.length)}
        title="Artists"
        disableTimeframes
      />
    </div>
  );
};

const Compare = withMobileProp({ maxDeviceWidth: 800 })(CompareInner);

export default Compare;

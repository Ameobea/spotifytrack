import React, { useMemo } from 'react';
import { useQuery } from 'react-query';
import { Link } from 'react-router-dom';
import { withMobileProp } from 'ameo-utils/dist/responsive';
import { useDispatch, useSelector } from 'react-redux';

import { getUrl, getJsonEndpoint } from 'src/api';
import { Artist, TimeFrames, ReduxStore } from 'src/types';
import { LineChart } from 'src/components/Charts';
import Loading from 'src/components/Loading';
import { ImageBoxGrid } from 'src/Cards';
import ArtistCard from 'src/Cards/ArtistCard';
import { actionCreators } from 'src/store';
import './GenreStats.scss';
import { colors } from 'src/style';
import { makeRetryable } from 'src/util2';

interface GenreStats {
  artists_by_id: { [artistId: string]: Artist };
  top_artists: [string, number][];
  timestamps: string[];
  popularity_history: TimeFrames<number>;
}

// const EveryNoiseLink = ({ genre }: { genre: string }) => {
//   const to = `http://everynoise.com/engenremap-${genre.replace(/ /g, '')}.html`;
//   return <ANewTab to={to} text={genre} style={{ color: 'white', fontSize: 11 }} />;
// };

const fetchGenreStats = makeRetryable(async (username: string, genre: string) =>
  getJsonEndpoint<GenreStats>(getUrl(`/stats/${username}/genre/${genre}`))
);

interface GenreStatsProps {
  username: string;
  genre: string;
  mobile: boolean;
}

const GenreStats: React.FC<GenreStatsProps> = ({ username, genre, mobile }) => {
  const artistsCorpus = useSelector((state: ReduxStore) => state.entityStore.artists);
  const dispatch = useDispatch();

  const { data: genreStats, status } = useQuery([genre, { username, genre }], () =>
    fetchGenreStats(username, genre).then((res) => {
      if (res) {
        dispatch(actionCreators.entityStore.ADD_ARTISTS(res.artists_by_id));
      }

      return res;
    })
  );

  const series = useMemo(() => {
    if (!genreStats) {
      return null;
    }

    const dates = genreStats.timestamps.map((date) => new Date(date));

    return ['short' as const, 'medium' as const, 'long' as const].map((name) => ({
      name,
      data: genreStats.popularity_history[name].map((popularity, i): [Date, number | null] => [
        dates[i],
        popularity,
      ]),
    }));
  }, [genreStats]);

  const title = (
    <h1 style={mobile ? { marginTop: 60 } : undefined}>
      <Link to={`/stats/${username}/`}>{username}</Link>&apos;s genre stats for{' '}
      <span style={{ color: colors.pink }}>{genre}</span>
    </h1>
  );

  if (status === 'loading' || !genreStats || !series) {
    return (
      <div className="genre-stats">
        {title}
        <Loading style={{ marginTop: 180 }} />
      </div>
    );
  }

  return (
    <div className="genre-stats">
      {title}
      <LineChart
        style={{ height: 300 }}
        series={series}
        otherConfig={{
          title: { text: mobile ? '' : `Popularity History for ${genre}` },
          xAxis: {
            type: 'time',
            name: 'Update Time',
            nameLocation: 'center',
            nameTextStyle: {
              color: '#ccc',
              fontSize: mobile ? 10 : 14,
              padding: 16,
            },
          },
          yAxis: {
            type: 'value',
            name: 'Popularity Ranking',
            nameLocation: 'middle',
            nameGap: 50,
            nameTextStyle: {
              color: '#ccc',
              fontSize: mobile ? 10 : 14,
            },
          },
          tooltip: { trigger: 'axis', show: false, formatter: undefined },
        }}
      />

      <ImageBoxGrid
        renderItem={(i) => {
          const [artistId] = genreStats.top_artists[i];
          if (!artistId) {
            return null;
          }
          const artist = artistsCorpus[artistId];
          if (!artist) {
            console.error(`No artist metadata for artist ${artistId}`);
            return null;
          }

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
        getItemCount={() => genreStats.top_artists.length}
        initialItems={40}
        title="Artists"
        disableTimeframes
      />
    </div>
  );
};

export default withMobileProp({ maxDeviceWidth: 800 })(GenreStats);

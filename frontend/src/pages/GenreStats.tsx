import React, { useMemo } from 'react';
import { connect } from 'react-redux';
import { useQuery } from 'react-query';
import { withMobileProp } from 'ameo-utils/dist/responsive';

import { getUrl, getJsonEndpoint } from 'src/api';
import { Artist, TimeFrames, ReduxStore } from 'src/types';
import { LineChart } from 'src/components/Charts';
import Loading from 'src/components/Loading';
import { ImageBoxGrid, Artist as ArtistCard } from 'src/Cards';
import { useDispatch } from 'react-redux';
import { actionCreators } from 'src/store';
import { ANewTab } from 'src/util';
import './GenreStats.scss';

interface GenreStats {
  artists_by_id: { [artistId: string]: Artist };
  top_artists: [string, number][];
  timestamps: string[];
  popularity_history: TimeFrames<number>;
}

const EveryNoiseLink = ({ genre }: { genre: string }) => {
  const to = `http://everynoise.com/engenremap-${genre.replace(/ /g, '')}.html`;
  return <ANewTab to={to} text={genre} style={{ color: 'white', fontSize: 11 }} />;
};

const fetchGenreStats = async (username: string, genre: string) =>
  getJsonEndpoint<GenreStats>(getUrl(`/stats/${username}/genre/${genre}`));

const mapStateToProps = (state: ReduxStore) => ({ artistsCorpus: state.entityStore.artists });

const GenreStats: React.FC<
  { username: string; genre: string; mobile: boolean } & ReturnType<typeof mapStateToProps>
> = ({ username, genre, artistsCorpus, mobile }) => {
  const dispatch = useDispatch();

  const { data: genreStats, status } = useQuery([genre, { username, genre }], () =>
    fetchGenreStats(username, genre).then((res) => {
      dispatch(actionCreators.entityStore.ADD_ARTISTS(res.artists_by_id));
      return res;
    })
  );

  const series = useMemo(() => {
    if (!genreStats) {
      return null;
    }

    const dates = genreStats.timestamps.map((date) => new Date(date));

    return ['short' as const, 'medium' as const, 'long' as const].map((name, i) => ({
      name,
      data: genreStats.popularity_history[name].map((popularity, i): [Date, number | null] => [
        dates[i],
        popularity,
      ]),
    }));
  }, [genreStats]);

  if (status === 'loading' || !genreStats || !series) {
    return (
      <div className="genre-stats">
        <h1 style={mobile ? { marginTop: 60 } : undefined}>{genre}</h1>
        <Loading style={{ marginTop: 180 }} />
      </div>
    );
  }

  return (
    <div className="genre-stats">
      <h1 style={mobile ? { marginTop: 60 } : undefined}>{genre}</h1>
      <LineChart
        style={{ height: 300 }}
        series={series}
        otherConfig={{
          title: { text: `Popularity History for ${genre}` },
          xAxis: {
            type: 'time',
            name: 'Update Time',
            nameLocation: 'center',
            nameTextStyle: {
              color: '#ccc',
              fontSize: 14,
              padding: 12,
            },
          },
          yAxis: {
            type: 'value',
            name: 'Popularity Ranking',
            nameLocation: 'middle',
            nameGap: 50,
            nameTextStyle: {
              color: '#ccc',
              fontSize: 14,
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
              // uri={artist.uri}
              id={artist.id}
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

export default withMobileProp({ maxDeviceWidth: 800 })(connect(mapStateToProps)(GenreStats));

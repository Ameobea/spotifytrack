import React, { useMemo, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import * as R from 'ramda';

import { useSelector, dispatch, actionCreators } from 'src/store';
import { ReactRouterRouteProps, ArtistStats as ArtistStatsType, Track, Artist } from 'src/types';
import { fetchArtistStats } from 'src/api';
import { colors } from 'src/style';
import Loading from 'src/components/Loading';
import { LineChart, BarChart } from 'src/components/Charts';
import { ArtistCards } from 'src/pages/Stats';
import './ArtistStats.scss';

const GenreChip: React.FC<{ username: string; genre: string }> = ({ username, genre }) => (
  <Link className="genre-chip-link" to={`/stats/${username}/genre/${genre}/`}>
    <div className="genre-chip">{genre}</div>
  </Link>
);

const GenresListing: React.FC<{ genres: string[]; username: string }> = ({ username, genres }) => (
  <div className="genres-listing">
    {genres.map(genre => (
      <GenreChip key={genre} username={username} genre={genre} />
    ))}
  </div>
);

const ArtistStats: React.FC<ReactRouterRouteProps> = ({ match }) => {
  const { username, artistId } = match.params;
  const artistStats: ArtistStatsType | undefined = useSelector(({ userStats }) =>
    R.path([username, 'artistStats', artistId], userStats)
  );
  const artist = useSelector(({ entityStore: { artists } }) => artists[artistId]);
  const topTracksCorpus = useSelector(({ entityStore: { tracks } }) =>
    artistStats && artistStats.topTracks
      ? R.pick(artistStats.topTracks.map(R.prop('trackId')), tracks)
      : null
  );

  const series = useMemo(
    () =>
      artistStats
        ? ['Short', 'Medium', 'Long'].map((name, i) => ({
            name,
            data: artistStats.popularityHistory.map(({ timestamp, popularityPerTimePeriod }): [
              Date,
              number | null
            ] => [timestamp, popularityPerTimePeriod[i]]),
          }))
        : null,
    [artistStats]
  );

  const fetchedStatsFor = useRef<string | null>(null);
  useEffect(() => {
    if (fetchedStatsFor.current === artistId || !!series) {
      return;
    }

    fetchedStatsFor.current = artistId;
    (async () => {
      const {
        artist,
        top_tracks,
        popularity_history,
        tracks_by_id,
      }: {
        artist: Artist;
        top_tracks: [string, number][]; // (trackId, score)
        popularity_history: [string, [number | null, number | null, number | null]][]; // (timestamp string, [short_ranking, medium_ranking, long_ranking])
        tracks_by_id: { [trackId: string]: Track };
      } = await fetchArtistStats(username, artistId);

      dispatch(actionCreators.entityStore.ADD_TRACKS(tracks_by_id));
      dispatch(actionCreators.entityStore.ADD_ARTISTS({ [artist.id]: artist }));
      dispatch(
        actionCreators.userStats.SET_ARTIST_STATS(
          username,
          artistId,
          top_tracks.map(([trackId, score]) => ({ trackId, score })),
          popularity_history.map(([timestamp, popularityPerTimePeriod]) => ({
            timestamp: new Date(timestamp),
            popularityPerTimePeriod,
          }))
        )
      );
    })();
  });

  return (
    <div className="artist-stats">
      {!artistStats || !artist || !series ? (
        <Loading style={{ height: 521 }} />
      ) : (
        <>
          <h1>
            Artist stats for <span style={{ color: colors.pink }}> {artist.name}</span>
          </h1>

          <p>Top genres:</p>
          <GenresListing username={username} genres={artist.genres} />

          <LineChart
            style={{ height: 300 }}
            series={series}
            otherConfig={{
              title: { text: `Popularity History for ${artist.name}` },
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
                inverse: true,
                name: 'Popularity Ranking',
                nameLocation: 'middle',
                nameGap: 50,
                nameTextStyle: {
                  color: '#ccc',
                  fontSize: 14,
                },
              },
              tooltip: { trigger: 'axis' },
            }}
          />
        </>
      )}

      <ArtistCards
        disableHeader
        hideShowMore
        style={{ width: '100%', paddingTop: 30, paddingBottom: 30 }}
        initialItems={100}
        horizontallyScrollable
      />

      {artistStats && artistStats.topTracks && topTracksCorpus ? (
        <>
          {R.isEmpty(artistStats.topTracks) ? (
            <div style={{ textAlign: 'center' }}>No top tracks available for artist</div>
          ) : (
            <BarChart
              data={artistStats.topTracks.map(R.prop('score'))}
              categories={artistStats.topTracks.map(({ trackId }) => topTracksCorpus[trackId].name)}
              style={{
                height: 400,
                width: '100%',
              }}
              otherConfig={{
                xAxis: {
                  axisLabel: {
                    interval: 0,
                    rotate: 70,
                  },
                },
                grid: {
                  bottom: 200,
                },
              }}
            />
          )}
        </>
      ) : (
        <Loading style={{ height: 400 }} />
      )}
    </div>
  );
};

export default ArtistStats;

import React, { useState } from 'react';
import * as R from 'ramda';
import { useHistory } from 'react-router-dom';
import { PropTypesOf } from 'ameo-utils/dist/util/react';
import { withMobileProp } from 'ameo-utils/dist/responsive';

import { ReactRouterRouteProps, UserStats, Track, Artist, ValueOf } from 'src/types';
import { useOnce } from 'src/util/hooks';
import { fetchUserStats } from 'src/api';
import { mapObj } from 'src/util';
import { dispatch, actionCreators, useSelector, UserStatsState } from 'src/store';
import { ImageBoxGrid, Artist as ArtistCard, Track as TrackCard } from 'src/Cards';
import ArtistStats from 'src/pages/ArtistStats';
import GenreStats from 'src/pages/GenreStats';
import Loading from 'src/components/Loading';
import GenresTreemap from 'src/components/GenresTreemap';
import { useUsername } from 'src/store/selectors';
import Timeline from 'src/components/Timeline';
import { RelatedArtistsGraphForUser } from 'src/components/RelatedArtistsGraph';
import './Stats.scss';
import { colors } from 'src/style';
import CompareLanding from './CompareLanding';
import ShareIcons from 'src/components/ShareIcons';

type ArtistCardProps = {
  horizontallyScrollable?: boolean;
  mobile: boolean;
} & Partial<PropTypesOf<typeof ImageBoxGrid>>;

export const ArtistCards: React.FC<ArtistCardProps> = ({
  horizontallyScrollable,
  mobile,
  ...props
}) => {
  const { artistsCorpus } = useSelector(({ entityStore: { artists } }) => ({
    artistsCorpus: artists,
  }));
  const { username } = useUsername()!;
  const stats = useSelector(({ userStats }) => (username ? userStats[username] : null));

  if (!stats) {
    return <Loading />;
  }

  return (
    <ImageBoxGrid
      horizontallyScrollable={horizontallyScrollable}
      renderItem={(i, timeframe) => {
        if (!stats.artists) {
          return null;
        }
        const artistId = stats.artists[timeframe][i];
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
      getItemCount={(timeframe) => (stats.artists ? stats.artists[timeframe].length : 0)}
      initialItems={mobile ? 9 : 10}
      disableHeader
      {...props}
    />
  );
};

enum StatsDetailsTab {
  Timeline = 'timeline',
  RelatedArtistsGraph = 'relatedArtists',
  Tracks = 'tracks',
  Artists = 'artists',
  Genres = 'genres',
  Compare = 'compare',
}

const ALL_TABS: { title: string; value: StatsDetailsTab }[] = [
  { title: 'Timeline', value: StatsDetailsTab.Timeline },
  { title: 'Artist Relationship Graph', value: StatsDetailsTab.RelatedArtistsGraph },
  { title: 'Top Artists', value: StatsDetailsTab.Artists },
  { title: 'Top Tracks', value: StatsDetailsTab.Tracks },
  { title: 'Top Genres', value: StatsDetailsTab.Genres },
  { title: 'Compare', value: StatsDetailsTab.Compare },
];

interface StatsDetailsTabsProps {
  selectedTab: StatsDetailsTab;
  setSelectedTab: (newTab: StatsDetailsTab) => void;
}

interface StatsDetailsTabCompProps {
  title: string;
  onSelect: () => void;
  isSelected: boolean;
}

const StatsDetailsTabComp: React.FC<StatsDetailsTabCompProps> = ({
  title,
  onSelect,
  isSelected,
}) => (
  <div
    className="stats-details-tab"
    data-active={`${isSelected}`}
    onClick={onSelect}
    tabIndex={0}
    role="tab"
    aria-selected={isSelected}
  >
    {title}
  </div>
);

const RelatedArtistsGraphTooltip: React.FC<{ onClick: () => void }> = ({ onClick }) => (
  <span className="related-artists-graph-tooltip" onClick={onClick}>
    What&apos;s This?
  </span>
);

const RelatedArtistsGraphModal: React.FC<{ onClose: () => void }> = ({ onClose }) => (
  <div className="related-artists-graph-modal-backdrop" onClick={onClose}>
    <div className="related-artists-graph-modal">
      <div className="close-button" onClick={onClose}>
        ✕
      </div>
      <h2>Artist Relationship Graph</h2>

      <p>
        This graph shows the relationships between your top artists as shown by listening patterns
        of other Spotify users. If two artists are connected, it means that listeners of one artist
        have a high chance of listening to the other as well. This data comes directly from Spotify.
      </p>
      <p>
        Although related artists often make similar types of music that can be classified into the
        same or similar genres, this is not always the case. Because of this, the related artists
        graph can be a powerful tool to visualize the world of music outside of a traditional
        genre-based context.
      </p>

      <h2>How to Use</h2>
      <p>
        You can drag the graph around using your mouse and zoom using the mouse wheel if you&apos;re
        on a computer. If you&apos;re on a phone or tablet, you can move around by drgging and zoom
        by pinching.
      </p>
      <p>
        If you double-click or double-tap on any artist, it will load additional all other artists
        related to it that are not in your personal top artists and add them to the graph.{' '}
      </p>
    </div>
  </div>
);

const StatsDetailsTabs: React.FC<StatsDetailsTabsProps> = ({ selectedTab, setSelectedTab }) => {
  const history = useHistory();
  const mkOnSelect = (value: StatsDetailsTab) => () => {
    setSelectedTab(value);
    history.push({
      pathname: history.location.pathname,
      search: history.location.search,
      hash: value,
    });
  };

  return (
    <div className="stats-details-tabs">
      {ALL_TABS.map(({ title, value }) => (
        <StatsDetailsTabComp
          key={value}
          title={title}
          isSelected={selectedTab === value}
          onSelect={mkOnSelect(value)}
        />
      ))}
    </div>
  );
};

const StatsDetailsInner: React.FC<{ stats: UserStats; mobile: boolean }> = ({ stats, mobile }) => {
  const history = useHistory();
  // TODO: Default to different default selected tab if we only have one update for the user
  const [selectedTab, setSelectedTab] = useState(
    (() => {
      const matchingTab = ALL_TABS.find((tab) => `#${tab.value}` === history.location.hash);
      if (matchingTab) {
        return matchingTab.value;
      }
      return StatsDetailsTab.Timeline;
    })()
  );
  const { displayName } = useUsername();

  const { tracksCorpus } = useSelector(({ entityStore: { tracks, artists } }) => ({
    tracksCorpus: tracks,
    artistsCorpus: artists,
  }));
  const [playing, setPlaying] = useState<string | false>(false);
  const [relatedArtistsGraphModalOpen, setRelatedArtistsGraphModalOpen] = useState(false);

  return (
    <>
      <div className="stats-details-header">
        <div className="headline-wrapper">
          <div className="headline">
            User stats for{' '}
            <span style={{ color: colors.pink }} className="username">
              {displayName}
            </span>{' '}
            on Spotifytrack
          </div>
          {selectedTab === StatsDetailsTab.Compare ? null : <ShareIcons />}
        </div>
        <StatsDetailsTabs selectedTab={selectedTab} setSelectedTab={setSelectedTab} />
      </div>

      {(() => {
        let content: React.ReactNode;
        switch (selectedTab) {
          case StatsDetailsTab.RelatedArtistsGraph: {
            return (
              <>
                {relatedArtistsGraphModalOpen ? (
                  <RelatedArtistsGraphModal
                    onClose={() => setRelatedArtistsGraphModalOpen(false)}
                  />
                ) : null}
                <RelatedArtistsGraphTooltip onClick={() => setRelatedArtistsGraphModalOpen(true)} />
                <RelatedArtistsGraphForUser />
              </>
            );
          }
          case StatsDetailsTab.Tracks: {
            content = (
              <ImageBoxGrid
                renderItem={(i, timeframe) => {
                  if (!stats.tracks) {
                    return null;
                  }
                  const trackId = stats.tracks[timeframe][i];
                  if (!trackId) {
                    return null;
                  }
                  const track = tracksCorpus[trackId];

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
                getItemCount={(timeframe) => (stats.tracks ? stats.tracks[timeframe].length : 0)}
                initialItems={mobile ? 9 : 10}
                disableHeader
              />
            );
            break;
          }
          case StatsDetailsTab.Artists: {
            content = <ArtistCards mobile={mobile} />;
            break;
          }
          case StatsDetailsTab.Genres: {
            return <GenresTreemap />;
          }
          case StatsDetailsTab.Timeline: {
            content = <Timeline />;
            break;
          }
          case StatsDetailsTab.Compare: {
            content = <CompareLanding />;
            break;
          }
        }

        return <div className="details">{content}</div>;
      })()}
    </>
  );
};

const StatsDetails = withMobileProp({ maxDeviceWidth: 800 })(StatsDetailsInner);

const StatsContent: React.FC<
  { username: string; statsForUser: ValueOf<UserStatsState> } & Pick<ReactRouterRouteProps, 'match'>
> = ({ match, username, statsForUser }) => {
  if (match.params.artistId) {
    return <ArtistStats match={match} />;
  } else if (match.params.genre) {
    return <GenreStats username={username} genre={match.params.genre} />;
  } else {
    if (!statsForUser?.tracks || !statsForUser.artists) {
      return <Loading style={{ marginTop: 100 }} />;
    }
    return <StatsDetails stats={statsForUser!} />;
  }
};

const Stats: React.FC<ReactRouterRouteProps> = ({
  match,
  match: {
    params: { username },
  },
}) => {
  const statsForUser = useSelector(({ userStats }) => userStats[username]);

  useOnce(async () => {
    if (statsForUser && statsForUser.tracks && statsForUser.artists) {
      return;
    }

    const userStats = await fetchUserStats(username);
    if (!userStats) {
      return;
    }
    const { last_update_time, tracks, artists } = userStats;

    dispatch(
      actionCreators.entityStore.ADD_TRACKS(
        R.flatten(Object.values(tracks)).reduce(
          (acc: { [trackId: string]: Track }, datum: Track) => ({ ...acc, [datum.id]: datum }),
          {}
        )
      )
    );
    dispatch(
      actionCreators.entityStore.ADD_ARTISTS(
        R.flatten(Object.values(artists)).reduce(
          (acc: { [artistId: string]: Artist }, datum: Artist) => ({ ...acc, [datum.id]: datum }),
          {}
        )
      )
    );
    dispatch(
      actionCreators.userStats.ADD_USER_STATS(username, {
        last_update_time,
        // TODO: Fix this type hackery when you're less lazy and ennui-riddled
        tracks: mapObj((tracks as any) as { [key: string]: { id: string }[] }, (tracks) =>
          tracks.map(R.prop('id'))
        ) as any,
        artists: mapObj((artists as any) as { [key: string]: { id: string }[] }, (artists) =>
          artists.map(R.prop('id'))
        ) as any,
        artistStats: {},
      })
    );
  });

  return (
    <main className="stats">
      <StatsContent username={username} match={match} statsForUser={statsForUser} />
    </main>
  );
};

export default Stats;

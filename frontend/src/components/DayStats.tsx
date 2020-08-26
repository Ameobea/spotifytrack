import React from 'react';
import { useSelector } from 'react-redux';
import * as R from 'ramda';

import { Artist, ReduxStore, TimelineEvent } from 'src/types';
import type { TimelineDay } from './Timeline';
import { Artist as ArtistCard, ImageBoxGrid } from '../Cards';

const EventTypePrecedence: TimelineEvent['type'][] = ['artistFirstSeen', 'topTrackFirstSeen'];

const EventTypeTitleByEventType: { [K in TimelineEvent['type']]: string } = {
  artistFirstSeen: 'Artist Seen for the First Time',
  topTrackFirstSeen: 'Top Track First Seen for the First Time',
};

const ArtistFirstSeenRenderer: React.FC<{
  events: (TimelineEvent & { type: 'artistFirstSeen' })[];
}> = ({ events }) => {
  const { artists } = useSelector((state: ReduxStore) => ({
    artists: events.reduce((acc, evt) => {
      const artist = state.entityStore.artists[evt.artist.id];
      if (artist) {
        acc.set(artist.id, artist);
      }
      return acc;
    }, new Map<string, Artist>()),
  }));

  return (
    <ImageBoxGrid
      horizontallyScrollable
      disableTimeframes
      getItemCount={() => events.length}
      initialItems={events.length}
      title={EventTypeTitleByEventType.artistFirstSeen}
      renderItem={(i) => {
        const artist = artists.get(events[i].artist.id);
        if (!artist) {
          return null;
        }

        return <ArtistCard {...artist} imageSrc={artist.images[0]?.url} />;
      }}
    />
  );
};

const TopTrackFirstSeenRenderer: React.FC<{
  events: (TimelineEvent & { type: 'topTrackFirstSeen' })[];
}> = ({ events }) => {
  return <>TODO</>; // TODO
};

const EventRendererByEventType: {
  [K in TimelineEvent['type']]: React.FC<{ events: (TimelineEvent & { type: K })[] }>;
} = {
  artistFirstSeen: ArtistFirstSeenRenderer,
  topTrackFirstSeen: TopTrackFirstSeenRenderer,
};

const EventsSection: React.FC<{
  eventType: TimelineEvent['type'];
  events: TimelineEvent[];
}> = ({ eventType, events }) => {
  const EventTypeRenderer = EventRendererByEventType[eventType];

  return <div className="events-section">{<EventTypeRenderer events={events as any} />}</div>;
};

const DayStats: React.FC<{ day: TimelineDay }> = ({ day }) => {
  const { artists, tracks } = useSelector((state: ReduxStore) => ({
    artists: state.entityStore.artists,
    tracks: state.entityStore.tracks,
  }));
  const eventsByType = R.groupBy(R.prop('type'), day.events);

  if (Object.keys(eventsByType).length === 0) {
    return <div className="day-stats">No events to display for this day</div>;
  }

  return (
    <div className="day-stats">
      {EventTypePrecedence.filter((key) => !!eventsByType[key]).map((key) => (
        <EventsSection key={key} eventType={key} events={eventsByType[key]} />
      ))}
    </div>
  );
};

export default DayStats;

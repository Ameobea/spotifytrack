import React, { useState } from 'react';
import * as R from 'ramda';
import { withMobileProp } from 'ameo-utils/dist/responsive';

import { TimelineEvent } from 'src/types';
import type { TimelineDay } from './Timeline';
import { ImageBoxGrid, Track as TrackCard } from 'src/Cards';
import ArtistCard from 'src/Cards/ArtistCard';
import { Dayjs } from 'dayjs';

const EventTypePrecedence: TimelineEvent['type'][] = ['artistFirstSeen', 'topTrackFirstSeen'];

const EventTypeTitleByEventType: { [K in TimelineEvent['type']]: string } = {
  artistFirstSeen: 'Artist Seen for the First Time',
  topTrackFirstSeen: 'Top Track First Seen for the First Time',
};

const ArtistFirstSeenRenderer: React.FC<{
  events: (TimelineEvent & { type: 'artistFirstSeen' })[];
  mobile: boolean;
}> = ({ events, mobile }) => (
  <ImageBoxGrid
    horizontallyScrollable
    disableTimeframes
    getItemCount={() => events.length}
    initialItems={events.length}
    title={EventTypeTitleByEventType.artistFirstSeen}
    renderItem={(i) => {
      const artist = events[i].artist;
      return <ArtistCard {...artist} imageSrc={artist.images[0]?.url} mobile={mobile} />;
    }}
  />
);

const TopTrackFirstSeenRenderer: React.FC<{
  events: (TimelineEvent & { type: 'topTrackFirstSeen' })[];
  mobile: boolean;
}> = ({ events, mobile }) => {
  const [playing, setPlaying] = useState<string | false>(false);

  return (
    <ImageBoxGrid
      horizontallyScrollable
      disableTimeframes
      getItemCount={() => events.length}
      initialItems={events.length}
      title={EventTypeTitleByEventType.topTrackFirstSeen}
      renderItem={(i) => {
        const track = events[i].track;
        return (
          <TrackCard
            title={track.name}
            artists={track.album.artists}
            previewUrl={track.preview_url}
            imageSrc={track.album.images[0]?.url}
            playing={playing}
            setPlaying={setPlaying}
            mobile={mobile}
          />
        );
      }}
    />
  );
};

const EventRendererByEventType: {
  [K in TimelineEvent['type']]: React.FC<{
    events: (TimelineEvent & { type: K })[];
    mobile: boolean;
  }>;
} = {
  artistFirstSeen: ArtistFirstSeenRenderer,
  topTrackFirstSeen: TopTrackFirstSeenRenderer,
};

const EventsSectionInner: React.FC<{
  eventType: TimelineEvent['type'];
  events: TimelineEvent[];
  mobile: boolean;
}> = ({ eventType, events, mobile }) => {
  const EventTypeRenderer = EventRendererByEventType[eventType];

  return (
    <div className="events-section">
      {<EventTypeRenderer events={events as any} mobile={mobile} />}
    </div>
  );
};

const EventsSection = withMobileProp({ maxDeviceWidth: 800 })(EventsSectionInner);

const DayHeader: React.FC<{ day: Dayjs; isWeek: boolean }> = ({ day, isWeek }) => (
  <h2 style={{ textAlign: 'center', marginTop: 3, marginBottom: 0 }}>
    {day.format('YYYY-MM-DD')}
    {isWeek ? (
      <>
        {' to '}
        {day.add(7, 'day').format('YYYY-MM-DD')}
      </>
    ) : null}
  </h2>
);

const DayStats: React.FC<{ day: TimelineDay; isWeek?: boolean }> = ({ day, isWeek = false }) => {
  const eventsByType = R.groupBy(R.prop('type'), day.events);

  if (Object.keys(eventsByType).length === 0) {
    return (
      <div className="day-stats">
        <DayHeader day={day.rawDate} isWeek={isWeek} />
        No events to display for this day
      </div>
    );
  }

  return (
    <div className="day-stats">
      <DayHeader day={day.rawDate} isWeek={isWeek} />
      {EventTypePrecedence.filter((key) => !!eventsByType[key]).map((key) => (
        <EventsSection key={key} eventType={key} events={eventsByType[key]} />
      ))}
    </div>
  );
};

export default DayStats;

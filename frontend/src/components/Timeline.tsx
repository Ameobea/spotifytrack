import React, { useMemo, useState } from 'react';
import { useQuery } from 'react-query';
import dayjs from 'dayjs';

import { useUsername } from 'src/store/selectors';
import { fetchTimelineEvents } from 'src/api';
import { ReduxStore, TimelineData, TimelineEvent, Image } from 'src/types';
import './Timeline.scss';
import { connect } from 'react-redux';
import { truncateWithElipsis } from 'src/util';
import { UnimplementedError } from 'ameo-utils';
import DayStats from './DayStats';

export interface TimelineDay {
  date: number;
  isPrevMonth: boolean;
  events: TimelineEvent[];
}

const TimelineEventComp: React.FC<{
  event: TimelineEvent;
  image: Image | null | undefined;
  tooltipContent: React.ReactNode | null;
}> = ({ event, image, tooltipContent }) => (
  <div className="timeline-event">
    {image ? (
      <>
        <img src={image.url} height="100%" width="100%" />
        <div className="timeline-event-tooltip">{tooltipContent}</div>{' '}
      </>
    ) : null}
  </div>
);

const mapStateToProps = (state: ReduxStore, { day }: { day: TimelineDay }) => {
  return {
    eventImages: day.events.map((evt) => {
      switch (evt.type) {
        case 'artistFirstSeen':
          return state.entityStore.artists[evt.artistID]?.images[0];
        case 'topTrackFirstSeen':
          return state.entityStore.tracks[evt.trackID]?.album.images[0];
        default:
          return null;
      }
    }),
    tooltipContent: day.events.map((evt) => {
      switch (evt.type) {
        case 'artistFirstSeen': {
          const artist = state.entityStore.artists[evt.artistID];
          if (!artist) {
            return null;
          }

          return (
            <>
              Artist Seen for the First Time:
              <br />
              <b>{truncateWithElipsis(artist.name, 60)}</b>
            </>
          );
        }
        case 'topTrackFirstSeen': {
          throw new UnimplementedError();
        }
        default:
          return null;
      }
    }),
  };
};

const TimelineDayCompInner: React.FC<
  {
    day: TimelineDay;
    onClick: () => void;
    selected?: boolean;
  } & ReturnType<typeof mapStateToProps>
> = ({ day, eventImages, tooltipContent, onClick, selected }) => (
  <div
    onClick={onClick}
    className="timeline-day"
    style={{ backgroundColor: selected ? '#389' : day.isPrevMonth ? '#222' : '#444' }}
  >
    <div className="timeline-date">{day.date}</div>
    <div className={`timeline-events event-count-${day.events.length > 4 ? '5-9' : '1-4'}`}>
      {day.events.map((event, i) => (
        <TimelineEventComp
          key={event.id}
          event={event}
          image={eventImages[i]}
          tooltipContent={tooltipContent[i]}
        />
      ))}
    </div>
  </div>
);

const TimelineDayComp = connect(mapStateToProps)(TimelineDayCompInner);

const TimelineWeek: React.FC<{
  days: TimelineDay[];
  selectedDay: TimelineDay | null;
  setSelectedDay: (day: TimelineDay) => void;
}> = ({ days, setSelectedDay, selectedDay }) => {
  return (
    <div className="timeline-week">
      {days.map((day) => (
        <TimelineDayComp
          key={day.date}
          selected={day === selectedDay}
          day={day}
          onClick={() => setSelectedDay(day)}
        />
      ))}
    </div>
  );
};

const data: TimelineData = {
  firstUpdate: new Date('2020-05-20'),
  events: [
    {
      date: new Date('2020-08-04'),
      type: 'artistFirstSeen',
      artistID: '0xByDfltDVpk6LDsUMHyI2',
      id: '1',
    },
    {
      date: new Date('2020-08-04'),
      type: 'artistFirstSeen',
      artistID: '3luonLzvSOxdU8ytCaEIK8',
      id: '2',
    },
    {
      date: new Date('2020-08-04'),
      type: 'artistFirstSeen',
      artistID: '3luonLzvSOxdU8ytCaEIK8',
      id: '11',
    },
    {
      date: new Date('2020-08-04'),
      type: 'artistFirstSeen',
      artistID: '3luonLzvSOxdU8ytCaEIK8',
      id: '211',
    },
    {
      date: new Date('2020-08-04'),
      type: 'artistFirstSeen',
      artistID: '3luonLzvSOxdU8ytCaEIK8',
      id: '2311',
    },
    {
      date: new Date('2020-08-08'),
      type: 'artistFirstSeen',
      artistID: '59pWgeY26Q6yJy37QvJflh',
      id: '3',
    },
  ],
};

const Timeline: React.FC = () => {
  const username = useUsername();

  // const { data } = useQuery({ queryKey: ['timeline', username], queryFn: fetchTimelineEvents });

  const [curMonth, setCurMonth] = useState(dayjs().startOf('month'));
  const weeks = useMemo(() => {
    const month = curMonth.month();
    const startOfCurMonth = curMonth.startOf('month');

    const weeks: TimelineDay[][] = [];
    let curWeek: TimelineDay[] = [];

    // Fill in days before the day of the week for the first day of the month, giving it a full week starting on Sunday
    const firstDayOfWeek = startOfCurMonth.day();
    const startOfPrevMonth = startOfCurMonth.subtract(2, 'day');
    const daysInPrevMonth = startOfPrevMonth.daysInMonth();
    for (let i = 0; i < firstDayOfWeek; i++) {
      curWeek.push({ date: daysInPrevMonth - (firstDayOfWeek - i), isPrevMonth: true, events: [] });
    }

    let curDay = dayjs(startOfCurMonth);
    while (curDay.month() === month) {
      // Check to see if we've filled up the whole current week and start a new one if we have
      if (curWeek.length === 7) {
        weeks.push(curWeek);
        curWeek = [];
      }

      const events = [];
      // We assume that the events are sorted by date
      const curDate = curDay.date();
      while (data && data.events.length > 0 && data.events[0].date.getDate() === curDate) {
        // This mutates `data.events`, popping the first element and leaving the tail in place in `data.events`
        events.push(data.events.shift()!);
      }

      curWeek.push({ date: curDate, isPrevMonth: false, events });

      curDay = curDay.add(1, 'day');
    }

    // Pad out the final week to end with Saturday using days from the next month
    let dayOfNextMonth = 1;
    while (curWeek.length < 7) {
      curWeek.push({ date: dayOfNextMonth, isPrevMonth: true, events: [] });
      dayOfNextMonth += 1;
    }
    weeks.push(curWeek);

    return weeks;
  }, [data, curMonth]);
  const [selectedDay, setSelectedDay] = useState<TimelineDay | null>(null);

  return (
    <div className="timeline">
      <h2 className="title">Timeline</h2>

      <div className="timeframe-controls">
        <button title="Back one month" onClick={() => setCurMonth(curMonth.subtract(1, 'month'))}>
          {'<'}
        </button>
        <div className="cur-month">{curMonth.format('MMMM YYYY')}</div>
        <button title="Forward one month" onClick={() => setCurMonth(curMonth.add(1, 'month'))}>
          {'>'}
        </button>
      </div>

      {weeks.map((week) => (
        <TimelineWeek
          key={week[0].date}
          days={week}
          selectedDay={selectedDay}
          setSelectedDay={setSelectedDay}
        />
      ))}

      {selectedDay ? (
        <DayStats day={selectedDay} />
      ) : (
        'Click a day on the calendar above to display details'
      )}
    </div>
  );
};

export default Timeline;

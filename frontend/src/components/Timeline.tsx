import React, { useMemo, useState } from 'react';
import { useQuery } from 'react-query';
import dayjs from 'dayjs';
import { UnimplementedError } from 'ameo-utils';

import { useUsername } from 'src/store/selectors';
import { fetchTimelineEvents } from 'src/api';
import { TimelineEvent, Image } from 'src/types';
import './Timeline.scss';
import { truncateWithElipsis } from 'src/util';
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
}> = ({ image, tooltipContent }) => (
  <div className="timeline-event">
    {image ? (
      <>
        <img src={image.url} height="100%" width="100%" />
        <div className="timeline-event-tooltip">{tooltipContent}</div>{' '}
      </>
    ) : null}
  </div>
);

const getEventImage = (event: TimelineEvent) => {
  switch (event.type) {
    case 'artistFirstSeen':
      return event.artist?.images?.[0];
    case 'topTrackFirstSeen':
      return event.track.album?.images?.[0];
    default:
      return null;
  }
};

const TooltipContent: React.FC<{ event: TimelineEvent }> = ({ event: evt }) => {
  switch (evt.type) {
    case 'artistFirstSeen': {
      return (
        <>
          Artist Seen for the First Time:
          <br />
          <b>{truncateWithElipsis(evt.artist.name, 60)}</b>
        </>
      );
    }
    case 'topTrackFirstSeen': {
      return (
        <>
          Top Track Seen for the First Time:
          <br />
          <b>{truncateWithElipsis(`${evt.track.album.artists[0].name} - ${evt.track.name}`, 60)}</b>
        </>
      );
    }
    default:
      throw new UnimplementedError();
  }
};

const TimelineDayComp: React.FC<{
  day: TimelineDay;
  onClick: () => void;
  selected?: boolean;
}> = ({ day, onClick, selected }) => {
  return (
    <div
      onClick={onClick}
      className="timeline-day"
      style={{ backgroundColor: selected ? '#389' : day.isPrevMonth ? '#222' : '#444' }}
    >
      <div className="timeline-date">{day.date}</div>
      <div className={`timeline-events event-count-${day.events.length > 4 ? '5-9' : '1-4'}`}>
        {day.events.slice(0, 9).map((event) => (
          <TimelineEventComp
            key={event.id}
            event={event}
            image={getEventImage(event)}
            tooltipContent={<TooltipContent event={event} />}
          />
        ))}
      </div>
    </div>
  );
};

const TimelineWeek: React.FC<{
  days: TimelineDay[];
  selectedDay: TimelineDay | null;
  setSelectedDay: (day: TimelineDay) => void;
}> = ({ days, setSelectedDay, selectedDay }) => (
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

const Timeline: React.FC = () => {
  const username = useUsername();

  const [curMonth, setCurMonth] = useState(dayjs().startOf('month'));
  const { data } = useQuery({
    queryKey: ['timeline', username, curMonth.toString()],
    queryFn: fetchTimelineEvents,
  });

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

    let curDay = dayjs(startOfCurMonth).endOf('day');
    while (curDay.month() === month) {
      // Check to see if we've filled up the whole current week and start a new one if we have
      if (curWeek.length === 7) {
        weeks.push(curWeek);
        curWeek = [];
      }

      const events = [];
      // We assume that the events are sorted by date
      const curDate = curDay.date();
      while (
        data &&
        data.events.length > 0 &&
        dayjs(data.events[0].date, 'YYYY-MM-DD').isBefore(curDay)
      ) {
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

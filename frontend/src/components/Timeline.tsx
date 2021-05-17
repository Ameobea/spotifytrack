import React, { useMemo, useRef, useState } from 'react';
import { useQuery } from 'react-query';
import dayjs, { Dayjs } from 'dayjs';
import { UnimplementedError } from 'ameo-utils';
import { withMobileOrDesktop, withMobileProp } from 'ameo-utils/dist/responsive';
import * as R from 'ramda';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faInfoCircle } from '@fortawesome/free-solid-svg-icons';

import { useUsername } from 'src/store/selectors';
import { fetchTimelineEvents } from 'src/api';
import { TimelineEvent, Image, TimelineData } from 'src/types';
import './Timeline.scss';
import { truncateWithElipsis } from 'src/util';
import DayStats from './DayStats';
import { getProxiedImageURL } from 'src/util/index';
import Tooltip from './Tooltip';

export interface TimelineDay {
  date: number;
  rawDate: Dayjs;
  isPrevMonth: boolean;
  events: TimelineEvent[];
}

const getViewportWidth = () =>
  Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);

interface TimelineEventCompProps {
  event: TimelineEvent;
  image: Image | null | undefined;
  tooltipContent: React.ReactNode | null;
  mobile: boolean;
}

const TimelineEventComp: React.FC<TimelineEventCompProps> = ({ image, tooltipContent, mobile }) => (
  <div className="timeline-event">
    {image ? (
      <>
        <img
          src={getProxiedImageURL(mobile ? Math.round(getViewportWidth() / 6) + 80 : 63, image.url)}
          height="100%"
          width="100%"
        />
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

interface TimelineDayCompProps {
  day: TimelineDay;
  onClick: () => void;
  selected?: boolean;
  mobile: boolean;
}

const TimelineDayComp: React.FC<TimelineDayCompProps> = ({ day, onClick, selected, mobile }) => (
  <div
    onClick={onClick}
    className="timeline-day"
    style={{ backgroundColor: selected ? '#389' : day.isPrevMonth ? '#222' : undefined }}
    data-selected={`${selected}`}
  >
    <div className="timeline-date">{day.date}</div>
    <div className={`timeline-events event-count-${day.events.length > 4 ? '5-9' : '1-4'}`}>
      {day.events.slice(0, 9).map((event) => (
        <TimelineEventComp
          key={event.id}
          event={event}
          image={getEventImage(event)}
          tooltipContent={<TooltipContent event={event} />}
          mobile={mobile}
        />
      ))}
    </div>
  </div>
);

interface TimelineWeekProps {
  days: TimelineDay[];
  selectedDay: TimelineDay | null;
  setSelectedDay: (day: TimelineDay) => void;
}

const DesktopTimelineWeek: React.FC<TimelineWeekProps> = ({
  days,
  setSelectedDay,
  selectedDay,
}) => (
  <div className="timeline-week">
    {days.map((day) => (
      <TimelineDayComp
        key={day.date}
        selected={day === selectedDay}
        day={day}
        onClick={() => setSelectedDay(day)}
        mobile={false}
      />
    ))}
  </div>
);

interface InnerTimelineProps {
  weeks: TimelineDay[][];
  selectedDay: TimelineDay | null;
  setSelectedDay: (newSelectedDay: TimelineDay | null) => void;
}

const DesktopTimeline: React.FC<InnerTimelineProps> = ({ weeks, selectedDay, setSelectedDay }) => (
  <>
    {weeks.map((week) => (
      <DesktopTimelineWeek
        key={week[0].date}
        days={week}
        selectedDay={selectedDay}
        setSelectedDay={setSelectedDay}
      />
    ))}
  </>
);

interface MobileTimelineWeekProps extends TimelineWeekProps {
  isSelected: boolean;
  onSelect: () => void;
}

const MobileTimelineWeek: React.FC<MobileTimelineWeekProps> = ({ days, isSelected, onSelect }) => {
  const allEvents = useMemo(
    () => days.reduce((acc, day) => [...acc, ...day.events], [] as TimelineEvent[]),
    [days]
  );

  return (
    <div
      style={
        isSelected
          ? { backgroundColor: '#389', marginTop: 8, borderRadius: 5 }
          : { marginTop: 8, borderRadius: 5 }
      }
    >
      <div className="mobile-week-label">
        {days[0].rawDate.toDate().toLocaleDateString()} -{' '}
        {days[days.length - 1].rawDate.toDate().toLocaleDateString()}
      </div>
      <div
        style={isSelected ? { backgroundColor: '#278' } : undefined}
        className="timeline-events mobile-timeline-week"
        onClick={onSelect}
      >
        {allEvents.slice(0, 12).map((evt) => (
          <TimelineEventComp
            key={evt.id}
            event={evt}
            image={getEventImage(evt)}
            tooltipContent={<TooltipContent event={evt} />}
            mobile
          />
        ))}
      </div>
    </div>
  );
};

const MobileTimeline: React.FC<InnerTimelineProps> = ({ weeks, selectedDay, setSelectedDay }) => (
  <div className="mobile-timeline-weeks">
    {weeks.map((week) => (
      <MobileTimelineWeek
        key={week[0].date}
        days={week}
        selectedDay={selectedDay}
        setSelectedDay={setSelectedDay}
        isSelected={week[0] === selectedDay}
        onSelect={() => setSelectedDay(week[0])}
      />
    ))}
  </div>
);

const InnerTimeline = withMobileOrDesktop({ maxDeviceWidth: 800 })(MobileTimeline, DesktopTimeline);

const maybeUpdateMobileSelectedDay = (
  data: TimelineData | undefined | null,
  mobile: boolean,
  selectedDay: TimelineDay | null,
  setSelectedDay: (newSelectedDay: TimelineDay | null) => void,
  weeks: TimelineDay[][],
  mobileSelectedDay: React.MutableRefObject<{
    lastSelectedDay: TimelineDay;
    mergedDay: TimelineDay;
  } | null>
) => {
  if (!mobile || !data) {
    return;
  }

  // If user hasn't changed their selected day/week, nothing needs to be done
  if (selectedDay === mobileSelectedDay.current?.lastSelectedDay) {
    return;
  }

  if (!selectedDay) {
    mobileSelectedDay.current = null;
    return;
  }

  const targetWeek = weeks.find((week) => week[0] === selectedDay);
  if (!targetWeek) {
    // User probably switched between mobile and desktop modes
    setSelectedDay(null);
    return;
  }

  const [firstDay, ...days] = targetWeek;
  const mergedDay = days.reduce((acc, day) => {
    acc.events = acc.events.concat(day.events);
    return acc;
  }, firstDay);

  mobileSelectedDay.current = { lastSelectedDay: selectedDay, mergedDay };
};

const Timeline: React.FC<{ mobile: boolean }> = ({ mobile }) => {
  const { username } = useUsername();

  const [curMonth, setCurMonth] = useState(dayjs().startOf('month'));
  const { data } = useQuery(['timeline', username, curMonth.toString()], () =>
    fetchTimelineEvents(username, curMonth.toString())
  );

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
      const rawDate = startOfCurMonth.subtract(firstDayOfWeek - i, 'day');
      const date = rawDate.format('YYYY-MM-DD');
      const [eventsForDay, rest] = data?.events
        ? R.partition((evt) => evt.date === date, data.events)
        : [[], []];
      if (data?.events) {
        data.events = rest;
      }

      curWeek.push({
        date: daysInPrevMonth - (firstDayOfWeek - i),
        rawDate,
        isPrevMonth: true,
        events: eventsForDay,
      });
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

      curWeek.push({ date: curDate, rawDate: curDay, isPrevMonth: false, events });

      curDay = curDay.add(1, 'day');
    }

    // Pad out the final week to end with Saturday using days from the next month
    let dayOfNextMonth = 1;
    while (curWeek.length < 7) {
      curWeek.push({
        date: dayOfNextMonth,
        rawDate: curDay.add(dayOfNextMonth, 'day'),
        isPrevMonth: true,
        events: [],
      });
      dayOfNextMonth += 1;
    }
    weeks.push(curWeek);

    return weeks;
  }, [data, curMonth]);
  const [selectedDay, setSelectedDay] = useState<TimelineDay | null>(null);
  const mobileSelectedDay = useRef<{ lastSelectedDay: TimelineDay; mergedDay: TimelineDay } | null>(
    null
  );

  maybeUpdateMobileSelectedDay(data, mobile, selectedDay, setSelectedDay, weeks, mobileSelectedDay);

  return (
    <div className={`timeline${!data ? ' timeline-loading' : ''}`}>
      <div style={{ display: 'flex', flexDirection: 'row', alignContent: 'flex-start' }}>
        <Tooltip
          tooltip="Shows the first time that tracks and artists were seen by Spotifytrack"
          style={{ marginLeft: 3 }}
        >
          <FontAwesomeIcon icon={faInfoCircle} size="sm" />
        </Tooltip>
      </div>

      <div className="timeframe-controls">
        <button title="Back one month" onClick={() => setCurMonth(curMonth.subtract(1, 'month'))}>
          {'🠔'}
        </button>
        <div className="cur-month">{curMonth.format('MMMM YYYY')}</div>
        <button title="Forward one month" onClick={() => setCurMonth(curMonth.add(1, 'month'))}>
          {'🠖'}
        </button>
      </div>

      <InnerTimeline weeks={weeks} selectedDay={selectedDay} setSelectedDay={setSelectedDay} />

      {selectedDay ? (
        mobile ? (
          <DayStats day={mobileSelectedDay.current!.mergedDay} isWeek />
        ) : (
          <DayStats day={selectedDay} />
        )
      ) : mobile ? (
        'Select a week above to display details'
      ) : (
        'Click a day on the calendar above to display details'
      )}
    </div>
  );
};

const WrappedTimeline = withMobileProp({ maxDeviceWidth: 800 })(Timeline);

export default WrappedTimeline;

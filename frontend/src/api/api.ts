import dayjs, { Dayjs } from 'dayjs';
import { API_BASE_URL } from 'src/conf';
import { TimelineData } from 'src/types';

export const getUrl = (path: string) => `${API_BASE_URL}${path}`;

export const getJsonEndpoint = <T = any>(url: string) =>
  fetch(url)
    .then((res) => res.json() as Promise<T>)
    .catch((err) => {
      console.error(`Error fetching API endpoint: ${url}: `, err);
      throw err;
    });

export const fetchUserStats = (username: string) => getJsonEndpoint(getUrl(`/stats/${username}`));

export const fetchArtistStats = (username: string, artistId: string) =>
  getJsonEndpoint(getUrl(`/stats/${username}/artist/${artistId}`));

export const fetchGenreHistory = (username: string) =>
  getJsonEndpoint(getUrl(`/stats/${username}/genre_history`));

export const fetchTimelineEvents = async (
  _key: string,
  username: string | null,
  startOfCurMonthS: string
) => {
  if (!username) {
    return null;
  }
  const startOfCurMonth = dayjs(startOfCurMonthS);

  const startDOW = startOfCurMonth.day();
  const startDayID = startOfCurMonth.subtract(startDOW, 'day').format('YYYY-MM-DD');

  const startOfNextMonth = startOfCurMonth.add(1, 'month');
  const startOfNextMonthDOW = startOfCurMonth.day();
  const endDayID = startOfNextMonth.add(7 - startOfNextMonthDOW + 1, 'day').format('YYYY-MM-DD');

  return getJsonEndpoint<TimelineData>(
    getUrl(`/stats/${username}/timeline?start_day_id=${startDayID}&end_day_id=${endDayID}`)
  );
};

import dayjs from 'dayjs';

import { API_BASE_URL } from 'src/conf';
import { Artist, TimelineData, Track } from 'src/types';

export const getUrl = (path: string) => `${API_BASE_URL}${path}`;

export const getJsonEndpoint = <T = any>(url: string) =>
  fetch(url)
    .then(async (res) => {
      if (res.status === 404) {
        return null;
      } else if (!res.ok) {
        throw await res.text();
      }

      return res.json() as Promise<T>;
    })
    .catch((err) => {
      console.error(`Error fetching API endpoint: ${url}: `, err);
      throw err;
    });

export const fetchUserStats = (username: string) => getJsonEndpoint(getUrl(`/stats/${username}`));

export const fetchArtistStats = (
  username: string,
  artistId: string
): Promise<{
  artist: Artist;
  top_tracks: [string, number][]; // (trackId, score)
  popularity_history: [string, [number | null, number | null, number | null]][]; // (timestamp string, [short_ranking, medium_ranking, long_ranking])
  tracks_by_id: { [trackId: string]: Track };
} | null> => getJsonEndpoint(getUrl(`/stats/${username}/artist/${artistId}`));

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

export const fetchComparison = (
  _key: string,
  user1: string,
  user2: string
): Promise<{ artists: Artist[]; tracks: Track[] } | null> =>
  getJsonEndpoint(getUrl(`/compare/${user1}/${user2}`));

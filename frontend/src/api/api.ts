import { API_BASE_URL } from 'src/conf';

export const getUrl = (path: string) => `${API_BASE_URL}${path}`;

const getJsonEndpoint = (url: string) =>
  fetch(url)
    .then(res => res.json())
    .catch(err => {
      console.error(`Error fetching API endpoint: ${url}: `, err);
      throw err;
    });

export const fetchUserStats = (username: string) => getJsonEndpoint(getUrl(`/stats/${username}`));

export const fetchArtistStats = (username: string, artistId: string) =>
  getJsonEndpoint(getUrl(`/stats/${username}/artist/${artistId}`));

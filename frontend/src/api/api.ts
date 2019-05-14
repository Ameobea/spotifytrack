import { API_BASE_URL } from '../conf';

export const getUrl = path => `${API_BASE_URL}${path}`;

const getJsonEndpoint = url =>
  fetch(url)
    .then(res => res.json())
    .catch(err => {
      console.error(`Error fetching API endpoint: ${url}: `, err);
      throw err;
    });

export const getUserStats = username => getJsonEndpoint(getUrl(`/stats/${username}`));

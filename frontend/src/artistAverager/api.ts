import { API_BASE_URL } from '../conf';
import { AutocompleteSuggestion } from './ArtistInput/AutocompleteDropdown';

export const getArtistAutocompleteSuggestions = (
  query: string
): Promise<AutocompleteSuggestion[]> => {
  const url = `${API_BASE_URL}/search_artist?q=${encodeURIComponent(query)}`;
  return fetch(url).then((res) => res.json());
};

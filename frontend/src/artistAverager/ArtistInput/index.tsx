import React, { useEffect, useRef, useState } from 'react';
import { useQuery } from 'react-query';

import { getArtistAutocompleteSuggestions, getArtistImageURL } from '../api';
import AutocompleteDropdown, { AutocompleteSuggestion } from './AutocompleteDropdown';
import './ArtistInput.scss';
import { getProxiedImageURL } from 'src/util/index';

interface ArtistInputProps {
  onSelect: (
    spotifyID: { spotifyID: string; name: string; internalID?: number | null } | null
  ) => void;
  onClear: () => void;
  selectedArtist: { spotifyID: string; name: string } | null;
  showImage?: boolean;
  filterAutocompleteResults?: (
    suggestions: AutocompleteSuggestion[]
  ) => Promise<AutocompleteSuggestion[]> | AutocompleteSuggestion[];
  placeholder?: string;
  onFocus?: () => void;
  onBlur?: () => void;
}

const ArtistInput: React.FC<ArtistInputProps> = ({
  onSelect,
  onClear,
  selectedArtist,
  showImage = true,
  filterAutocompleteResults = (suggestions: AutocompleteSuggestion[]) => suggestions,
  placeholder,
  onFocus,
  onBlur,
}) => {
  const [text, setText] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const [selectedSuggestionIx, setSelectedSuggestionIx] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const lastSuggestions = useRef<AutocompleteSuggestion[]>([]);
  const { data: suggestions } = useQuery(['artistAutocomplete', text], ({ queryKey: [, text] }) =>
    text ? getArtistAutocompleteSuggestions(text, filterAutocompleteResults) : []
  );
  useEffect(() => {
    if (suggestions) {
      lastSuggestions.current = suggestions;
    }
    setSelectedSuggestionIx(0);
  }, [suggestions]);

  const { data: artistURL } = useQuery(
    ['artistURL', selectedArtist?.spotifyID],
    ({ queryKey: [, artistSpotifyID] }) => {
      if (artistSpotifyID) {
        return getArtistImageURL(artistSpotifyID);
      }
      return null;
    }
  );

  return (
    <div className="artist-input-wrapper">
      <input
        ref={inputRef}
        onFocus={() => {
          setIsFocused(true);
          setText('');
          onSelect(null);
          onFocus?.();
        }}
        onBlur={() =>
          setTimeout(() => {
            setIsFocused(false);
            onBlur?.();
          }, 100)
        }
        className="artist-input"
        value={text}
        onChange={(evt) => {
          onClear();
          setText(evt.target.value);
        }}
        placeholder={placeholder}
        onKeyDown={(evt) => {
          if (evt.key === 'ArrowDown') {
            setSelectedSuggestionIx(
              Math.min(selectedSuggestionIx + 1, (suggestions?.length ?? 1) - 1)
            );
          } else if (evt.key === 'ArrowUp') {
            setSelectedSuggestionIx(Math.max(selectedSuggestionIx - 1, 0));
          } else if (evt.key === 'Enter') {
            const selected = suggestions?.[selectedSuggestionIx];
            if (!selected) {
              return;
            }
            setText(selected.name);
            onSelect(selected);
            inputRef.current?.blur();
          }
        }}
      />
      {isFocused ? (
        <AutocompleteDropdown
          items={suggestions ?? lastSuggestions.current}
          onSelect={({ spotifyID, internalID }) => {
            const match = (suggestions ?? lastSuggestions.current).find(
              (sugg) => sugg.spotifyID === spotifyID
            )!;
            setText(match.name);
            onSelect({ spotifyID, internalID, name: match.name });
          }}
          selectedIx={selectedSuggestionIx}
          setSelectedIx={setSelectedSuggestionIx}
        />
      ) : null}
      {showImage ? (
        <div className="artist-picker-portrait">
          {artistURL ? <img src={getProxiedImageURL(280, artistURL)} /> : null}
        </div>
      ) : null}
    </div>
  );
};

export default ArtistInput;

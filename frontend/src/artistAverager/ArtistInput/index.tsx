import React, { useEffect, useRef, useState } from 'react';
import { useQuery } from 'react-query';

import { getArtistAutocompleteSuggestions } from '../api';
import AutocompleteDropdown, { AutocompleteSuggestion } from './AutocompleteDropdown';
import './ArtistInput.scss';
import { set } from 'ramda';

interface ArtistInputProps {
  onSelect: (spotifyID: string) => void;
}

const ArtistInput: React.FC<ArtistInputProps> = ({ onSelect }) => {
  const [text, setText] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const [selectedSuggestionIx, setSelectedSuggestionIx] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const lastSuggestions = useRef<AutocompleteSuggestion[]>([]);
  const { data: suggestions } = useQuery(['artistAutocomplete', text], ({ queryKey: [, text] }) =>
    text ? getArtistAutocompleteSuggestions(text) : []
  );
  useEffect(() => {
    if (suggestions) {
      lastSuggestions.current = suggestions;
    }
    setSelectedSuggestionIx(0);
  }, [suggestions]);

  return (
    <>
      <input
        ref={inputRef}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setTimeout(() => setIsFocused(false), 100)}
        className="artist-input"
        value={text}
        onChange={(evt) => setText(evt.target.value)}
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
            onSelect(selected.spotifyID);
            inputRef.current?.blur();
          }
        }}
      />
      {isFocused ? (
        <AutocompleteDropdown
          items={suggestions ?? lastSuggestions.current}
          onSelect={(spotifyID) => {
            const match = (suggestions ?? lastSuggestions.current).find(
              (sugg) => sugg.spotifyID === spotifyID
            )!;
            setText(match.name);
            onSelect(spotifyID);
          }}
          selectedIx={selectedSuggestionIx}
        />
      ) : null}
    </>
  );
};

export default ArtistInput;

import React from 'react';

export interface AutocompleteSuggestion {
  name: string;
  spotifyID: string;
}

interface AutocompleteSuggestionProps {
  name: string;
  onSelect: () => void;
  isSelected: boolean;
}

const AutocompleteDropdownItem: React.FC<AutocompleteSuggestionProps> = ({
  name,
  onSelect,
  isSelected,
}) => (
  <div
    data-selected={isSelected.toString()}
    className="autocomplete-suggestion"
    onMouseDown={(evt) => {
      if (evt.button !== 0) {
        return;
      }
      onSelect();
    }}
  >
    {name}
  </div>
);

interface AutocompleteDropdownProps {
  items: AutocompleteSuggestion[];
  onSelect: (spotifyID: string) => void;
  selectedIx: number | null;
}

const AutocompleteDropdown: React.FC<AutocompleteDropdownProps> = ({
  items,
  onSelect,
  selectedIx,
}) => {
  return (
    <div className="autocomplete-dropdown">
      {items.map(({ name, spotifyID }, i) => (
        <AutocompleteDropdownItem
          key={spotifyID}
          name={name}
          onSelect={() => onSelect(spotifyID)}
          isSelected={i === selectedIx}
        />
      ))}
    </div>
  );
};

export default AutocompleteDropdown;

import React from 'react';

export interface AutocompleteSuggestion {
  name: string;
  spotifyID: string;
  internalID?: number;
}

interface AutocompleteSuggestionProps {
  name: string;
  onSelect: () => void;
  isSelected: boolean;
  onHover: () => void;
}

const AutocompleteDropdownItem: React.FC<AutocompleteSuggestionProps> = ({
  name,
  onSelect,
  isSelected,
  onHover,
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
    onMouseEnter={onHover}
  >
    {name}
  </div>
);

interface AutocompleteDropdownProps {
  items: AutocompleteSuggestion[];
  onSelect: (item: { spotifyID: string; internalID?: number | null }) => void;
  selectedIx: number | null;
  setSelectedIx: (newSelectedIx: number) => void;
}

const AutocompleteDropdown: React.FC<AutocompleteDropdownProps> = ({
  items,
  onSelect,
  selectedIx,
  setSelectedIx,
}) => {
  return (
    <div className="autocomplete-dropdown">
      {items.map(({ name, spotifyID, internalID }, i) => (
        <AutocompleteDropdownItem
          key={spotifyID}
          name={name}
          onSelect={() => onSelect({ spotifyID, internalID })}
          isSelected={i === selectedIx}
          onHover={() => setSelectedIx(i)}
        />
      ))}
    </div>
  );
};

export default AutocompleteDropdown;

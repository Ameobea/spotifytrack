import React from 'react';
import * as R from 'ramda';

import './CheatSheet.scss';

interface CSItemProps {
  name: string;
  keybind: string;
  keybindFlex?: number;
}

const CSItem: React.FC<CSItemProps> = ({ name, keybind, keybindFlex }) => (
  <div className="cheat-sheet-item">
    <div className="name">{name}</div>
    <div className="keybind" style={!R.isNil(keybindFlex) ? { flex: keybindFlex } : undefined}>
      {keybind}
    </div>
  </div>
);

type Keybinds = { name: string; keybind: string }[];

const DESKTOP_FLY_KEYBINDS: Keybinds = [
  { name: 'Exit Fly Mode', keybind: 'ESCAPE' },
  { name: 'Move Forward, Back, Left, Right', keybind: 'W,A,S,D' },
  { name: 'Ascend, Descend', keybind: 'SPACE/Q, Z' },
  { name: 'Increase Speed', keybind: 'SHIFT' },
  { name: 'Play Next Music', keybind: 'LEFT CLICK' },
  { name: 'Play Previous Music', keybind: 'RIGHT CLICK' },
  { name: 'Zoom In/Out', keybind: 'MOUSE WHEEL' },
];

const DESKTOP_ORBIT_KEYBINDS: Keybinds = [
  { name: 'Orbit', keybind: 'Drag' },
  { name: 'Zoom', keybind: 'Scroll Wheel' },
  { name: 'Move Camera In/Out', keybind: 'Hold + Drag Middle Mouse' },
  { name: 'Pan', keybind: 'Hold + Drag Right Mouse' },
  { name: 'Enter Fly Mode', keybind: 'Search for an artist' },
];

const MOBILE_ORBIT_KEYBINDS: Keybinds = [
  { name: 'Zoom', keybind: '2-Finger Pinch' },
  { name: 'Orbit', keybind: '1-Finger Drag' },
  { name: 'Pan', keybind: '2-Finger Drag' },
];

const MOBILE_FLY_KEYBINDS: Keybinds = [
  { name: 'Zoom', keybind: '2-Finger Pinch' },
  { name: 'Orbit', keybind: '1-Finger Drag' },
  { name: 'Pan', keybind: '2-Finger Drag' },
  { name: 'Orbit Artist + Play Music', keybind: 'Tap' },
];

interface CheatSheetProps {
  isMobile: boolean;
  isOrbitMode: boolean;
  setAboutPageOpen: () => void;
}

const CheatSheet: React.FC<CheatSheetProps> = ({ isMobile, isOrbitMode, setAboutPageOpen }) => {
  const { keybinds, keybindFlex } = (() => {
    if (isMobile) {
      if (isOrbitMode) {
        return { keybinds: MOBILE_ORBIT_KEYBINDS, keybindFlex: undefined };
      } else {
        return { keybinds: MOBILE_FLY_KEYBINDS, keybindFlex: undefined };
      }
    } else {
      if (isOrbitMode) {
        return { keybinds: DESKTOP_ORBIT_KEYBINDS, keybindFlex: 1.3 };
      } else {
        return { keybinds: DESKTOP_FLY_KEYBINDS, keybindFlex: undefined };
      }
    }
  })();

  return (
    <div className={`cheat-sheet${isMobile ? ' mobile-cheat-sheet' : ''}`}>
      {isMobile ? (
        <button
          className="cheat-sheet-about-button mobile-cheat-sheet-about-button"
          onClick={setAboutPageOpen}
        >
          About
        </button>
      ) : null}
      <ul>
        {keybinds.map((item) => (
          <CSItem
            key={item.name}
            name={item.name}
            keybindFlex={keybindFlex}
            keybind={item.keybind}
          />
        ))}
      </ul>
      {!isMobile ? (
        <button
          className="cheat-sheet-about-button desktop-cheat-sheet-about-button"
          onClick={setAboutPageOpen}
        >
          About
        </button>
      ) : null}
    </div>
  );
};

export const CollapsedCheatSheet: React.FC<{ isMobile: boolean; isOrbitMode: boolean }> = ({
  isMobile,
}) => {
  if (isMobile) {
    return null;
  }

  return (
    <div className="collapsed-cheat-sheet">
      <div className="cheat-sheet">
        <ul>
          <CSItem name="Exit Fly Mode" keybind="ESCAPE" />
        </ul>
      </div>
    </div>
  );
};

export default CheatSheet;

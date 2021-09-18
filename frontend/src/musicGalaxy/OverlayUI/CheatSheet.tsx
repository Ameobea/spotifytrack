import React from 'react';

import './CheatSheet.scss';

interface CSItemProps {
  name: string;
  keybind: string;
}

const CSItem: React.FC<CSItemProps> = ({ name, keybind }) => (
  <div className="cheat-sheet-item">
    <div className="name">{name}</div>
    <div className="keybind">{keybind}</div>
  </div>
);

const KEYBINDS: { name: string; keybind: string }[] = [
  { name: 'Exit Fly Mode', keybind: 'ESCAPE' },
  { name: 'Move Forward, Back, Left, Right', keybind: 'W,A,S,D' },
  { name: 'Ascend, Descend', keybind: 'SPACE/Q, Z' },
  { name: 'Increase Speed', keybind: 'SHIFT' },
  { name: 'Play Next Music', keybind: 'LEFT CLICK' },
  { name: 'Play Previous Music', keybind: 'RIGHT CLICK' },
  { name: 'Zoom In/Out', keybind: 'MOUSE WHEEL' },
];

const CheatSheet: React.FC = () => (
  <div className="cheat-sheet">
    <ul>
      {KEYBINDS.map((item) => (
        <CSItem key={item.name} name={item.name} keybind={item.keybind} />
      ))}
    </ul>
  </div>
);

export const CollapsedCheatSheet: React.FC = () => (
  <div className="collapsed-cheat-sheet">
    <div className="cheat-sheet">
      <ul>
        <CSItem name="Exit Fly Mode" keybind="ESCAPE" />
      </ul>
    </div>
  </div>
);

export default CheatSheet;

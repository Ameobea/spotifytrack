import React, { useState } from 'react';

import { DEFAULT_VOLUME } from '../conf';
import './VolumeAndReturnToOrbitModeControls.scss';

interface VolumeAndReturnToOrbitModeControlsProps {
  onVolumeChange: (volume: number) => void;
  onReturnToOrbitMode: () => void;
  controlMode: 'orbit' | 'flyorbit' | 'pointerlock';
}

const VolumeAndReturnToOrbitModeControls: React.FC<VolumeAndReturnToOrbitModeControlsProps> = ({
  onVolumeChange,
  onReturnToOrbitMode,
  controlMode,
}) => {
  const [volume, setVolume] = useState(DEFAULT_VOLUME);

  return (
    <div className="volume-and-return-to-orbit-mode-controls">
      <input
        type="range"
        min="0"
        max="1"
        step="0.01"
        value={volume}
        onChange={(e) => {
          setVolume(parseFloat(e.target.value));
          onVolumeChange(parseFloat(e.target.value));
        }}
      />
      <button
        onClick={() => {
          onVolumeChange(0);
          setVolume(0);
        }}
        className="mute-button"
      >
        🔇
      </button>
      {controlMode !== 'orbit' ? (
        <button onClick={onReturnToOrbitMode} className="return-to-orbit-mode-button">
          Return to Overview Mode
        </button>
      ) : null}
    </div>
  );
};

export default VolumeAndReturnToOrbitModeControls;

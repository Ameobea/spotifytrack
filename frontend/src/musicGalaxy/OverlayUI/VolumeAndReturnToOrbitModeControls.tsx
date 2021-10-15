import React, { useState } from 'react';

import { DEFAULT_VOLUME } from '../conf';
import './VolumeAndReturnToOrbitModeControls.scss';

interface VolumeAndReturnToOrbitModeControlsProps {
  onVolumeChange: (volume: number) => void;
  onReturnToOrbitMode: () => void;
}

const VolumeAndReturnToOrbitModeControls: React.FC<VolumeAndReturnToOrbitModeControlsProps> = ({
  onVolumeChange,
  onReturnToOrbitMode,
}) => {
  const [volume, setVolume] = useState(
    localStorage.volume === null || localStorage.volume === undefined
      ? DEFAULT_VOLUME
      : +localStorage.volume
  );

  return (
    <div className="volume-and-return-to-orbit-mode-controls">
      <input
        type="range"
        min="0"
        max="1"
        step="0.01"
        value={volume}
        onChange={(e) => {
          const newVolume = +e.target.value;
          setVolume(newVolume);
          onVolumeChange(newVolume);
          localStorage.volume = newVolume;
        }}
      />
      <button
        onClick={() => {
          onVolumeChange(0);
          setVolume(0);
          localStorage.volume = 0;
        }}
        className="mute-button"
      >
        🔇
      </button>
      <button onClick={onReturnToOrbitMode} className="return-to-orbit-mode-button">
        Return to Overview Mode
      </button>
    </div>
  );
};

export default VolumeAndReturnToOrbitModeControls;

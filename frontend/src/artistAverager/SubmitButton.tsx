import React from 'react';

import './SubmitButton.scss';

interface SubmitButtonProps {
  onSubmit: () => void;
  disabled: boolean;
}

const SubmitButton: React.FC<SubmitButtonProps> = ({ onSubmit, disabled }) => (
  <button disabled={disabled} className="artist-averager-submit-button" onClick={onSubmit}>
    Submit
  </button>
);

export default SubmitButton;

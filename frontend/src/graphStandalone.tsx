import ReactDOM from 'react-dom';
import React from 'react';

import './index.scss';
import { RelatedArtistsGraph } from './components/RelatedArtistsGraph';

const GraphStandalone: React.FC = () => {
  return (
    <div className="graph-standalone">
      <RelatedArtistsGraph relatedArtists={{}} />
    </div>
  );
};

console.log(ReactDOM);
ReactDOM.createRoot(document.getElementById('root')).render(<GraphStandalone />);
